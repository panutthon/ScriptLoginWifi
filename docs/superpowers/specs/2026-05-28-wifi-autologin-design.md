# WiFi Auto-Login Script — Design Spec

**Date:** 2026-05-28  
**Status:** Approved

## Overview

Node.js script ที่ login captive portal ของ WiFi router (MikroTik Hotspot) โดยอัตโนมัติ รันด้วย `npm start`

**Target URL:** `http://192.168.100.1/login`

## Architecture

Single-file script — `src/login.js` — ทำงานเป็น linear flow:

```
GET /login → parse salt from JS → compute MD5(prefix + password + suffix) → POST login → print result
```

## Login Flow (Reverse-Engineered from HTML)

หน้า login มีสอง form:
- `form[name="login"]` — visible form ที่ user กรอก
- `form[name="sendin"]` — hidden form ที่ถูก submit จริง

JavaScript `doLogin()` บน client:
1. copy username ไปยัง `sendin.username`
2. hash password: `hexMD5(prefix + plainPassword + suffix)` โดย prefix/suffix เป็น octal-escaped string ที่ embed อยู่ใน HTML (อาจเปลี่ยนทุก session)
3. submit `sendin` form

Fields ที่ POST:
| Field | Value |
|-------|-------|
| `username` | plain text |
| `password` | `md5(prefix + password + suffix)` |
| `dst` | `http://www.google.com` |
| `popup` | `true` |

## File Structure

```
project/
├── src/
│   └── login.js        # entry point
├── .env                # WIFI_USERNAME, WIFI_PASSWORD
├── .env.example        # template (no real credentials)
├── package.json
└── .gitignore          # ต้อง ignore .env
```

## Dependencies

- `axios` — HTTP requests
- `md5` — MD5 hashing
- `dotenv` — load .env

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `.env` missing variable | exit(1) + บอก variable ที่หายไป |
| Router ไม่ตอบ | timeout 10s + error message |
| Login ล้มเหลว | detect จาก response body/redirect + print message |
| Login สำเร็จ | print success message |

## Configuration (.env)

```
WIFI_USERNAME=<your_username>
WIFI_PASSWORD=<your_password>
```

## npm Script

```json
"scripts": {
  "start": "node src/login.js"
}
```

## Security Notes

- `.env` ต้องอยู่ใน `.gitignore` เสมอ
- ไม่มี credentials ใน source code หรือ spec
