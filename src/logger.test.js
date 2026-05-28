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
