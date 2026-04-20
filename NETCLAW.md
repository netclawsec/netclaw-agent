# NetClaw Agent — 网钳科技 Fork Notes

This repository is the 网钳科技 productized integration of two upstream projects:

| Layer | Upstream | Location in this repo | Sync mechanism |
|---|---|---|---|
| Agent runtime | [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) | repo root (everything except `webui/`) | plain `git merge` / rebase |
| Web UI | [`nesquena/hermes-webui`](https://github.com/nesquena/hermes-webui) | `webui/` subdirectory | `git subtree` |

The product is sold/distributed as **NetClaw Agent**. The two upstream names ("Hermes", "Hermes Web UI") are preserved in:

- All Python package names (`hermes_agent`, `hermes_cli`, …) — avoids breaking imports and upstream merges.
- Internal environment variables (`HERMES_*`, `HERMES_WEBUI_*`) — runtime contracts read by 300+ files. Users interact with the product via the branded **`NETCLAW_*`** names, which are mirrored into the legacy names at startup by `hermes_constants._propagate_netclaw_env()`.
- CLI binary — exposed as `netclaw` / `netclaw-agent` / `netclaw-acp` via `[project.scripts]`. Python entry-point functions still live in `hermes_cli.main:main` etc. internally.
- `CHANGELOG.md` / `LICENSE` / `CONTRIBUTING.md` — preserve attribution.

User-visible strings (`webui/static/i18n.js`, `webui/static/index.html`, onboarding copy, README surfaces) are rebranded to **NetClaw Agent**.

## Productization shim

The central compatibility shim lives in [`hermes_constants.py`](hermes_constants.py) and does two things at module import time:

1. **Env propagation** — `_propagate_netclaw_env()` copies every `NETCLAW_*` environment variable into its `HERMES_*` sibling when the legacy name is unset. Downstream code keeps reading `os.getenv("HERMES_FOO")`; users only see `NETCLAW_FOO`.
2. **Home directory resolution** — `_resolve_home_default()` prefers `NETCLAW_HOME` → `HERMES_HOME` → existing `~/.netclaw/` → existing `~/.hermes/` (legacy) → fresh `~/.netclaw/`.

### Manual migration (optional)

Fresh installs land in `~/.netclaw/`. Existing users who want to consolidate:

```bash
# Agent must not be running
mv ~/.hermes ~/.netclaw
```

No other action needed — env vars, subprocess home, skill dirs, `.env` loader all route through `get_hermes_home()`.

## Remotes

```bash
git remote -v
# origin          <your-netclaw-fork>              (or NousResearch/hermes-agent if not forked yet)
# upstream-agent  https://github.com/NousResearch/hermes-agent.git
# upstream-webui  https://github.com/nesquena/hermes-webui.git
```

If these are missing, recreate them:

```bash
git remote add upstream-agent https://github.com/NousResearch/hermes-agent.git
git remote add upstream-webui https://github.com/nesquena/hermes-webui.git
```

## Pulling upstream updates

### Agent runtime (NousResearch/hermes-agent)

```bash
git fetch upstream-agent
git merge upstream-agent/main        # or: git rebase upstream-agent/main
```

Expect potential conflicts in:
- `README.md` top banner (we added a `<!-- netclaw fork notice -->` comment)
- `NETCLAW.md` (ours, shouldn't conflict)
- Nothing in `webui/` should conflict from this path.

### Web UI (nesquena/hermes-webui)

```bash
git fetch upstream-webui
git subtree pull --prefix=webui upstream-webui master --squash
```

Conflicts will land in `webui/static/*` — particularly `i18n.js` and `index.html` where we replaced "Hermes" with "NetClaw Agent". Resolve by **keeping our branded strings** and **accepting upstream structural / feature changes**.

### Re-apply branding after a webui merge

If upstream introduces new `Hermes` strings in user-facing files, re-run:

```bash
cd webui
for f in static/index.html static/i18n.js static/ui.js static/messages.js static/panels.js static/boot.js static/sessions.js static/commands.js; do
  [ -f "$f" ] && perl -i -pe 's/\bHermes\b/NetClaw Agent/g' "$f"
done
# Then collapse any accidental "NetClaw Agent Agent"
perl -i -pe 's/NetClaw Agent Agent/NetClaw Agent/g' static/*.js static/*.html
```

## Backups of the pre-merge state

Archived to `/tmp/` on the machine that performed the original merge (2026-04-18):

- `hermes-agent-webui-backup-2026-04-18.tar.gz` — the untracked `webui/` (React+Vite client + Python server) that existed in hermes-agent before the merge. Not used; preserved for reference.
- `hermes-webui-local-branding-2026-04-18.patch` — uncommitted branding WIP from the separate `hermes-webui` checkout.
- `hermes-webui-untracked-2026-04-18.tar.gz` — untracked files (`gateway.py`, `static/saas.css`) from the separate `hermes-webui` checkout.

## Branding conventions

| Surface | Rule |
|---|---|
| HTML `<title>`, page headers, onboarding copy | **NetClaw Agent** |
| Button labels, modal titles, settings descriptions | **NetClaw Agent** |
| Error messages shown to end users | **NetClaw Agent** |
| CLI command references in user-facing docs | use `netclaw …` exclusively. |
| Env vars documented to users | `NETCLAW_*` (e.g. `NETCLAW_HOME`). Legacy `HERMES_*` still works and is propagated to `NETCLAW_*` values at startup. |
| Default data directory | `~/.netclaw` for fresh installs. Existing `~/.hermes` installs keep using that path — resolver at `hermes_constants._resolve_home_default()` picks whichever directory already exists. |
| Python imports | keep upstream names internally (`from hermes_cli import …`). Not user-visible. |
| CHANGELOG historical entries | keep as-is |
