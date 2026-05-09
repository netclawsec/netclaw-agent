"""WebUI qxnav (奇心AI / api.ai6800.com) proxy endpoints.

Exposes:
  GET  /api/qxnav/models                  -> /v1/models               (chat model list)
  POST /api/qxnav/generate                -> /v1/media/generate       (image / video task)
  GET  /api/qxnav/status?task_id=...      -> /v1/media/status         (poll a task)

Why this lives behind the WebUI:
- Keeps the API key off the renderer process. The browser only ever sees its
  own origin; the upstream Bearer token is read from
  ``NETCLAW_QXNAV_API_KEY`` at request time and falls back to a built-in
  default key shipped with the desktop installer.
- Lets us swap the upstream base host (api.ai6800.com primary,
  api.ai6700.com fallback) without re-bundling the SPA.

The aggregator is OpenAI-compatible for chat (``/v1/chat/completions``) and
uses a unified async media endpoint for image/video — submit returns a
``task_id``, then poll ``/v1/media/status`` until ``is_final`` is true.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from api.helpers import bad, j


# ── Upstream config ───────────────────────────────────────────────────────────

# Primary + fallback hosts from the qxnav apidoc. Override with
# ``NETCLAW_QXNAV_BASE`` in the WebUI env if you need to point at a private
# mirror; the default tries primary then falls back on connection error.
_DEFAULT_BASES: tuple[str, ...] = (
    "https://api.ai6800.com",
    "https://api.ai6700.com",
)

# API key MUST be supplied via env (NETCLAW_QXNAV_API_KEY) or the per-tenant
# config bootstrap — never bake a fallback into the binary. Any prior build
# that hardcoded a key had that key extractable via `strings <netclaw-agent>`
# from the shipped .app, so we deliberately removed the in-source default
# (the historical key has been rotated).


def _bases() -> tuple[str, ...]:
    override = (os.environ.get("NETCLAW_QXNAV_BASE") or "").strip().rstrip("/")
    if override:
        return (override,)
    return _DEFAULT_BASES


def _api_key() -> str:
    return (os.environ.get("NETCLAW_QXNAV_API_KEY") or "").strip()


# ── Upstream HTTP helpers ─────────────────────────────────────────────────────


def _upstream_request(
    method: str,
    path: str,
    *,
    query: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, Any] | str]:
    """Call the qxnav upstream, trying primary then fallback on transport errors.

    Returns ``(status_code, parsed_json_or_raw_text)``. JSON parsing failures
    surface as a string so the caller can decide whether to forward 502.
    """
    qs = ("?" + urllib.parse.urlencode(query)) if query else ""
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Accept": "application/json",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"

    last_exc: Exception | None = None
    for base in _bases():
        url = f"{base}{path}{qs}"
        req = urllib.request.Request(url, data=payload, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                status = resp.getcode()
                try:
                    return status, json.loads(raw.decode("utf-8") or "{}")
                except Exception:
                    return status, raw.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            # Upstream returned a non-2xx with a JSON body — forward verbatim
            # so the SPA can show the real error. Don't try the fallback host.
            raw = exc.read()
            try:
                return exc.code, json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                return exc.code, raw.decode("utf-8", errors="replace")
        except Exception as exc:
            last_exc = exc
            continue

    return 502, {
        "error": {
            "message": f"qxnav upstream unreachable: {last_exc}",
            "type": "upstream_unreachable",
        }
    }


def _forward(handler, status: int, payload: dict[str, Any] | str) -> bool:
    if isinstance(payload, str):
        payload = {
            "error": {"message": payload[:500], "type": "upstream_non_json"},
        }
        if 200 <= status < 300:
            status = 502
    j(handler, payload, status=status)
    return True


# ── Route handlers ────────────────────────────────────────────────────────────


def handle_models(handler) -> bool:
    """``GET /api/qxnav/models`` — proxy upstream model list."""
    status, payload = _upstream_request("GET", "/v1/models", timeout=15.0)
    return _forward(handler, status, payload)


def handle_status(handler, parsed) -> bool:
    """``GET /api/qxnav/status?task_id=…`` — poll a media generation task."""
    qs = urllib.parse.parse_qs(parsed.query or "")
    task_id = (qs.get("task_id") or [""])[0].strip()
    if not task_id:
        return bad(handler, "task_id is required")
    status, payload = _upstream_request(
        "GET",
        "/v1/media/status",
        query={"task_id": task_id},
        timeout=15.0,
    )
    return _forward(handler, status, payload)


def handle_generate(handler, body: dict[str, Any]) -> bool:
    """``POST /api/qxnav/generate`` — submit an image/video task.

    Body shape (forwarded as-is):
        {"model": "gemini-3-pro-image-preview",
         "prompt": "…",
         "params": {"aspectRatio": "16:9", "imageSize": "2K", ...}}
    """
    model = (body.get("model") or "").strip()
    prompt = body.get("prompt")
    if not model:
        return bad(handler, "model is required")
    if prompt is None:
        return bad(handler, "prompt is required")
    upstream_body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "params": body.get("params") or {},
    }
    # Long timeout — submission is fast (returns task_id) but upstream has been
    # observed to take 5–10s on cold paths.
    status, payload = _upstream_request(
        "POST",
        "/v1/media/generate",
        body=upstream_body,
        timeout=60.0,
    )
    # Upstream wraps submissions as {code, data:{task_id,...}, msg} — unwrap so
    # the SPA can read body.task_id (matches /v1/media/status which is flat).
    if (
        isinstance(payload, dict)
        and isinstance(payload.get("data"), dict)
        and "task_id" in payload["data"]
    ):
        flat: dict[str, Any] = dict(payload["data"])
        if payload.get("msg"):
            flat.setdefault("msg", payload["msg"])
        return _forward(handler, status, flat)
    return _forward(handler, status, payload)
