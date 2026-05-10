"""
Hermes Web UI -- Route handlers for GET and POST endpoints.
Extracted from server.py (Sprint 11) so server.py is a thin shell.
"""

import html as _html
import json
import logging
import os
import queue
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import parse_qs

logger = logging.getLogger(__name__)

from hermes_cli.employee_auth import employee_data_root
from api.config import (
    STATE_DIR,
    SESSION_DIR,
    DEFAULT_WORKSPACE,
    DEFAULT_MODEL,
    SESSIONS,
    SESSIONS_MAX,
    LOCK,
    STREAMS,
    STREAMS_LOCK,
    CANCEL_FLAGS,
    SERVER_START_TIME,
    _resolve_cli_toolsets,
    _INDEX_HTML_PATH,
    _WEB_DIST_PATH,
    get_available_models,
    IMAGE_EXTS,
    MD_EXTS,
    MIME_MAP,
    MAX_FILE_BYTES,
    MAX_UPLOAD_BYTES,
    CHAT_LOCK,
    load_settings,
    save_settings,
)
from api.helpers import (
    require,
    bad,
    safe_resolve,
    j,
    t,
    read_body,
    _security_headers,
    _sanitize_error,
    redact_session_data,
    _redact_text,
)

# ── CSRF: validate Origin/Referer on POST ────────────────────────────────────
import re as _re


def _normalize_host_port(value: str) -> tuple[str, str | None]:
    """Split a host or host:port string into (hostname, port|None).
    Handles IPv6 bracket notation, e.g. [::1]:8080."""
    value = value.strip().lower()
    if not value:
        return "", None
    if value.startswith("["):
        end = value.find("]")
        if end != -1:
            host = value[1:end]
            rest = value[end + 1 :]
            if rest.startswith(":") and rest[1:].isdigit():
                return host, rest[1:]
            return host, None
    if value.count(":") == 1:
        host, port = value.rsplit(":", 1)
        if port.isdigit():
            return host, port
    return value, None


def _ports_match(
    origin_scheme: str, origin_port: str | None, allowed_port: str | None
) -> bool:
    """Return True when two ports should be considered equivalent, scheme-aware.

    Treats an absent port as the scheme default: port 80 for http, port 443 for https.
    Port 80 is NOT treated as equivalent to 443 (different protocols = different origins).
    """
    if origin_port == allowed_port:
        return True
    # Determine the default port for the origin's scheme
    default = "443" if origin_scheme == "https" else "80"
    if not origin_port and allowed_port == default:
        return True
    if not allowed_port and origin_port == default:
        return True
    return False


def _allowed_public_origins() -> set[str]:
    """Parse HERMES_WEBUI_ALLOWED_ORIGINS env var (comma-separated) into a set.

    Each entry must include the scheme, e.g. https://myapp.example.com:8000.
    Entries without a scheme are silently skipped and a warning is printed.
    """
    raw = os.getenv("HERMES_WEBUI_ALLOWED_ORIGINS", "")
    result = set()
    for value in raw.split(","):
        value = value.strip().rstrip("/").lower()
        if not value:
            continue
        if not (value.startswith("http://") or value.startswith("https://")):
            import sys

            print(
                f"[webui] WARNING: HERMES_WEBUI_ALLOWED_ORIGINS entry {value!r} is missing "
                f"the scheme (expected https://hostname or http://hostname). Entry ignored.",
                flush=True,
                file=sys.stderr,
            )
            continue
        result.add(value)
    return result


def _check_csrf(handler) -> bool:
    """Reject cross-origin POST requests. Returns True if OK."""
    origin = handler.headers.get("Origin", "")
    referer = handler.headers.get("Referer", "")
    host = handler.headers.get("Host", "")
    if not origin and not referer:
        return True  # non-browser clients (curl, agent) have no Origin
    target = origin or referer
    # Extract host:port from origin/referer
    m = _re.match(r"^https?://([^/]+)", target)
    if not m:
        return False
    origin_host = m.group(1)
    origin_scheme = m.group(0).split("://")[0].lower()  # 'http' or 'https'
    origin_name, origin_port = _normalize_host_port(origin_host)
    # Check against explicitly allowed public origins (env var)
    origin_value = m.group(0).rstrip("/").lower()
    if origin_value in _allowed_public_origins():
        return True
    # Allow same-origin: check Host, X-Forwarded-Host (reverse proxy), and
    # X-Real-Host against the origin. Reverse proxies (Caddy, nginx) set
    # X-Forwarded-Host to the client's original Host header.
    allowed_hosts = [
        h.strip()
        for h in [
            host,
            handler.headers.get("X-Forwarded-Host", ""),
            handler.headers.get("X-Real-Host", ""),
        ]
        if h.strip()
    ]
    for allowed in allowed_hosts:
        allowed_name, allowed_port = _normalize_host_port(allowed)
        if origin_name == allowed_name and _ports_match(
            origin_scheme, origin_port, allowed_port
        ):
            return True
    return False


from api.models import (
    Session,
    get_session,
    new_session,
    all_sessions,
    title_from,
    _write_session_index,
    SESSION_INDEX_FILE,
    load_projects,
    save_projects,
    import_cli_session,
    get_cli_sessions,
    get_cli_session_messages,
)
from api.workspace import (
    load_workspaces,
    save_workspaces,
    get_last_workspace,
    set_last_workspace,
    list_dir,
    read_file_content,
    safe_resolve_ws,
    resolve_trusted_workspace,
)
from api.upload import handle_upload, handle_transcribe
from api.streaming import _sse, _run_agent_streaming, cancel_stream
from api.social import (
    handle_publish_upload,
    handle_publish_batch,
    handle_publish_queue_get,
    handle_publish_queue_post,
    handle_reply_templates_get,
    handle_reply_templates_post,
    handle_intercept_search,
    handle_intercept_comments,
    handle_intercept_reply,
    handle_intercept_tasks,
    handle_doctor as handle_social_doctor,
    handle_platforms as handle_social_platforms,
)
from api.onboarding import (
    apply_onboarding_setup,
    get_onboarding_status,
    complete_onboarding,
    probe_provider_models,
    list_managed_providers,
    save_managed_provider,
    activate_managed_provider,
    delete_managed_provider,
)

# Approval system (optional -- graceful fallback if agent not available)
try:
    from tools.approval import (
        submit_pending as _submit_pending_raw,
        approve_session,
        approve_permanent,
        save_permanent_allowlist,
        is_approved,
        _pending,
        _lock,
        _permanent_approved,
        resolve_gateway_approval,
    )
except ImportError:
    _submit_pending_raw = lambda *a, **k: None
    approve_session = lambda *a, **k: None
    approve_permanent = lambda *a, **k: None
    save_permanent_allowlist = lambda *a, **k: None
    is_approved = lambda *a, **k: True
    resolve_gateway_approval = lambda *a, **k: 0
    _pending = {}
    _lock = threading.Lock()
    _permanent_approved = set()


def submit_pending(session_key: str, approval: dict) -> None:
    """Append a pending approval to the per-session queue.

    Wraps the agent's submit_pending to:
    - Add a stable approval_id (uuid4 hex) so the respond endpoint can target
      a specific entry even when multiple approvals are queued simultaneously.
    - Change the storage from a single overwriting dict value to a list, so
      parallel tool calls each get their own approval slot (fixes #527).
    """
    entry = dict(approval)
    entry.setdefault("approval_id", uuid.uuid4().hex)
    with _lock:
        queue = _pending.setdefault(session_key, [])
        # Replace a legacy non-list value if the agent version uses the old pattern.
        if not isinstance(queue, list):
            _pending[session_key] = [queue]
            queue = _pending[session_key]
        queue.append(entry)
    # NOTE: We do NOT call _submit_pending_raw here — that function overwrites
    # _pending[session_key] with a single dict, which would undo the list we just
    # built. The gateway blocking path uses _gateway_queues (a separate mechanism
    # managed by check_all_command_guards / register_gateway_notify), which is
    # unaffected by _pending. The _pending dict is only used for UI polling.


# Clarify prompts (optional -- graceful fallback if agent not available)
try:
    from api.clarify import (
        submit_pending as submit_clarify_pending,
        get_pending as get_clarify_pending,
        resolve_clarify,
    )
except ImportError:
    submit_clarify_pending = lambda *a, **k: None
    get_clarify_pending = lambda *a, **k: None
    resolve_clarify = lambda *a, **k: 0


# ── Login page locale strings ─────────────────────────────────────────────────
# Add entries here to support more languages on the login page.
# The key must match the 'language' setting value (from static/i18n.js LOCALES).
_LOGIN_LOCALE = {
    "en": {
        "lang": "en",
        "title": "Sign in",
        "subtitle": "Enter your password to continue",
        "placeholder": "Password",
        "btn": "Sign in",
        "invalid_pw": "Invalid password",
        "conn_failed": "Connection failed",
    },
    "es": {
        "lang": "es-ES",
        "title": "Iniciar sesi\u00f3n",
        "subtitle": "Introduce tu contrase\u00f1a para continuar",
        "placeholder": "Contrase\u00f1a",
        "btn": "Entrar",
        "invalid_pw": "Contrase\u00f1a inv\u00e1lida",
        "conn_failed": "Error de conexi\u00f3n",
    },
    "de": {
        "lang": "de-DE",
        "title": "Anmelden",
        "subtitle": "Geben Sie Ihr Passwort ein, um fortzufahren",
        "placeholder": "Passwort",
        "btn": "Anmelden",
        "invalid_pw": "Ung\u00fcltiges Passwort",
        "conn_failed": "Verbindung fehlgeschlagen",
    },
    "zh": {
        "lang": "zh-CN",
        "title": "\u767b\u5f55",
        "subtitle": "\u8f93\u5165\u5bc6\u7801\u7ee7\u7eed\u4f7f\u7528",
        "placeholder": "\u5bc6\u7801",
        "btn": "\u767b\u5f55",
        "invalid_pw": "\u5bc6\u7801\u9519\u8bef",
        "conn_failed": "\u8fde\u63a5\u5931\u8d25",
    },
    "zh-Hant": {
        "lang": "zh-TW",
        "title": "\u767b\u5f55",
        "subtitle": "\u8f38\u5165\u5bc6\u78bc\u7e7c\u7e8c\u4f7f\u7528",
        "placeholder": "\u5bc6\u78bc",
        "btn": "\u767b\u5f55",
        "invalid_pw": "\u5bc6\u78bc\u932f\u8aa4",
        "conn_failed": "\u9023\u63a5\u5931\u6557",
    },
}


def _resolve_login_locale_key(raw_lang: str | None) -> str:
    """Resolve settings.language to a known _LOGIN_LOCALE key."""
    if not raw_lang:
        return "en"
    lang = str(raw_lang).strip()
    if not lang:
        return "en"
    if lang in _LOGIN_LOCALE:
        return lang

    normalized = lang.replace("_", "-")
    lower = normalized.lower()

    # Case-insensitive direct key match first.
    for key in _LOGIN_LOCALE:
        if key.lower() == lower:
            return key

    # Common Chinese aliases.
    if (
        lower == "zh"
        or lower.startswith("zh-cn")
        or lower.startswith("zh-sg")
        or lower.startswith("zh-hans")
    ):
        return "zh"
    if (
        lower.startswith("zh-tw")
        or lower.startswith("zh-hk")
        or lower.startswith("zh-mo")
        or lower.startswith("zh-hant")
    ):
        return "zh-Hant" if "zh-Hant" in _LOGIN_LOCALE else "zh"

    # Fallback to base language subtag (e.g. en-US -> en).
    base = lower.split("-", 1)[0]
    for key in _LOGIN_LOCALE:
        if key.lower() == base:
            return key
    return "en"


# ── Login page (self-contained, no external deps) ────────────────────────────
_LOGIN_PAGE_HTML = """<!doctype html>
<html lang="{{LANG}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{BOT_NAME}} — {{LOGIN_TITLE}}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1a2e;color:#e8e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#16213e;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:36px 32px;
  width:320px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
.logo{width:48px;height:48px;border-radius:12px;background:linear-gradient(145deg,#e8a030,#e94560);
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:#fff;
  margin:0 auto 12px;box-shadow:0 2px 12px rgba(233,69,96,.3)}
h1{font-size:18px;font-weight:600;margin-bottom:4px}
.sub{font-size:12px;color:#8888aa;margin-bottom:24px}
input{width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.1);
  background:rgba(255,255,255,.04);color:#e8e8f0;font-size:14px;outline:none;margin-bottom:14px;
  transition:border-color .15s}
input:focus{border-color:rgba(124,185,255,.5);box-shadow:0 0 0 3px rgba(124,185,255,.1)}
button{width:100%;padding:10px;border-radius:10px;border:none;background:rgba(124,185,255,.15);
  border:1px solid rgba(124,185,255,.3);color:#7cb9ff;font-size:14px;font-weight:600;cursor:pointer;
  transition:all .15s}
button:hover{background:rgba(124,185,255,.25)}
.err{color:#e94560;font-size:12px;margin-top:10px;display:none}
</style></head><body>
<div class="card">
  <div class="logo">{{BOT_NAME_INITIAL}}</div>
  <h1>{{BOT_NAME}}</h1>
  <p class="sub">{{LOGIN_SUBTITLE}}</p>
  <form id="login-form" data-invalid-pw="{{LOGIN_INVALID_PW}}" data-conn-failed="{{LOGIN_CONN_FAILED}}">
    <input type="password" id="pw" placeholder="{{LOGIN_PLACEHOLDER}}" autofocus>
    <button type="submit">{{LOGIN_BTN}}</button>
  </form>
  <div class="err" id="err"></div>
</div>
<script src="/static/login.js"></script>
</body></html>"""

# ── GET routes ────────────────────────────────────────────────────────────────


