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
