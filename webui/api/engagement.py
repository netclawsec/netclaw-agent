"""Engagement automation rules — CRUD over ~/.netclaw/web/engagement_rules.json.

A "rule" represents one autonomous interaction job (auto-like / auto-comment /
auto-follow) that the engagement worker will execute on a schedule. This file
only owns the persistence + REST surface; the runtime executor (cron + opencli
wrappers) lives in ``cron/jobs.py`` so it can share the existing scheduler.

State file layout::

  [
    {
      "id": "uuid",
      "kind": "like" | "comment" | "follow",
      "platform": "douyin" | "xhs",
      "keyword": "新手化妆",
      "comment_template_id": "uuid?",   # only for kind=comment
      "daily_cap": 50,
      "enabled": true,
      "created_at": 1715000000,
      "last_run_at": null,
      "today_count": 0,
      "today_date": "2026-05-09"
    },
    ...
  ]

Routes (wired in api/routes.py):
  GET    /api/engagement/rules        -> list
  POST   /api/engagement/rules        -> create  body: {kind,platform,keyword,daily_cap,comment_template_id?}
  PATCH  /api/engagement/rules/<id>   -> update toggleable fields
  DELETE /api/engagement/rules/<id>   -> remove
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from api.helpers import bad, j, read_body

STATE_DIR = Path.home() / ".netclaw" / "web"
STATE_DIR.mkdir(parents=True, exist_ok=True)
RULES_FILE = STATE_DIR / "engagement_rules.json"
_RULES_LOCK = threading.Lock()

VALID_KINDS = {"like", "comment", "follow"}
VALID_PLATFORMS = {"douyin", "xhs"}


def _load() -> list[dict[str, Any]]:
    if not RULES_FILE.exists():
        return []
    try:
        data = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _save(rules: list[dict[str, Any]]) -> None:
    tmp = RULES_FILE.with_suffix(f"{RULES_FILE.suffix}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp.write_text(
            json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp.replace(RULES_FILE)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _validate_create(body: dict[str, Any]) -> dict[str, Any]:
    """Validate + normalise a create payload. Raises ValueError on bad input."""
    kind = str(body.get("kind") or "").strip().lower()
    if kind not in VALID_KINDS:
        raise ValueError(f"kind must be one of {sorted(VALID_KINDS)}")
    platform = str(body.get("platform") or "").strip().lower()
    if platform not in VALID_PLATFORMS:
        raise ValueError(f"platform must be one of {sorted(VALID_PLATFORMS)}")
    keyword = str(body.get("keyword") or "").strip()
    if not keyword or len(keyword) > 64:
        raise ValueError("keyword must be 1-64 chars")
    try:
        daily_cap = int(body.get("daily_cap") or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("daily_cap must be int") from exc
    if daily_cap < 1 or daily_cap > 1000:
        raise ValueError("daily_cap must be 1-1000")
    template_id = body.get("comment_template_id")
    if kind == "comment" and template_id and not isinstance(template_id, str):
        raise ValueError("comment_template_id must be string")
    return {
        "kind": kind,
        "platform": platform,
        "keyword": keyword,
        "daily_cap": daily_cap,
        "comment_template_id": template_id if isinstance(template_id, str) else None,
    }


def _rule_id_from_path(path: str) -> str:
    parts = [p for p in path.split("/") if p]
    return unquote(parts[-1]) if parts else ""


# ─────────────────────────────────────────────────────────────────────────
# Handlers
# ─────────────────────────────────────────────────────────────────────────


def handle_list(handler) -> bool:
    rules = _load()
    return j(handler, {"rules": rules}, status=200)


def handle_create(handler) -> bool:
    try:
        body = read_body(handler) or {}
        if not isinstance(body, dict):
            raise ValueError("body must be JSON object")
        validated = _validate_create(body)
    except ValueError as exc:
        return bad(handler, str(exc))
    rule = {
        "id": str(uuid.uuid4()),
        **validated,
        "enabled": False,
        "created_at": int(time.time()),
        "last_run_at": None,
        "today_count": 0,
        "today_date": None,
    }
    with _RULES_LOCK:
        rules = _load()
        rules.append(rule)
        _save(rules)
    return j(handler, rule, status=201)


def handle_update(handler, rule_id: str) -> bool:
    try:
        body = read_body(handler) or {}
        if not isinstance(body, dict):
            raise ValueError("body must be JSON object")
    except ValueError as exc:
        return bad(handler, str(exc))

    with _RULES_LOCK:
        rules = _load()
        idx = next((i for i, r in enumerate(rules) if r.get("id") == rule_id), -1)
        if idx < 0:
            return j(handler, {"error": "not_found"}, status=404)
        rule = dict(rules[idx])
        # Whitelist patchable fields. id / created_at / counters stay locked.
        if "enabled" in body:
            rule["enabled"] = bool(body["enabled"])
        if "daily_cap" in body:
            try:
                cap = int(body["daily_cap"])
            except (TypeError, ValueError):
                return bad(handler, "daily_cap must be int")
            if cap < 1 or cap > 1000:
                return bad(handler, "daily_cap must be 1-1000")
            rule["daily_cap"] = cap
        if "keyword" in body:
            kw = str(body["keyword"]).strip()
            if not kw or len(kw) > 64:
                return bad(handler, "keyword must be 1-64 chars")
            rule["keyword"] = kw
        if "comment_template_id" in body:
            tid = body["comment_template_id"]
            rule["comment_template_id"] = tid if isinstance(tid, str) else None
        rules[idx] = rule
        _save(rules)
    return j(handler, rule, status=200)


def handle_delete(handler, rule_id: str) -> bool:
    with _RULES_LOCK:
        rules = _load()
        new_rules = [r for r in rules if r.get("id") != rule_id]
        if len(new_rules) == len(rules):
            return j(handler, {"error": "not_found"}, status=404)
        _save(new_rules)
    return j(handler, {"ok": True}, status=200)
