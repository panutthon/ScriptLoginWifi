# Scheduled Auto-Login with Retry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily Windows Task Scheduler entry that runs `src/login.js` at 05:01 with 3-attempt retry (30s gap) and file logging, so WiFi reconnects automatically after the 05:00 router timeout.

**Architecture:** Refactor existing single-shot `login()` into `attemptLogin()` (throws typed errors) + `runWithRetry()` (retries and logs). Add `src/logger.js` for append-only file logging. Add PowerShell install/uninstall scripts that register the scheduled task without storing a Windows password.

**Tech Stack:** Node.js, Jest, PowerShell (Windows Task Scheduler API), existing deps (axios, dotenv, md5).

**Spec:** `docs/superpowers/specs/2026-05-28-scheduled-retry-design.md`

---

## Task 1: Logger module

**Files:**
- Create: `src/logger.js`
- Create: `src/logger.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/logger.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('./logger');

describe('logger', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifi-log-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readLog() {
    return fs.readFileSync(path.join(tmpDir, 'logs', 'wifi-login.log'), 'utf8');
  }

  test('info writes a line with INFO level and Bangkok-offset timestamp', () => {
    logger.info('hello');
    const line = readLog();
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00\] INFO  hello\n$/);
  });

  test('error writes a line with ERROR level', () => {
    logger.error('boom');
    expect(readLog()).toMatch(/\] ERROR boom\n$/);
  });

  test('auto-creates logs directory when missing', () => {
    expect(fs.existsSync(path.join(tmpDir, 'logs'))).toBe(false);
    logger.info('first');
    expect(fs.existsSync(path.join(tmpDir, 'logs'))).toBe(true);
  });

  test('appends across calls (does not overwrite)', () => {
    logger.info('one');
    logger.info('two');
    const lines = readLog().trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/ one$/);
    expect(lines[1]).toMatch(/ two$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/logger.test.js`
Expected: FAIL with "Cannot find module './logger'"

- [ ] **Step 3: Implement `src/logger.js`**

```js
const fs = require('fs');
const path = require('path');

function bangkokTimestamp(date = new Date()) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y  = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(shifted.getUTCDate()).padStart(2, '0');
  const h  = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  const s  = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`;
}

function logPath() {
  return path.join(process.cwd(), 'logs', 'wifi-login.log');
}

function write(level, msg) {
  const file = logPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const padded = level.padEnd(5, ' ');
  fs.appendFileSync(file, `[${bangkokTimestamp()}] ${padded} ${msg}\n`);
}

