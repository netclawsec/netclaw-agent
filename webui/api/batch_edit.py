"""Batch video editor — natural-language style assembly modeled on the
ffmpeg-skill / video-editing-skill command sets (cut / merge / subtitle /
speed / watermark / GIF / silence-removal).

Backend for `/studio/batch-edit`. The frontend collects assembly options;
we translate them into ffmpeg invocations and run them in a worker thread,
persisting per-task progress to ~/.netclaw/web/batch_edit_tasks.json.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from api.helpers import j, read_body

FFMPEG_BIN = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
STATE_DIR = Path.home() / ".netclaw" / "web"
STATE_DIR.mkdir(parents=True, exist_ok=True)
TASKS_FILE = STATE_DIR / "batch_edit_tasks.json"
OUTPUT_ROOT = STATE_DIR / "batch_edit_outputs"
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

FFMPEG_TIMEOUT = 600  # 10 min per single ffmpeg call

_TASKS_LOCK = threading.Lock()

# Cap concurrent renders so a flood of /api/studio/batch-edit submissions
# can't pin every CPU core / saturate the disk. Worker threads spawn freely
# but block on this semaphore before doing real ffmpeg work, so the queue
# unwinds in order without dropping requests.
_render_concurrency = max(
    1, int(os.environ.get("NETCLAW_RENDER_CONCURRENCY", "2") or "2")
)
_RENDER_SEMAPHORE = threading.Semaphore(_render_concurrency)
# Hard ceiling on backlog (running + queued). Past this we 503 the request
# rather than spawn another waiting daemon thread — flooding submissions
# would otherwise pile up threads that each park on the semaphore for an
# hour. Default is generous (4× concurrency) so legitimate bursts are fine.
_RENDER_QUEUE_DEPTH = max(
    _render_concurrency,
    int(
        os.environ.get("NETCLAW_RENDER_QUEUE_DEPTH", str(_render_concurrency * 4))
        or "0"
    ),
)
_render_inflight = threading.BoundedSemaphore(_RENDER_QUEUE_DEPTH)

# Resolved paths must live under one of these roots. Otherwise a malicious
# input could make ffmpeg's concat demuxer read /etc/hosts via a relative
# escape or a symlink target.
_ALLOWED_INPUT_ROOTS: tuple[Path, ...] = (
    (Path.home() / ".netclaw").resolve(),
    (Path.home() / "Downloads").resolve(),
    (Path.home() / "Movies").resolve(),
    (Path.home() / "Desktop").resolve(),
    (Path.home() / "workspace").resolve(),
    Path("/tmp").resolve(),
    Path("/private/tmp").resolve(),
)


def _load_tasks() -> list[dict[str, Any]]:
    if not TASKS_FILE.exists():
        return []
    try:
        return json.loads(TASKS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_tasks(tasks: list[dict[str, Any]]) -> None:
    # uuid-suffixed tmp so concurrent _save_tasks calls don't truncate each
    # other's tmp file before either rename completes.
    tmp = TASKS_FILE.with_suffix(f"{TASKS_FILE.suffix}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp.write_text(
            json.dumps(tasks, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp.replace(TASKS_FILE)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _update_task(task_id: str, **fields: Any) -> None:
    with _TASKS_LOCK:
        tasks = _load_tasks()
        for t in tasks:
            if t.get("id") == task_id:
                t.update(fields)
                t["updated_at"] = int(time.time())
                break
        _save_tasks(tasks)


_ALLOWED_INPUT_EXTS: frozenset[str] = frozenset(
    {
        ".mp4",
        ".mov",
        ".m4v",
        ".webm",
        ".mkv",
        ".avi",
        ".mp3",
        ".m4a",
        ".wav",
        ".aac",
        ".flac",
        ".jpg",
        ".jpeg",
        ".png",
    }
)

# Block manifest / playlist extensions explicitly — even with extension
# allowlist a savvy user could rename a `.m3u8` to `.mp4`; the
# ``-protocol_whitelist file,pipe`` flag we pass to ffmpeg is the real
# defence, but rejecting these names early gives a clearer error.
_BLOCKED_INPUT_EXTS: frozenset[str] = frozenset(
    {
        ".m3u8",
        ".m3u",
        ".sdp",
        ".concat",
        ".txt",
        ".pls",
        ".asx",
        ".ram",
    }
)


def _validate_input_path(raw: Any) -> Path:
    """Resolve + validate a user-supplied input path.

    Raises ValueError if the path is not a string, contains newlines (which
    would break ffmpeg's concat demuxer line-oriented parser), doesn't exist,
    isn't a regular file, has an extension outside the allowlist, or escapes
    every allowed root.
    """
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("input path must be a non-empty string")
    if "\n" in raw or "\r" in raw:
        raise ValueError("input path may not contain newlines")
    p = Path(raw).expanduser().resolve(strict=False)
    if not p.exists() or not p.is_file():
        raise ValueError(f"input not found or not a file: {raw}")
    suffix = p.suffix.lower()
    if suffix in _BLOCKED_INPUT_EXTS:
        raise ValueError(f"playlist/manifest inputs are not allowed: {raw}")
    if suffix not in _ALLOWED_INPUT_EXTS:
        raise ValueError(f"unsupported input extension {suffix!r}: {raw}")
    for root in _ALLOWED_INPUT_ROOTS:
        try:
            p.relative_to(root)
            return p
        except ValueError:
            continue
    raise ValueError(f"input path outside allowed roots: {raw}")


def _ffconcat_quote(p: Path) -> str:
    """Wrap a resolved path for ffmpeg's concat demuxer 'file ...' line.

    The demuxer accepts single-quoted strings; embedded `'` is escaped by
    closing+escaping+reopening: `'\\''`.
    """
    return "'" + str(p).replace("'", "'\\''") + "'"


def _drawtext_escape(s: str) -> str:
    """Escape a string for safe use as `text=` in ffmpeg drawtext.

    drawtext text expansion has many metacharacters: \\ : ' = , ; %.
    Stripping is safer than partial escaping for our short titles.
    """
    out = []
    for ch in s:
        if ch in ("\\", "'", '"', ":", "=", ",", ";", "%", "{", "}"):
            continue
        out.append(ch)
    return "".join(out)[:64]


def _run_ffmpeg(args: list[str], log_lines: list[str], deadline: float) -> bool:
    """Run an ffmpeg invocation, append last stderr lines on failure.

    All invocations are pinned to ``-protocol_whitelist file,pipe`` so a
    crafted manifest (.m3u8 / .sdp / concat list with remote `file
    https://...` lines) cannot trick ffmpeg into making outbound HTTP
    requests on our behalf — that would otherwise be an SSRF primitive.
    """
    remaining = max(1, int(deadline - time.time()))
    timeout = min(FFMPEG_TIMEOUT, remaining)
    try:
        proc = subprocess.run(
            [FFMPEG_BIN, "-y", "-protocol_whitelist", "file,pipe", *args],
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        log_lines.append(f"[timeout] ffmpeg exceeded {timeout}s")
        return False
    except FileNotFoundError:
        log_lines.append(
            "[error] ffmpeg binary not found; install via `brew install ffmpeg`"
        )
        return False
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", errors="replace").splitlines()[-15:]
        log_lines.extend(tail)
        return False
    return True


def _build_video_filter(opts: dict[str, Any]) -> str:
    """Compose -vf chain. Modeled on ffmpeg-skill commands: scale, drawtext, speed."""
    chain: list[str] = []
    aspect = str(opts.get("aspect") or "9:16")
    if aspect == "9:16":
        chain.append(
            "scale=1080:1920:force_original_aspect_ratio=decrease,"
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black"
        )
    elif aspect == "16:9":
        chain.append(
            "scale=1920:1080:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"
        )
    elif aspect == "1:1":
        chain.append(
            "scale=1080:1080:force_original_aspect_ratio=decrease,"
            "pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black"
        )

    title = _drawtext_escape(str(opts.get("top_title") or "").strip())
    if title:
        chain.append(
            f"drawtext=text='{title}':fontcolor=white:fontsize=64:"
            f"box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=80"
        )
    return ",".join(chain) if chain else ""


def _has_audio_track(path: Path) -> bool:
    """Return True if ``path`` contains at least one audio stream.

    Uses ffprobe (ships with ffmpeg). Falls back to True on probe error so we
    don't drop legit audio just because ffprobe misbehaves; the downstream
    ffmpeg call will fail loudly if the assumption was wrong.
    """
    ffprobe = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
    if not Path(ffprobe).exists():
        return True  # can't tell — assume yes
    try:
        proc = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "default=nw=1:nk=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return True
    return "audio" in (proc.stdout or "")


def _atempo_chain(speed: float) -> str:
    """Chain atempo filters because each instance only supports 0.5-2x.

    e.g. 4x → atempo=2.0,atempo=2.0; 0.25x → atempo=0.5,atempo=0.5.
    """
    if speed <= 0:
        return "atempo=1.0"
    parts: list[str] = []
    cur = float(speed)
    while cur > 2.0:
        parts.append("atempo=2.0")
        cur /= 2.0
    while cur < 0.5:
        parts.append("atempo=0.5")
        cur *= 2.0
    parts.append(f"atempo={cur:.4f}")
    return ",".join(parts)


def _process_one(
    task_id: str,
    idx: int,
    inputs: list[Path],
    opts: dict[str, Any],
    deadline: float,
) -> dict[str, Any]:
    log: list[str] = []
    out_dir = OUTPUT_ROOT / task_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"clip_{idx + 1}.mp4"

    # Stage 1 — concat inputs into a single intermediate file.
    list_file = out_dir / f"concat_{idx + 1}.txt"
    list_lines = [f"file {_ffconcat_quote(p)}" for p in inputs]
    list_file.write_text("\n".join(list_lines) + "\n", encoding="utf-8")

    intermediate = out_dir / f"raw_{idx + 1}.mp4"
    # `-safe 0` is required to allow absolute paths in concat lists; we already
    # validated each path against _ALLOWED_INPUT_ROOTS so accepting absolutes
    # is intentional, not a bypass.
    if not _run_ffmpeg(
        [
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            str(intermediate),
        ],
        log,
        deadline,
    ):
        # concat-with-copy fails on heterogeneous inputs; fall back to re-encode.
        if not _run_ffmpeg(
            [
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(intermediate),
            ],
            log,
            deadline,
        ):
            return {"ok": False, "error": "concat failed", "log": log}

    # Stage 2 — render with optional video filters, speed, and BGM mix.
    bgm_path: Path | None = None
    bgm_raw = str(opts.get("bgm_path") or "").strip()
    if bgm_raw:
        try:
            bgm_path = _validate_input_path(bgm_raw)
        except ValueError as exc:
            log.append(f"[warn] bgm ignored: {exc}")

    args: list[str] = ["-i", str(intermediate)]
    if bgm_path is not None:
        args.extend(["-i", str(bgm_path)])

    vf = _build_video_filter(opts)
    try:
        speed = float(opts.get("speed") or 1.0)
    except (TypeError, ValueError):
        speed = 1.0
    speed = max(0.25, min(4.0, speed))

    has_speed = abs(speed - 1.0) > 1e-6

    if has_speed:
        speed_v = f"setpts=PTS/{speed}"
        vf = f"{vf},{speed_v}" if vf else speed_v

    if vf:
        args.extend(["-vf", vf])

    # Audio: combine speed (atempo) + BGM (amix) into one filter_complex
    # graph. Either standalone needs the same machinery so they don't clobber
    # each other (the previous bug: BGM present + speed != 1 dropped atempo).
    # If the source video has no audio track, drawing from [0:a] would crash
    # ffmpeg — substitute anullsrc so atempo/amix still work end-to-end.
    src_has_audio = _has_audio_track(intermediate)
    if bgm_path is not None or has_speed:
        atempo = _atempo_chain(speed) if has_speed else "anull"
        # Source audio handle: real [0:a] when present, otherwise anullsrc.
        if src_has_audio:
            src_audio = "[0:a]"
        else:
            args.extend(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=channel_layout=stereo:sample_rate=44100",
                ]
            )
            # The newly added input is at the end of the input list. Compute
            # its index dynamically: original (intermediate) is 0, optional
            # bgm is 1 if present, then this null source comes next.
            null_idx = 2 if bgm_path is not None else 1
            src_audio = f"[{null_idx}:a]"
        if bgm_path is not None:
            graph = (
                f"{src_audio}{atempo}[va];"
                f"[va][1:a]amix=inputs=2:duration=first:weights=1 0.4[aout]"
            )
        else:
            graph = f"{src_audio}{atempo}[aout]"
        args.extend(["-filter_complex", graph, "-map", "0:v", "-map", "[aout]"])
    elif not src_has_audio:
        # No filter needed but source is silent — explicitly drop audio so the
        # output container doesn't carry a phantom track.
        args.extend(["-an"])

    args.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(out_file),
        ]
    )
    if not _run_ffmpeg(args, log, deadline):
        return {"ok": False, "error": "render failed", "log": log}

    return {
        "ok": True,
        "output_path": str(out_file),
        "size_bytes": out_file.stat().st_size if out_file.exists() else 0,
        "log": log[-5:],
    }


def _worker(task_id: str, count: int, inputs: list[Path], opts: dict[str, Any]) -> None:
    """Worker thread. All exceptions surface as a failed task — never silent.

    Blocks on _RENDER_SEMAPHORE so we never run more than N concurrent
    ffmpeg pipelines (default 2). Tasks queue cleanly: the row stays
    state="queued" in the on-disk store until a slot frees, so the UI
    accurately distinguishes "queued" from "running".
    """
    outputs: list[dict[str, Any]] = []
    # Total budget = FFMPEG_TIMEOUT × renders × 2 (concat + render). Cap at 1h.
    budget = min(3600, FFMPEG_TIMEOUT * count * 2)
    # Outer guard: always release the inflight slot (which the *handler*
    # acquired before spawning us) regardless of how this worker exits.
    try:
        # Wait for a render slot — but enforce a sane upper bound so a wedged
        # worker can't starve newcomers forever.
        if not _RENDER_SEMAPHORE.acquire(timeout=budget):
            _update_task(
                task_id,
                state="failed",
                error="render slot timeout (other tasks holding the queue)",
                outputs=outputs,
            )
            return
        deadline = time.time() + budget
        try:
            for i in range(count):
                _update_task(task_id, progress=f"{i}/{count}", state="running")
                if time.time() >= deadline:
                    outputs.append(
                        {"ok": False, "error": "task deadline exceeded", "log": []}
                    )
                    _update_task(
                        task_id,
                        state="failed",
                        error="task deadline exceeded",
                        outputs=outputs,
                    )
                    return
                result = _process_one(task_id, i, inputs, opts, deadline)
                outputs.append(result)
                if not result.get("ok"):
                    _update_task(
                        task_id,
                        state="failed",
                        error=result.get("error"),
                        outputs=outputs,
                    )
                    return
            _update_task(
                task_id, state="done", progress=f"{count}/{count}", outputs=outputs
            )
        except Exception as exc:  # noqa: BLE001 — worker top-level safety net
            _update_task(
                task_id,
                state="failed",
                error=f"worker crashed: {type(exc).__name__}: {exc}",
                outputs=outputs,
            )
        finally:
            _RENDER_SEMAPHORE.release()
    finally:
        try:
            _render_inflight.release()
        except ValueError:
            # BoundedSemaphore raises if released too many times; defensive
            # — caller already guarantees one acquire per worker.
            pass


def handle_batch_edit_create(handler) -> bool:
    """POST /api/studio/batch-edit — kick off a batch render.

    Body: { inputs: [path,...], count: 1-10, options: {aspect, speed, top_title, bgm_path} }
    """
    try:
        body = read_body(handler) or {}
        if not isinstance(body, dict):
            raise ValueError("body must be a JSON object")
        raw_inputs = body.get("inputs") or []
        if not isinstance(raw_inputs, list) or not raw_inputs:
            raise ValueError("inputs[] required")
        validated_inputs: list[Path] = [_validate_input_path(p) for p in raw_inputs]
        try:
            count = int(body.get("count") or 1)
        except (TypeError, ValueError):
            raise ValueError("count must be int")
        count = max(1, min(10, count))
        options = body.get("options") or {}
        if not isinstance(options, dict):
            raise ValueError("options must be an object")
    except ValueError as exc:
        return j(handler, {"error": str(exc)}, status=400)

    # Reject before allocating a row when the backlog is saturated. This
    # prevents flooding submissions from spawning hundreds of daemon threads
    # that each block on the render semaphore for up to an hour.
    if not _render_inflight.acquire(blocking=False):
        return j(
            handler,
            {
                "error": "render queue is full — try again later",
                "queued": _RENDER_QUEUE_DEPTH,
            },
            status=503,
        )

    task_id = str(uuid.uuid4())
    task = {
        "id": task_id,
        "state": "queued",
        "progress": f"0/{count}",
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
        "count": count,
        "inputs": [str(p) for p in validated_inputs],
        "options": options,
        "outputs": [],
    }
    with _TASKS_LOCK:
        tasks = _load_tasks()
        tasks.append(task)
        _save_tasks(tasks)

    threading.Thread(
        target=_worker,
        args=(task_id, count, validated_inputs, options),
        daemon=True,
    ).start()
    return j(handler, task, status=201)


def handle_batch_edit_list(handler) -> bool:
    """GET /api/studio/batch-edit — list recent tasks (newest first)."""
    tasks = _load_tasks()
    tasks.sort(key=lambda t: t.get("created_at", 0), reverse=True)
    return j(handler, {"tasks": tasks[:50]}, status=200)
