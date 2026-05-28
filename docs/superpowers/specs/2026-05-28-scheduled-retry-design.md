# Scheduled Auto-Login with Retry — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**Builds on:** `2026-05-28-wifi-autologin-design.md`

## Overview

ต่อยอดจาก `src/login.js` ที่รัน login ครั้งเดียวให้ทำงาน **อัตโนมัติทุกวันเวลา 05:01** ผ่าน Windows Task Scheduler หลังจากที่ WiFi router ตัด session ตอน 05:00 น. (Asia/Bangkok)

**Constraint:** ใช้ทรัพยากรเครื่องน้อยที่สุด — ไม่มี node daemon รันค้าง

## Architecture

```
┌──────────────────────────┐
│ Windows Task Scheduler   │  (runs daily 05:01 local time)
│  Task: WifiAutoLogin     │
└────────────┬─────────────┘
             │ launches
             ▼
   node src/login.js
             │
             ▼
┌──────────────────────────┐
│ login.js (with retry)    │
│  attempt 1..3, 30s gap   │──► logger.js ──► logs/wifi-login.log
│  exit 0 on success       │
│  exit 1 if all fail      │
└──────────────────────────┘
```

**Process model:** Node process spins up only at scheduled time, runs ≤ ~90 seconds worst case (3 attempts × ≤10s axios timeout + 2 × 30s gap), exits. No background process, no RAM cost when idle.

## File Structure

```
src/
  login.js              # MODIFY: extract attemptLogin(), add retry wrapper
  utils.js              # UNCHANGED
  logger.js             # NEW: append timestamped lines to logs/wifi-login.log
  logger.test.js        # NEW
  login.test.js         # NEW: retry logic tests
scripts/
  install-task.ps1      # NEW: register Windows scheduled task
  uninstall-task.ps1    # NEW: remove the task
logs/                   # created at runtime, gitignored
  wifi-login.log
.gitignore              # MODIFY: add logs/
package.json            # MODIFY: add install-task / uninstall-task scripts
```

## Component: `src/logger.js`

Minimal append-only logger.

**API:**
```js
const logger = require('./logger');
logger.info('Login successful');
logger.error('Network unreachable');
```

**Behavior:**
- Writes to `<project-root>/logs/wifi-login.log` (relative to `process.cwd()`)
- Auto-creates `logs/` directory if missing (`fs.mkdirSync` recursive)
- Line format: `[YYYY-MM-DDTHH:mm:ss+07:00] <LEVEL> <message>\n`
- Timestamp always in Asia/Bangkok offset (+07:00) regardless of system locale
- Synchronous append (`fs.appendFileSync`) — simpler and safe for a script that runs once/day
- No rotation, no size cap — user manages manually (~200 B/day)

**Test cases (`logger.test.js`):**
- `info()` writes line with `INFO` level and Bangkok-offset timestamp
- `error()` writes line with `ERROR` level
- `info()` auto-creates `logs/` directory when missing
- Subsequent calls append (do not overwrite)
- Use `os.tmpdir()` + `process.chdir` (or inject base dir) to isolate from real `logs/`

## Component: `src/login.js` (refactored)

Split current monolithic `login()` into:

**`attemptLogin()`** — pure attempt, throws on failure:
- Returns `void` on success
- Throws `Error` with `.code` property: `NETWORK | PARSE | AUTH | CONFIG | UNKNOWN`
- No `process.exit` calls inside
- No `console.log` — caller decides what to log

**`runWithRetry()`** — the new entry point:
```
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;

async function runWithRetry() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await attemptLogin();
      logger.info(`Login successful (attempt ${attempt}/${MAX_ATTEMPTS})`);
      return 0;
    } catch (err) {
      const code = err.code || 'UNKNOWN';
      logger.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed [${code}]: ${err.message}`);
      if (code === 'CONFIG') return 1;  // no point retrying missing .env
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  logger.error(`Gave up after ${MAX_ATTEMPTS} attempts`);
  return 1;
}

if (require.main === module) {
  runWithRetry().then(code => process.exit(code));
}