module.exports = {
  info:  (msg) => write('INFO', msg),
  error: (msg) => write('ERROR', msg),
  bangkokTimestamp,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/logger.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/logger.js src/logger.test.js
git commit -m "feat: add append-only file logger with Bangkok timestamp"
```

---

## Task 2: Refactor login.js — extract `attemptLogin()` with typed errors

**Files:**
- Modify: `src/login.js` (full rewrite of the function body — keep `require`s)
- Create: `src/login.test.js`

The current `login()` calls `process.exit(1)` for every failure. We split it into a pure function that throws `Error` with `.code` set to one of: `CONFIG | NETWORK | PARSE | AUTH | UNKNOWN`.

- [ ] **Step 1: Write the failing test**

Create `src/login.test.js`:

```js
jest.mock('axios');
const axios = require('axios');
const { attemptLogin } = require('./login');

describe('attemptLogin', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...ORIGINAL_ENV, WIFI_USERNAME: 'u', WIFI_PASSWORD: 'p' };
  });

  afterAll(() => { process.env = ORIGINAL_ENV; });

  test('throws CONFIG when WIFI_USERNAME missing', async () => {
    delete process.env.WIFI_USERNAME;
    await expect(attemptLogin()).rejects.toMatchObject({ code: 'CONFIG' });
  });

  test('throws CONFIG when WIFI_PASSWORD missing', async () => {
    delete process.env.WIFI_PASSWORD;
    await expect(attemptLogin()).rejects.toMatchObject({ code: 'CONFIG' });
  });

  test('throws NETWORK when GET fails', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(attemptLogin()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  test('throws PARSE when login page has no salt', async () => {
    axios.get.mockResolvedValue({ data: '<html>no salt here</html>' });
    await expect(attemptLogin()).rejects.toMatchObject({ code: 'PARSE' });
  });

  test('throws AUTH when POST 302 redirects back to router', async () => {
    axios.get.mockResolvedValue({
      data: `<script>hexMD5('aa' + document.login.password.value + 'bb')</script>`,
    });
    axios.post.mockResolvedValue({
      status: 302,
      headers: { location: 'http://192.168.100.1/login?error=1' },
      data: '',
    });
    await expect(attemptLogin()).rejects.toMatchObject({ code: 'AUTH' });
  });

  test('throws AUTH when POST body still contains login form', async () => {
    axios.get.mockResolvedValue({
      data: `<script>hexMD5('aa' + document.login.password.value + 'bb')</script>`,
    });
    axios.post.mockResolvedValue({
      status: 200,
      headers: {},
      data: '<form name="login">...</form>',
    });
    await expect(attemptLogin()).rejects.toMatchObject({ code: 'AUTH' });
  });

  test('resolves on success (302 away from router)', async () => {
    axios.get.mockResolvedValue({
      data: `<script>hexMD5('aa' + document.login.password.value + 'bb')</script>`,
    });
    axios.post.mockResolvedValue({
      status: 302,
      headers: { location: 'http://www.google.com' },
      data: '',
    });
    await expect(attemptLogin()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/login.test.js`
Expected: FAIL — `attemptLogin` is not exported yet

- [ ] **Step 3: Rewrite `src/login.js`**

Replace the entire file with:

```js
const axios = require('axios');
const dotenv = require('dotenv');
const { parseSalt, computePasswordHash } = require('./utils');

dotenv.config();

const LOGIN_URL = 'http://192.168.100.1/login';
const TIMEOUT_MS = 10000;

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function attemptLogin() {
  const username = process.env.WIFI_USERNAME;
  const password = process.env.WIFI_PASSWORD;
  if (!username) throw makeError('CONFIG', 'WIFI_USERNAME missing in .env');
  if (!password) throw makeError('CONFIG', 'WIFI_PASSWORD missing in .env');

  let html;
  try {
    const resp = await axios.get(LOGIN_URL, { timeout: TIMEOUT_MS });
    html = resp.data;
  } catch (err) {
    throw makeError('NETWORK', `Cannot reach router at ${LOGIN_URL}: ${err.message}`);
  }

  let prefix, suffix;
  try {
    ({ prefix, suffix } = parseSalt(html));
  } catch (err) {
    throw makeError('PARSE', `Could not parse login form: ${err.message}`);
  }
  const hashedPassword = computePasswordHash(prefix, password, suffix);

  const body = new URLSearchParams({
    username,
    password: hashedPassword,
    dst: 'http://www.google.com',
    popup: 'true',
  }).toString();

  let postResp;
  try {
    postResp = await axios.post(LOGIN_URL, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true,
    });
  } catch (err) {
    throw makeError('NETWORK', `Login request failed: ${err.message}`);
  }

  if (postResp.status === 302) {
    const location = postResp.headers['location'] || '';
    if (location.includes('192.168.100.1')) {
      throw makeError('AUTH', 'Login failed: redirected back to router');
    }
    return;
  }

  const data = typeof postResp.data === 'string' ? postResp.data : '';
  if (data.includes('name="login"')) {
    throw makeError('AUTH', 'Login failed: login form still present in response');
  }
}

module.exports = { attemptLogin };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/login.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Run full test suite to verify nothing else broke**

Run: `npm test`
Expected: PASS (utils.test.js + logger.test.js + login.test.js)

- [ ] **Step 6: Commit**

```bash
git add src/login.js src/login.test.js
git commit -m "refactor: extract attemptLogin with typed error codes"
```

---

## Task 3: Add `runWithRetry()` and wire it as the entry point

**Files:**
- Modify: `src/login.js` (append retry logic + new module entry)
- Modify: `src/login.test.js` (append retry tests)

- [ ] **Step 1: Write the failing tests**

Append to `src/login.test.js`:

```js
describe('runWithRetry', () => {
  let loginModule;
  let logger;
  let attemptSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.doMock('./logger', () => ({ info: jest.fn(), error: jest.fn() }));
    logger = require('./logger');
    loginModule = require('./login');
    attemptSpy = jest.spyOn(loginModule, 'attemptLogin');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.dontMock('./logger');
    attemptSpy.mockRestore();
  });

  async function runAndDrainTimers() {
    const promise = loginModule.runWithRetry();
    await jest.runAllTimersAsync();
    return promise;
  }

  test('succeeds on first attempt — no retry, exit code 0', async () => {
    attemptSpy.mockResolvedValue();
    const code = await runAndDrainTimers();
    expect(code).toBe(0);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/attempt 1\/3/));
  });

  test('fails twice with NETWORK then succeeds — exit code 0, 3 attempts', async () => {
    const err = Object.assign(new Error('net down'), { code: 'NETWORK' });
    attemptSpy
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce();
    const code = await runAndDrainTimers();
    expect(code).toBe(0);
    expect(attemptSpy).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/attempt 3\/3/));
  });

  test('fails all 3 with AUTH — exit code 1, logs Gave up', async () => {
    const err = Object.assign(new Error('bad creds'), { code: 'AUTH' });
    attemptSpy.mockRejectedValue(err);
    const code = await runAndDrainTimers();
    expect(code).toBe(1);
    expect(attemptSpy).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(4); // 3 attempts + Gave up
    expect(logger.error).toHaveBeenLastCalledWith(expect.stringMatching(/Gave up/));
  });

  test('CONFIG error skips remaining attempts — exit code 1, 1 attempt', async () => {
    const err = Object.assign(new Error('no env'), { code: 'CONFIG' });
    attemptSpy.mockRejectedValue(err);
    const code = await runAndDrainTimers();
    expect(code).toBe(1);
    expect(attemptSpy).toHaveBeenCalledTimes(1);
  });
});
```

Note: `runWithRetry` must call `module.exports.attemptLogin()` (not bare `attemptLogin()`) so that `jest.spyOn(loginModule, 'attemptLogin')` intercepts the call.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/login.test.js -t runWithRetry`
Expected: FAIL — `runWithRetry` not exported yet

- [ ] **Step 3: Append retry logic to `src/login.js`**

Add at the end of `src/login.js` (replace the `module.exports` line):

```js
const logger = require('./logger');

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await module.exports.attemptLogin();
      logger.info(`Login successful (attempt ${attempt}/${MAX_ATTEMPTS})`);
      return 0;
    } catch (err) {
      const code = err.code || 'UNKNOWN';
      logger.error(`Attempt ${attempt}/${MAX_ATTEMPTS} failed [${code}]: ${err.message}`);
      if (code === 'CONFIG') return 1;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }
  logger.error(`Gave up after ${MAX_ATTEMPTS} attempts`);
  return 1;
}

module.exports = { attemptLogin, runWithRetry };

if (require.main === module) {
  runWithRetry().then((code) => process.exit(code));
}
```

Note: `module.exports.attemptLogin()` (not bare `attemptLogin()`) lets the retry tests intercept the call via `jest.spyOn(loginModule, 'attemptLogin')`.

- [ ] **Step 4: Run retry tests to verify they pass**

Run: `npx jest src/login.test.js -t runWithRetry`
Expected: PASS, 4 tests

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS (utils + logger + login attemptLogin + login runWithRetry)

- [ ] **Step 6: Commit**

```bash
git add src/login.js src/login.test.js
git commit -m "feat: add 3-attempt retry with 30s gap and file logging"
```

---

## Task 4: PowerShell install script

**Files:**
- Create: `scripts/install-task.ps1`

- [ ] **Step 1: Create `scripts/install-task.ps1`**

```powershell
$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path "$PSScriptRoot\.."
$nodeExe     = (Get-Command node).Source
$scriptPath  = Join-Path $projectRoot "src\login.js"

if (-not (Test-Path $scriptPath)) {
    Write-Error "Could not find $scriptPath"
    exit 1
}

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
  -Force | Out-Null

Write-Host "Installed scheduled task 'WifiAutoLogin' (runs daily at 05:01)."
```

- [ ] **Step 2: Smoke check syntax**

Run: `powershell -ExecutionPolicy Bypass -NoProfile -Command "& { $PSScriptRoot = '$(pwd)\scripts'; . scripts/install-task.ps1 }" -WhatIf` — if PowerShell parsing fails it will error out. (Skip if not available; this is a sanity check only.)

If you cannot run PowerShell in this environment, skip — the script will be verified manually in Task 6.

- [ ] **Step 3: Commit**

```bash
git add scripts/install-task.ps1
git commit -m "feat: add PowerShell script to install daily scheduled task"
```

---

## Task 5: PowerShell uninstall script

**Files:**
- Create: `scripts/uninstall-task.ps1`

- [ ] **Step 1: Create `scripts/uninstall-task.ps1`**

```powershell
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName "WifiAutoLogin" -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Scheduled task 'WifiAutoLogin' not found — nothing to remove."
    exit 0
}

Unregister-ScheduledTask -TaskName "WifiAutoLogin" -Confirm:$false
Write-Host "Removed scheduled task 'WifiAutoLogin'."
```

- [ ] **Step 2: Commit**

```bash
git add scripts/uninstall-task.ps1
git commit -m "feat: add PowerShell script to uninstall scheduled task"
```

---

## Task 6: Wire npm scripts and gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore` (create if absent)

- [ ] **Step 1: Update `package.json` scripts block**

Replace the `"scripts"` block with:

```json
"scripts": {
  "start": "node src/login.js",
  "test": "jest",
  "install-task":   "powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1",
  "uninstall-task": "powershell -ExecutionPolicy Bypass -File scripts/uninstall-task.ps1"
}
```

- [ ] **Step 2: Add `logs/` to `.gitignore`**

If `.gitignore` exists, append `logs/` on its own line. If it does not exist, create it with:

```
node_modules/
.env
logs/
coverage/
```

- [ ] **Step 3: Verify `logs/` is ignored**

Run: `git check-ignore -v logs/wifi-login.log` (after `mkdir logs && touch logs/wifi-login.log` if needed, then delete the file)
Expected: prints the matching `.gitignore` rule.

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: wire install-task/uninstall-task npm scripts, ignore logs/"
```

---

## Task 7: Manual verification on Windows

**Files:** none (verification only)

These steps require the developer's actual machine — they are not automatable in this plan.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests PASS (utils, logger, attemptLogin, runWithRetry)

- [ ] **Step 2: Manual `npm start`**

Run: `npm start`
Expected:
- `logs/wifi-login.log` now exists
- Contains a single new line matching `[<timestamp>] INFO  Login successful (attempt 1/3)` (assuming credentials are valid and router is reachable)
- Process exits with code 0

- [ ] **Step 3: Install the scheduled task**

Run: `npm run install-task`
Expected: prints `Installed scheduled task 'WifiAutoLogin' (runs daily at 05:01).`

Verify in PowerShell: `Get-ScheduledTask -TaskName WifiAutoLogin | Format-List TaskName,State,Triggers`
Expected: `State: Ready`, Trigger shows `Daily` at `5:01:00 AM`.

- [ ] **Step 4: Trigger the task manually**

In Task Scheduler GUI: right-click `WifiAutoLogin` → Run.
Or PowerShell: `Start-ScheduledTask -TaskName WifiAutoLogin`

Expected: within ~10s, `logs/wifi-login.log` gets a new line.

- [ ] **Step 5: Uninstall**

Run: `npm run uninstall-task`
Expected: prints `Removed scheduled task 'WifiAutoLogin'.`

Verify: `Get-ScheduledTask -TaskName WifiAutoLogin -ErrorAction SilentlyContinue` returns nothing.

- [ ] **Step 6: Re-install (final state for production use)**

Run: `npm run install-task`

The system is now ready — script will run automatically every day at 05:01.