def handle_get(handler, parsed) -> bool:
    """Handle all GET routes. Returns True if handled, False for 404."""

    # Same-origin proxy for sidecars (publish/intercept/wechat/crm).
    if _sidecar_proxy(handler, "GET", parsed.path):
        return True

    if parsed.path in ("/", "/index.html"):
        return t(
            handler,
            _INDEX_HTML_PATH.read_text(encoding="utf-8"),
            content_type="text/html; charset=utf-8",
        )

    # /login is now a React SPA route — falls through to the index.html
    # fallback at the end of handle_get(), which lets React Router render
    # the new LoginPage component.

    if parsed.path == "/api/auth/status":
        from api.auth import is_auth_enabled, parse_cookie, verify_session

        logged_in = False
        if is_auth_enabled():
            cv = parse_cookie(handler)
            logged_in = bool(cv and verify_session(cv))
        return j(handler, {"auth_enabled": is_auth_enabled(), "logged_in": logged_in})

    if parsed.path == "/api/license":
        from api.license import handle_status as _license_status

        return _license_status(handler)

    if parsed.path == "/api/bundle":
        from api.employee import handle_bundle as _bundle_get

        return _bundle_get(handler)

    if parsed.path == "/api/employee/whoami":
        from api.employee import handle_whoami as _emp_whoami

        return _emp_whoami(handler)

    if parsed.path == "/api/agent/version-info":
        from api.employee import handle_agent_version_info as _agent_version_info

        return _agent_version_info(handler)

    if parsed.path == "/api/agent/check-update":
        from api.employee import handle_agent_check_update as _agent_check_update

        return _agent_check_update(handler)

    if parsed.path == "/api/agent/restart":
        from api.employee import handle_agent_restart as _agent_restart

        return _agent_restart(handler)

    if parsed.path == "/api/qxnav/models":
        from api.qxnav import handle_models as _qxnav_models

        return _qxnav_models(handler)

    if parsed.path == "/api/workspace/default":
        # Surface the WebUI's effective default workspace so the AgentChat
        # composer can show the real cwd instead of the placeholder
        # "默认工作目录" string.
        return j(handler, {"workspace": str(DEFAULT_WORKSPACE)})

    if parsed.path == "/api/qxnav/status":
        from api.qxnav import handle_status as _qxnav_status

        return _qxnav_status(handler, parsed)

    if parsed.path == "/favicon.ico":
        static_root = Path(__file__).parent.parent / "static"
        ico_path = (static_root / "favicon.ico").resolve()
        if ico_path.exists() and ico_path.is_file():
            data = ico_path.read_bytes()
            handler.send_response(200)
            handler.send_header("Content-Type", "image/x-icon")
            handler.send_header("Content-Length", str(len(data)))
            handler.send_header("Cache-Control", "public, max-age=86400")
            handler.end_headers()
            handler.wfile.write(data)
        else:
            handler.send_response(204)
            handler.end_headers()
        return True

    if parsed.path == "/health":
        with STREAMS_LOCK:
            n_streams = len(STREAMS)
        return j(
            handler,
            {
                "status": "ok",
                "sessions": len(SESSIONS),
                "active_streams": n_streams,
                "uptime_seconds": round(time.time() - SERVER_START_TIME, 1),
            },
        )

    if parsed.path == "/api/models":
        return j(handler, get_available_models())

    if parsed.path == "/api/models/live":
        return _handle_live_models(handler, parsed)

    if parsed.path == "/api/settings":
        settings = load_settings()
        # Never expose the stored password hash to clients
        settings.pop("password_hash", None)
        return j(handler, settings)

    if parsed.path == "/api/onboarding/status":
        return j(handler, get_onboarding_status())

    if parsed.path == "/api/providers/list":
        try:
            return j(handler, list_managed_providers())
        except Exception as exc:
            logger.exception("list_managed_providers failed")
            return bad(handler, f"读取失败：{exc}", 500)

    if parsed.path.startswith("/static/"):
        return _serve_static(handler, parsed)

    # Vite-built React SPA assets — single source of truth for the frontend.
    # New UI lives in hermes_cli/web_dist/ (built from web/src/), legacy
    # webui/static/ has been removed.
    if parsed.path.startswith("/assets/") or parsed.path.startswith("/fonts/"):
        return _serve_spa_asset(handler, parsed, "", _WEB_DIST_PATH)
    if parsed.path == "/favicon.ico":
        return _serve_spa_asset(handler, parsed, "/", _WEB_DIST_PATH)

    # Top-level static assets shipped in web_dist root (logo, robots, etc.).
    # The Vite build emits these as `public/*` → `web_dist/*` (not under
    # /assets/), so they need their own match arm.
    if parsed.path in ("/logo.png", "/logo.svg", "/robots.txt"):
        return _serve_spa_asset(handler, parsed, "/", _WEB_DIST_PATH)

    # AI-generated nav/UI icons under web/public/icons → web_dist/icons.
    # Without this, the SPA fallback below would return index.html and the
    # browser's <img onError> would hide every sidebar logo.
    if parsed.path.startswith("/icons/") and parsed.path.endswith(".png"):
        return _serve_spa_asset(handler, parsed, "/", _WEB_DIST_PATH)

    # ── SPA-compat adapters (for routes the new React SPA expects) ──────────
    # The new UI was designed against hermes_cli/web_server.py (FastAPI).
    # webui/server.py uses different naming for some endpoints, so we add
    # thin adapters here so the SPA renders without 404s. Each adapter returns
    # a minimal-but-valid shape; real data flows through where webui has it.
    if parsed.path == "/api/status":
        try:
            from api.gateway_watcher import get_status_snapshot

            snap = get_status_snapshot()
        except Exception:
            snap = {}
        with LOCK:
            active = sum(
                1 for s in SESSIONS.values() if not getattr(s, "ended_at", None)
            )
        return j(
            handler,
            {
                "active_sessions": active,
                "config_path": "",
                "config_version": 1,
                "env_path": "",
                "gateway_exit_reason": snap.get("exit_reason"),
                "gateway_health_url": snap.get("health_url"),
                "gateway_pid": snap.get("pid"),
                "gateway_platforms": snap.get("platforms", {}),
                "gateway_running": bool(snap.get("running", False)),
                "gateway_state": snap.get("state"),
                "gateway_updated_at": snap.get("updated_at"),
                "hermes_home": str(STATE_DIR),
                "latest_config_version": 1,
                "release_date": "2026-05-07",
                "version": "0.10.0",
            },
        )

    if parsed.path == "/api/analytics/usage":
        # Aggregate real per-session token usage into daily / by-model / totals.
        from datetime import datetime, timezone
        from collections import defaultdict

        days_qs = parse_qs(parsed.query).get("days", ["7"])[0]
        try:
            days = max(1, min(365, int(days_qs)))
        except (TypeError, ValueError):
            days = 7
        cutoff_ts = time.time() - days * 86400

        daily_buckets: dict[str, dict[str, float]] = defaultdict(
            lambda: {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "reasoning_tokens": 0,
                "estimated_cost": 0.0,
                "actual_cost": 0.0,
                "sessions": 0,
            }
        )
        by_model_buckets: dict[str, dict[str, float]] = defaultdict(
            lambda: {
                "input_tokens": 0,
                "output_tokens": 0,
                "estimated_cost": 0.0,
                "sessions": 0,
            }
        )
        total_input = total_output = total_sessions = 0
        with LOCK:
            for s in SESSIONS.values():
                # Use whatever timestamp the session has — created_at preferred.
                ts = (
                    getattr(s, "created_at", None)
                    or getattr(s, "updated_at", None)
                    or 0
                )
                if not ts or ts < cutoff_ts:
                    continue
                day_key = datetime.fromtimestamp(ts, tz=timezone.utc).strftime(
                    "%Y-%m-%d"
                )
                in_tok = int(getattr(s, "input_tokens", 0) or 0)
                out_tok = int(getattr(s, "output_tokens", 0) or 0)
                model = getattr(s, "model", None) or "unknown"

                bucket = daily_buckets[day_key]
                bucket["input_tokens"] += in_tok
                bucket["output_tokens"] += out_tok
                bucket["sessions"] += 1

                m = by_model_buckets[model]
                m["input_tokens"] += in_tok
                m["output_tokens"] += out_tok
                m["sessions"] += 1

                total_input += in_tok
                total_output += out_tok
                total_sessions += 1

        daily = [{"day": day, **stats} for day, stats in sorted(daily_buckets.items())]
        by_model = [
            {"model": m, **stats}
            for m, stats in sorted(
                by_model_buckets.items(), key=lambda x: -x[1]["sessions"]
            )
        ]
        return j(
            handler,
            {
                "daily": daily,
                "by_model": by_model,
                "totals": {
                    "total_input": total_input,
                    "total_output": total_output,
                    "total_cache_read": 0,
                    "total_reasoning": 0,
                    "total_estimated_cost": 0.0,
                    "total_actual_cost": 0.0,
                    "total_sessions": total_sessions,
                },
            },
        )

    if parsed.path == "/api/config":
        # Real webui config — settings.json + active provider/model/theme rolled up.
        try:
            view = get_available_models() or {}
        except Exception:
            view = {}
        out = load_settings() or {}
        if isinstance(view, dict):
            out = {**out, **view}
        return j(handler, out)

    if parsed.path == "/api/config/defaults":
        return j(handler, {})

    if parsed.path == "/api/config/schema":
        return j(handler, {"fields": {}, "category_order": []})

    if parsed.path == "/api/cron/jobs":
        # Real cron list from cron.jobs (the same backing store /api/crons uses).
        try:
            from cron.jobs import list_jobs as _list_jobs

            jobs = _list_jobs(include_disabled=True)
        except Exception:
            jobs = []
        return j(handler, jobs)

    if parsed.path == "/api/dashboard/themes":
        # Match the trimmed BUILTIN_THEMES in web/src/themes/presets.ts —
        # only Light + Dark survive. The legacy presets (Hermes Dark,
        # Midnight, Ember, Mono, Cyberpunk, Rose) were removed.
        themes_list = [
            {"name": "netclaw-light", "label": "Light", "description": "浅色"},
            {"name": "netclaw-dark", "label": "Dark", "description": "深色"},
        ]
        active = load_settings().get("theme") or "netclaw-light"
        # Migrate any persisted legacy theme name to a sensible default so the
        # picker never shows a "current=midnight" that no longer exists.
        if active not in {"netclaw-light", "netclaw-dark"}:
            active = "netclaw-light"
        return j(handler, {"themes": themes_list, "active": active})

    if parsed.path == "/api/dashboard/plugins":
        return j(handler, [])

    if parsed.path == "/api/model/info":
        # Read real model + provider from active config (config.yaml + settings).
        try:
            view = get_available_models() or {}
        except Exception:
            view = {}
        settings = load_settings() or {}
        active_model = (
            view.get("default_model")
            or settings.get("model")
            or DEFAULT_MODEL
            or "unknown"
        )
        provider = view.get("active_provider") or settings.get("provider") or "auto"
        # Per-model context window heuristics — real values would come from the
        # provider's /models endpoint, which webui doesn't proxy yet.
        ctx_map = {
            "deepseek": 128000,
            "claude": 200000,
            "gpt": 128000,
            "gemini": 1000000,
        }
        ctx = next(
            (v for k, v in ctx_map.items() if k in active_model.lower()),
            128000,
        )
        return j(
            handler,
            {
                "model": active_model,
                "provider": provider,
                "auto_context_length": ctx,
                "config_context_length": 0,
                "effective_context_length": ctx,
                "capabilities": {
                    "supports_tools": True,
                    "supports_vision": "claude" in active_model.lower()
                    or "gpt-4" in active_model.lower(),
                    "supports_reasoning": False,
                    "context_window": ctx,
                    "max_output_tokens": 8192,
                    "model_family": provider,
                },
            },
        )

    if parsed.path == "/api/tools/toolsets":
        return j(handler, [])

    if parsed.path == "/api/providers/oauth":
        return j(handler, {"providers": []})

    if parsed.path == "/api/env":
        return j(handler, {})

    if parsed.path == "/api/logs":
        return j(handler, {"file": "agent.log", "lines": []})

    if parsed.path == "/api/session":
        sid = parse_qs(parsed.query).get("session_id", [""])[0]
        if not sid:
            return j(handler, {"error": "session_id is required"}, status=400)
        try:
            s = get_session(sid)
            raw = s.compact() | {
                "messages": s.messages,
                "tool_calls": getattr(s, "tool_calls", []),
                "active_stream_id": getattr(s, "active_stream_id", None),
                "pending_user_message": getattr(s, "pending_user_message", None),
                "pending_attachments": getattr(s, "pending_attachments", []),
                "pending_started_at": getattr(s, "pending_started_at", None),
            }
            return j(handler, {"session": redact_session_data(raw)})
        except KeyError:
            # Not a WebUI session -- try CLI store
            msgs = get_cli_session_messages(sid)
            if msgs:
                cli_meta = None
                for cs in get_cli_sessions():
                    if cs["session_id"] == sid:
                        cli_meta = cs
                        break
                sess = {
                    "session_id": sid,
                    "title": (cli_meta or {}).get("title", "CLI Session"),
                    "workspace": (cli_meta or {}).get("workspace", ""),
                    "model": (cli_meta or {}).get("model", "unknown"),
                    "message_count": len(msgs),
                    "created_at": (cli_meta or {}).get("created_at", 0),
                    "updated_at": (cli_meta or {}).get("updated_at", 0),
                    "pinned": False,
                    "archived": False,
                    "project_id": None,
                    "profile": (cli_meta or {}).get("profile"),
                    "is_cli_session": True,
                    "messages": msgs,
                    "tool_calls": [],
                }
                return j(handler, {"session": redact_session_data(sess)})
            return bad(handler, "Session not found", 404)

    if parsed.path == "/api/sessions":
        webui_sessions = all_sessions()
        settings = load_settings()
        if settings.get("show_cli_sessions"):
            cli = get_cli_sessions()
            webui_ids = {s["session_id"] for s in webui_sessions}
            deduped_cli = [s for s in cli if s["session_id"] not in webui_ids]
        else:
            deduped_cli = []
        merged = webui_sessions + deduped_cli
        merged.sort(key=lambda s: s.get("updated_at", 0) or 0, reverse=True)
        safe_merged = []
        for s in merged:
            item = dict(s)
            if isinstance(item.get("title"), str):
                item["title"] = _redact_text(item["title"])
            safe_merged.append(item)
        return j(handler, {"sessions": safe_merged, "cli_count": len(deduped_cli)})

    if parsed.path == "/api/projects":
        return j(handler, {"projects": load_projects()})

    if parsed.path == "/api/session/export":
        return _handle_session_export(handler, parsed)

    if parsed.path == "/api/workspaces":
        return j(
            handler, {"workspaces": load_workspaces(), "last": get_last_workspace()}
        )

    if parsed.path == "/api/sessions/search":
        return _handle_sessions_search(handler, parsed)

    if parsed.path == "/api/list":
        return _handle_list_dir(handler, parsed)

    if parsed.path == "/api/personalities":
        # Read personalities from config.yaml agent.personalities section
        # (matches hermes-agent CLI behavior, not filesystem SOUL.md approach)
        from api.config import reload_config as _reload_cfg

        _reload_cfg()  # pick up config.yaml changes without server restart
        from api.config import get_config as _get_cfg

        _cfg = _get_cfg()
        agent_cfg = _cfg.get("agent", {})
        raw_personalities = agent_cfg.get("personalities", {})
        personalities = []
        if isinstance(raw_personalities, dict):
            for name, value in raw_personalities.items():
                desc = ""
                if isinstance(value, dict):
                    desc = value.get("description", "")
                elif isinstance(value, str):
                    desc = value[:80] + ("..." if len(value) > 80 else "")
                personalities.append({"name": name, "description": desc})
        return j(handler, {"personalities": personalities})

    if parsed.path == "/api/git-info":
        qs = parse_qs(parsed.query)
        sid = qs.get("session_id", [""])[0]
        if not sid:
            return bad(handler, "session_id required")
        try:
            s = get_session(sid)
        except KeyError:
            return bad(handler, "Session not found", 404)
        from api.workspace import git_info_for_workspace

        info = git_info_for_workspace(Path(s.workspace))
        return j(handler, {"git": info})

    if parsed.path == "/api/agent-update/check":
        # Installed-build (Inno Setup) self-update. Distinct from
        # /api/updates/check below which handles git-based dev updates.
        from api.agent_self_update import check as _agent_update_check

        return j(handler, _agent_update_check())

    if parsed.path == "/api/updates/check":
        settings = load_settings()
        if not settings.get("check_for_updates", True):
            return j(handler, {"disabled": True})
        qs = parse_qs(parsed.query)
        force = qs.get("force", ["0"])[0] == "1"
        # ?simulate=1 returns fake behind counts for UI testing (localhost only)
        if (
            qs.get("simulate", ["0"])[0] == "1"
            and handler.client_address[0] == "127.0.0.1"
        ):
            return j(
                handler,
                {
                    "webui": {
                        "name": "webui",
                        "behind": 3,
                        "current_sha": "abc1234",
                        "latest_sha": "def5678",
                        "branch": "master",
                    },
                    "agent": {
                        "name": "agent",
                        "behind": 1,
                        "current_sha": "aaa0001",
                        "latest_sha": "bbb0002",
                        "branch": "master",
                    },
                    "checked_at": 0,
                },
            )
        from api.updates import check_for_updates

        return j(handler, check_for_updates(force=force))

    if parsed.path == "/api/chat/stream/status":
        stream_id = parse_qs(parsed.query).get("stream_id", [""])[0]
        return j(handler, {"active": stream_id in STREAMS, "stream_id": stream_id})

    if parsed.path == "/api/chat/cancel":
        stream_id = parse_qs(parsed.query).get("stream_id", [""])[0]
        if not stream_id:
            return bad(handler, "stream_id required")
        cancelled = cancel_stream(stream_id)
        return j(handler, {"ok": True, "cancelled": cancelled, "stream_id": stream_id})

    if parsed.path in ("/api/intercept/health", "/api/intercept/tasks"):
        return _proxy_intercept(handler, "GET", parsed.path)

    if parsed.path == "/api/chat/stream":
        return _handle_sse_stream(handler, parsed)

    if parsed.path == "/api/sessions/gateway/stream":
        return _handle_gateway_sse_stream(handler)

    if parsed.path == "/api/media":
        return _handle_media(handler, parsed)

    if parsed.path == "/api/file/raw":
        return _handle_file_raw(handler, parsed)

    if parsed.path == "/api/file":
        return _handle_file_read(handler, parsed)

    if parsed.path == "/api/approval/pending":
        return _handle_approval_pending(handler, parsed)

    if parsed.path == "/api/approval/inject_test":
        # Loopback-only: used by automated tests; blocked from any remote client
        if handler.client_address[0] != "127.0.0.1":
            return j(handler, {"error": "not found"}, status=404)
        return _handle_approval_inject(handler, parsed)

    if parsed.path == "/api/clarify/pending":
        return _handle_clarify_pending(handler, parsed)

    if parsed.path == "/api/clarify/inject_test":
        # Loopback-only: used by automated tests; blocked from any remote client
        if handler.client_address[0] != "127.0.0.1":
            return j(handler, {"error": "not found"}, status=404)
        return _handle_clarify_inject(handler, parsed)

    # ── Cron API (GET) ──
    if parsed.path == "/api/crons":
        from cron.jobs import list_jobs

        return j(handler, {"jobs": list_jobs(include_disabled=True)})

    if parsed.path == "/api/crons/output":
        return _handle_cron_output(handler, parsed)

    if parsed.path == "/api/crons/recent":
        return _handle_cron_recent(handler, parsed)

    # ── Skills API (GET) ──
    if parsed.path == "/api/skills":
        from tools.skills_tool import skills_list as _skills_list, _find_all_skills

        # `_find_all_skills(skip_disabled=True)` returns ALL skills (incl
        # disabled ones); `_get_disabled_skill_names()` is the filter.
        # We need both so the UI can render disabled skills with their
        # toggle in the off position.
        from tools.skills_tool import _get_disabled_skill_names

        all_skills = _find_all_skills(skip_disabled=True)
        disabled = _get_disabled_skill_names()
        annotated = [{**s, "enabled": s["name"] not in disabled} for s in all_skills]
        # Fall back to legacy shape if the lower-level walker returned
        # nothing (e.g. user has no SKILL.md files yet) — keeps the existing
        # skills_list() formatter as the source of truth for grouping etc.
        if not annotated:
            raw = _skills_list()
            data = json.loads(raw) if isinstance(raw, str) else raw
            return j(handler, {"skills": data.get("skills", [])})
        return j(handler, {"skills": annotated})

    # Phase 3 — social/intercept GETs
    if parsed.path == "/api/social/queue":
        return handle_publish_queue_get(handler)
    if parsed.path == "/api/social/reply-templates":
        return handle_reply_templates_get(handler)
    if parsed.path == "/api/social/doctor":
        return handle_social_doctor(handler)
    if parsed.path == "/api/social/platforms":
        return handle_social_platforms(handler)
    if parsed.path == "/api/studio/batch-edit":
        from api.batch_edit import handle_batch_edit_list

        return handle_batch_edit_list(handler)
    if parsed.path == "/api/engagement/rules":
        from api.engagement import handle_list as _eng_list

        return _eng_list(handler)
    if parsed.path == "/api/social/accounts":
        from api.accounts import handle_list as _acc_list

        return _acc_list(handler)

    if parsed.path == "/api/brand-analysis/platforms":
        from api.brand_analysis import handle_platforms as _ba_platforms

        return _ba_platforms(handler)
    if parsed.path == "/api/brand-analysis/status":
        from api.brand_analysis import handle_status as _ba_status

        return _ba_status(handler, parsed)
    if parsed.path == "/api/brand-analysis/download":
        from api.brand_analysis import handle_download as _ba_download

        return _ba_download(handler, parsed)
    if parsed.path == "/api/intercept/tasks":
        return handle_intercept_tasks(handler)

    if parsed.path == "/api/skills/content":
        from tools.skills_tool import skill_view as _skill_view, SKILLS_DIR

        qs = parse_qs(parsed.query)
        name = qs.get("name", [""])[0]
        if not name:
            return j(handler, {"error": "name required"}, status=400)
        file_path = qs.get("file", [""])[0]
        if file_path:
            # Serve a linked file from the skill directory
            import re as _re

            if _re.search(r"[*?\[\]]", name):
                return bad(handler, "Invalid skill name", 400)
            skill_dir = None
            for p in SKILLS_DIR.rglob(name):
                if p.is_dir():
                    skill_dir = p
                    break
            if not skill_dir:
                return bad(handler, "Skill not found", 404)
            target = (skill_dir / file_path).resolve()
            try:
                target.relative_to(skill_dir.resolve())
            except ValueError:
                return bad(handler, "Invalid file path", 400)
            if not target.exists() or not target.is_file():
                return bad(handler, "File not found", 404)
            return j(
                handler,
                {"content": target.read_text(encoding="utf-8"), "path": file_path},
            )
        raw = _skill_view(name)
        data = json.loads(raw) if isinstance(raw, str) else raw
        if "linked_files" not in data:
            data["linked_files"] = {}
        return j(handler, data)

    # ── Memory API (GET) ──
    if parsed.path == "/api/memory":
        return _handle_memory_read(handler)

    # ── Profile API (GET) ──
    if parsed.path == "/api/profiles":
        from api.profiles import list_profiles_api, get_active_profile_name

        return j(
            handler,
            {"profiles": list_profiles_api(), "active": get_active_profile_name()},
        )

    if parsed.path == "/api/profile/active":
        from api.profiles import get_active_profile_name, get_active_hermes_home

        return j(
            handler,
            {"name": get_active_profile_name(), "path": str(get_active_hermes_home())},
        )

    # SPA client-side routing fallback — any unmatched non-API GET returns
    # index.html so React Router can handle it (/social, /wechat, /settings/*, …).
    if not parsed.path.startswith("/api/"):
        try:
            return t(
                handler,
                _INDEX_HTML_PATH.read_text(encoding="utf-8"),
                content_type="text/html; charset=utf-8",
            )
        except (OSError, FileNotFoundError):
            pass

    return False  # 404


