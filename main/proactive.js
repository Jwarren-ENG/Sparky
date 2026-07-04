// Proactivity engine: periodically looks for triggers (upcoming events,
// urgent unread email, stalled plans) and speaks up — unless quiet hours.
const { osascript, nowISO } = require('./util');
const store = require('./store');

let notify = () => {}; // (text, {spoken}) => main routes to session or OS notification
function setNotifier(fn) { notify = fn; }

const URGENT_RE = /\b(urgent|asap|action required|important|deadline|overdue|final notice|reminder:)\b/i;

async function checkCalendar() {
  const script = `
    set startDate to current date
    set endDate to startDate + (35 * minutes)
    set out to ""
    tell application "Calendar"
      repeat with c in calendars
        try
          set evts to (every event of c whose start date is greater than or equal to startDate and start date is less than or equal to endDate)
          repeat with e in evts
            set out to out & (summary of e) & " | " & ((start date of e) as text) & "\\n"
          end repeat
        end try
      end repeat
    end tell
    return out`;
  const r = await osascript(script, 45000);
  if (!r.ok) return;
  for (const line of r.out.split('\n').filter(Boolean)) {
    const [title, start] = line.split(' | ');
    const key = `cal:${title}:${start}`;
    if (store.proactiveState.data.announced[key]) continue;
    store.proactiveState.data.announced[key] = nowISO();
    store.proactiveState.save();
    notify(`Heads up: "${title}" is coming up at ${start}.`);
  }
}

async function checkEmail() {
  const r = await osascript(`
    tell application "Mail"
      set out to ""
      try
        set msgs to messages 1 thru 15 of inbox
        repeat with m in msgs
          if read status of m is false then
            set out to out & (subject of m) & " | " & (sender of m) & "\\n"
          end if
        end repeat
      end try
      return out
    end tell`, 30000);
  if (!r.ok) return;
  for (const line of r.out.split('\n').filter(Boolean)) {
    const [subject, sender] = line.split(' | ');
    if (!URGENT_RE.test(subject || '')) continue;
    const key = `mail:${subject}:${sender}`;
    if (store.proactiveState.data.announced[key]) continue;
    store.proactiveState.data.announced[key] = nowISO();
    store.proactiveState.save();
    notify(`You have an urgent-looking unread email from ${sender}: "${subject}".`);
  }
}

function checkStalledPlan() {
  const p = store.plan.data.current;
  if (p?.status === 'paused') {
    const key = `plan:${p.id}:paused`;
    const last = store.proactiveState.data.announced[key];
    if (!last || Date.now() - new Date(last).getTime() > 60 * 60 * 1000) {
      store.proactiveState.data.announced[key] = nowISO();
      store.proactiveState.save();
      notify(`Reminder: the plan "${p.goal}" is still paused. Want me to resume or drop it?`);
    }
  }
}

let interval = null;
function start() {
  stop();
  const tick = async () => {
    if (!store.settings.data.proactivity || store.inQuietHours()) return;
    try { await checkCalendar(); } catch {}
    try { await checkEmail(); } catch {}
    try { checkStalledPlan(); } catch {}
    // Trim announced map so it doesn't grow forever.
    const entries = Object.entries(store.proactiveState.data.announced);
    if (entries.length > 300) {
      store.proactiveState.data.announced = Object.fromEntries(entries.slice(-150));
      store.proactiveState.save();
    }
  };
  const min = Math.max(1, store.settings.data.proactiveIntervalMin || 5);
  interval = setInterval(tick, min * 60 * 1000);
  setTimeout(tick, 20 * 1000); // first check shortly after launch
}
function stop() { if (interval) clearInterval(interval); interval = null; }

module.exports = { start, stop, setNotifier };
