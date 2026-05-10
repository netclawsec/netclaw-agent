"""Social publish + intercept HTTP handlers — spawn opencli for Douyin/XHS.

This is a thin layer over `opencli douyin <cmd>` / `opencli xhs <cmd>` that
runs the user's REAL Chrome (CDP) — not the mcp_publish/mcp_intercept
sidecar that uses an isolated Playwright Chromium.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from api.helpers import j, read_body

_QUEUE_LOCK = threading.Lock()

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
    # Use a uuid-suffixed tmp file so two writers racing on the same target
    # don't truncate each other's tmp before either rename completes.
    tmp = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


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
    if norm not in ("douyin", "xhs", "shipinhao"):
        raise ValueError("platform must be one of: douyin, xhs, shipinhao")
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
    # Lock the read-modify-write so this route doesn't race with publish-batch
    # (both target QUEUE_FILE; codex review flagged this gap).
    with _QUEUE_LOCK:
        queue = _load_json(QUEUE_FILE, [])
        queue.append(item)
        _save_json(QUEUE_FILE, queue)
    return j(handler, item, status=201)


def handle_publish_batch(handler) -> bool:
    """POST /api/social/publish-batch — fan-out one item to multiple platforms.

    Body:
      {
        title: str,
        video_path: str,
        caption?: str,
        scheduled_at?: str,
        targets: [{platform, account_idx?}, ...]
      }

    Each target produces an independent queue row so the operator can track
    per-platform status. Heavy lifting (real publish) stays in the existing
    single-target opencli flow — this route only enqueues.
    """
    try:
        body = read_body(handler) or {}
        title = _require_field(body, "title")
        # video_path is required — without it the queue row can never be
        # acted on by the worker. Codex review flagged a UI bug that let it
        # through empty; reject at the boundary so frontend bugs surface fast.
        video_path = _require_field(body, "video_path")
        targets = body.get("targets") or []
        if not isinstance(targets, list) or not targets:
            raise ValueError("targets[] must be a non-empty list")
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    # Validate every target up front so a single bad row rejects the batch
    # rather than silently dropping it (caller never learns the row was lost).
    now = int(time.time())
    scheduled_at = body.get("scheduled_at", "")
    cover = body.get("cover", "")
    poi_name = body.get("poi_name", "")
    visibility = body.get("visibility", "public")
    if visibility not in ("public", "friends", "private"):
        visibility = "public"
    topics_raw = body.get("topics") or []
    topics: list[str] = (
        [
            str(t).strip().lstrip("#")
            for t in topics_raw
            if isinstance(t, str) and t.strip()
        ][:10]
        if isinstance(topics_raw, list)
        else []
    )
    new_items: list[dict[str, Any]] = []
    for i, t in enumerate(targets):
        if not isinstance(t, dict):
            return j(handler, {"error": f"targets[{i}] must be an object"}, status=400)
        platform = str(t.get("platform") or "").strip()
        if platform not in ("douyin", "xhs", "shipinhao"):
            return j(
                handler,
                {"error": f"targets[{i}].platform invalid: {platform!r}"},
                status=400,
            )
        try:
            account_idx = int(t.get("account_idx") or 0)
        except (TypeError, ValueError):
            return j(
                handler, {"error": f"targets[{i}].account_idx must be int"}, status=400
            )
        if account_idx < 0 or account_idx > 99:
            return j(
                handler, {"error": f"targets[{i}].account_idx out of range"}, status=400
            )
        new_items.append(
            {
                "id": str(uuid.uuid4()),
                "title": title,
                "platform": platform,
                "target_account_idx": account_idx,
                "video_path": video_path,
                "caption": body.get("caption", ""),
                "cover": cover,
                "topics": topics,
                "visibility": visibility,
                "poi_name": poi_name,
                "scheduled_at": scheduled_at,
                "status": "pending",
                "created_at": now,
            }
        )
    if not new_items:
        return j(handler, {"error": "no valid targets"}, status=400)

    # Lock around the full read-modify-write so concurrent callers don't lose
    # rows when their snapshots overlap.
    with _QUEUE_LOCK:
        queue = _load_json(QUEUE_FILE, [])
        queue.extend(new_items)
        _save_json(QUEUE_FILE, queue)
    return j(handler, {"created": new_items, "count": len(new_items)}, status=201)


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

    id_arg = {"douyin": "aweme_id", "xhs": "note_id", "shipinhao": "feed_id"}[platform]
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


def handle_platforms(handler) -> bool:
    """GET /api/social/platforms — return login state for the 3 social platforms.

    Probes 抖音 via ``opencli douyin profile`` (only platform with a cheap
    profile call). For 小红书 / 视频号 we don't have a cheap "am I logged in"
    command, so we surface ``logged_in: null`` and let the user click through
    to verify in their browser. The login URL list is static and matches what
    the desktop sidebar offers.
    """
    platforms: list[dict[str, Any]] = []

    # ── 抖音 (real probe) ────────────────────────────────────────────────
    douyin: dict[str, Any] = {
        "id": "douyin",
        "name": "抖音",
        "brand": "tiktok",
        "login_url": "https://creator.douyin.com/",
        "logged_in": None,
        "nickname": None,
        "detail": None,
        "error": None,
    }
    if OPENCLI_BIN and Path(OPENCLI_BIN).exists():
        result = _run_opencli(["douyin", "profile"], timeout=15)
        if result.get("ok") and isinstance(result.get("data"), dict):
            data = result["data"]
            douyin["logged_in"] = bool(data.get("uid"))
            douyin["nickname"] = data.get("nickname")
            follower = data.get("follower_count")
            aweme = data.get("aweme_count")
            if follower is not None or aweme is not None:
                bits = []
                if follower is not None:
                    bits.append(f"粉丝 {follower}")
                if aweme is not None:
                    bits.append(f"作品 {aweme}")
                douyin["detail"] = " · ".join(bits)
        elif result.get("ok") is False:
            douyin["logged_in"] = False
            douyin["error"] = (result.get("error") or "未登录或 cookies 已过期")[:200]
    else:
        douyin["error"] = "opencli 未安装"

    platforms.append(douyin)

    # ── 小红书 / 视频号 (URL-only, no cheap login probe available) ───────
    platforms.append(
        {
            "id": "xhs",
            "name": "小红书",
            "brand": "xiaohongshu",
            "login_url": "https://creator.xiaohongshu.com/login",
            "logged_in": None,
            "detail": "暂无快速检测命令，点击下方按钮在浏览器里确认登录态",
        }
    )
    platforms.append(
        {
            "id": "shipinhao",
            "name": "视频号",
            "brand": "wechat",
            "login_url": "https://channels.weixin.qq.com/",
            "logged_in": None,
            "detail": "暂无快速检测命令，点击下方按钮在浏览器里确认登录态",
        }
    )

    return j(handler, {"platforms": platforms})


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