# ── POST routes ───────────────────────────────────────────────────────────────


def handle_post(handler, parsed) -> bool:
    """Handle all POST routes. Returns True if handled, False for 404."""
    # CSRF: reject cross-origin browser requests
    if not _check_csrf(handler):
        return j(handler, {"error": "Cross-origin request rejected"}, status=403)

    # Same-origin proxy for sidecars (publish/intercept/wechat/crm).
    if any(parsed.path == p or parsed.path.startswith(p + "/") for p in _SIDECAR_PORTS):
        try:
            length = int(handler.headers.get("Content-Length", 0))
            raw = handler.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            body = {}
        if _sidecar_proxy(handler, "POST", parsed.path, body):
            return True

    if parsed.path == "/api/upload":
        return handle_upload(handler)

    if parsed.path == "/api/system/open-url":
        # POST {url} — open the URL in the user's default OS browser. Required
        # because pywebview's webkit shell silently swallows `window.open`
        # (and even <a target=_blank>) for security; this gives a single
        # cross-platform "force open externally" path.
        try:
            length = int(handler.headers.get("Content-Length", 0) or 0)
            raw = handler.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            payload = {}
        url = (payload.get("url") or "").strip()
        if not url or not (url.startswith("http://") or url.startswith("https://")):
            return bad(handler, "valid http/https url required")
        # Use webbrowser.open instead of `cmd /c start` so the URL never gets
        # interpreted by a shell parser (avoids cmd-meta injection on Windows).
        import webbrowser as _wb

        try:
            _wb.open(url, new=2)
        except Exception as exc:
            return bad(handler, f"open failed: {exc}", 500)
        return j(handler, {"ok": True, "url": url})

    if parsed.path == "/api/files/choose-file":
        # POST {extensions?: ["zip"], start?: "/abs/path"} → spawn the OS
        # native file-picker and return the selected file path. Used by the
        # SkillsPage install dialog so users can browse to a .zip skill
        # bundle instead of typing the path.
        try:
            length = int(handler.headers.get("Content-Length", 0) or 0)
            raw = handler.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            payload = {}
        exts = payload.get("extensions") or []
        if not isinstance(exts, list):
            exts = []
        # Sanitise extensions to alphanumeric only — they get interpolated
        # into shell-adjacent strings (PowerShell, AppleScript, zenity), so
        # any quote / backtick / semicolon would otherwise be injectable.
        import re as _re_ext

        exts = [
            e.lstrip(".")
            for e in exts
            if isinstance(e, str)
            and _re_ext.fullmatch(r"[A-Za-z0-9]{1,8}", e.lstrip("."))
        ]
        import platform as _plat
        import subprocess as _sp

        sysname = _plat.system()
        try:
            if sysname == "Darwin":
                # Build "of type {\"zip\", \"tar.gz\"}" clause for AppleScript
                of_type = ""
                if exts:
                    quoted = ", ".join(json.dumps(e.lstrip(".")) for e in exts)
                    of_type = f" of type {{{quoted}}}"
                script = (
                    "try\n"
                    f"  set f to choose file{of_type}\n"
                    "  POSIX path of f\n"
                    "on error\n"
                    '  return ""\n'
                    "end try"
                )
                proc = _sp.run(
                    ["osascript", "-e", script],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                picked = (proc.stdout or "").strip()
            elif sysname == "Windows":
                filt = "All files (*.*)|*.*"
                if exts:
                    parts = ";".join(f"*.{e.lstrip('.')}" for e in exts)
                    filt = f"Selected ({parts})|{parts}|All files (*.*)|*.*"
                ps = (
                    "Add-Type -AssemblyName System.Windows.Forms;"
                    "$f = New-Object System.Windows.Forms.OpenFileDialog;"
                    f"$f.Filter = '{filt}';"
                    "if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }"
                )
                proc = _sp.run(
                    ["powershell.exe", "-NoProfile", "-Command", ps],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                picked = (proc.stdout or "").strip()
            else:
                args = ["zenity", "--file-selection"]
                if exts:
                    args += [
                        "--file-filter",
                        "Selected | " + " ".join(f"*.{e.lstrip('.')}" for e in exts),
                    ]
                proc = _sp.run(
                    args, capture_output=True, text=True, timeout=120, check=False
                )
                picked = (proc.stdout or "").strip()
        except Exception as exc:
            return j(
                handler, {"ok": False, "error": f"picker failed: {exc}"}, status=500
            )
        if not picked:
            return j(handler, {"ok": False, "cancelled": True})
        return j(handler, {"ok": True, "path": picked})

    if parsed.path == "/api/files/choose-folder":
        # POST {start?: "/abs/path"} → spawn the OS native folder-picker
        # dialog and return the selected directory. Used by the AgentChat
        # composer so users get a real Finder/Explorer instead of typing a
        # path. Implemented per-platform with shell tooling that ships in the
        # base OS — no extra Python deps so it works inside the PyInstaller
        # bundle.
        try:
            length = int(handler.headers.get("Content-Length", 0) or 0)
            raw = handler.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            payload = {}
        start = (payload.get("start") or "").strip()
        # Sanitise `start` to drop characters that could escape the PowerShell
        # single-quoted literal at line ~1314. Single quote terminates the
        # literal; backtick / dollar-paren give code execution; semicolon /
        # ampersand chain commands. Newlines also break the one-liner.
        if "'" in start or any(
            ch in start for ch in ("`", "$", ";", "&", "|", "\n", "\r")
        ):
            start = ""
        import platform as _plat
        import subprocess as _sp

        sysname = _plat.system()
        try:
            if sysname == "Darwin":
                # AppleScript — `choose folder` opens the standard Finder
                # picker. Output is HFS path; we coerce to POSIX.
                script = (
                    "try\n"
                    f"  set d to choose folder{(' default location POSIX file ' + json.dumps(start)) if start else ''}\n"
                    "  POSIX path of d\n"
                    "on error\n"
                    '  return ""\n'
                    "end try"
                )
                proc = _sp.run(
                    ["osascript", "-e", script],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                picked = (proc.stdout or "").strip().rstrip("/")
            elif sysname == "Windows":
                ps = (
                    "Add-Type -AssemblyName System.Windows.Forms;"
                    "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
                    f"$f.SelectedPath = '{start}';"
                    if start
                    else "$f = New-Object System.Windows.Forms.FolderBrowserDialog;"
                )
                ps += "if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"
                proc = _sp.run(
                    ["powershell.exe", "-NoProfile", "-Command", ps],
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                picked = (proc.stdout or "").strip()
            else:
                # zenity ships on most desktop linux distros.
                args = ["zenity", "--file-selection", "--directory"]
                if start:
                    args += ["--filename", start.rstrip("/") + "/"]
                proc = _sp.run(
                    args, capture_output=True, text=True, timeout=120, check=False
                )
                picked = (proc.stdout or "").strip()
        except Exception as exc:
            return j(
                handler, {"ok": False, "error": f"picker failed: {exc}"}, status=500
            )
        if not picked:
            return j(handler, {"ok": False, "cancelled": True})
        return j(handler, {"ok": True, "path": picked})

    if parsed.path == "/api/studio/save-output":
        # POST {url, dest_dir, filename?} → download a remote URL into the
        # user's chosen storage directory and return the saved absolute path.
        # Used by ContentStudio to materialise generated images/videos on disk
        # the moment the upstream task succeeds (most providers GC the asset
        # within a few hours).
        try:
            length = int(handler.headers.get("Content-Length", 0) or 0)
            raw = handler.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return j(handler, {"ok": False, "error": "bad json"}, status=400)

        url = (payload.get("url") or "").strip()
        dest_dir = (payload.get("dest_dir") or "").strip()
        if not url or not url.startswith(("http://", "https://")):
            return j(
                handler, {"ok": False, "error": "missing or invalid url"}, status=400
            )
        if not dest_dir:
            return j(handler, {"ok": False, "error": "missing dest_dir"}, status=400)

        from pathlib import Path as _P
        import urllib.request as _ur
        import urllib.parse as _up
        import time as _t
        import re as _re

        try:
            dest_root = _P(dest_dir).expanduser().resolve()
            dest_root.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            return j(
                handler, {"ok": False, "error": f"bad dest_dir: {exc}"}, status=400
            )

        # Pick filename: explicit > URL path basename > timestamp+ext.
        explicit = (payload.get("filename") or "").strip()
        if explicit:
            candidate = explicit
        else:
            url_path = _up.urlparse(url).path
            candidate = _P(url_path).name or f"output-{int(_t.time())}.bin"
        # Sanitise — drop separators / control bytes / over-long names.
        candidate = _re.sub(r"[^\w.\-]", "_", _P(candidate).name)[:160]
        if not candidate or candidate.strip(".") == "":
            candidate = f"output-{int(_t.time())}.bin"

        # Avoid clobbering an existing file.
        target = dest_root / candidate
        if target.exists():
            stem, suffix = target.stem, target.suffix
            i = 1
            while True:
                candidate = f"{stem}-{i}{suffix}"
                target = dest_root / candidate
                if not target.exists():
                    break
                i += 1
                if i > 9999:
                    return j(
                        handler,
                        {"ok": False, "error": "too many duplicates"},
                        status=500,
                    )

        try:
            from api.url_safety import open_safe_http, UnsafeUrlError

            try:
                resp = open_safe_http(url, timeout=300)
            except UnsafeUrlError as exc:
                return j(
                    handler, {"ok": False, "error": f"unsafe url: {exc}"}, status=400
                )
            with target.open("wb") as fh:
                cap = 500 * 1024 * 1024
                total = 0
                try:
                    while True:
                        chunk = resp.read_chunk(64 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > cap:
                            target.unlink(missing_ok=True)
                            return j(
                                handler,
                                {"ok": False, "error": "remote file exceeds 500MB cap"},
                                status=413,
                            )
                        fh.write(chunk)
                finally:
                    try:
                        resp.body.close()
                    except Exception:
                        pass
        except Exception as exc:
            target.unlink(missing_ok=True)
            return j(
                handler, {"ok": False, "error": f"download failed: {exc}"}, status=502
            )

        return j(
            handler,
            {
                "ok": True,
                "path": str(target),
                "filename": candidate,
                "size": target.stat().st_size,
            },
        )

    if parsed.path == "/api/studio/oss-upload":
        # multipart/form-data POST {file} → upload to the netclaw-agent OSS
        # bucket under <employee_id>/<timestamp>-<safe-name> and return the
        # public URL. ContentStudio uses this so users can pick local files
        # from Finder/Explorer instead of typing public URLs.
        from api.upload import parse_multipart, _sanitize_upload_name

        try:
            content_type = handler.headers.get("Content-Type", "")
            content_length = int(handler.headers.get("Content-Length", 0) or 0)
            if content_length > MAX_UPLOAD_BYTES:
                return j(
                    handler,
                    {
                        "ok": False,
                        "error": f"File too large (max {MAX_UPLOAD_BYTES // 1024 // 1024}MB)",
                    },
                    status=413,
                )
            fields, files = parse_multipart(handler.rfile, content_type, content_length)
        except ValueError as exc:
            return j(handler, {"ok": False, "error": str(exc)}, status=400)
        except Exception as exc:
            return j(
                handler, {"ok": False, "error": f"parse failed: {exc}"}, status=400
            )

        if "file" not in files:
            return j(handler, {"ok": False, "error": "no file field"}, status=400)
        filename, file_bytes = files["file"]
        try:
            safe_name = _sanitize_upload_name(filename)
        except ValueError as exc:
            return j(handler, {"ok": False, "error": str(exc)}, status=400)

        ak = os.environ.get("OSS_ACCESS_KEY") or os.environ.get("ALICLOUD_AK")
        sk = os.environ.get("OSS_ACCESS_SECRET") or os.environ.get("ALICLOUD_SK")
        if not ak or not sk:
            return j(
                handler,
                {
                    "ok": False,
                    "error": "OSS credentials missing — set OSS_ACCESS_KEY/SECRET",
                },
                status=500,
            )

        try:
            import oss2
        except ImportError:
            return j(
                handler, {"ok": False, "error": "oss2 SDK not bundled"}, status=500
            )

        # Per-employee folder so different users don't collide.
        try:
            from hermes_cli.employee_auth import load_auth_state, ANONYMOUS_EMPLOYEE_ID

            state = load_auth_state()
            employee_id = (
                state.employee_id if state else None
            ) or ANONYMOUS_EMPLOYEE_ID
        except Exception:
            employee_id = "_anonymous"

        bucket_name = os.environ.get("NETCLAW_AGENT_BUCKET", "netclaw-agent")
        endpoint = os.environ.get(
            "NETCLAW_AGENT_OSS_ENDPOINT", "https://oss-cn-hangzhou.aliyuncs.com"
        )
        region_host = endpoint.replace("https://", "").replace("http://", "")

        import time as _t

        ts = int(_t.time() * 1000)
        key = f"{employee_id}/{ts}-{safe_name}"

        try:
            auth = oss2.Auth(ak, sk)
            bucket = oss2.Bucket(auth, endpoint, bucket_name)
            # Object-level public-read so the resulting URL never expires.
            # The bucket itself has account/bucket BlockPublicAccess disabled
            # (one-time setup); we set object ACL on each put so a future
            # bucket-level toggle doesn't quietly start serving 403s.
            bucket.put_object(
                key,
                file_bytes,
                headers={"x-oss-object-acl": "public-read"},
            )
        except Exception as exc:
            return j(
                handler, {"ok": False, "error": f"OSS put failed: {exc}"}, status=502
            )

        public_url = f"https://{bucket_name}.{region_host}/{key}"
        return j(
            handler,
            {"ok": True, "url": public_url, "key": key, "size": len(file_bytes)},
        )

    if parsed.path in (
        "/api/studio/oss-list",
        "/api/studio/oss-delete",
        "/api/studio/oss-mirror",
    ):
        # Shared OSS plumbing — extract once, dispatch by path below.
        ak = os.environ.get("OSS_ACCESS_KEY") or os.environ.get("ALICLOUD_AK")
        sk = os.environ.get("OSS_ACCESS_SECRET") or os.environ.get("ALICLOUD_SK")
        if not ak or not sk:
            return j(
                handler,
                {"ok": False, "error": "OSS credentials missing"},
                status=500,
            )
        try:
            import oss2
        except ImportError:
            return j(
                handler, {"ok": False, "error": "oss2 SDK not bundled"}, status=500
            )
        try:
            from hermes_cli.employee_auth import (
                load_auth_state,
                ANONYMOUS_EMPLOYEE_ID,
            )

            state = load_auth_state()
            employee_id = (
                state.employee_id if state else None
            ) or ANONYMOUS_EMPLOYEE_ID
        except Exception:
            employee_id = "_anonymous"
        bucket_name = os.environ.get("NETCLAW_AGENT_BUCKET", "netclaw-agent")
        endpoint = os.environ.get(
            "NETCLAW_AGENT_OSS_ENDPOINT",
            "https://oss-cn-hangzhou.aliyuncs.com",
        )
        region_host = endpoint.replace("https://", "").replace("http://", "")
        auth = oss2.Auth(ak, sk)
        bucket = oss2.Bucket(auth, endpoint, bucket_name)
        prefix = f"{employee_id}/"

        # ── GET-style list: ?marker=... pagination ───────────────────────
        if parsed.path == "/api/studio/oss-list":
            try:
                from urllib.parse import parse_qs

                qs = parse_qs(parsed.query)
                marker = (qs.get("marker", [""])[0] or "").strip()
                max_keys = min(int(qs.get("limit", ["100"])[0] or 100), 1000)
                items = []
                next_marker = None
                listing = bucket.list_objects(
                    prefix=prefix, max_keys=max_keys, marker=marker
                )
                for obj in listing.object_list:
                    items.append(
                        {
                            "key": obj.key,
                            "filename": obj.key[len(prefix) :],
                            "size": obj.size,
                            "url": f"https://{bucket_name}.{region_host}/{obj.key}",
                            "modified": (
                                obj.last_modified
                                if isinstance(obj.last_modified, (int, float))
                                else None
                            ),
                        }
                    )
                if listing.is_truncated:
                    next_marker = listing.next_marker
                return j(
                    handler,
                    {"ok": True, "items": items, "next_marker": next_marker},
                )
            except Exception as exc:
                return j(
                    handler, {"ok": False, "error": f"list failed: {exc}"}, status=502
                )

        # ── delete: POST {keys: [...]} ───────────────────────────────────
        if parsed.path == "/api/studio/oss-delete":
            try:
                length = int(handler.headers.get("Content-Length", 0) or 0)
                payload = json.loads(handler.rfile.read(length).decode("utf-8") or "{}")
            except Exception:
                return j(handler, {"ok": False, "error": "bad json"}, status=400)
            keys = payload.get("keys") or []
            if not isinstance(keys, list) or not keys:
                return j(handler, {"ok": False, "error": "missing keys"}, status=400)
            # Refuse to touch keys outside the caller's prefix.
            keys = [k for k in keys if isinstance(k, str) and k.startswith(prefix)]
            if not keys:
                return j(handler, {"ok": False, "error": "no allowed keys"}, status=403)
            try:
                bucket.batch_delete_objects(keys)
                return j(handler, {"ok": True, "deleted": keys})
            except Exception as exc:
                return j(
                    handler,
                    {"ok": False, "error": f"delete failed: {exc}"},
                    status=502,
                )

        # ── mirror: POST {url, filename?} — fetches an external URL and
        #            re-uploads it to OSS so the result outlives the
        #            upstream provider's CDN expiry.
        if parsed.path == "/api/studio/oss-mirror":
            try:
                length = int(handler.headers.get("Content-Length", 0) or 0)
                payload = json.loads(handler.rfile.read(length).decode("utf-8") or "{}")
            except Exception:
                return j(handler, {"ok": False, "error": "bad json"}, status=400)
            url = (payload.get("url") or "").strip()
            if not url or not url.startswith(("http://", "https://")):
                return j(handler, {"ok": False, "error": "missing url"}, status=400)
            explicit = (payload.get("filename") or "").strip()
            import urllib.request as _ur
            import urllib.parse as _up
            import re as _re
            import time as _t

            # Pick filename
            if explicit:
                cand = explicit
            else:
                cand = (
                    Path(_up.urlparse(url).path).name or f"output-{int(_t.time())}.bin"
                )
            cand = _re.sub(r"[^\w.\-]", "_", Path(cand).name)[:160]
            if not cand or cand.strip(".") == "":
                cand = f"output-{int(_t.time())}.bin"

            ts = int(_t.time() * 1000)
            key = f"{prefix}{ts}-{cand}"

            try:
                from api.url_safety import open_safe_http, UnsafeUrlError

                try:
                    safe_resp = open_safe_http(url, timeout=300)
                except UnsafeUrlError as exc:
                    return j(
                        handler,
                        {"ok": False, "error": f"unsafe url: {exc}"},
                        status=400,
                    )
                try:
                    body = safe_resp.read_chunk(500 * 1024 * 1024 + 1)
                finally:
                    try:
                        safe_resp.body.close()
                    except Exception:
                        pass
                if len(body) > 500 * 1024 * 1024:
                    return j(
                        handler,
                        {"ok": False, "error": "remote file exceeds 500MB"},
                        status=413,
                    )
            except Exception as exc:
                return j(
                    handler,
                    {"ok": False, "error": f"fetch failed: {exc}"},
                    status=502,
                )

            try:
                bucket.put_object(
                    key, body, headers={"x-oss-object-acl": "public-read"}
                )
            except Exception as exc:
                return j(
                    handler,
                    {"ok": False, "error": f"OSS put failed: {exc}"},
                    status=502,
                )

            return j(
                handler,
                {
                    "ok": True,
                    "url": f"https://{bucket_name}.{region_host}/{key}",
                    "key": key,
                    "size": len(body),
                },
            )

    if parsed.path == "/api/files/reveal":
        # POST {path: "/abs/path/to/file"} → spawn the OS file explorer with
        # the file selected/highlighted. macOS: `open -R`. Windows:
        # `explorer.exe /select,`. Linux: best-effort `xdg-open` on parent dir.
        try:
            length = int(handler.headers.get("Content-Length", 0) or 0)
            raw = handler.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            payload = {}
        target = (payload.get("path") or "").strip()
        if not target:
            return bad(handler, "path is required")
        from pathlib import Path as _P
        import platform as _plat
        import subprocess as _sp

        try:
            p = _P(target).expanduser().resolve(strict=False)
        except Exception as exc:
            return bad(handler, f"invalid path: {exc}")
        if not p.exists():
            return bad(handler, f"path not found: {p}", 404)
        try:
            sysname = _plat.system()
            if sysname == "Darwin":
                _sp.Popen(["open", "-R", str(p)])
            elif sysname == "Windows":
                # explorer /select,"C:\foo\bar.png" highlights the file in
                # the parent folder. The comma must be the *only* separator.
                _sp.Popen(["explorer.exe", f"/select,{p}"])
            else:
                _sp.Popen(["xdg-open", str(p.parent if p.is_file() else p)])
        except Exception as exc:
            return bad(handler, f"reveal failed: {exc}", 500)
        return j(handler, {"ok": True, "path": str(p)})

    if parsed.path == "/api/transcribe":
        return handle_transcribe(handler)

    # Phase 3 — social publish + intercept (Douyin/XHS via opencli + user real Chrome)
    if parsed.path == "/api/social/upload":
        return handle_publish_upload(handler)
    if parsed.path == "/api/social/queue":
        return handle_publish_queue_post(handler)
    if parsed.path == "/api/social/publish-batch":
        return handle_publish_batch(handler)
    if parsed.path == "/api/studio/batch-edit":
        from api.batch_edit import handle_batch_edit_create

        return handle_batch_edit_create(handler)
    if parsed.path == "/api/engagement/rules":
        from api.engagement import handle_create as _eng_create

        return _eng_create(handler)
    if parsed.path == "/api/social/accounts":
        from api.accounts import handle_add as _acc_add

        return _acc_add(handler)
    if parsed.path.startswith("/api/social/accounts/"):
        suffix = parsed.path[len("/api/social/accounts/") :]
        parts = suffix.split("/")
        if len(parts) == 3 and parts[2] == "delete":
            from api.accounts import handle_delete as _acc_del

            return _acc_del(handler, parts[0], parts[1])
        if len(parts) == 3 and parts[2] == "update":
            from api.accounts import handle_update as _acc_upd

            return _acc_upd(handler, parts[0], parts[1])
    if parsed.path.startswith("/api/engagement/rules/"):
        suffix = parsed.path[len("/api/engagement/rules/") :]
        if suffix.endswith("/update"):
            rule_id = suffix[: -len("/update")]
            from api.engagement import handle_update as _eng_update

            return _eng_update(handler, rule_id)
        if suffix.endswith("/delete"):
            rule_id = suffix[: -len("/delete")]
            from api.engagement import handle_delete as _eng_delete

            return _eng_delete(handler, rule_id)
    if parsed.path == "/api/social/reply-templates":
        return handle_reply_templates_post(handler)
    if parsed.path == "/api/intercept/search":
        return handle_intercept_search(handler)
    if parsed.path == "/api/intercept/comments":
        return handle_intercept_comments(handler)
    if parsed.path == "/api/intercept/reply":
        return handle_intercept_reply(handler)

    body = read_body(handler)

    if parsed.path == "/api/license/activate":
        from api.license import handle_activate as _license_activate

        return _license_activate(handler, body)

    if parsed.path == "/api/license/deactivate":
        from api.license import handle_deactivate as _license_deactivate

        return _license_deactivate(handler, body)

    if parsed.path == "/api/license/verify":
        from api.license import handle_verify as _license_verify

        return _license_verify(handler, body)

    if parsed.path == "/api/employee/resolve-invite":
        from api.employee import handle_resolve_invite as _emp_resolve

        return _emp_resolve(handler, body)

    if parsed.path == "/api/employee/register":
        from api.employee import handle_register as _emp_register

        return _emp_register(handler, body)

    if parsed.path == "/api/employee/login":
        from api.employee import handle_login as _emp_login

        return _emp_login(handler, body)

    if parsed.path == "/api/employee/logout":
        from api.employee import handle_logout as _emp_logout

        return _emp_logout(handler, body)

    if parsed.path == "/api/qxnav/generate":
        from api.qxnav import handle_generate as _qxnav_generate

        return _qxnav_generate(handler, body)

    if parsed.path == "/api/brand-analysis/start":
        from api.brand_analysis import handle_start as _ba_start

        return _ba_start(handler, body)
    if parsed.path == "/api/brand-analysis/export":
        from api.brand_analysis import handle_export as _ba_export

        return _ba_export(handler, body)

    if parsed.path == "/api/session/new":
        try:
            workspace = (
                str(resolve_trusted_workspace(body.get("workspace")))
                if body.get("workspace")
                else None
            )
        except ValueError as e:
            return bad(handler, str(e))
        s = new_session(workspace=workspace, model=body.get("model"))
        return j(handler, {"session": s.compact() | {"messages": s.messages}})

    if parsed.path == "/api/sessions/cleanup":
        return _handle_sessions_cleanup(handler, body, zero_only=False)

    if parsed.path == "/api/sessions/cleanup_zero_message":
        return _handle_sessions_cleanup(handler, body, zero_only=True)

    if parsed.path == "/api/session/rename":
        try:
            require(body, "session_id", "title")
        except ValueError as e:
            return bad(handler, str(e))
        try:
            s = get_session(body["session_id"])
        except KeyError:
            return bad(handler, "Session not found", 404)
        s.title = str(body["title"]).strip()[:80] or "Untitled"
        s.save()
        return j(handler, {"session": s.compact()})

    if parsed.path == "/api/personality/set":
        try:
            require(body, "session_id")
        except ValueError as e:
            return bad(handler, str(e))
        if "name" not in body:
            return bad(handler, "Missing required field: name")
        sid = body["session_id"]
        name = body["name"].strip()
        try:
            s = get_session(sid)
        except KeyError:
            return bad(handler, "Session not found", 404)
        # Resolve personality from config.yaml agent.personalities section
        # (matches hermes-agent CLI behavior)
        prompt = ""
        if name:
            from api.config import reload_config as _reload_cfg2

            _reload_cfg2()  # pick up config changes without restart
            from api.config import get_config as _get_cfg2

            _cfg2 = _get_cfg2()
            agent_cfg = _cfg2.get("agent", {})
            raw_personalities = agent_cfg.get("personalities", {})
            if not isinstance(raw_personalities, dict) or name not in raw_personalities:
                return bad(
                    handler, f'Personality "{name}" not found in config.yaml', 404
                )
            value = raw_personalities[name]
            # Resolve prompt using the same logic as hermes-agent cli.py
            if isinstance(value, dict):
                parts = [value.get("system_prompt", "") or value.get("prompt", "")]
                if value.get("tone"):
                    parts.append(f"Tone: {value['tone']}")
                if value.get("style"):
                    parts.append(f"Style: {value['style']}")
                prompt = "\n".join(p for p in parts if p)
            else:
                prompt = str(value)
        s.personality = name if name else None
        s.save()
        return j(handler, {"ok": True, "personality": s.personality, "prompt": prompt})

    if parsed.path == "/api/session/update":
        try:
            require(body, "session_id")
        except ValueError as e:
            return bad(handler, str(e))
        try:
            s = get_session(body["session_id"])
        except KeyError:
            return bad(handler, "Session not found", 404)
        try:
            new_ws = str(resolve_trusted_workspace(body.get("workspace", s.workspace)))
        except ValueError as e:
            return bad(handler, str(e))
        s.workspace = new_ws
        s.model = body.get("model", s.model)
        if "yolo" in body:
            s.yolo = bool(body.get("yolo"))
            try:
                from tools.approval import (
                    enable_session_yolo,
                    disable_session_yolo,
                )

                (enable_session_yolo if s.yolo else disable_session_yolo)(s.session_id)
            except ImportError:
                pass
        s.save()
        set_last_workspace(new_ws)
        return j(handler, {"session": s.compact() | {"messages": s.messages}})

    if parsed.path == "/api/session/delete":
        sid = body.get("session_id", "")
        if not sid:
            return bad(handler, "session_id is required")
        if not all(c in "0123456789abcdefghijklmnopqrstuvwxyz_" for c in sid):
            return bad(handler, "Invalid session_id", 400)
        # Delete from WebUI session store
        with LOCK:
            SESSIONS.pop(sid, None)
        try:
            p = (SESSION_DIR / f"{sid}.json").resolve()
            p.relative_to(SESSION_DIR.resolve())
        except Exception:
            return bad(handler, "Invalid session_id", 400)
        try:
            p.unlink(missing_ok=True)
        except Exception:
            logger.debug("Failed to unlink session file %s", p)
        try:
            SESSION_INDEX_FILE.unlink(missing_ok=True)
        except Exception:
            logger.debug("Failed to unlink session index")
        # Also delete from CLI state.db (for CLI sessions shown in sidebar)
        try:
            from api.models import delete_cli_session

            delete_cli_session(sid)
        except Exception:
            logger.debug("Failed to delete CLI session %s", sid)
        return j(handler, {"ok": True})

    if parsed.path == "/api/session/clear":
        try:
            require(body, "session_id")
        except ValueError as e:
            return bad(handler, str(e))
        try:
            s = get_session(body["session_id"])
        except KeyError:
            return bad(handler, "Session not found", 404)
        s.messages = []
        s.tool_calls = []
        s.title = "Untitled"
        s.save()
        return j(handler, {"ok": True, "session": s.compact()})

    if parsed.path == "/api/session/truncate":
        try:
            require(body, "session_id")
        except ValueError as e:
            return bad(handler, str(e))
        if body.get("keep_count") is None:
            return bad(handler, "Missing required field(s): keep_count")
        try:
            s = get_session(body["session_id"])
        except KeyError:
            return bad(handler, "Session not found", 404)
        keep = int(body["keep_count"])
        s.messages = s.messages[:keep]
        s.save()
        return j(
            handler, {"ok": True, "session": s.compact() | {"messages": s.messages}}
        )

    if parsed.path == "/api/session/compress":
        return _handle_session_compress(handler, body)

    if parsed.path == "/api/chat/start":
        return _handle_chat_start(handler, body)

    if parsed.path == "/api/chat":
        return _handle_chat_sync(handler, body)

    if parsed.path in (
        "/api/intercept/scrape",
        "/api/intercept/draft",
        "/api/intercept/post",
    ):
        return _proxy_intercept(handler, "POST", parsed.path, body)

    # ── Cron API (POST) ──
    if parsed.path == "/api/crons/create":
        return _handle_cron_create(handler, body)

    if parsed.path == "/api/crons/update":
        return _handle_cron_update(handler, body)

    if parsed.path == "/api/crons/delete":
        return _handle_cron_delete(handler, body)

    if parsed.path == "/api/crons/run":
        return _handle_cron_run(handler, body)

    if parsed.path == "/api/crons/pause":
        return _handle_cron_pause(handler, body)

    if parsed.path == "/api/crons/resume":
        return _handle_cron_resume(handler, body)

    # ── File ops (POST) ──
    if parsed.path == "/api/file/delete":
        return _handle_file_delete(handler, body)

    if parsed.path == "/api/file/save":
        return _handle_file_save(handler, body)

    if parsed.path == "/api/file/create":
        return _handle_file_create(handler, body)

    if parsed.path == "/api/file/rename":
        return _handle_file_rename(handler, body)

    if parsed.path == "/api/file/create-dir":
        return _handle_create_dir(handler, body)

    # ── Workspace management (POST) ──
    if parsed.path == "/api/workspaces/add":
        return _handle_workspace_add(handler, body)

    if parsed.path == "/api/workspaces/remove":
        return _handle_workspace_remove(handler, body)

    if parsed.path == "/api/workspaces/rename":
        return _handle_workspace_rename(handler, body)

    # ── Approval (POST) ──
    if parsed.path == "/api/approval/respond":
        return _handle_approval_respond(handler, body)

    # ── Clarify (POST) ──
    if parsed.path == "/api/clarify/respond":
        return _handle_clarify_respond(handler, body)

    # ── Skills (POST) ──
    if parsed.path == "/api/skills/save":
        return _handle_skill_save(handler, body)

    if parsed.path == "/api/skills/delete":
        return _handle_skill_delete(handler, body)

    if parsed.path == "/api/skills/toggle":
        # body = {name, enabled}. Persists into config.yaml under
        # skills.disabled (a list of skill names that are turned off).
        # The web client renders this list and lets users flip individual
        # toggles — `_find_all_skills` then filters them out by default.
        name = (body or {}).get("name") if isinstance(body, dict) else None
        enabled = bool((body or {}).get("enabled")) if isinstance(body, dict) else False
        if not isinstance(name, str) or not name.strip():
            return j(handler, {"ok": False, "error": "missing name"}, status=400)
        try:
            from hermes_cli.config import load_config, get_config_path
            from utils import atomic_yaml_write
        except Exception as exc:
            return j(
                handler,
                {"ok": False, "error": f"config import failed: {exc}"},
                status=500,
            )
        try:
            cfg = load_config() or {}
            if not isinstance(cfg, dict):
                cfg = {}
            skills_cfg = cfg.get("skills")
            if not isinstance(skills_cfg, dict):
                skills_cfg = {}
                cfg["skills"] = skills_cfg
            disabled_raw = skills_cfg.get("disabled") or []
            if isinstance(disabled_raw, str):
                disabled_raw = [disabled_raw]
            disabled = {str(v).strip() for v in disabled_raw if str(v).strip()}
            if enabled:
                disabled.discard(name.strip())
            else:
                disabled.add(name.strip())
            skills_cfg["disabled"] = sorted(disabled)
            # Bypass save_config() (which bails when HERMES_MANAGED is set
            # by the macOS app launcher) — write the YAML directly.
            atomic_yaml_write(get_config_path(), cfg)
        except Exception as exc:
            return j(
                handler,
                {"ok": False, "error": f"persist failed: {exc}"},
                status=500,
            )
        return j(handler, {"ok": True, "name": name, "enabled": enabled})

    # ── Memory (POST) ──
    if parsed.path == "/api/memory/write":
        return _handle_memory_write(handler, body)

    # ── Profile API (POST) ──
    if parsed.path == "/api/profile/switch":
        name = body.get("name", "").strip()
        if not name:
            return bad(handler, "name is required")
        try:
            from api.profiles import switch_profile, _validate_profile_name

            if name != "default":
                _validate_profile_name(name)
            result = switch_profile(name)
            return j(handler, result)
        except (ValueError, FileNotFoundError) as e:
            return bad(handler, _sanitize_error(e), 404)
        except RuntimeError as e:
            return bad(handler, str(e), 409)

    if parsed.path == "/api/profile/create":
        name = body.get("name", "").strip()
        if not name:
            return bad(handler, "name is required")
        import re as _re

        if not _re.match(r"^[a-z0-9][a-z0-9_-]{0,63}$", name):
            return bad(
                handler,
                "Invalid profile name: lowercase letters, numbers, hyphens, underscores only",
            )
        clone_from = body.get("clone_from")
        if clone_from is not None:
            clone_from = str(clone_from).strip()
            if not _re.match(r"^[a-z0-9][a-z0-9_-]{0,63}$", clone_from):
                return bad(handler, "Invalid clone_from name")
        base_url = body.get("base_url", "").strip() if body.get("base_url") else None
        api_key = body.get("api_key", "").strip() if body.get("api_key") else None
        if base_url and not base_url.startswith(("http://", "https://")):
            return bad(handler, "base_url must start with http:// or https://")
        try:
            from api.profiles import create_profile_api

            result = create_profile_api(
                name,
                clone_from=clone_from,
                clone_config=bool(body.get("clone_config", False)),
                base_url=base_url,
                api_key=api_key,
            )
            return j(handler, {"ok": True, "profile": result})
        except (ValueError, FileExistsError, RuntimeError) as e:
            return bad(handler, str(e))

    if parsed.path == "/api/profile/delete":
        name = body.get("name", "").strip()
        if not name:
            return bad(handler, "name is required")
        try:
            from api.profiles import delete_profile_api, _validate_profile_name

            _validate_profile_name(name)
            result = delete_profile_api(name)
            return j(handler, result)
        except (ValueError, FileNotFoundError) as e:
            return bad(handler, _sanitize_error(e))
        except RuntimeError as e:
            return bad(handler, str(e), 409)

    # ── Settings (POST) ──
    if parsed.path == "/api/settings":
        from api.auth import (
            create_session,
            is_auth_enabled,
            parse_cookie,
            set_auth_cookie,
            verify_session,
        )

        if "bot_name" in body:
            body["bot_name"] = (str(body["bot_name"]) or "").strip() or "NetClaw"

        auth_enabled_before = is_auth_enabled()
        current_cookie = parse_cookie(handler)
        logged_in_before = bool(current_cookie and verify_session(current_cookie))
        requested_password = bool(
            isinstance(body.get("_set_password"), str)
            and body.get("_set_password", "").strip()
        )

        saved = save_settings(body)
        saved.pop("password_hash", None)  # never expose hash to client

        auth_enabled_after = is_auth_enabled()
        auth_just_enabled = bool(
            requested_password and auth_enabled_after and not auth_enabled_before
        )
        logged_in_after = logged_in_before
        new_cookie = None

        if auth_just_enabled and not logged_in_before:
            new_cookie = create_session()
            logged_in_after = True

        saved["auth_enabled"] = auth_enabled_after
        saved["logged_in"] = logged_in_after
        saved["auth_just_enabled"] = auth_just_enabled

        if not new_cookie:
            return j(handler, saved)

        response_body = json.dumps(saved, ensure_ascii=False, indent=2).encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(response_body)))
        handler.send_header("Cache-Control", "no-store")
        set_auth_cookie(handler, new_cookie)
        _security_headers(handler)
        handler.end_headers()
        handler.wfile.write(response_body)
        return True

    if parsed.path == "/api/onboarding/setup":
        # Writing API keys to disk - restrict to local/private networks unless auth is active.
        # In Docker, requests arrive from the bridge network (172.x.x.x), not 127.0.0.1,
        # even when the user accesses via localhost:8787 on the host.
        # Behind a reverse proxy (nginx/Caddy/Traefik) or SSH tunnel, X-Forwarded-For
        # carries the real origin IP — read it first before falling back to the raw socket addr.
        # HERMES_WEBUI_ONBOARDING_OPEN=1 lets operators on remote servers explicitly bypass
        # the check when they control network access themselves (e.g. firewall + VPN).
        from api.auth import is_auth_enabled
        import os as _os

        if not is_auth_enabled() and not _os.getenv("HERMES_WEBUI_ONBOARDING_OPEN"):
            import ipaddress

            try:
                # Prefer forwarded headers set by reverse proxies
                _xff = handler.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                _xri = handler.headers.get("X-Real-IP", "").strip()
                _raw = handler.client_address[0]
                _ip_str = _xff or _xri or _raw
                addr = ipaddress.ip_address(_ip_str)
                is_local = addr.is_loopback or addr.is_private
            except ValueError:
                is_local = False
            if not is_local:
                return bad(
                    handler,
                    "Onboarding setup is only available from local networks when auth is not enabled. To bypass this on a remote server, set HERMES_WEBUI_ONBOARDING_OPEN=1.",
                    403,
                )
        try:
            return j(handler, apply_onboarding_setup(body))
        except ValueError as e:
            return bad(handler, str(e))
        except RuntimeError as e:
            return bad(handler, str(e), 500)

    if parsed.path == "/api/onboarding/complete":
        return j(handler, complete_onboarding())

    if parsed.path == "/api/onboarding/test-provider":
        provider = (body.get("provider") or "").strip()
        base_url = (body.get("base_url") or "").strip()
        api_key = (body.get("api_key") or "").strip()
        try:
            return j(handler, probe_provider_models(provider, base_url, api_key))
        except Exception as exc:
            logger.exception("test-provider probe failed")
            return j(
                handler,
                {"ok": False, "error": f"探测失败：{exc}"},
                status=200,
            )

    if parsed.path == "/api/providers/save":
        try:
            return j(handler, save_managed_provider(body))
        except ValueError as exc:
            return bad(handler, str(exc))
        except Exception as exc:
            logger.exception("save_managed_provider failed")
            return bad(handler, f"保存失败：{exc}", 500)

    if parsed.path == "/api/providers/activate":
        try:
            return j(handler, activate_managed_provider(body))
        except ValueError as exc:
            return bad(handler, str(exc))
        except Exception as exc:
            logger.exception("activate_managed_provider failed")
            return bad(handler, f"切换失败：{exc}", 500)

    if parsed.path == "/api/providers/delete":
        try:
            return j(handler, delete_managed_provider(body))
        except ValueError as exc:
            return bad(handler, str(exc))
        except Exception as exc:
            logger.exception("delete_managed_provider failed")
            return bad(handler, f"删除失败：{exc}", 500)

    # ── Session pin (POST) ──
    if parsed.path == "/api/session/pin":
        try:
            require(body, "session_id")
        except ValueError as e:
            return bad(handler, str(e))
        try:
            s = get_session(body["session_id"])
        except KeyError:
            return bad(handler, "Session not found", 404)
        s.pinned = bool(body.get("pinned", True))
        s.save()
        return j(handler, {"ok": True, "session": s.compact()})

    # ── Session archive (POST) ──
    if parsed.path == "/api/session/archive":
        try:
            require(body, "session_id")
        except ValueError as e:
            return bad(handler, str(e))
        try:
            s = get_session(body["session_id"])
        except KeyError:
            return bad(handler, "Session not found", 404)
        s.archived = bool(body.get("archived", True))
        s.save()
        return j(handler, {"ok": True, "session": s.compact()})

    # ── Session move to project (POST) ──
    if parsed.path == "/api/session/move":
        try:
            require(body, "session_id")
        except ValueError as e:
            return bad(handler, str(e))
        try:
            s = get_session(body["session_id"])
        except KeyError:
            return bad(handler, "Session not found", 404)
        s.project_id = body.get("project_id") or None
        s.save()
        return j(handler, {"ok": True, "session": s.compact()})

    # ── Project CRUD (POST) ──
    if parsed.path == "/api/projects/create":
        try:
            require(body, "name")
        except ValueError as e:
            return bad(handler, str(e))
        import re as _re

        name = body["name"].strip()[:128]
        if not name:
            return bad(handler, "name required")
        color = body.get("color")
        if color and not _re.match(r"^#[0-9a-fA-F]{3,8}$", color):
            return bad(handler, "Invalid color format")
        projects = load_projects()
        proj = {
            "project_id": uuid.uuid4().hex[:12],
            "name": name,
            "color": color,
            "created_at": time.time(),
        }
        projects.append(proj)
        save_projects(projects)
        return j(handler, {"ok": True, "project": proj})

    if parsed.path == "/api/projects/rename":
        try:
            require(body, "project_id", "name")
        except ValueError as e:
            return bad(handler, str(e))
        import re as _re

        projects = load_projects()
        proj = next(
            (p for p in projects if p["project_id"] == body["project_id"]), None
        )
        if not proj:
            return bad(handler, "Project not found", 404)
        proj["name"] = body["name"].strip()[:128]
        if "color" in body:
            color = body["color"]
            if color and not _re.match(r"^#[0-9a-fA-F]{3,8}$", color):
                return bad(handler, "Invalid color format")
            proj["color"] = color
        save_projects(projects)
        return j(handler, {"ok": True, "project": proj})

    if parsed.path == "/api/projects/delete":
        try:
            require(body, "project_id")
        except ValueError as e:
            return bad(handler, str(e))
        projects = load_projects()
        proj = next(
            (p for p in projects if p["project_id"] == body["project_id"]), None
        )
        if not proj:
            return bad(handler, "Project not found", 404)
        projects = [p for p in projects if p["project_id"] != body["project_id"]]
        save_projects(projects)
        # Unassign all sessions that belonged to this project
        if SESSION_INDEX_FILE.exists():
            try:
                index = json.loads(SESSION_INDEX_FILE.read_text(encoding="utf-8"))
                for entry in index:
                    if entry.get("project_id") == body["project_id"]:
                        try:
                            s = get_session(entry["session_id"])
                            s.project_id = None
                            s.save()
                        except Exception:
                            logger.debug(
                                "Failed to update session %s", entry.get("session_id")
                            )
            except Exception:
                logger.debug("Failed to load session index for project unlink")
        return j(handler, {"ok": True})

    # ── Session import from JSON (POST) ──
    if parsed.path == "/api/session/import":
        return _handle_session_import(handler, body)

    # ── Self-update (POST) ──
    if parsed.path == "/api/updates/apply":
        target = body.get("target", "")
        if target not in ("webui", "agent"):
            return bad(handler, 'target must be "webui" or "agent"')
        from api.updates import apply_update

        return j(handler, apply_update(target))

    # ── Installed-build self-update (POST) ──
    # Downloads the new Setup.exe to %TEMP%, validates sha256, then exec
    # Inno installer with /SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS.
    # Process exits via os._exit(0) ~3s after this returns 200.
    if parsed.path == "/api/agent-update/apply":
        from api.agent_self_update import apply_update as _agent_update_apply

        return j(handler, _agent_update_apply())

    if parsed.path == "/api/agent/static-update/apply":
        from api.employee import (
            handle_agent_static_update_apply as _agent_static_update_apply,
        )

        return _agent_static_update_apply(handler, body)

    # ── CLI session import (POST) ──
    if parsed.path == "/api/session/import_cli":
        return _handle_session_import_cli(handler, body)

    # ── Auth endpoints (POST) ──
    if parsed.path == "/api/auth/login":
        from api.auth import (
            verify_password,
            create_session,
            set_auth_cookie,
            is_auth_enabled,
        )
        from api.auth import _check_login_rate, _record_login_attempt

        if not is_auth_enabled():
            return j(handler, {"ok": True, "message": "Auth not enabled"})
        client_ip = handler.client_address[0]
        if not _check_login_rate(client_ip):
            return j(
                handler,
                {"error": "Too many attempts. Try again in a minute."},
                status=429,
            )
        password = body.get("password", "")
        if not verify_password(password):
            _record_login_attempt(client_ip)
            return bad(handler, "Invalid password", 401)
        cookie_val = create_session()
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Cache-Control", "no-store")
        _security_headers(handler)
        set_auth_cookie(handler, cookie_val)
        handler.end_headers()
        handler.wfile.write(json.dumps({"ok": True}).encode())
        return True

    if parsed.path == "/api/auth/logout":
        from api.auth import clear_auth_cookie, invalidate_session, parse_cookie

        cookie_val = parse_cookie(handler)
        if cookie_val:
            invalidate_session(cookie_val)
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Cache-Control", "no-store")
        _security_headers(handler)
        clear_auth_cookie(handler)
        handler.end_headers()
        handler.wfile.write(json.dumps({"ok": True}).encode())
        return True

    return False  # 404


def _intercept_base_url() -> str:
    return (
        os.getenv("NETCLAW_INTERCEPT_URL")
        or os.getenv("HERMES_INTERCEPT_URL")
        or "http://127.0.0.1:9202"
    ).rstrip("/")


_SIDECAR_PORTS = {
    "/api/publish": "9201",
    "/api/intercept": "9202",
    "/api/wechat": "9203",
    "/api/crm": "9204",
}


def _sidecar_proxy(handler, method: str, path: str, body: dict | None = None) -> bool:
    """Forward an /api/<sidecar>/* request to the corresponding local port.

    Used so the webview can make same-origin requests (port 9119) instead of
    hitting cross-port sidecars directly — pywebview / Edge WebView2 may block
    the cross-port fetches even with permissive CORS headers.
    """
    prefix = next(
        (p for p in _SIDECAR_PORTS if path == p or path.startswith(p + "/")),
        None,
    )
    if not prefix:
        return False
    port = _SIDECAR_PORTS[prefix]
    target = f"http://127.0.0.1:{port}{path}"
    data = None if method == "GET" else json.dumps(body or {}).encode("utf-8")
    request = urllib.request.Request(
        target,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            try:
                payload = json.loads(raw.decode("utf-8") or "{}") if raw else {}
            except Exception:
                payload = {"error": "Sidecar returned non-JSON response"}
            j(handler, payload, status=response.status)
            return True
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            payload = {"error": f"Sidecar returned HTTP {exc.code}"}
        j(handler, payload, status=exc.code)
        return True
    except (OSError, TimeoutError) as exc:
        logger.warning("Sidecar at %s unreachable: %s", target, exc)
        bad(handler, f"Sidecar at {prefix} unavailable", 502)
        return True


def _proxy_intercept(
    handler,
    method: str,
    path: str,
    body: dict | None = None,
) -> None:
    target = _intercept_base_url() + path
    data = None if method == "GET" else json.dumps(body or {}).encode("utf-8")
    request = urllib.request.Request(
        target,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
            return j(handler, payload, status=response.status)
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            payload = {"error": "Intercept sidecar returned an invalid response"}
        return j(handler, payload, status=exc.code)
    except (OSError, TimeoutError) as exc:
        logger.warning("Intercept sidecar unavailable at %s: %s", target, exc)
        return bad(handler, "Intercept sidecar unavailable", 502)


# ── GET route helpers ─────────────────────────────────────────────────────────

# MIME types for static file serving. Hoisted to module scope to avoid
# rebuilding the dict on every request.
_STATIC_MIME = {
    "css": "text/css",
    "js": "application/javascript",
    "html": "text/html",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "ico": "image/x-icon",
    "gif": "image/gif",
    "webp": "image/webp",
    "woff": "font/woff",
    "woff2": "font/woff2",
}
# MIME types that are text-based and should carry charset=utf-8
_TEXT_MIME_TYPES = {
    "text/css",
    "application/javascript",
    "text/html",
    "image/svg+xml",
    "text/plain",
}


def _serve_spa_asset(handler, parsed, prefix: str, asset_root: Path):
    """Serve a file out of the React SPA dist (web_dist/).

    Used for `/assets/*`, `/fonts/*`, and `/favicon.ico` — Vite-emitted asset
    paths. Sandboxed to `asset_root`. Falls through with 404 if the path
    doesn't resolve to a file inside the root.
    """
    rel = parsed.path[len(prefix) :] if prefix else parsed.path.lstrip("/")
    asset_file = (asset_root / rel).resolve()
    try:
        asset_file.relative_to(asset_root)
    except ValueError:
        return j(handler, {"error": "not found"}, status=404)
    if not asset_file.exists() or not asset_file.is_file():
        return j(handler, {"error": "not found"}, status=404)
    ext = asset_file.suffix.lower()
    ct = _STATIC_MIME.get(ext.lstrip("."), "application/octet-stream")
    ct_header = f"{ct}; charset=utf-8" if ct in _TEXT_MIME_TYPES else ct
    handler.send_response(200)
    handler.send_header("Content-Type", ct_header)
    # Vite-built JS/CSS have content-hashed filenames, so we can cache aggressively.
    if rel.startswith("assets/") or rel.startswith("fonts/"):
        handler.send_header("Cache-Control", "public, max-age=31536000, immutable")
    else:
        handler.send_header("Cache-Control", "no-store")
    raw = asset_file.read_bytes()
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)
    return True


def _serve_static(handler, parsed):
    """Legacy `/static/*` — only kept as a redirect target for any remaining
    callers; new SPA assets go through `_serve_spa_asset` for `/assets/*`."""
    return j(
        handler, {"error": "not found", "hint": "legacy /static/ removed"}, status=404
    )


def _handle_session_export(handler, parsed):
    sid = parse_qs(parsed.query).get("session_id", [""])[0]
    if not sid:
        return bad(handler, "session_id is required")
    try:
        s = get_session(sid)
    except KeyError:
        return bad(handler, "Session not found", 404)
    safe = redact_session_data(s.__dict__)
    payload = json.dumps(safe, ensure_ascii=False, indent=2)
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header(
        "Content-Disposition", f'attachment; filename="netclaw-{sid}.json"'
    )
    handler.send_header("Content-Length", str(len(payload.encode("utf-8"))))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(payload.encode("utf-8"))
    return True


def _handle_sessions_search(handler, parsed):
    qs = parse_qs(parsed.query)
    q = qs.get("q", [""])[0].lower().strip()
    content_search = qs.get("content", ["1"])[0] == "1"
    depth = int(qs.get("depth", ["5"])[0])
    if not q:
        safe_sessions = []
        for s in all_sessions():
            item = dict(s)
            if isinstance(item.get("title"), str):
                item["title"] = _redact_text(item["title"])
            safe_sessions.append(item)
        return j(handler, {"sessions": safe_sessions})
    results = []
    for s in all_sessions():
        title_match = q in (s.get("title") or "").lower()
        if title_match:
            item = dict(s, match_type="title")
            if isinstance(item.get("title"), str):
                item["title"] = _redact_text(item["title"])
            results.append(item)
            continue
        if content_search:
            try:
                sess = get_session(s["session_id"])
                msgs = sess.messages[:depth] if depth else sess.messages
                for m in msgs:
                    c = m.get("content") or ""
                    if isinstance(c, list):
                        c = " ".join(
                            p.get("text", "")
                            for p in c
                            if isinstance(p, dict) and p.get("type") == "text"
                        )
                    if q in str(c).lower():
                        item = dict(s, match_type="content")
                        if isinstance(item.get("title"), str):
                            item["title"] = _redact_text(item["title"])
                        results.append(item)
                        break
            except (KeyError, Exception):
                pass
    return j(handler, {"sessions": results, "query": q, "count": len(results)})


def _handle_list_dir(handler, parsed):
    qs = parse_qs(parsed.query)
    sid = qs.get("session_id", [""])[0]
    if not sid:
        return bad(handler, "session_id is required")
    try:
        s = get_session(sid)
        workspace = s.workspace
    except KeyError:
        # Fallback for CLI sessions not loaded in WebUI memory
        try:
            cli_meta = None
            for cs in get_cli_sessions():
                if cs["session_id"] == sid:
                    cli_meta = cs
                    break
            if not cli_meta:
                return bad(handler, "Session not found", 404)
            workspace = cli_meta.get("workspace", "")
        except Exception:
            return bad(handler, "Session not found", 404)
    try:
        return j(
            handler,
            {
                "entries": list_dir(Path(workspace), qs.get("path", ["."])[0]),
                "path": qs.get("path", ["."])[0],
            },
        )
    except (FileNotFoundError, ValueError) as e:
        return bad(handler, _sanitize_error(e), 404)


def _handle_sse_stream(handler, parsed):
    stream_id = parse_qs(parsed.query).get("stream_id", [""])[0]
    q = STREAMS.get(stream_id)
    if q is None:
        return j(handler, {"error": "stream not found"}, status=404)
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("X-Accel-Buffering", "no")
    handler.send_header("Connection", "keep-alive")
    handler.end_headers()
    try:
        while True:
            try:
                event, data = q.get(timeout=30)
            except queue.Empty:
                handler.wfile.write(b": heartbeat\n\n")
                handler.wfile.flush()
                continue
            _sse(handler, event, data)
            if event in ("stream_end", "error", "cancel"):
                break
    except (BrokenPipeError, ConnectionResetError):
        pass
    return True


def _handle_gateway_sse_stream(handler):
    """SSE endpoint for real-time gateway session updates.
    Streams change events from the gateway watcher background thread.
    Only active when show_cli_sessions (show_agent_sessions) setting is enabled.
    """
    # Check if the feature is enabled
    settings = load_settings()
    if not settings.get("show_cli_sessions"):
        return j(handler, {"error": "agent sessions not enabled"}, status=404)

    from api.gateway_watcher import get_watcher

    watcher = get_watcher()
    if watcher is None:
        return j(handler, {"error": "watcher not started"}, status=503)

    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("X-Accel-Buffering", "no")
    handler.send_header("Connection", "keep-alive")
    handler.end_headers()

    q = watcher.subscribe()
    try:
        # Send initial snapshot immediately
        from api.models import get_cli_sessions

        initial = get_cli_sessions()
        _sse(handler, "sessions_changed", {"sessions": initial})

        while True:
            try:
                event_data = q.get(timeout=30)
            except queue.Empty:
                handler.wfile.write(b": keepalive\n\n")
                handler.wfile.flush()
                continue
            if event_data is None:
                break  # watcher is stopping
            _sse(handler, event_data.get("type", "sessions_changed"), event_data)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        pass
    finally:
        watcher.unsubscribe(q)
    return True


def _content_disposition_value(disposition: str, filename: str) -> str:
    """Build a latin-1-safe Content-Disposition value with RFC 5987 filename*."""
    import urllib.parse as _up

    safe_name = Path(filename).name.replace("\r", "").replace("\n", "")
    ascii_fallback = "".join(
        ch if 32 <= ord(ch) < 127 and ch not in {'"', "\\"} else "_" for ch in safe_name
    ).strip(" .")
    if not ascii_fallback:
        suffix = Path(safe_name).suffix
        ascii_suffix = "".join(
            ch if 32 <= ord(ch) < 127 and ch not in {'"', "\\"} else "_"
            for ch in suffix
        )
        ascii_fallback = f"download{ascii_suffix}" if ascii_suffix else "download"
    quoted_name = _up.quote(safe_name, safe="")
    return (
        f"{disposition}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quoted_name}"
    )


def _handle_media(handler, parsed):
    """Serve a local file by absolute path for inline display in the chat.

    Security:
    - Path must resolve to an allowed root (hermes home, /tmp, common dirs)
    - Auth-gated when auth is enabled
    - Only image MIME types are served inline; all others force download
    - SVG always served as attachment (XSS risk)
    - No path traversal: resolved path must stay within an allowed root
    """
    import os as _os
    from api.auth import is_auth_enabled, parse_cookie, verify_session

    _HOME = Path(_os.path.expanduser("~"))
    _HERMES_HOME = Path(_os.getenv("HERMES_HOME", str(_HOME / ".hermes"))).expanduser()

    # Auth check
    if is_auth_enabled():
        cv = parse_cookie(handler)
        if not (cv and verify_session(cv)):
            handler.send_response(401)
            handler.send_header("Content-Type", "application/json")
            handler.end_headers()
            handler.wfile.write(b'{"error":"Authentication required"}')
            return

    qs = parse_qs(parsed.query)
    raw_path = qs.get("path", [""])[0].strip()
    if not raw_path:
        return bad(handler, "path parameter required", 400)

    # Resolve the path and check it is within an allowed root
    try:
        target = Path(raw_path).resolve()
    except Exception:
        return bad(handler, "Invalid path", 400)

    # Allowed roots: hermes home, /tmp, and active workspace.
    # Intentionally NOT the entire home dir — that would expose ~/.ssh,
    # ~/.aws, browser profiles, etc. to any authenticated user.
    allowed_roots = [
        _HERMES_HOME.resolve(),
        Path("/tmp").resolve(),
        (_HOME / ".hermes").resolve(),
    ]
    # Also allow the active workspace directory (where screenshots land)
    try:
        from api.workspace import get_last_workspace

        ws = Path(get_last_workspace()).resolve()
        if ws.is_dir():
            allowed_roots.append(ws)
    except Exception:
        pass
    within_allowed = any(
        _os.path.commonpath([str(target), str(root)]) == str(root)
        for root in allowed_roots
        if root.exists()
    )
    if not within_allowed:
        return bad(handler, "Path not in allowed location", 403)

    if not target.exists() or not target.is_file():
        return j(handler, {"error": "not found"}, status=404)

    # Determine MIME type
    ext = target.suffix.lower()
    mime = MIME_MAP.get(ext, "application/octet-stream")

    # Only serve image types inline; everything else is a download
    _INLINE_IMAGE_TYPES = {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/x-icon",
        "image/bmp",
    }
    _DOWNLOAD_TYPES = {"image/svg+xml"}  # SVG: XSS risk, force download

    try:
        raw_bytes = target.read_bytes()
    except PermissionError:
        return bad(handler, "Permission denied", 403)
    except Exception:
        return bad(handler, "Could not read file", 500)

    handler.send_response(200)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(len(raw_bytes)))
    handler.send_header("Cache-Control", "private, max-age=3600")
    _security_headers(handler)

    if mime in _DOWNLOAD_TYPES or mime not in _INLINE_IMAGE_TYPES:
        handler.send_header(
            "Content-Disposition",
            _content_disposition_value("attachment", target.name),
        )
    else:
        handler.send_header(
            "Content-Disposition",
            _content_disposition_value("inline", target.name),
        )

    handler.end_headers()
    handler.wfile.write(raw_bytes)


def _handle_file_raw(handler, parsed):
    qs = parse_qs(parsed.query)
    sid = qs.get("session_id", [""])[0]
    if not sid:
        return bad(handler, "session_id is required")
    try:
        s = get_session(sid)
    except KeyError:
        return bad(handler, "Session not found", 404)
    rel = qs.get("path", [""])[0]
    force_download = qs.get("download", [""])[0] == "1"
    target = safe_resolve(Path(s.workspace), rel)
    if not target.exists() or not target.is_file():
        return j(handler, {"error": "not found"}, status=404)
    ext = target.suffix.lower()
    mime = MIME_MAP.get(ext, "application/octet-stream")
    raw_bytes = target.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(len(raw_bytes)))
    handler.send_header("Cache-Control", "no-store")
    # Security: force download for dangerous MIME types to prevent XSS
    dangerous_types = {"text/html", "application/xhtml+xml", "image/svg+xml"}
    if force_download or mime in dangerous_types:
        handler.send_header(
            "Content-Disposition",
            _content_disposition_value("attachment", target.name),
        )
    else:
        handler.send_header(
            "Content-Disposition",
            _content_disposition_value("inline", target.name),
        )
    handler.end_headers()
    handler.wfile.write(raw_bytes)
    return True


def _handle_file_read(handler, parsed):
    qs = parse_qs(parsed.query)
    sid = qs.get("session_id", [""])[0]
    if not sid:
        return bad(handler, "session_id is required")
    try:
        s = get_session(sid)
    except KeyError:
        return bad(handler, "Session not found", 404)
    rel = qs.get("path", [""])[0]
    if not rel:
        return bad(handler, "path is required")
    try:
        return j(handler, read_file_content(Path(s.workspace), rel))
    except (FileNotFoundError, ValueError) as e:
        return bad(handler, _sanitize_error(e), 404)


def _handle_approval_pending(handler, parsed):
    sid = parse_qs(parsed.query).get("session_id", [""])[0]
    with _lock:
        queue = _pending.get(sid)
        # Support both the new list format and a legacy single-dict value.
        if isinstance(queue, list):
            p = queue[0] if queue else None
            total = len(queue)
        elif queue:
            p = queue
            total = 1
        else:
            p = None
            total = 0
    if p:
        return j(handler, {"pending": dict(p), "pending_count": total})
    return j(handler, {"pending": None, "pending_count": 0})


def _handle_approval_inject(handler, parsed):
    """Inject a fake pending approval -- loopback-only, used by automated tests."""
    qs = parse_qs(parsed.query)
    sid = qs.get("session_id", [""])[0]
    key = qs.get("pattern_key", ["test_pattern"])[0]
    cmd = qs.get("command", ["rm -rf /tmp/test"])[0]
    if sid:
        submit_pending(
            sid,
            {
                "command": cmd,
                "pattern_key": key,
                "pattern_keys": [key],
                "description": "test pattern",
            },
        )
        return j(handler, {"ok": True, "session_id": sid})
    return j(handler, {"error": "session_id required"}, status=400)


def _handle_clarify_pending(handler, parsed):
    sid = parse_qs(parsed.query).get("session_id", [""])[0]
    pending = get_clarify_pending(sid)
    if pending:
        return j(handler, {"pending": pending})
    return j(handler, {"pending": None})


def _handle_clarify_inject(handler, parsed):
    """Inject a fake pending clarify prompt -- loopback-only, used by automated tests."""
    qs = parse_qs(parsed.query)
    sid = qs.get("session_id", [""])[0]
    question = qs.get("question", ["Which option?"])[0]
    choices = qs.get("choices", [])
    if sid:
        submit_clarify_pending(
            sid,
            {
                "question": question,
                "choices_offered": choices,
                "session_id": sid,
                "kind": "clarify",
            },
        )
        return j(handler, {"ok": True, "session_id": sid})
    return j(handler, {"error": "session_id required"}, status=400)


def _handle_live_models(handler, parsed):
    """Return the live model list for a provider.

    Delegates to the agent's provider_model_ids() which handles:
    - OpenRouter: live fetch from /api/v1/models
    - Anthropic: live fetch from /v1/models (API key or OAuth token)
    - Copilot: live fetch from api.githubcopilot.com/models with correct headers
    - openai-codex: Codex OAuth endpoint + local ~/.codex/ cache fallback
    - Nous: live fetch from inference-api.nousresearch.com/v1/models
    - DeepSeek, kimi-coding, opencode-zen/go, custom: generic OpenAI-compat /v1/models
    - ZAI, MiniMax, Google/Gemini: fall back to static list (non-standard endpoints)
    - All others: static _PROVIDER_MODELS fallback

    The agent already maintains all provider-specific auth and endpoint logic
    in one place; the WebUI inherits it rather than duplicating it.

    Query params:
        provider  (optional) — provider ID; defaults to active profile provider
    """
    qs = parse_qs(parsed.query)
    provider = (qs.get("provider", [""])[0] or "").lower().strip()

    try:
        from api.config import get_config as _gc

        cfg = _gc()
        if not provider:
            provider = cfg.get("model", {}).get("provider") or ""
        if not provider:
            return j(handler, {"error": "no_provider", "models": []})

        # Delegate to the agent's live-fetch + fallback resolver.
        # provider_model_ids() tries live endpoints first and falls back to
        # the static _PROVIDER_MODELS list — it never raises.
        try:
            import sys as _sys
            import os as _os

            _agent_dir = _os.path.join(
                _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))),
                "..",
                "..",
                ".hermes",
                "hermes-agent",
            )
            _agent_dir = _os.path.normpath(_agent_dir)
            if _agent_dir not in _sys.path:
                _sys.path.insert(0, _agent_dir)
            from hermes_cli.models import provider_model_ids as _pmi

            ids = _pmi(provider)
        except Exception as _import_err:
            logger.debug(
                "provider_model_ids import failed for %s: %s", provider, _import_err
            )
            # Last resort: return the WebUI's own static catalog
            from api.config import _PROVIDER_MODELS as _pm

            ids = [m["id"] for m in _pm.get(provider, [])]

        if not ids:
            return j(handler, {"provider": provider, "models": [], "count": 0})

        # Normalise to {id, label} — provider_model_ids() returns plain string IDs
        def _make_label(mid):
            """Best-effort human label from a model ID string."""
            # Preserve slashes for router IDs like "anthropic/claude-sonnet-4.6"
            display = mid.split("/")[-1] if "/" in mid else mid
            parts = display.split("-")
            result = []
            for p in parts:
                pl = p.lower()
                if pl == "gpt":
                    result.append("GPT")
                elif pl in (
                    "claude",
                    "gemini",
                    "gemma",
                    "llama",
                    "mistral",
                    "qwen",
                    "deepseek",
                    "grok",
                    "kimi",
                    "glm",
                ):
                    result.append(p.capitalize())
                elif p[:1].isdigit():
                    result.append(p)  # version numbers: 5.4, 3.5, 4.6 — unchanged
                else:
                    result.append(p.capitalize())
            label = " ".join(result)
            # Restore well-known uppercase tokens that title-casing breaks
            for orig in ("GPT", "GLM", "API", "AI", "XL", "MoE"):
                label = label.replace(orig.title(), orig)
            return label

        models_out = [{"id": mid, "label": _make_label(mid)} for mid in ids if mid]
        return j(
            handler,
            {"provider": provider, "models": models_out, "count": len(models_out)},
        )

    except Exception as _e:
        logger.debug("_handle_live_models failed for %s: %s", provider, _e)
        return j(handler, {"error": str(_e), "models": []})


