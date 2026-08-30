# Unit Elite — 9Router Launcher (integrations/9router/)

Deterministic launcher for the **9Router** AI service (v0.5.55), bound to
loopback only (`127.0.0.1:20128`) for Unit Elite internal use.

Sub-work: `TECH-0001-BIND-01`
Status: `PATCH_READY_FOR_ACCEPTANCE` (awaiting SYSTEM ACCEPTANCE by Pranata)

## Background (verified facts)

- 9Router v0.5.55 installed as a global npm package.
  Root: `C:\Users\User\AppData\Roaming\npm\node_modules\`
- Node executable (absolute): `C:\Program Files\nodejs\node.exe`
- 9Router CLI entry: `...\node_modules\9router\cli.js`
- The opencode session PATH is **trimmed** — `where node`, `where 9router`, and
  `npm` often return nothing. The npm shim `%APPDATA%\npm\9router.cmd` does not
  resolve `node` in that session. **The launcher therefore must and does use the
  absolute `node.exe` path as the primary/default resolution.**

## Files

| File | Purpose |
|------|---------|
| `start-9router.cmd` | Start 9Router on loopback port 20128 (idempotent, fail-closed). |
| `stop-9router.cmd` | Stop only the verified 9Router process tree (safe, scoped). |
| `health-9router.cmd` | Read-only health/exposure check. |
| `README.md` | This document. |

## Usage

```bat
call integrations\9router\health-9router.cmd
call integrations\9router\start-9router.cmd
call integrations\9router\stop-9router.cmd
```

Exit codes (common convention across the three files):

- `0` — success / healthy / already running and healthy.
- `1` — not running, or unable to verify/stop, or no executable found.
- `2` — service unhealthy / listener not confirmed / start timeout/failure.
- `3` — **FAIL CLOSED**: `0.0.0.0:20128` exposure detected (refused to proceed).

## start-9router.cmd behaviour

1. **Resolve executable** — prefer verified absolute `node.exe`
   (`C:\Program Files\nodejs\node.exe`) and locate `9router\cli.js`, first via
   `npm root -g` (if npm is on PATH) then via `%APPDATA%\npm\node_modules`.
   Falls back to `where node` / `where 9router` only if the PATH provides them.
   Never depends on the internal structure of a specific cli.js *(so it keeps
   working after `npm upgrade 9router` as long as the `--host/--port` contract
   holds)*.
2. **No duplicate listener** — before starting it inspects `netstat`:
   - Already a **healthy loopback** `127.0.0.1:20128` listener → reports
     `already running` and **skips start (idempotent-safe)**.
   - A `0.0.0.0:20128` listener → reports a conflict and **fails (no double
     start)**.
3. **Explicit start args** — `--host 127.0.0.1 --port 20128 --tray
   --skip-update`. Env `HOSTNAME`/`PORT` are **not** honoured by `cli.js` and
   are never relied upon.
4. **Waits** for `/api/health` to return 200 (poll, timeout 30 s default).
5. **Verifies** the listener: `127.0.0.1:20128` LISTENING and `0.0.0.0:20128`
   absent.
6. **FAIL CLOSED** — non-zero exit + clear message if `0.0.0.0:20128` is ever
   found; does not continue.

## stop-9router.cmd behaviour

- Finds the PID **actually LISTENING** on loopback `127.0.0.1:20128`.
- Ascends the parent chain via WMI to find the **root `cli.js` tray launcher**
  (command line contains `9router\cli.js`).
- Runs `taskkill /PID <root> /T /F` **only on that verified tree**.
- Never blind-kills other processes by port. After stopping, confirms the
  loopback listener is gone.
- If no loopback listener exists → reports “not running” (idempotent).

## health-9router.cmd behaviour

Read-only. Reports:

1. Whether `127.0.0.1:20128` is LISTENING and its PID.
2. API health: `GET /api/health` → `200 {"ok":true}`.
3. **Exposure detection**: if `0.0.0.0:20128` is LISTENING → FAIL (exit 2) and a
   security warning.

## Contract compliance

- **No credentials** are stored or logged.
- **No modification** to 9Router source, OpenCode, or any config.
- Deterministic, clearly commented Windows batch (no `.ps1` executed directly,
  so Execution Policy is never changed; inline `powershell -NoProfile` is used
  only where parsing is required).
- Upgrades are safe: resolution does not hard-code a version-specific internal
  file beyond the verified global `cli.js` entry point.
- Loopback only: never binds or reports `0.0.0.0`.

## Verification status (self-test PASS, 2026-08-29)

| Test | Result |
|------|--------|
| `start-9router.cmd` from empty port (START_FROM_EMPTY) | PASS — service up loopback-only, exit 0, health 200 |
| `start-9router.cmd` duplicate start (idempotent skip) | PASS — exit 0, same PID, 1 listener, no double start |
| `health-9router.cmd` against live 127.0.0.1:20128 | PASS — exit 0, loopback=1, exposure=0, API 200 |
| `stop-9router.cmd` | PASS — exit 0, root cli.js tray found, tree stopped, port freed |
| 0.0.0.0 fail-closed branch (true `0.0.0.0:20128` listener) | PASS — start exits 3, health exits 2 (exposed) |
| API `GET /api/health` | PASS — 200 `{"ok":true}` |
| No hardcoded credentials (grep key/secret/token/jwt/api-key) | PASS — no credential material; grep hits are batch `tokens=` params and policy comments only |
| 9Router source (`node_modules\9router`) | NOT modified — launcher only invokes with `--host 127.0.0.1 --port 20128` |

## Fixes in this revision (TECH-0001-BIND-01)

1. **CACAT 1 — false-positive 0.0.0.0 detection (start-9router.cmd)**: exposure is now
   detected per-field on the LOCAL address only (`echo %%A | findstr /b "0.0.0.0:"`,
   with `%%A` = LOCAL column, tokens=2-5, state LISTENING required). Line-level matching
   of `0.0.0.0` was false-positiving on the foreign address `0.0.0.0:0` that appears on
   every LISTENING line, so the loopback idempotent-skip branch (exit 0) was unreachable.
   A true `0.0.0.0:PORT` listener still fails closed with exit 3 (verified live).
2. **CACAT 2 — stop-9router.cmd PowerShell quoting bug**: `-match ''9router[\\/]cli.js''`
   (doubled single quotes) caused a PS ParserError and an empty ROOT_RESULT, so STOP
   always refused to kill. The regex is now a single-quoted PS string
   `'9router[\\/]cli\.js'`, valid inside the `for /f` command wrapper; `-ExecutionPolicy
   Bypass` was dropped because only `-Command` is used (Execution Policy is never changed).
3. **CACAT 3 — parse error `'. was unexpected at this time.'` on empty port
   (start-9router.cmd)**: caused by UNESCAPED parentheses in `echo` text inside
   parenthesized blocks (line 133 `(idempotent-safe)` and line 157 `(HTTP 200)`); cmd
   parses the whole compound block even when the condition is false. Both messages now
   avoid parentheses, so START from an empty port succeeds and completes the poll/verify
   path (verified live).
4. **Minor hardening (health-9router.cmd)**: API body trimming handles non-text
   responses (`[byte[]]` converted via UTF-8 before `.Trim()`), keeping the normal
   `200 {"ok":true}` output unchanged (verified live).

## Acceptance

Systematic acceptance (Stage C1) by Pranata Komputer is still pending. This launcher is
**PATCH_READY_FOR_ACCEPTANCE** — not PRODUCTION_READY.
