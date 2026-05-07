"""Social publish + intercept HTTP handlers — spawn opencli for Douyin/XHS.

This is a thin layer over `opencli douyin <cmd>` / `opencli xhs <cmd>` that
runs the user's REAL Chrome (CDP) — not the mcp_publish/mcp_intercept
sidecar that uses an isolated Playwright Chromium.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

from api.helpers import j, read_body

OPENCLI_BIN = shutil.which("opencli") or "/opt/homebrew/bin/opencli"
SOCIAL_STATE_DIR = Path.home() / ".netclaw" / "web"
SOCIAL_STATE_DIR.mkdir(parents=True, exist_ok=True)
QUEUE_FILE = SOCIAL_STATE_DIR / "social_queue.json"
TEMPLATES_FILE = SOCIAL_STATE_DIR / "reply_templates.json"
INTERCEPT_TASKS_FILE = SOCIAL_STATE_DIR / "intercept_tasks.json"

# Limit subprocess output to prevent runaway adapters from filling memory.
SUBPROC_TIMEOUT = 180  # seconds
MAX_OUTPUT_BYTES = 4 * 1024 * 1024  # 4 MB


# ─────────────────────────────────────────────────────────────────────────
# JSON state helpers
# ─────────────────────────────────────────────────────────────────────────


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _save_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


# ─────────────────────────────────────────────────────────────────────────
# opencli runner
# ─────────────────────────────────────────────────────────────────────────


def _run_opencli(args: list[str], timeout: int = SUBPROC_TIMEOUT) -> dict[str, Any]:
    """Spawn opencli with -f json, return parsed result.

    Returns a dict with one of:
      - { ok: True, data: <list[dict]> }
      - { ok: False, error: <str>, stdout: <str>, stderr: <str>, returncode: <int> }
    """
    if not OPENCLI_BIN or not Path(OPENCLI_BIN).exists():
        return {"ok": False, "error": "opencli binary not found on PATH"}
    try:
        proc = subprocess.run(
            [OPENCLI_BIN, *args, "-f", "json"],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "error": f"opencli timeout after {timeout}s",
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
        }
    except OSError as exc:
        return {"ok": False, "error": f"opencli spawn failed: {exc}"}

    stdout = (proc.stdout or "")[:MAX_OUTPUT_BYTES]
    stderr = (proc.stderr or "")[:MAX_OUTPUT_BYTES]

    if proc.returncode != 0:
        return {
            "ok": False,
            "error": "opencli non-zero exit",
            "stdout": stdout,
            "stderr": stderr,
            "returncode": proc.returncode,
        }

    try:
        data = json.loads(stdout) if stdout.strip() else []
    except json.JSONDecodeError as exc:
        return {
            "ok": False,
            "error": f"opencli stdout not JSON: {exc}",
            "stdout": stdout,
            "stderr": stderr,
        }

    return {"ok": True, "data": data}


# ─────────────────────────────────────────────────────────────────────────
# Validation helpers
# ─────────────────────────────────────────────────────────────────────────


def _require_field(body: dict[str, Any], field: str, kind: type = str) -> Any:
    val = body.get(field)
    if val is None:
        raise ValueError(f"missing field: {field}")
    if kind is str:
        if not isinstance(val, str) or not val.strip():
            raise ValueError(f"{field} must be a non-empty string")
        return val.strip()
    if kind is int:
        if not isinstance(val, int) or isinstance(val, bool):
            raise ValueError(f"{field} must be an integer")
        return val
    return val


def _validate_platform(platform: str) -> str:
    norm = platform.strip().lower()
    if norm not in ("douyin", "xhs"):
        raise ValueError("platform must be 'douyin' or 'xhs'")
    return norm


# ─────────────────────────────────────────────────────────────────────────
# Publish endpoints
# ─────────────────────────────────────────────────────────────────────────


def handle_publish_upload(handler) -> bool:
    """POST /api/social/upload — upload a video to Douyin Creator via opencli.

    Body: { video_path, title, caption?, cover?, visibility?, schedule_at? }
    """
    try:
        body = read_body(handler) or {}
        video_path = _require_field(body, "video_path")
        title = _require_field(body, "title")
        if not Path(video_path).exists():
            raise ValueError(f"video_path does not exist: {video_path}")
        if len(title) > 30:
            raise ValueError("title must be ≤30 chars")
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    args = [
        "douyin",
        "draft" if not body.get("schedule_at") else "publish",
        video_path,
        "--title",
        title,
    ]
    if body.get("caption"):
        args.extend(["--caption", str(body["caption"])])
    if body.get("cover"):
        args.extend(["--cover", str(body["cover"])])
    visibility = body.get("visibility", "public")
    if visibility in ("public", "friends", "private"):
        args.extend(["--visibility", visibility])
    if body.get("schedule_at"):
        args.extend(["--publish-at", str(body["schedule_at"])])

    result = _run_opencli(args, timeout=300)
    return j(handler, result, status=200 if result.get("ok") else 500)


def handle_publish_queue_get(handler) -> bool:
    """GET /api/social/queue — list locally tracked publish jobs."""
    queue = _load_json(QUEUE_FILE, [])
    return j(handler, {"queue": queue}, status=200)


def handle_publish_queue_post(handler) -> bool:
    """POST /api/social/queue — append a planned publish item to local queue."""
    try:
        body = read_body(handler) or {}
        title = _require_field(body, "title")
        scheduled_at = body.get("scheduled_at", "")
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    queue = _load_json(QUEUE_FILE, [])
    item = {
        "id": str(uuid.uuid4()),
        "title": title,
        "platform": body.get("platform", "douyin"),
        "video_path": body.get("video_path", ""),
        "caption": body.get("caption", ""),
        "scheduled_at": scheduled_at,
        "status": "pending",
        "created_at": int(time.time()),
    }
    queue.append(item)
    _save_json(QUEUE_FILE, queue)
    return j(handler, item, status=201)


def handle_reply_templates_get(handler) -> bool:
    templates = _load_json(TEMPLATES_FILE, [])
    return j(handler, {"templates": templates}, status=200)


def handle_reply_templates_post(handler) -> bool:
    try:
        body = read_body(handler) or {}
        text = _require_field(body, "text")
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    templates = _load_json(TEMPLATES_FILE, [])
    tpl = {
        "id": str(uuid.uuid4()),
        "name": body.get("name", text[:20]),
        "text": text,
        "created_at": int(time.time()),
    }
    templates.append(tpl)
    _save_json(TEMPLATES_FILE, templates)
    return j(handler, tpl, status=201)


# ─────────────────────────────────────────────────────────────────────────
# Intercept endpoints
# ─────────────────────────────────────────────────────────────────────────


def handle_intercept_search(handler) -> bool:
    """POST /api/intercept/search — spawn opencli {platform} search <query>."""
    try:
        body = read_body(handler) or {}
        platform = _validate_platform(_require_field(body, "platform"))
        query = _require_field(body, "query")
        limit = int(body.get("limit", 20))
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    args = [platform, "search", query, "--limit", str(max(1, min(50, limit)))]
    if platform == "douyin" and body.get("type"):
        args.extend(["--type", str(body["type"])])
    result = _run_opencli(args, timeout=120)
    return j(handler, result, status=200 if result.get("ok") else 500)


def handle_intercept_comments(handler) -> bool:
    """POST /api/intercept/comments — spawn opencli {platform} comments <id>."""
    try:
        body = read_body(handler) or {}
        platform = _validate_platform(_require_field(body, "platform"))
        target_id = _require_field(body, "target_id")
        limit = int(body.get("limit", 50))
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    id_arg = "aweme_id" if platform == "douyin" else "note_id"
    args = [platform, "comments", target_id, "--limit", str(max(1, min(200, limit)))]
    result = _run_opencli(args, timeout=180)
    if result.get("ok"):
        result["target_id"] = target_id
        result["id_field"] = id_arg
    return j(handler, result, status=200 if result.get("ok") else 500)


def handle_intercept_reply(handler) -> bool:
    """POST /api/intercept/reply — spawn opencli {platform} reply <id> <text>."""
    try:
        body = read_body(handler) or {}
        platform = _validate_platform(_require_field(body, "platform"))
        target_id = _require_field(body, "target_id")
        text = _require_field(body, "text")
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    args = [platform, "reply", target_id, text]
    if body.get("reply_to"):
        args.extend(["--reply-to", str(body["reply_to"])])
    if body.get("dry_run"):
        args.append("--dry-run")

    result = _run_opencli(args, timeout=120)

    # Record into intercept_tasks log regardless of outcome.
    tasks = _load_json(INTERCEPT_TASKS_FILE, [])
    tasks.append(
        {
            "id": str(uuid.uuid4()),
            "platform": platform,
            "target_id": target_id,
            "reply_to": body.get("reply_to"),
            "text": text,
            "dry_run": bool(body.get("dry_run")),
            "created_at": int(time.time()),
            "ok": bool(result.get("ok")),
            "error": result.get("error"),
        }
    )
    _save_json(INTERCEPT_TASKS_FILE, tasks[-200:])  # keep last 200 only
    return j(handler, result, status=200 if result.get("ok") else 500)


def handle_intercept_tasks(handler) -> bool:
    """GET /api/intercept/tasks — list past intercept tasks."""
    tasks = _load_json(INTERCEPT_TASKS_FILE, [])
    return j(handler, {"tasks": tasks[::-1]}, status=200)


def handle_doctor(handler) -> bool:
    """GET /api/social/doctor — verify opencli is installed + Chrome bridge ok."""
    payload: dict[str, Any] = {"opencli_path": OPENCLI_BIN}
    if not OPENCLI_BIN or not Path(OPENCLI_BIN).exists():
        payload["ok"] = False
        payload["error"] = "opencli not found on PATH"
        return j(handler, payload, status=200)

    try:
        proc = subprocess.run(
            [OPENCLI_BIN, "doctor"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        payload["ok"] = proc.returncode == 0
        payload["stdout"] = (proc.stdout or "")[:8192]
        payload["stderr"] = (proc.stderr or "")[:8192]
        payload["returncode"] = proc.returncode
    except Exception as exc:
        payload["ok"] = False
        payload["error"] = str(exc)
    return j(handler, payload, status=200)