def _handle_cron_output(handler, parsed):
    from cron.jobs import OUTPUT_DIR as CRON_OUT

    qs = parse_qs(parsed.query)
    job_id = qs.get("job_id", [""])[0]
    limit = int(qs.get("limit", ["5"])[0])
    if not job_id:
        return j(handler, {"error": "job_id required"}, status=400)
    out_dir = CRON_OUT / job_id
    outputs = []
    if out_dir.exists():
        files = sorted(out_dir.glob("*.md"), reverse=True)[:limit]
        for f in files:
            try:
                txt = f.read_text(encoding="utf-8", errors="replace")
                outputs.append({"filename": f.name, "content": txt[:8000]})
            except Exception:
                logger.debug("Failed to read cron output file %s", f)
    return j(handler, {"job_id": job_id, "outputs": outputs})


def _handle_cron_recent(handler, parsed):
    """Return cron jobs that have completed since a given timestamp."""
    import datetime

    qs = parse_qs(parsed.query)
    since = float(qs.get("since", ["0"])[0])
    try:
        from cron.jobs import list_jobs

        jobs = list_jobs(include_disabled=True)
        completions = []
        for job in jobs:
            last_run = job.get("last_run_at")
            if not last_run:
                continue
            if isinstance(last_run, str):
                try:
                    ts = datetime.datetime.fromisoformat(
                        last_run.replace("Z", "+00:00")
                    ).timestamp()
                except (ValueError, TypeError):
                    continue
            else:
                ts = float(last_run)
            if ts > since:
                completions.append(
                    {
                        "job_id": job.get("id", ""),
                        "name": job.get("name", "Unknown"),
                        "status": job.get("last_status", "unknown"),
                        "completed_at": ts,
                    }
                )
        return j(handler, {"completions": completions, "since": since})
    except ImportError:
        return j(handler, {"completions": [], "since": since})


