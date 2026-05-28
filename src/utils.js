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