module.exports = { attemptLogin, runWithRetry };
```

**Error classification inside `attemptLogin()`:**

| Cause | `.code` |
|-------|---------|
| Missing `WIFI_USERNAME` / `WIFI_PASSWORD` | `CONFIG` |
| `axios.get(LOGIN_URL)` throws | `NETWORK` |
| `parseSalt()` throws | `PARSE` |
| Login response indicates failure (302 to login / body has `name="login"`) | `AUTH` |
| Anything else | `UNKNOWN` |

**Test cases (`login.test.js`):** Use `jest.mock` to replace `attemptLogin` with a controllable mock, and `jest.useFakeTimers()` for the 30s sleep.
- Success on first attempt → exit code 0, one INFO log, no sleeps
- Fail twice (`NETWORK`), succeed on attempt 3 → exit code 0, two ERROR + one INFO log, two 30s sleeps
- Fail all 3 (`AUTH`) → exit code 1, three ERROR logs + one "Gave up" log, two sleeps
- Fail with `CONFIG` on attempt 1 → exit code 1, no retry (skip remaining attempts and sleeps)

## Component: `scripts/install-task.ps1`

```powershell
$projectRoot = Resolve-Path "$PSScriptRoot\.."
$nodeExe     = (Get-Command node).Source
$scriptPath  = Join-Path $projectRoot "src\login.js"

$action    = New-ScheduledTaskAction `
              -Execute $nodeExe `
              -Argument "`"$scriptPath`"" `
              -WorkingDirectory $projectRoot

$trigger   = New-ScheduledTaskTrigger -Daily -At "05:01"

$settings  = New-ScheduledTaskSettingsSet `
              -MultipleInstances IgnoreNew `
              -StartWhenAvailable:$false `
              -DontStopOnIdleEnd `
              -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal `
              -UserId $env:USERNAME `
              -LogonType Interactive `
              -RunLevel Limited

Register-ScheduledTask `
  -TaskName "WifiAutoLogin" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Auto re-login to WiFi captive portal after 05:00 timeout" `
  -Force
```

**Key settings:**
- `-LogonType Interactive` + `RunLevel Limited` → no Windows password required
- `-MultipleInstances IgnoreNew` → if previous run somehow still active, skip new
- `-StartWhenAvailable:$false` → skip if PC was offline (matches user preference)
- `-ExecutionTimeLimit 5min` → safety cap; normal run is ~90s worst case

## Component: `scripts/uninstall-task.ps1`

```powershell
Unregister-ScheduledTask -TaskName "WifiAutoLogin" -Confirm:$false
```

## `package.json` additions

```json
"scripts": {
  "start": "node src/login.js",
  "test": "jest",
  "install-task":   "powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1",
  "uninstall-task": "powershell -ExecutionPolicy Bypass -File scripts/uninstall-task.ps1"
}
```

## `.gitignore` additions

```
logs/
```

## Error Handling Summary

| Scenario | Behavior |
|----------|----------|
| `.env` missing variable | One ERROR log, exit 1 immediately (no retry — won't fix itself) |
| Router unreachable | ERROR log per attempt, retry up to 3× |
| Salt parse fail | ERROR log per attempt, retry up to 3× (page might be partial) |
| Wrong credentials | ERROR log per attempt, retry up to 3× then give up |
| Success | INFO log, exit 0 |

## Manual Verification Plan

After implementation:
1. `npm test` — all unit tests pass
2. `npm start` — manual run logs to `logs/wifi-login.log` and prints nothing surprising
3. `npm run install-task` — `Get-ScheduledTask -TaskName WifiAutoLogin` shows the task
4. Right-click task in Task Scheduler → "Run" → verify entry appears in log
5. `npm run uninstall-task` — task gone from scheduler

## Out of Scope

- Multi-router / multi-credential support
- Email/Slack notifications on failure
- Log rotation
- Linux/macOS scheduling (cron) — Windows only per current setup
- Detecting mid-day disconnects — only the 05:00 timeout is handled