def _handle_memory_read(handler):
    mem_dir = employee_data_root() / "memories"
    mem_file = mem_dir / "MEMORY.md"
    user_file = mem_dir / "USER.md"
    memory = (
        mem_file.read_text(encoding="utf-8", errors="replace")
        if mem_file.exists()
        else ""
    )
    user = (
        user_file.read_text(encoding="utf-8", errors="replace")
        if user_file.exists()
        else ""
    )
    return j(
        handler,
        {
            "memory": _redact_text(memory),
            "user": _redact_text(user),
            "memory_path": str(mem_file),
            "user_path": str(user_file),
            "memory_mtime": mem_file.stat().st_mtime if mem_file.exists() else None,
            "user_mtime": user_file.stat().st_mtime if user_file.exists() else None,
        },
    )


# ── POST route helpers ────────────────────────────────────────────────────────


def _handle_sessions_cleanup(handler, body, zero_only=False):
    cleaned = 0
    for p in SESSION_DIR.glob("*.json"):
        if p.name.startswith("_"):
            continue
        try:
            s = Session.load(p.stem)
            if zero_only:
                should_delete = s and len(s.messages) == 0
            else:
                should_delete = s and s.title == "Untitled" and len(s.messages) == 0
            if should_delete:
                with LOCK:
                    SESSIONS.pop(p.stem, None)
                p.unlink(missing_ok=True)
                cleaned += 1
        except Exception:
            logger.debug("Failed to clean up session file %s", p)
    if SESSION_INDEX_FILE.exists():
        SESSION_INDEX_FILE.unlink(missing_ok=True)
    return j(handler, {"ok": True, "cleaned": cleaned})


