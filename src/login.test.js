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
