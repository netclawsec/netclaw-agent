"""Multi-account registry — CRUD over ~/.netclaw/web/social_accounts.json.

This adds a *registry layer* on top of the existing single-account flow:
the runtime cookie storage path can stay where it is for backwards compat,
while the registry tracks the (platform, idx, nickname, status) tuple the
UI needs to render an "accounts grid" and let the publisher pick a target.

Cookie isolation per account is intentionally NOT done in this commit —
it requires opencli changes to accept --account-idx and a cookie-path
override. The registry here is the prerequisite. When the opencli surface
gets that flag, set ``cookie_path`` on the registered account and have
the publisher pass it through.

State file::

  {
    "douyin": [
      { "idx": 0, "nickname": "@主号", "cookie_path": null,
        "added_at": 1715000000, "last_used_at": null, "logged_in": null },
      { "idx": 1, "nickname": "@矩阵-01", "cookie_path": null, ... }
    ],
    "xhs": [...],
    "shipinhao": [...]
  }

Routes:
  GET  /api/social/accounts             -> list grouped by platform
  POST /api/social/accounts             -> add  body: {platform, nickname?}
  POST /api/social/accounts/<p>/<i>/delete
  POST /api/social/accounts/<p>/<i>/update body: {nickname?, logged_in?}
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from api.helpers import bad, j, read_body

STATE_DIR = Path.home() / ".netclaw" / "web"
STATE_DIR.mkdir(parents=True, exist_ok=True)
ACCOUNTS_FILE = STATE_DIR / "social_accounts.json"
_LOCK = threading.Lock()

VALID_PLATFORMS = {"douyin", "xhs", "shipinhao"}


def _empty_state() -> dict[str, list[dict[str, Any]]]:
    return {p: [] for p in VALID_PLATFORMS}


def _load() -> dict[str, list[dict[str, Any]]]:
    if not ACCOUNTS_FILE.exists():
        return _empty_state()
    try:
        data = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return _empty_state()
    if not isinstance(data, dict):
        return _empty_state()
    # Normalise: every platform key must exist as a list, even if state file
    # was created before a new platform was added.
    out = _empty_state()
    for p in VALID_PLATFORMS:
        v = data.get(p)
        if isinstance(v, list):
            out[p] = v
    return out


def _save(state: dict[str, list[dict[str, Any]]]) -> None:
    tmp = ACCOUNTS_FILE.with_suffix(
        f"{ACCOUNTS_FILE.suffix}.{uuid.uuid4().hex[:8]}.tmp"
    )
    try:
        tmp.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp.replace(ACCOUNTS_FILE)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _next_idx(rows: list[dict[str, Any]]) -> int:
    """Find the smallest non-negative idx not already taken in ``rows``."""
    used = {int(r.get("idx", -1)) for r in rows if isinstance(r.get("idx"), int)}
    i = 0
    while i in used:
        i += 1
    return i


def handle_list(handler) -> bool:
    state = _load()
    return j(handler, {"accounts": state}, status=200)


def handle_add(handler) -> bool:
    try:
        body = read_body(handler) or {}
        if not isinstance(body, dict):
            raise ValueError("body must be JSON object")
        platform = str(body.get("platform") or "").strip().lower()
        if platform not in VALID_PLATFORMS:
            raise ValueError(f"platform must be one of {sorted(VALID_PLATFORMS)}")
        nickname = str(body.get("nickname") or "").strip()[:50]
    except ValueError as exc:
        return bad(handler, str(exc))
    with _LOCK:
        state = _load()
        idx = _next_idx(state[platform])
        if idx > 99:
            return j(handler, {"error": "too_many_accounts"}, status=400)
        row = {
            "idx": idx,
            "nickname": nickname or f"{platform}-{idx}",
            "cookie_path": None,
            "added_at": int(time.time()),
            "last_used_at": None,
            "logged_in": None,
        }
        state[platform].append(row)
        _save(state)
    return j(handler, {"platform": platform, "account": row}, status=201)


def _find(state: dict[str, list[dict[str, Any]]], platform: str, idx: int) -> int:
    """Return list index of the account row, or -1 if not present."""
    rows = state.get(platform) or []
    for i, r in enumerate(rows):
        if int(r.get("idx", -1)) == idx:
            return i
    return -1


def handle_delete(handler, platform: str, idx_str: str) -> bool:
    if platform not in VALID_PLATFORMS:
        return bad(handler, "bad platform")
    try:
        idx = int(idx_str)
    except ValueError:
        return bad(handler, "idx must be int")
    with _LOCK:
        state = _load()
        i = _find(state, platform, idx)
        if i < 0:
            return j(handler, {"error": "not_found"}, status=404)
        del state[platform][i]
        _save(state)
    return j(handler, {"ok": True}, status=200)


def handle_update(handler, platform: str, idx_str: str) -> bool:
    if platform not in VALID_PLATFORMS:
        return bad(handler, "bad platform")
    try:
        idx = int(idx_str)
        body = read_body(handler) or {}
        if not isinstance(body, dict):
            raise ValueError("body must be JSON object")
    except ValueError as exc:
        return bad(handler, str(exc))
    with _LOCK:
        state = _load()
        i = _find(state, platform, idx)
        if i < 0:
            return j(handler, {"error": "not_found"}, status=404)
        row = dict(state[platform][i])
        if "nickname" in body:
            nickname = str(body["nickname"]).strip()[:50]
            if nickname:
                row["nickname"] = nickname
        if "logged_in" in body:
            v = body["logged_in"]
            if isinstance(v, bool) or v is None:
                row["logged_in"] = v
        # cookie_path is intentionally NOT writable from this endpoint.
        # Once opencli grows a multi-account flag we'll set it server-side
        # to a path under ~/.netclaw/employees/<id>/cookies/<platform>/<idx>/
        # — letting the client write arbitrary paths now would create a
        # file-read primitive when the publisher later passes the value
        # through to opencli. Silently ignore the field.
        state[platform][i] = row
        _save(state)
    return j(handler, row, status=200)
