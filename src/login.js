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

  let prefix, suffix;
  try {
    ({ prefix, suffix } = parseSalt(html));
  } catch (err) {
    console.error(`Could not parse login form: ${err.message}`);
    process.exit(1);
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
