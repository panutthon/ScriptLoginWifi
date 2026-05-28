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
