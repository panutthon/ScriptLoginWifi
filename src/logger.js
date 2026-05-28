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
