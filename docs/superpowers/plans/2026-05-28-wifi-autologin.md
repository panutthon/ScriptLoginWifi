# WiFi Auto-Login Script — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Node.js script ที่ login MikroTik Hotspot captive portal ที่ `http://192.168.100.1/login` โดยอัตโนมัติ รันด้วย `npm start`

**Architecture:** GET login page → parse octal-encoded salt from embedded JS → compute `MD5(prefix + password + suffix)` as hex string → POST form fields to router → detect success via redirect location header

**Tech Stack:** Node.js, axios (HTTP), md5 (hashing), dotenv (env vars), jest (testing)

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `.env` (not committed)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "wifi-autologin",
  "version": "1.0.0",
  "scripts": {
    "start": "node src/login.js",
    "test": "jest"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "md5": "^2.3.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
.env
```

- [ ] **Step 3: Create .env.example**

```
WIFI_USERNAME=your_username_here
WIFI_PASSWORD=your_password_here
```

- [ ] **Step 4: Create .env with real credentials**

```
WIFI_USERNAME=m3zv6c
WIFI_PASSWORD=s2e3
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`  
Expected: `node_modules/` created, no errors

- [ ] **Step 6: Commit scaffold (do NOT include .env)**

```bash
git init
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: scaffold wifi autologin project"
```

---

### Task 2: Utility Functions with TDD

**Background:**  
The login page runs this JS before submitting:
```javascript
hexMD5('\131' + document.login.password.value + '\130\016\375\376\175\101\137\262\122\221\160\262\312\335\030\332')
```
The strings `\131`, `\130\016...` are JavaScript octal escapes stored as literal text in the HTML (e.g. backslash + digits). They must be decoded to raw bytes before hashing. The salt may change per session, so it must be parsed from a fresh GET each time.

**Files:**
- Create: `src/utils.js`
- Create: `src/utils.test.js`

- [ ] **Step 1: Create src/utils.test.js with failing tests**

```javascript
const md5 = require('md5');
const { decodeJsOctalString, parseSalt, computePasswordHash } = require('./utils');

describe('decodeJsOctalString', () => {
  test('decodes single octal escape', () => {
    expect(decodeJsOctalString('\\131')).toEqual(Buffer.from([89]));
  });

  test('decodes multiple octal escapes', () => {
    expect(decodeJsOctalString('\\130\\016')).toEqual(Buffer.from([88, 14]));
  });

  test('preserves plain ASCII chars', () => {
    expect(decodeJsOctalString('abc')).toEqual(Buffer.from([97, 98, 99]));
  });

  test('handles mixed octal and ASCII', () => {
    expect(decodeJsOctalString('a\\101b')).toEqual(Buffer.from([97, 65, 98]));
  });
});

describe('parseSalt', () => {
  test('extracts prefix and suffix from login HTML', () => {
    const html = `hexMD5('\\131' + document.login.password.value + '\\130\\016')`;
    const result = parseSalt(html);
    expect(result.prefix).toBe('\\131');
    expect(result.suffix).toBe('\\130\\016');
  });

  test('throws if pattern not found', () => {
    expect(() => parseSalt('<html>no match</html>')).toThrow('Could not parse salt');
  });
});

describe('computePasswordHash', () => {
  test('computes MD5 of correct byte sequence', () => {
    // prefix \131=[89], 'pass'=[112,97,115,115], suffix \130=[88]
    const result = computePasswordHash('\\131', 'pass', '\\130');
    const expected = md5(Buffer.from([89, 112, 97, 115, 115, 88]));
    expect(result).toBe(expected);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npx jest src/utils.test.js`  
Expected: FAIL — "Cannot find module './utils'"

- [ ] **Step 3: Create src/utils.js**

```javascript
const md5 = require('md5');

function decodeJsOctalString(str) {
  const bytes = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const match = str.slice(i + 1).match(/^([0-7]{1,3})/);
      if (match) {
        bytes.push(parseInt(match[1], 8));
        i += 1 + match[1].length;
        continue;
      }
    }
    bytes.push(str.charCodeAt(i));
    i++;
  }
  return Buffer.from(bytes);
}

function parseSalt(html) {
  const match = html.match(
    /hexMD5\('((?:[^'\\]|\\.)*?)'\s*\+\s*document\.login\.password\.value\s*\+\s*'((?:[^'\\]|\\.)*?)'\)/
  );
  if (!match) throw new Error('Could not parse salt from login page');
  return { prefix: match[1], suffix: match[2] };
}

function computePasswordHash(prefix, password, suffix) {
  const prefixBuf = decodeJsOctalString(prefix);
  const passwordBuf = Buffer.from(password, 'latin1');
  const suffixBuf = decodeJsOctalString(suffix);
  return md5(Buffer.concat([prefixBuf, passwordBuf, suffixBuf]));
}

module.exports = { decodeJsOctalString, parseSalt, computePasswordHash };
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `npx jest src/utils.test.js`  
Expected: PASS — 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/utils.test.js
git commit -m "feat: add salt parsing and password hash utilities"
```

---

### Task 3: Main Login Script

**Background:**  
MikroTik hotspot on successful login returns HTTP 302 redirect to `dst` URL (google.com).  
On failed login it returns HTTP 200 with the login page again.  
We use `maxRedirects: 0` + `validateStatus: () => true` to inspect the redirect manually.

**Files:**
- Create: `src/login.js`

- [ ] **Step 1: Create src/login.js**

```javascript
const axios = require('axios');
const dotenv = require('dotenv');
const { parseSalt, computePasswordHash } = require('./utils');

dotenv.config();

const LOGIN_URL = 'http://192.168.100.1/login';
const TIMEOUT_MS = 10000;

async function login() {
  const username = process.env.WIFI_USERNAME;
  const password = process.env.WIFI_PASSWORD;

  if (!username) {
    console.error('Error: WIFI_USERNAME missing in .env');
    process.exit(1);
  }
  if (!password) {
    console.error('Error: WIFI_PASSWORD missing in .env');
    process.exit(1);
  }

  let html;
  try {
    const resp = await axios.get(LOGIN_URL, { timeout: TIMEOUT_MS });
    html = resp.data;
  } catch (err) {
    console.error(`Cannot reach router at ${LOGIN_URL}: ${err.message}`);
    process.exit(1);
  }

  const { prefix, suffix } = parseSalt(html);
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
    console.error(`Login request failed: ${err.message}`);
    process.exit(1);
  }

  if (postResp.status === 302) {
    const location = postResp.headers['location'] || '';
    if (!location.includes('192.168.100.1')) {
      console.log('Login successful!');
    } else {
      console.error('Login failed: check credentials in .env');
      process.exit(1);
    }
  } else {
    const data = typeof postResp.data === 'string' ? postResp.data : '';
    if (data.includes('name="login"')) {
      console.error('Login failed: check credentials in .env');
      process.exit(1);
    }
    console.log('Login successful!');
  }
}

login();
```

- [ ] **Step 2: Run all tests**

Run: `npx jest`  
Expected: PASS — all 7 tests passing

- [ ] **Step 3: Commit**

```bash
git add src/login.js
git commit -m "feat: add main wifi login script"
```

---

### Task 4: Verify End-to-End

- [ ] **Step 1: Run npm start while connected to the WiFi network**

Run: `npm start`  
Expected: `Login successful!` printed to console

- [ ] **Step 2: Test error case — wrong password**

Temporarily change `WIFI_PASSWORD` in `.env` to a wrong value, run `npm start`  
Expected: `Login failed: check credentials in .env` + exit code 1

- [ ] **Step 3: Restore correct credentials**

Restore `.env` to correct `WIFI_PASSWORD=s2e3`

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify end-to-end login flow"
```