def _handle_chat_start(handler, body):
    try:
        require(body, "session_id")
    except ValueError as e:
        return bad(handler, str(e))
    try:
        s = get_session(body["session_id"])
    except KeyError:
        return bad(handler, "Session not found", 404)
    msg = str(body.get("message", "")).strip()
    if not msg:
        return bad(handler, "message is required")
    attachments = [str(a) for a in (body.get("attachments") or [])][:20]
    try:
        workspace = str(resolve_trusted_workspace(body.get("workspace") or s.workspace))
    except ValueError as e:
        return bad(handler, str(e))
    model = body.get("model") or s.model
    # Prevent duplicate runs in the same session while a stream is still active.
    # This commonly happens after page refresh/reconnect races and can produce
    # duplicated clarify cards for what appears to be a single user request.
    current_stream_id = getattr(s, "active_stream_id", None)
    if current_stream_id:
        with STREAMS_LOCK:
            current_active = current_stream_id in STREAMS
        if current_active:
            return j(
                handler,
                {
                    "error": "session already has an active stream",
                    "active_stream_id": current_stream_id,
                },
                status=409,
            )
        # Stale stream id from a previous run; clear and continue.
        s.active_stream_id = None
    stream_id = uuid.uuid4().hex
    s.workspace = workspace
    s.model = model
    s.active_stream_id = stream_id
    s.pending_user_message = msg
    s.pending_attachments = attachments
    s.pending_started_at = time.time()
    s.save()
    set_last_workspace(workspace)
    q = queue.Queue()
    with STREAMS_LOCK:
        STREAMS[stream_id] = q
    thr = threading.Thread(
        target=_run_agent_streaming,
        args=(s.session_id, msg, model, workspace, stream_id, attachments),
        daemon=True,
    )
    thr.start()
    return j(handler, {"stream_id": stream_id, "session_id": s.session_id})


