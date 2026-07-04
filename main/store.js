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
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return structuredClone(this.fallback); }
  }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
}

const settings = new Store('settings', {
  wakeWord: true,
  dryRun: false,
  proactivity: true,
  proactiveIntervalMin: 5,
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  userName: '',
});
const memory = new Store('memory', { items: [] });
const notes = new Store('notes', { items: [] });
const db = new Store('database', { tables: {} });
const actionLog = new Store('actionlog', { items: [] });
const plan = new Store('plan', { current: null });
const clipboardHist = new Store('clipboard', { items: [] });
const timers = new Store('timers', { items: [] });
const proactiveState = new Store('proactive_state', { announced: {}, snoozed: [] });

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

module.exports = { settings, memory, notes, db, actionLog, plan, clipboardHist, timers, proactiveState, inQuietHours };
