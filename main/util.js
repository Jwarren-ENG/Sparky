// Shared helpers for the main process.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
for (const d of [DATA_DIR, ARTIFACT_DIR]) fs.mkdirSync(d, { recursive: true });

function loadEnv() {
  const env = {};
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
    }
  } catch { /* no .env yet */ }
  for (const [k, v] of Object.entries(env)) if (v && !process.env[k]) process.env[k] = v;
  return env;
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), err });
    });
  });
}

async function osascript(script, timeout = 30000) {
  const r = await sh('osascript', ['-e', script], { timeout });
  if (!r.ok) return { ok: false, error: r.stderr || String(r.err) };
  return { ok: true, out: r.stdout };
}

function nowISO() { return new Date().toISOString(); }
function uid(prefix = '') { return prefix + Math.random().toString(36).slice(2, 10); }

function truncate(s, n = 4000) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s;
}

module.exports = { ROOT, DATA_DIR, ARTIFACT_DIR, loadEnv, sh, osascript, nowISO, uid, truncate };
