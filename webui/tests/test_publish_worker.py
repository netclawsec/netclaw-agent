"""Smoke tests for the publish worker."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from unittest import mock

import pytest


@pytest.fixture
def queue_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point QUEUE_FILE at a tmpfile, isolated from real ~/.netclaw.

    Also widens ``_ALLOWED_PUBLISH_ROOTS`` to include the pytest tmp
    directory so test videos created via ``tmp_path`` pass the
    publisher's path-allowlist check. (Real ~/.netclaw and /tmp are
    already permitted in production.)
    """
    fake = tmp_path / "queue.json"
    fake.write_text("[]", encoding="utf-8")
    monkeypatch.setattr("api.social.QUEUE_FILE", fake)
    monkeypatch.setattr("api.publish_worker.QUEUE_FILE", fake)
    from api import publish_worker

    monkeypatch.setattr(
        publish_worker,
        "_ALLOWED_PUBLISH_ROOTS",
        publish_worker._ALLOWED_PUBLISH_ROOTS + (tmp_path.resolve(),),
    )
    return fake


def _enqueue(queue_file: Path, **fields):
    rows = json.loads(queue_file.read_text(encoding="utf-8"))
    item = {
        "id": fields.get("id") or str(uuid.uuid4()),
        "title": fields.get("title", "测试视频"),
        "platform": fields.get("platform", "douyin"),
        "video_path": fields.get("video_path", "/tmp/fake.mp4"),
        "caption": fields.get("caption", ""),
        "scheduled_at": fields.get("scheduled_at", ""),
        "status": fields.get("status", "pending"),
        "created_at": int(time.time()),
    }
    rows.append(item)
    queue_file.write_text(json.dumps(rows), encoding="utf-8")
    return item


def test_claim_skips_non_pending(queue_file: Path):
    from api.publish_worker import _claim_next

    _enqueue(queue_file, status="published")
    _enqueue(queue_file, status="failed")
    assert _claim_next(time.time()) is None


def test_claim_picks_oldest_pending_and_marks_publishing(
    queue_file: Path, tmp_path: Path
):
    from api.publish_worker import _claim_next

    # Create a real fake video so _build_args doesn't reject the row.
    video = tmp_path / "fake.mp4"
    video.write_bytes(b"fake")
    older = _enqueue(queue_file, video_path=str(video), title="老的")
    time.sleep(0.01)
    _enqueue(queue_file, video_path=str(video), title="新的")
    claimed = _claim_next(time.time())
    assert claimed is not None
    assert claimed["id"] == older["id"]
    rows = json.loads(queue_file.read_text(encoding="utf-8"))
    statuses = {r["id"]: r["status"] for r in rows}
    assert statuses[older["id"]] == "publishing"
    assert all(v == "publishing" or v == "pending" for v in statuses.values())


def test_process_one_marks_failed_when_video_missing(queue_file: Path):
    from api.publish_worker import _process_one

    item = _enqueue(queue_file, video_path="/does/not/exist.mp4")
    _process_one(item)
    rows = json.loads(queue_file.read_text(encoding="utf-8"))
    row = next(r for r in rows if r["id"] == item["id"])
    assert row["status"] == "failed"
    assert "missing video_path" in row["error"]


def test_process_one_routes_to_opencli_and_marks_published(
    queue_file: Path, tmp_path: Path
):
    from api import publish_worker

    video = tmp_path / "ok.mp4"
    video.write_bytes(b"ok")
    item = _enqueue(queue_file, video_path=str(video))

    captured: dict = {}

    def _fake_opencli(args, timeout=300):
        captured["args"] = args
        captured["timeout"] = timeout
        return {"ok": True, "data": {"aweme_id": "1234"}}

    with mock.patch.object(publish_worker, "_run_opencli", _fake_opencli):
        publish_worker._process_one(item)

    assert captured["args"][0] == "douyin"
    assert captured["args"][1] == "publish"
    assert str(video) in captured["args"]
    rows = json.loads(queue_file.read_text(encoding="utf-8"))
    row = next(r for r in rows if r["id"] == item["id"])
    assert row["status"] == "published"
    assert "error" not in row


def test_process_one_records_opencli_failure(queue_file: Path, tmp_path: Path):
    from api import publish_worker

    video = tmp_path / "ok.mp4"
    video.write_bytes(b"ok")
    item = _enqueue(queue_file, video_path=str(video))

    with mock.patch.object(
        publish_worker,
        "_run_opencli",
        return_value={"ok": False, "error": "rate_limit", "stderr": "blocked"},
    ):
        publish_worker._process_one(item)

    rows = json.loads(queue_file.read_text(encoding="utf-8"))
    row = next(r for r in rows if r["id"] == item["id"])
    assert row["status"] == "failed"
    assert "rate_limit" in row["error"]


def test_is_due_handles_iso_and_unix(queue_file: Path):
    from api.publish_worker import _is_due

    now = time.time()
    assert _is_due({"scheduled_at": ""}, now) is True
    assert _is_due({"scheduled_at": now - 1}, now) is True
    assert _is_due({"scheduled_at": now + 1000}, now) is False
    # ISO string in the past
    iso_past = "2020-01-01T00:00:00Z"
    assert _is_due({"scheduled_at": iso_past}, now) is True
    # Malformed → treat as due (so operator sees the error)
    assert _is_due({"scheduled_at": "not a date"}, now) is True
