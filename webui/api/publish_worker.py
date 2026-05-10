"""Background worker that drains ~/.netclaw/web/social_queue.json.

The /api/social/publish-batch route enqueues rows but does NOT actually call
the platform — that's this worker's job. We poll the queue every 5 s, claim
the oldest pending row whose ``scheduled_at`` has elapsed, run the platform
adapter via ``_run_opencli``, and write the row's terminal status back.

Concurrency model
-----------------
Single worker thread. Sequential execution per row. Two reasons:

1. Platform anti-spam — bursting 10 publishes in 5 s on one account looks
   exactly like a bot and trips风控. Spacing serial calls is the safer default.
2. Real Chrome (CDP) underneath — opencli drives the user's actual browser
   tab. Two ``opencli douyin publish`` invocations racing for the same Chrome
   profile would clobber each other.

If a tenant later wants per-platform parallelism, replace this single-worker
pattern with a ``Semaphore(per_platform=N)``-style scheduler. Don't add it
prematurely.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.social import (
    QUEUE_FILE,
    _QUEUE_LOCK,
    _load_json,
    _run_opencli,
    _save_json,
)

logger = logging.getLogger(__name__)

# Stay friendly on the queue file — we don't want a wedged worker to spin
# CPU when there's nothing to do, but we also want fresh items to start
# within a few seconds so the UI feels live.
_POLL_SECONDS = 5
# Per-row publish budget. opencli already times out at 300 s; we add a
# slightly larger ceiling here as an outer safety net.
_PUBLISH_TIMEOUT = 600

_PLATFORM_TO_OPENCLI = {
    "douyin": "douyin",
    "xhs": "xhs",
    "shipinhao": "shipinhao",
}


def _is_due(item: dict[str, Any], now_ts: float) -> bool:
    """True if ``item.scheduled_at`` is empty or already in the past."""
    raw = item.get("scheduled_at") or ""
    if not raw:
        return True
    try:
        # Accept both Unix epoch ints and ISO strings.
        if isinstance(raw, (int, float)):
            return float(raw) <= now_ts
        text = str(raw).strip()
        if not text:
            return True
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp() <= now_ts
    except (TypeError, ValueError):
        # Malformed timestamps shouldn't strand the row forever — treat as
        # due so the operator notices via the eventual error.
        return True


def _claim_next(now_ts: float) -> dict[str, Any] | None:
    """Atomically pick the oldest due pending row and flip it to publishing.

    Returns the (mutated) row, or None if nothing's eligible.
    """
    with _QUEUE_LOCK:
        queue = _load_json(QUEUE_FILE, [])
        # Stale-claim recovery: any row stuck in "publishing" past the
        # publish timeout (plus a 60s grace for opencli shutdown) is
        # considered abandoned (process crash / wedged opencli / upgrade).
        # Bump its attempts counter and either retry or fail it. Keeps the
        # queue from accumulating phantom in-flight work.
        stale_threshold = now_ts - (_PUBLISH_TIMEOUT + 60)
        for row in queue:
            if not isinstance(row, dict):
                continue
            if row.get("status") != "publishing":
                continue
            try:
                claimed_at = float(row.get("claimed_at") or 0)
            except (TypeError, ValueError):
                claimed_at = 0
            if claimed_at and claimed_at >= stale_threshold:
                continue
            attempts = int(row.get("attempts") or 0)
            if attempts >= 3:
                row["status"] = "failed"
                row["error"] = "stale claim — abandoned after 3 attempts"
                row["finished_at"] = int(now_ts)
            else:
                row["status"] = "pending"
                row["attempts"] = attempts + 1
                row.pop("claimed_at", None)

        target_idx = -1
        target_created = float("inf")
        for i, item in enumerate(queue):
            if not isinstance(item, dict):
                continue
            if not item.get("id"):
                continue  # malformed — skip; can't track terminal state
            if item.get("status") != "pending":
                continue
            if not _is_due(item, now_ts):
                continue
            try:
                created = float(item.get("created_at") or 0)
            except (TypeError, ValueError):
                # Don't let one bad row stall the whole loop.
                created = 0
            if created < target_created:
                target_created = created
                target_idx = i
        if target_idx < 0:
            _save_json(QUEUE_FILE, queue)  # may have rewritten stale rows
            return None
        queue[target_idx]["status"] = "publishing"
        queue[target_idx]["claimed_at"] = int(now_ts)
        _save_json(QUEUE_FILE, queue)
        return dict(queue[target_idx])


def _finalize(item_id: str, status: str, error: str | None = None) -> None:
    """Write a terminal status back to the queue file."""
    with _QUEUE_LOCK:
        queue = _load_json(QUEUE_FILE, [])
        for row in queue:
            if isinstance(row, dict) and row.get("id") == item_id:
                row["status"] = status
                row["finished_at"] = int(time.time())
                if error is not None:
                    row["error"] = error[:500]
                else:
                    row.pop("error", None)
                break
        _save_json(QUEUE_FILE, queue)


_ALLOWED_VIDEO_EXTS: frozenset[str] = frozenset(
    {".mp4", ".mov", ".m4v", ".webm", ".mkv"}
)
_ALLOWED_COVER_EXTS: frozenset[str] = frozenset({".jpg", ".jpeg", ".png", ".webp"})
# Same allowlist concept as batch_edit._ALLOWED_INPUT_ROOTS — only feed
# opencli files that came from somewhere we control or the user explicitly
# picked. This blocks path traversal / arbitrary-file-read / symlink sneak.
_ALLOWED_PUBLISH_ROOTS: tuple[Path, ...] = (
    (Path.home() / ".netclaw").resolve(),
    (Path.home() / "Downloads").resolve(),
    (Path.home() / "Movies").resolve(),
    (Path.home() / "Desktop").resolve(),
    (Path.home() / "workspace").resolve(),
    Path("/tmp").resolve(),
    Path("/private/tmp").resolve(),
)


def _safe_local_file(raw: str, allowed_exts: frozenset[str]) -> Path | None:
    """Return a resolved Path for a user-supplied path, or None if unsafe.

    Mirrors ``batch_edit._validate_input_path``: real file under an allowed
    root with a known media extension. Anything else (URL, symlink to /etc,
    bogus suffix) is rejected.
    """
    if not raw or "\n" in raw or "\r" in raw:
        return None
    p = Path(raw).expanduser().resolve(strict=False)
    if not p.exists() or not p.is_file():
        return None
    if p.suffix.lower() not in allowed_exts:
        return None
    for root in _ALLOWED_PUBLISH_ROOTS:
        try:
            p.relative_to(root)
            return p
        except ValueError:
            continue
    return None


def _build_args(item: dict[str, Any]) -> list[str] | None:
    """Map a queue row to an ``opencli`` argv. Returns None for unsupported rows."""
    platform = item.get("platform")
    sub = _PLATFORM_TO_OPENCLI.get(platform or "")
    if not sub:
        return None
    video_raw = (item.get("video_path") or "").strip()
    safe_video = _safe_local_file(video_raw, _ALLOWED_VIDEO_EXTS)
    if safe_video is None:
        return None
    title = (item.get("title") or "").strip()
    if not title:
        return None
    args: list[str] = [sub, "publish", str(safe_video), "--title", title]
    caption = (item.get("caption") or "").strip()
    if caption:
        args.extend(["--caption", caption])
    cover_raw = (item.get("cover") or "").strip()
    if cover_raw:
        # Cover may be either an http(s) URL (opencli will download) or a
        # local file. For local paths we apply the same allowlist; URLs
        # pass through unchanged but only http/https schemes.
        if cover_raw.startswith(("http://", "https://")):
            args.extend(["--cover", cover_raw])
        else:
            safe_cover = _safe_local_file(cover_raw, _ALLOWED_COVER_EXTS)
            if safe_cover is not None:
                args.extend(["--cover", str(safe_cover)])
            # else: silently drop cover rather than fail the publish
    visibility = item.get("visibility") or "public"
    if visibility in ("public", "friends", "private"):
        args.extend(["--visibility", visibility])
    topics = item.get("topics") or []
    if isinstance(topics, list):
        for t in topics[:10]:
            if isinstance(t, str) and t.strip():
                args.extend(["--topic", t.strip()])
    schedule_at = (item.get("scheduled_at") or "").strip()
    if schedule_at:
        args.extend(["--publish-at", schedule_at])
    account_idx = item.get("target_account_idx")
    if isinstance(account_idx, int) and account_idx > 0:
        # opencli has a (still-being-rolled-out) flag for multi-account
        # cookie selection; passing it is forward-compatible — older opencli
        # builds will just emit "unknown flag" which we surface as the row's
        # error so operators know to upgrade.
        args.extend(["--account-idx", str(account_idx)])
    return args


def _process_one(item: dict[str, Any]) -> None:
    """Run opencli for one row + persist the outcome. Never raises."""
    item_id = item.get("id")
    if not item_id:
        return
    try:
        args = _build_args(item)
        if args is None:
            _finalize(
                item_id,
                "failed",
                error="invalid item: missing video_path / title or unsupported platform",
            )
            return
        result = _run_opencli(args, timeout=_PUBLISH_TIMEOUT)
        if result.get("ok"):
            _finalize(item_id, "published")
        else:
            stderr = (result.get("stderr") or "").strip()
            err = result.get("error") or "publish failed"
            full = f"{err} | {stderr}" if stderr else err
            _finalize(item_id, "failed", error=full)
    except Exception as exc:  # noqa: BLE001 — never let one row kill the loop
        logger.exception("publish_worker crashed on item %s", item_id)
        _finalize(
            item_id, "failed", error=f"worker exception: {type(exc).__name__}: {exc}"
        )


# ─────────────────────────────────────────────────────────────────────────
# Worker lifecycle
# ─────────────────────────────────────────────────────────────────────────


class PublishWorker:
    """Single-thread daemon that drains the publish queue.

    Idempotent — calling start() multiple times is a no-op once the thread
    is alive. Use ``ensure_running()`` from anywhere; the module-level
    singleton makes it safe under threaded HTTP servers.
    """

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        with self._lock:
            if self.is_running():
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._loop, name="publish-worker", daemon=True
            )
            self._thread.start()
            logger.info("publish_worker started")

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                item = _claim_next(time.time())
            except Exception:
                logger.exception("publish_worker: claim_next failed")
                item = None
            if item is None:
                # Sleep with cancellation responsiveness: wake every 0.5 s
                # so a stop() returns within half a second.
                self._stop.wait(_POLL_SECONDS)
                continue
            _process_one(item)


_singleton = PublishWorker()


def ensure_running() -> PublishWorker:
    """Spawn the worker once per process. Safe to call from many places."""
    _singleton.start()
    return _singleton
