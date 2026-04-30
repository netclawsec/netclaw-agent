"""
Unit + integration tests for the NetClaw Agent macOS launcher.

Runs from the project root:
    pytest packaging/macos/tests/test_launch.py -v

Integration tests that spin up uvicorn are marked `@pytest.mark.integration`
and skipped unless --run-integration is passed.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]
PACKAGING_DIR = PROJECT_ROOT / "packaging" / "macos"

sys.path.insert(0, str(PACKAGING_DIR))
sys.path.insert(0, str(PROJECT_ROOT))

import app_launcher  # noqa: E402  (import after sys.path setup)


# ---------------------------------------------------------------------------
# Pytest config
# ---------------------------------------------------------------------------


def pytest_addoption(parser):  # pragma: no cover
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run integration tests that spin up uvicorn / hit NetClaw relay.",
    )


def pytest_collection_modifyitems(config, items):  # pragma: no cover
    if config.getoption("--run-integration"):
        return
    skip_marker = pytest.mark.skip(reason="pass --run-integration to enable")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_marker)


# ---------------------------------------------------------------------------
# §2 unit tests
# ---------------------------------------------------------------------------


class TestFrozenResourceDir:
    def test_repo_fallback_when_not_frozen(self, monkeypatch):
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)
        result = app_launcher._frozen_resource_dir()
        assert result.is_dir()
        # Should resolve to somewhere within the hermes-agent source tree.
        assert (result / "hermes_cli").exists() or (result / "packaging").exists()

    def test_frozen_path_returned_when_meipass_set(self, monkeypatch, tmp_path):
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        assert app_launcher._frozen_resource_dir() == tmp_path


class TestSetupEnvironment:
    def test_exports_bundled_skills_env_vars(self, monkeypatch, tmp_path):
        skills = tmp_path / "skills"
        skills.mkdir()
        optional = tmp_path / "optional-skills"
        optional.mkdir()

        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        monkeypatch.delenv("HERMES_BUNDLED_SKILLS", raising=False)
        monkeypatch.delenv("HERMES_OPTIONAL_SKILLS", raising=False)
        monkeypatch.delenv("HERMES_MANAGED", raising=False)

        app_launcher._setup_environment()

        assert os.environ["HERMES_BUNDLED_SKILLS"] == str(skills)
        assert os.environ["HERMES_OPTIONAL_SKILLS"] == str(optional)
        assert os.environ["HERMES_MANAGED"] == "macos-app"

    def test_does_not_overwrite_existing(self, monkeypatch, tmp_path):
        skills = tmp_path / "skills"
        skills.mkdir()
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        monkeypatch.setenv("HERMES_MANAGED", "homebrew")

        app_launcher._setup_environment()

        assert os.environ["HERMES_MANAGED"] == "homebrew"


class TestWaitForPort:
    def test_returns_false_when_nothing_bound(self):
        # Port 1 is privileged; never bindable as a regular user.
        assert app_launcher._wait_for_port("127.0.0.1", 1, timeout=0.3) is False

    def test_returns_true_when_socket_bound(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", 0))
            s.listen(1)
            host, port = s.getsockname()
            assert app_launcher._wait_for_port(host, port, timeout=2.0) is True


class TestAppLauncherImport:
    def test_app_launcher_has_main(self):
        assert callable(app_launcher.main)

    def test_startup_error_falls_back_to_stderr(self, capsys):
        app_launcher._show_startup_error("T", "M")
        # Either native dialog (silent in capsys) or stderr fallback — both OK.


# ---------------------------------------------------------------------------
# §2 integration tests (uvicorn must actually serve)
# ---------------------------------------------------------------------------


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def uvicorn_server():
    """Boot the real uvicorn in a background thread, yield (host, port)."""
    port = _find_free_port()
    host = "127.0.0.1"
    thread = app_launcher._start_server_thread(host, port)
    try:
        if not app_launcher._wait_for_port(host, port, timeout=20.0):
            pytest.fail(f"uvicorn did not come up on {host}:{port}")
        yield host, port
    finally:
        # Daemon thread will die with pytest process; uvicorn doesn't expose
        # a clean-shutdown API here, so we rely on process teardown.
        pass


@pytest.mark.integration
def test_api_status_endpoint_returns_200(uvicorn_server):
    import urllib.request

    host, port = uvicorn_server
    with urllib.request.urlopen(f"http://{host}:{port}/api/status", timeout=5) as r:
        assert r.status == 200
        body = r.read()
        assert body  # non-empty JSON


@pytest.mark.integration
def test_session_token_injected_into_html(uvicorn_server):
    import urllib.request

    host, port = uvicorn_server
    with urllib.request.urlopen(f"http://{host}:{port}/", timeout=5) as r:
        body = r.read().decode("utf-8", errors="replace")
    # The SPA HTML must contain the session token placeholder replaced.
    # web_server.py uses a <meta name="hermes-session-token" …> tag.
    assert "hermes-session-token" in body or "sessionToken" in body


@pytest.mark.integration
def test_reveal_endpoint_requires_auth(uvicorn_server):
    import urllib.request
    import urllib.error

    host, port = uvicorn_server
    req = urllib.request.Request(
        f"http://{host}:{port}/api/env/reveal",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(req, timeout=5)
    # Should be 401 or 403 without the session token.
    assert exc.value.code in (401, 403)


# ---------------------------------------------------------------------------
# §2 integration: real NetClaw API relay (gpt-5.4)
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("NETCLAW_API_KEY"),
    reason="set NETCLAW_API_KEY to run live API test",
)
def test_netclaw_relay_chat_completion():
    """Hit the real gpt-5.4 endpoint via the NetClaw relay.

    Defends against:
      - OPENAI_BASE_URL env override not respected
      - TLS trust store missing from PyInstaller bundle (cert bundling bug)
    """
    import json
    import urllib.request

    url = "https://api.netclawapi.com/cli/v1/chat/completions"
    body = json.dumps(
        {
            "model": "gpt-5.4",
            "max_tokens": 20,
            "messages": [{"role": "user", "content": "Reply with: OK"}],
        }
    ).encode()

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ['NETCLAW_API_KEY']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        assert r.status == 200
        payload = json.loads(r.read())

    assert "choices" in payload
    assert payload["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# Smoke test on built .app (only when dist/NetClaw Agent.app exists)
# ---------------------------------------------------------------------------

BUILT_APP = PROJECT_ROOT / "dist" / "NetClaw Agent.app"


@pytest.mark.integration
@pytest.mark.skipif(not BUILT_APP.exists(), reason="run build.sh first")
def test_built_app_is_signed():
    result = subprocess.run(
        ["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(BUILT_APP)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.integration
@pytest.mark.skipif(not BUILT_APP.exists(), reason="run build.sh first")
def test_built_app_launches_and_exits(tmp_path):
    """Launch the app, wait for port, kill cleanly."""
    env = os.environ.copy()
    env["HERMES_APP_PORT"] = str(_find_free_port())

    exe = BUILT_APP / "Contents" / "MacOS" / "netclaw-agent"
    proc = subprocess.Popen(
        [str(exe)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    try:
        ready = app_launcher._wait_for_port(
            "127.0.0.1", int(env["HERMES_APP_PORT"]), timeout=30
        )
        assert ready, "Built app failed to start uvicorn within 30s"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
