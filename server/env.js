const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const env = {};
  const lines = (text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let [, k, v] = m;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function config(envPath) {
  const p = envPath || path.join(process.cwd(), '.env');
  try {
    const text = fs.readFileSync(p, 'utf8');
    const env = parseEnv(text);
    for (const [k, v] of Object.entries(env)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, error: e.message, path: p };
  }
}

module.exports = { config };