def _handle_chat_sync(handler, body):
    """Fallback synchronous chat endpoint (POST /api/chat). Not used by frontend."""
    from api.config import _get_session_agent_lock

    s = get_session(body["session_id"])
    msg = str(body.get("message", "")).strip()
    if not msg:
        return j(handler, {"error": "empty message"}, status=400)
    workspace = Path(body.get("workspace") or s.workspace).expanduser().resolve()
    s.workspace = str(workspace)
    s.model = body.get("model") or s.model
    from api.streaming import _ENV_LOCK

    with _ENV_LOCK:
        old_cwd = os.environ.get("TERMINAL_CWD")
        os.environ["TERMINAL_CWD"] = str(workspace)
        old_exec_ask = os.environ.get("HERMES_EXEC_ASK")
        old_session_key = os.environ.get("HERMES_SESSION_KEY")
        os.environ["HERMES_EXEC_ASK"] = "1"
        os.environ["HERMES_SESSION_KEY"] = s.session_id
    # Re-apply any persisted per-session YOLO flag so it survives server restarts.
    if getattr(s, "yolo", False):
        try:
            from tools.approval import enable_session_yolo

            enable_session_yolo(s.session_id)
        except ImportError:
            pass
    try:
        from run_agent import AIAgent

        with CHAT_LOCK:
            from api.config import resolve_model_provider

            _model, _provider, _base_url = resolve_model_provider(s.model)
            # Resolve API key via Hermes runtime provider (matches gateway behaviour)
            _api_key = None
            try:
                from hermes_cli.runtime_provider import resolve_runtime_provider

                _rt = resolve_runtime_provider(requested=_provider)
                _api_key = _rt.get("api_key")
                # Also use runtime provider/base_url if the webui config didn't resolve them
                if not _provider:
                    _provider = _rt.get("provider")
                if not _base_url:
                    _base_url = _rt.get("base_url")
            except Exception as _e:
                print(
                    f"[webui] WARNING: resolve_runtime_provider failed: {_e}",
                    flush=True,
                )
            agent = AIAgent(
                model=_model,
                provider=_provider,
                base_url=_base_url,
                api_key=_api_key,
                platform="cli",
                quiet_mode=True,
                enabled_toolsets=_resolve_cli_toolsets(),
                session_id=s.session_id,
            )
            workspace_ctx = f"[Workspace: {s.workspace}]\n"
            workspace_system_msg = (
                f"Active workspace at session start: {s.workspace}\n"
                "Every user message is prefixed with [Workspace: /absolute/path] indicating the "
                "workspace the user has selected in the web UI at the time they sent that message. "
                "This tag is the single authoritative source of the active workspace and updates "
                "with every message. It overrides any prior workspace mentioned in this system "
                "prompt, memory, or conversation history. Always use the value from the most recent "
                "[Workspace: ...] tag as your default working directory for ALL file operations: "
                "write_file, read_file, search_files, terminal workdir, and patch. "
                "Never fall back to a hardcoded path when this tag is present."
            )
            from api.streaming import (
                _sanitize_messages_for_api,
                _restore_reasoning_metadata,
            )

            _previous_messages = list(s.messages or [])

            result = agent.run_conversation(
                user_message=workspace_ctx + msg,
                system_message=workspace_system_msg,
                conversation_history=_sanitize_messages_for_api(s.messages),
                task_id=s.session_id,
                persist_user_message=msg,
            )
    finally:
        with _ENV_LOCK:
            if old_cwd is None:
                os.environ.pop("TERMINAL_CWD", None)
            else:
                os.environ["TERMINAL_CWD"] = old_cwd
            if old_exec_ask is None:
                os.environ.pop("HERMES_EXEC_ASK", None)
            else:
                os.environ["HERMES_EXEC_ASK"] = old_exec_ask
            if old_session_key is None:
                os.environ.pop("HERMES_SESSION_KEY", None)
            else:
                os.environ["HERMES_SESSION_KEY"] = old_session_key
    s.messages = _restore_reasoning_metadata(
        _previous_messages,
        result.get("messages") or s.messages,
    )
    # Only auto-generate title when still default; preserves user renames
    if s.title == "Untitled":
        s.title = title_from(s.messages, s.title)
    s.save()
    # Sync to state.db for /insights (opt-in setting)
    try:
        if load_settings().get("sync_to_insights"):
            from api.state_sync import sync_session_usage

            sync_session_usage(
                session_id=s.session_id,
                input_tokens=s.input_tokens or 0,
                output_tokens=s.output_tokens or 0,
                estimated_cost=s.estimated_cost,
                model=s.model,
                title=s.title,
                message_count=len(s.messages),
            )
    except Exception:
        logger.debug("Failed to update session cost tracking")
    return j(
        handler,
        {
            "answer": result.get("final_response") or "",
            "status": "done" if result.get("completed", True) else "partial",
            "session": s.compact() | {"messages": s.messages},
            "result": {k: v for k, v in result.items() if k != "messages"},
        },
    )


def _handle_cron_create(handler, body):
    try:
        require(body, "prompt", "schedule")
    except ValueError as e:
        return bad(handler, str(e))
    try:
        from cron.jobs import create_job

        job = create_job(
            prompt=body["prompt"],
            schedule=body["schedule"],
            name=body.get("name") or None,
            deliver=body.get("deliver") or "local",
            skills=body.get("skills") or [],
            model=body.get("model") or None,
        )
        return j(handler, {"ok": True, "job": job})
    except Exception as e:
        return j(handler, {"error": str(e)}, status=400)


def _handle_cron_update(handler, body):
    try:
        require(body, "job_id")
    except ValueError as e:
        return bad(handler, str(e))
    from cron.jobs import update_job

    updates = {k: v for k, v in body.items() if k != "job_id" and v is not None}
    job = update_job(body["job_id"], updates)
    if not job:
        return bad(handler, "Job not found", 404)
    return j(handler, {"ok": True, "job": job})


def _handle_cron_delete(handler, body):
    try:
        require(body, "job_id")
    except ValueError as e:
        return bad(handler, str(e))
    from cron.jobs import remove_job

    ok = remove_job(body["job_id"])
    if not ok:
        return bad(handler, "Job not found", 404)
    return j(handler, {"ok": True, "job_id": body["job_id"]})


def _handle_cron_run(handler, body):
    job_id = body.get("job_id", "")
    if not job_id:
        return bad(handler, "job_id required")
    from cron.jobs import get_job
    from cron.scheduler import run_job

    job = get_job(job_id)
    if not job:
        return bad(handler, "Job not found", 404)
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return j(handler, {"ok": True, "job_id": job_id, "status": "triggered"})


def _handle_cron_pause(handler, body):
    job_id = body.get("job_id", "")
    if not job_id:
        return bad(handler, "job_id required")
    from cron.jobs import pause_job

    result = pause_job(job_id, reason=body.get("reason"))
    if result:
        return j(handler, {"ok": True, "job": result})
    return bad(handler, "Job not found", 404)


def _handle_cron_resume(handler, body):
    job_id = body.get("job_id", "")
    if not job_id:
        return bad(handler, "job_id required")
    from cron.jobs import resume_job

    result = resume_job(job_id)
    if result:
        return j(handler, {"ok": True, "job": result})
    return bad(handler, "Job not found", 404)


def _handle_file_delete(handler, body):
    try:
        require(body, "session_id", "path")
    except ValueError as e:
        return bad(handler, str(e))
    try:
        s = get_session(body["session_id"])
    except KeyError:
        return bad(handler, "Session not found", 404)
    try:
        target = safe_resolve(Path(s.workspace), body["path"])
        if not target.exists():
            return bad(handler, "File not found", 404)
        if target.is_dir():
            return bad(handler, "Cannot delete directories via this endpoint")
        target.unlink()
        return j(handler, {"ok": True, "path": body["path"]})
    except (ValueError, PermissionError) as e:
        return bad(handler, _sanitize_error(e))


def _handle_file_save(handler, body):
    try:
        require(body, "session_id", "path")
    except ValueError as e:
        return bad(handler, str(e))
    try:
        s = get_session(body["session_id"])
    except KeyError:
        return bad(handler, "Session not found", 404)
    try:
        target = safe_resolve(Path(s.workspace), body["path"])
        if not target.exists():
            return bad(handler, "File not found", 404)
        if target.is_dir():
            return bad(handler, "Cannot save: path is a directory")
        target.write_text(body.get("content", ""), encoding="utf-8")
        return j(
            handler, {"ok": True, "path": body["path"], "size": target.stat().st_size}
        )
    except (ValueError, PermissionError) as e:
        return bad(handler, _sanitize_error(e))


