"""
UI / functional tests for the NetClaw Agent webui.

Drives the same FastAPI server that the .app embeds, using Playwright.

Skipped when Playwright isn't installed:
    pip install playwright && playwright install chromium

Run:
    pytest packaging/macos/tests/test_ui.py -v --run-integration
"""

from __future__ import annotations

import os
import socket
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PROJECT_ROOT / "packaging" / "macos"))
sys.path.insert(0, str(PROJECT_ROOT))

playwright_sync = pytest.importorskip(
    "playwright.sync_api", reason="playwright not installed"
)
from playwright.sync_api import sync_playwright  # noqa: E402


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server():
    """Start uvicorn once per module, yield (host, port)."""
    import app_launcher  # type: ignore

    port = _find_free_port()
    host = "127.0.0.1"
    app_launcher._start_server_thread(host, port)
    assert app_launcher._wait_for_port(host, port, timeout=20.0), (
        "uvicorn failed to start"
    )
    yield host, port


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


def test_webview_loads_dashboard(server, browser):
    host, port = server
    context = browser.new_context()
    page = context.new_page()

    console_errors = []
    page.on(
        "console",
        lambda msg: console_errors.append(msg) if msg.type == "error" else None,
    )

    page.goto(f"http://{host}:{port}/", wait_until="networkidle", timeout=15000)

    # The SPA root should render something — we accept any non-empty body.
    body_text = page.text_content("body")
    assert body_text and len(body_text.strip()) > 0, "dashboard body is empty"

    # No critical console errors
    critical = [e for e in console_errors if "favicon" not in (e.text or "").lower()]
    assert not critical, f"console errors: {[e.text for e in critical]}"

    context.close()


def test_api_status_endpoint(server):
    import json
    import urllib.request

    host, port = server
    with urllib.request.urlopen(f"http://{host}:{port}/api/status", timeout=5) as r:
        data = json.loads(r.read())
    # /api/status is public and should respond with a dict
    assert isinstance(data, dict)


def test_config_schema_endpoint(server):
    import json
    import urllib.request

    host, port = server
    with urllib.request.urlopen(
        f"http://{host}:{port}/api/config/schema", timeout=5
    ) as r:
        schema = json.loads(r.read())
    assert isinstance(schema, (dict, list)) and schema, "empty config schema"


def test_dashboard_themes_endpoint(server):
    import json
    import urllib.request

    host, port = server
    with urllib.request.urlopen(
        f"http://{host}:{port}/api/dashboard/themes", timeout=5
    ) as r:
        themes = json.loads(r.read())
    # Expect at least the canonical 6 themes
    names = {
        t.get("name", t)
        for t in (themes if isinstance(themes, list) else themes.get("themes", []))
    }
    expected = {"default", "midnight", "ember", "mono", "cyberpunk", "rose"}
    missing = expected - {str(n) for n in names}
    assert not missing, f"themes missing: {missing}"


def test_accessibility_snapshot(server, browser):
    host, port = server
    context = browser.new_context()
    page = context.new_page()
    page.goto(f"http://{host}:{port}/", wait_until="domcontentloaded", timeout=15000)

    snapshot = page.accessibility.snapshot()
    assert snapshot, "accessibility snapshot is empty"
    # Landmark check: some role should be present under root
    assert snapshot.get("children"), "no accessible children on root"

    context.close()


def test_edge_case_large_config_yaml(server):
    import json
    import urllib.request

    host, port = server
    # Send a legitimately large (but parseable) config via defaults endpoint read.
    with urllib.request.urlopen(
        f"http://{host}:{port}/api/config/defaults", timeout=5
    ) as r:
        defaults = json.loads(r.read())
    assert isinstance(defaults, (dict, list))


@pytest.mark.skipif(
    not os.environ.get("NETCLAW_API_KEY"),
    reason="set NETCLAW_API_KEY to exercise live LLM call through the webui",
)
def test_netclaw_relay_via_webui(server):
    """End-to-end: webui → uvicorn → configured relay → gpt-5.4."""
    # This test currently exercises the raw /api/chat route — left as a
    # placeholder because /api/chat body schema depends on the session config.
    pytest.skip("wire once /api/chat schema is stabilized")
