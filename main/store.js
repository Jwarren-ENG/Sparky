// Tiny JSON file stores. Each store is one file in data/.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./util');

class Store {
  constructor(name, fallback) {
    this.file = path.join(DATA_DIR, name + '.json');
    this.fallback = fallback;
    this.data = this._load();
  }
  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Newly added settings keys get their defaults on older data files.
      for (const k of Object.keys(this.fallback)) if (!(k in data)) data[k] = structuredClone(this.fallback[k]);
      return data;
    } catch { return structuredClone(this.fallback); }
  }
  save() {
    // Debounced (rapid tool calls / clipboard copies don't hammer the disk);
    // flushAll() runs on quit.
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 250);
  }
  flush() {
    clearTimeout(this._t);
    // Atomic write: a crash mid-write can never corrupt the store.
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

const allStores = [];
const track = (s) => { allStores.push(s); return s; };
function flushAll() { for (const s of allStores) try { s.flush(); } catch {} }

const settings = track(new Store('settings', {
  wakeWord: true,
  dryRun: false,
  proactivity: true,
  proactiveIntervalMin: 5,
  clipboardHistory: true,
  captions: true,
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  userName: '',
}));
const memory = track(new Store('memory', { items: [] }));
const notes = track(new Store('notes', { items: [] }));
const db = track(new Store('database', { tables: {} }));
const actionLog = track(new Store('actionlog', { items: [] }));
const plan = track(new Store('plan', { current: null }));
const clipboardHist = track(new Store('clipboard', { items: [] }));
const timers = track(new Store('timers', { items: [] }));
const proactiveState = track(new Store('proactive_state', { announced: {}, snoozed: [] }));

function inQuietHours() {
  const q = settings.data.quietHours;
  if (!q?.enabled) return false;
  const [sh_, sm] = q.start.split(':').map(Number);
  const [eh, em] = q.end.split(':').map(Number);
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const s = sh_ * 60 + sm, e = eh * 60 + em;
  return s <= e ? (mins >= s && mins < e) : (mins >= s || mins < e);
}

module.exports = { settings, memory, notes, db, actionLog, plan, clipboardHist, timers, proactiveState, inQuietHours, flushAll };