def _handle_file_create(handler, body):
    try:
        require(body, "session_id", "path")
    except ValueError as e:
        return bad(handler, str(e))
    try:
        s = get_session(body["session_id"])
    except KeyError:
        return bad(handler, "Session not found", 404)
    try:
        target = safe_resolve(Path(s.workspace), body["path"])
        if target.exists():
            return bad(handler, "File already exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body.get("content", ""), encoding="utf-8")
        return j(
            handler, {"ok": True, "path": str(target.relative_to(Path(s.workspace)))}
        )
    except (ValueError, PermissionError) as e:
        return bad(handler, _sanitize_error(e))


def _handle_file_rename(handler, body):
    try:
        require(body, "session_id", "path", "new_name")
    except ValueError as e:
        return bad(handler, str(e))
    try:
        s = get_session(body["session_id"])
    except KeyError:
        return bad(handler, "Session not found", 404)
    try:
        source = safe_resolve(Path(s.workspace), body["path"])
        if not source.exists():
            return bad(handler, "File not found", 404)
        new_name = body["new_name"].strip()
        if not new_name or "/" in new_name or ".." in new_name:
            return bad(handler, "Invalid file name")
        dest = source.parent / new_name
        if dest.exists():
            return bad(handler, f'A file named "{new_name}" already exists')
        source.rename(dest)
        new_rel = str(dest.relative_to(Path(s.workspace)))
        return j(handler, {"ok": True, "old_path": body["path"], "new_path": new_rel})
    except (ValueError, PermissionError, OSError) as e:
        return bad(handler, _sanitize_error(e))


def _handle_create_dir(handler, body):
    try:
        require(body, "session_id", "path")
    except ValueError as e:
        return bad(handler, str(e))
    try:
        s = get_session(body["session_id"])
    except KeyError:
        return bad(handler, "Session not found", 404)
    try:
        target = safe_resolve(Path(s.workspace), body["path"])
        if target.exists():
            return bad(handler, "Path already exists")
        target.mkdir(parents=True)
        return j(
            handler, {"ok": True, "path": str(target.relative_to(Path(s.workspace)))}
        )
    except (ValueError, PermissionError, OSError) as e:
        return bad(handler, _sanitize_error(e))


def _handle_workspace_add(handler, body):
    path_str = body.get("path", "").strip()
    name = body.get("name", "").strip()
    if not path_str:
        return bad(handler, "path is required")
    try:
        p = resolve_trusted_workspace(path_str)
    except ValueError as e:
        return bad(handler, str(e))
    wss = load_workspaces()
    if any(w["path"] == str(p) for w in wss):
        return bad(handler, "Workspace already in list")
    wss.append({"path": str(p), "name": name or p.name})
    save_workspaces(wss)
    return j(handler, {"ok": True, "workspaces": wss})


def _handle_workspace_remove(handler, body):
    path_str = body.get("path", "").strip()
    if not path_str:
        return bad(handler, "path is required")
    wss = load_workspaces()
    wss = [w for w in wss if w["path"] != path_str]
    save_workspaces(wss)
    return j(handler, {"ok": True, "workspaces": wss})


def _handle_workspace_rename(handler, body):
    path_str = body.get("path", "").strip()
    name = body.get("name", "").strip()
    if not path_str or not name:
        return bad(handler, "path and name are required")
    wss = load_workspaces()
    for w in wss:
        if w["path"] == path_str:
            w["name"] = name
            break
    else:
        return bad(handler, "Workspace not found", 404)
    save_workspaces(wss)
    return j(handler, {"ok": True, "workspaces": wss})


def _handle_approval_respond(handler, body):
    sid = body.get("session_id", "")
    if not sid:
        return bad(handler, "session_id is required")
    choice = body.get("choice", "deny")
    if choice not in ("once", "session", "always", "deny"):
        return bad(handler, f"Invalid choice: {choice}")
    approval_id = body.get("approval_id", "")

    # Pop the targeted entry from the pending queue by approval_id.
    # Falls back to popping the first entry for backward-compat with old clients.
    pending = None
    with _lock:
        queue = _pending.get(sid)
        if isinstance(queue, list):
            if approval_id:
                # Find and remove the specific entry by approval_id.
                for i, entry in enumerate(queue):
                    if entry.get("approval_id") == approval_id:
                        pending = queue.pop(i)
                        break
                else:
                    # approval_id not found -- fall back to oldest entry.
                    pending = queue.pop(0) if queue else None
            else:
                pending = queue.pop(0) if queue else None
            if not queue:
                _pending.pop(sid, None)
        elif queue:
            # Legacy single-dict value.
            pending = _pending.pop(sid, None)

    if pending:
        keys = pending.get("pattern_keys") or [pending.get("pattern_key", "")]
        if choice in ("once", "session"):
            for k in keys:
                approve_session(sid, k)
        elif choice == "always":
            for k in keys:
                approve_session(sid, k)
                approve_permanent(k)
            save_permanent_allowlist(_permanent_approved)
    # Unblock the agent thread waiting in the gateway approval queue.
    # This is the primary signal when streaming is active — the agent
    # thread is parked in entry.event.wait() and needs to be woken up.
    resolve_gateway_approval(sid, choice, resolve_all=False)
    return j(handler, {"ok": True, "choice": choice})


def _handle_clarify_respond(handler, body):
    sid = body.get("session_id", "")
    if not sid:
        return bad(handler, "session_id is required")
    response = body.get("response")
    if response is None:
        response = body.get("answer")
    if response is None:
        response = body.get("choice")
    response = str(response or "").strip()
    if not response:
        return bad(handler, "response is required")
    resolve_clarify(sid, response, resolve_all=False)
    return j(handler, {"ok": True, "response": response})


def _handle_session_compress(handler, body):
    def _visible_messages_for_anchor(messages):
        out = []
        for m in messages or []:
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            if not role or role == "tool":
                continue
            content = m.get("content", "")
            has_attachments = bool(m.get("attachments"))
            if role == "assistant":
                tool_calls = m.get("tool_calls")
                has_tool_calls = isinstance(tool_calls, list) and len(tool_calls) > 0
                has_tool_use = False
                has_reasoning = bool(m.get("reasoning"))
                if isinstance(content, list):
                    for p in content:
                        if not isinstance(p, dict):
                            continue
                        if p.get("type") == "tool_use":
                            has_tool_use = True
                        if p.get("type") in {"thinking", "reasoning"}:
                            has_reasoning = True
                    text = "\n".join(
                        str(p.get("text") or p.get("content") or "")
                        for p in content
                        if isinstance(p, dict) and p.get("type") == "text"
                    ).strip()
                else:
                    text = str(content or "").strip()
                if (
                    text
                    or has_attachments
                    or has_tool_calls
                    or has_tool_use
                    or has_reasoning
                ):
                    out.append(m)
                continue
            if isinstance(content, list):
                text = "\n".join(
                    str(p.get("text") or p.get("content") or "")
                    for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                ).strip()
            else:
                text = str(content or "").strip()
            if text or has_attachments:
                out.append(m)
        return out

    def _anchor_message_key(m):
        if not isinstance(m, dict):
            return None
        role = str(m.get("role") or "")
        if not role or role == "tool":
            return None
        content = m.get("content", "")
        if isinstance(content, list):
            text = "\n".join(
                str(p.get("text") or p.get("content") or "")
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            )
        else:
            text = str(content or "")
        norm = " ".join(text.split()).strip()[:160]
        ts = m.get("_ts") or m.get("timestamp")
        attachments = m.get("attachments")
        attach_count = len(attachments) if isinstance(attachments, list) else 0
        if not norm and not attach_count and not ts:
            return None
        return {"role": role, "ts": ts, "text": norm, "attachments": attach_count}

    try:
        require(body, "session_id")
    except ValueError as e:
        return bad(handler, str(e))

    sid = str(body.get("session_id") or "").strip()
    if not sid:
        return bad(handler, "session_id is required")

    # Cap focus_topic to 500 chars — matches the defensive input-size pattern
    # used elsewhere (session title :80, first-exchange snippets :500) and
    # prevents a user from forwarding an unbounded string into the compressor
    # prompt path. No privilege boundary here (user prompting themself), just
    # cheap bound-checking.
    focus_topic = (
        str(body.get("focus_topic") or body.get("topic") or "").strip()[:500] or None
    )

    try:
        s = get_session(sid)
    except KeyError:
        return bad(handler, "Session not found", 404)

    if getattr(s, "active_stream_id", None):
        return bad(
            handler,
            "Session is still streaming; wait for the current turn to finish.",
            409,
        )

    try:
        from api.streaming import _sanitize_messages_for_api

        messages = _sanitize_messages_for_api(s.messages)
        if len(messages) < 4:
            return bad(
                handler,
                "Not enough conversation to compress (need at least 4 messages).",
            )

        def _fallback_estimate_messages_tokens_rough(msgs):
            """Fallback heuristic token estimate when runtime metadata helpers are absent.

            Uses whitespace token-like word counting only. This intentionally
            over/under-estimates BPE token counts (roughly around x3/x4 scale),
            and is only for resilient fallback behavior.
            """
            total = 0
            for m in msgs or []:
                if not isinstance(m, dict):
                    continue
                content = m.get("content", "")
                if isinstance(content, list):
                    content_text = "\n".join(
                        str(p.get("text") or p.get("content") or "")
                        for p in content
                        if isinstance(p, dict)
                    )
                else:
                    content_text = str(content or "")
                total += len(content_text.split())
            return max(1, total)

        def _fallback_summarize_manual_compression(
            original_messages,
            compressed_messages,
            before_tokens,
            after_tokens,
            focus_topic=None,
        ):
            """Lightweight fallback summary to keep /session/compress usable in tests/runtime."""
            after_tokens = (
                after_tokens
                if after_tokens is not None
                else _fallback_estimate_messages_tokens_rough(compressed_messages)
            )
            headline = f"Compressed: {len(original_messages)} \u2192 {len(compressed_messages)} messages"
            summary = {
                "headline": headline,
                "token_line": f"Rough transcript estimate: ~{before_tokens} \u2192 ~{after_tokens} tokens",
                "note": f"Focus: {focus_topic}" if focus_topic else None,
            }
            summary["reference_message"] = (
                f"[CONTEXT COMPACTION \u2014 REFERENCE ONLY] {headline}\n"
                f"{summary['token_line']}\n"
                + (summary["note"] + "\n" if summary.get("note") else "")
                + "Compression completed."
            )
            return summary

        def _estimate_messages_tokens_rough(msgs):
            try:
                from agent.model_metadata import estimate_messages_tokens_rough

                return estimate_messages_tokens_rough(msgs)
            except Exception:
                return _fallback_estimate_messages_tokens_rough(msgs)

        def _summarize_manual_compression(
            original_messages,
            compressed_messages,
            before_tokens,
            after_tokens,
            focus_topic=None,
        ):
            try:
                from agent.manual_compression_feedback import (
                    summarize_manual_compression,
                )

                return summarize_manual_compression(
                    original_messages,
                    compressed_messages,
                    before_tokens,
                    after_tokens,
                )
            except Exception:
                return _fallback_summarize_manual_compression(
                    original_messages,
                    compressed_messages,
                    before_tokens,
                    after_tokens,
                    focus_topic,
                )

        import api.config as _cfg
        import hermes_cli.runtime_provider as _runtime_provider
        import run_agent as _run_agent

        resolved_model, resolved_provider, resolved_base_url = (
            _cfg.resolve_model_provider(s.model)
        )

        resolved_api_key = None
        try:
            _rt = _runtime_provider.resolve_runtime_provider(
                requested=resolved_provider
            )
            resolved_api_key = _rt.get("api_key")
            if not resolved_provider:
                resolved_provider = _rt.get("provider")
            if not resolved_base_url:
                resolved_base_url = _rt.get("base_url")
        except Exception as _e:
            logger.warning("resolve_runtime_provider failed for compression: %s", _e)

        if not resolved_api_key:
            return bad(handler, "No provider configured -- cannot compress.")

        with _cfg._get_session_agent_lock(sid):
            original_messages = list(messages)
            approx_tokens = _estimate_messages_tokens_rough(original_messages)

            agent = _run_agent.AIAgent(
                model=resolved_model,
                provider=resolved_provider,
                base_url=resolved_base_url,
                api_key=resolved_api_key,
                platform="cli",
                quiet_mode=True,
                enabled_toolsets=_resolve_cli_toolsets(),
                session_id=sid,
            )
            compressed = agent.context_compressor.compress(
                original_messages,
                current_tokens=approx_tokens,
                focus_topic=focus_topic,
            )
            new_tokens = _estimate_messages_tokens_rough(compressed)
            summary = _summarize_manual_compression(
                original_messages,
                compressed,
                approx_tokens,
                new_tokens,
                focus_topic=focus_topic,
            )

            s.messages = compressed
            s.tool_calls = []
            s.active_stream_id = None
            s.pending_user_message = None
            s.pending_attachments = []
            s.pending_started_at = None
            visible_after = _visible_messages_for_anchor(compressed)
            s.compression_anchor_visible_idx = (
                max(0, len(visible_after) - 1) if visible_after else None
            )
            s.compression_anchor_message_key = (
                _anchor_message_key(visible_after[-1]) if visible_after else None
            )
            s.save()

        session_payload = redact_session_data(
            s.compact()
            | {
                "messages": s.messages,
                "tool_calls": s.tool_calls,
                "active_stream_id": s.active_stream_id,
                "pending_user_message": s.pending_user_message,
                "pending_attachments": s.pending_attachments,
                "pending_started_at": s.pending_started_at,
                "compression_anchor_visible_idx": getattr(
                    s, "compression_anchor_visible_idx", None
                ),
                "compression_anchor_message_key": getattr(
                    s, "compression_anchor_message_key", None
                ),
            }
        )
        return j(
            handler,
            {
                "ok": True,
                "session": session_payload,
                "summary": summary,
                "focus_topic": focus_topic,
            },
        )
    except Exception as e:
        logger.warning("Manual session compression failed: %s", e)
        return bad(handler, f"Compression failed: {_sanitize_error(e)}")


def _handle_skill_save(handler, body):
    try:
        require(body, "name", "content")
    except ValueError as e:
        return bad(handler, str(e))
    skill_name = body["name"].strip().lower().replace(" ", "-")
    if not skill_name or "/" in skill_name or ".." in skill_name:
        return bad(handler, "Invalid skill name")
    category = body.get("category", "").strip()
    if category and ("/" in category or ".." in category):
        return bad(handler, "Invalid category")
    from tools.skills_tool import SKILLS_DIR

    if category:
        skill_dir = SKILLS_DIR / category / skill_name
    else:
        skill_dir = SKILLS_DIR / skill_name
    # Validate resolved path stays within SKILLS_DIR
    try:
        skill_dir.resolve().relative_to(SKILLS_DIR.resolve())
    except ValueError:
        return bad(handler, "Invalid skill path")
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text(body["content"], encoding="utf-8")
    return j(handler, {"ok": True, "name": skill_name, "path": str(skill_file)})


def _handle_skill_delete(handler, body):
    try:
        require(body, "name")
    except ValueError as e:
        return bad(handler, str(e))
    from tools.skills_tool import SKILLS_DIR
    import shutil

    matches = list(SKILLS_DIR.rglob(f"{body['name']}/SKILL.md"))
    if not matches:
        return bad(handler, "Skill not found", 404)
    skill_dir = matches[0].parent
    shutil.rmtree(str(skill_dir))
    return j(handler, {"ok": True, "name": body["name"]})


def _handle_memory_write(handler, body):
    try:
        require(body, "section", "content")
    except ValueError as e:
        return bad(handler, str(e))
    mem_dir = employee_data_root() / "memories"
    mem_dir.mkdir(parents=True, exist_ok=True)
    section = body["section"]
    if section == "memory":
        target = mem_dir / "MEMORY.md"
    elif section == "user":
        target = mem_dir / "USER.md"
    else:
        return bad(handler, 'section must be "memory" or "user"')
    target.write_text(body["content"], encoding="utf-8")
    return j(handler, {"ok": True, "section": section, "path": str(target)})


def _handle_session_import_cli(handler, body):
    """Import a single CLI session into the WebUI store."""
    try:
        require(body, "session_id")
    except ValueError as e:
        return bad(handler, str(e))

    sid = str(body["session_id"])

    # Check if already imported — idempotent
    existing = Session.load(sid)
    if existing:
        return j(
            handler,
            {
                "session": existing.compact()
                | {
                    "messages": existing.messages,
                    "is_cli_session": True,
                },
                "imported": False,
            },
        )

    # Fetch messages from CLI store
    msgs = get_cli_session_messages(sid)
    if not msgs:
        return bad(handler, "Session not found in CLI store", 404)

    # Derive title from first user message
    title = title_from(msgs, "CLI Session")
    model = "unknown"

    # Get profile, model, and timestamps from CLI session metadata
    profile = None
    created_at = None
    updated_at = None
    for cs in get_cli_sessions():
        if cs["session_id"] == sid:
            profile = cs.get("profile")
            model = cs.get("model", "unknown")
            created_at = cs.get("created_at")
            updated_at = cs.get("updated_at")
            break

    s = import_cli_session(
        sid,
        title,
        msgs,
        model,
        profile=profile,
        created_at=created_at,
        updated_at=updated_at,
    )
    s.is_cli_session = True
    s._cli_origin = sid
    s.save(touch_updated_at=False)
    return j(
        handler,
        {
            "session": s.compact()
            | {
                "messages": msgs,
                "is_cli_session": True,
            },
            "imported": True,
        },
    )


def _handle_session_import(handler, body):
    """Import a session from a JSON export. Creates a new session with a new ID."""
    if not body or not isinstance(body, dict):
        return bad(handler, "Request body must be a JSON object")
    messages = body.get("messages")
    if not isinstance(messages, list):
        return bad(handler, 'JSON must contain a "messages" array')
    title = body.get("title", "Imported session")
    workspace = body.get("workspace", str(DEFAULT_WORKSPACE))
    model = body.get("model", DEFAULT_MODEL)
    s = Session(
        title=title,
        workspace=workspace,
        model=model,
        messages=messages,
        tool_calls=body.get("tool_calls", []),
    )
    s.pinned = body.get("pinned", False)
    with LOCK:
        SESSIONS[s.session_id] = s
        SESSIONS.move_to_end(s.session_id)
        while len(SESSIONS) > SESSIONS_MAX:
            SESSIONS.popitem(last=False)
    s.save()
    return j(handler, {"ok": True, "session": s.compact() | {"messages": s.messages}})
