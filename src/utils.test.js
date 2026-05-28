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
