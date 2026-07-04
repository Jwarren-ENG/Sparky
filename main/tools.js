// Tool executors. Every call is action-logged; risky calls go through a
// pending-confirmation gate; computer control respects dry-run mode.
const fs = require('fs');
const path = require('path');
const { clipboard, shell } = require('electron');
const { sh, osascript, nowISO, uid, truncate, ARTIFACT_DIR } = require('./util');
const store = require('./store');
const mem = require('./memory');
const oa = require('./openai');
const { RISKY_TOOLS } = require('./tooldefs');

let emit = () => {};            // set by main.js: (channel, payload) => renderer
function setEmitter(fn) { emit = fn; }

const pending = new Map();      // confirmation gate
const liveTimers = new Map();   // id -> Timeout

// ---------- logging ----------
function logAction(tool, summary, { undo = null, dryRun = false } = {}) {
  const entry = { id: uid('a_'), tool, summary, time: nowISO(), dryRun, canUndo: !!undo };
  if (undo) entry._undo = undo; // {type, payload} — kept in memory + file
  store.actionLog.data.items.unshift(entry);
  store.actionLog.data.items = store.actionLog.data.items.slice(0, 500);
  store.actionLog.save();
  emit('log', publicLog()); // keeps the panel's Log tab fresh without opening it
  return entry;
}
const publicLog = () => store.actionLog.data.items.map(({ _undo, ...rest }) => rest).slice(0, 100);

// ---------- confirmation gate ----------
function requireConfirmation(tool, args, summary) {
  const id = uid('c_');
  pending.set(id, { tool, args, summary, created: Date.now() });
  emit('confirm', { id, summary });
  return { status: 'awaiting_confirmation', id, summary, instruction: 'Ask the user out loud. Only after a clear yes, call confirm_action with approved=true.' };
}

// ---------- computer-control primitives ----------
const dryRun = () => !!store.settings.data.dryRun;

// Computer-control tools are blocked until the model switches into computer
// mode via set_mode (extra layer on top of dry-run and confirmations).
let computerMode = false;
const NEEDS_COMPUTER_MODE = new Set(['open_app', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll', 'run_workflow']);
const modeBlocked = () => ({ error: 'Computer control is disabled. Call set_mode with mode="computer" first (tell the user you are switching).' });

async function hasCliclick() {
  if (hasCliclick.cached !== undefined) return hasCliclick.cached;
  const r = await sh('which', ['cliclick']);
  return (hasCliclick.cached = r.ok);
}

const KEYCODES = { return: 36, enter: 36, tab: 48, space: 49, delete: 51, escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121, f1: 122, f2: 120 };

async function pressKey(combo) {
  const parts = combo.toLowerCase().split('+').map(s => s.trim());
  const key = parts.pop();
  const mods = parts.map(m => ({ cmd: 'command down', command: 'command down', shift: 'shift down', alt: 'option down', option: 'option down', ctrl: 'control down', control: 'control down' }[m])).filter(Boolean);
  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  if (KEYCODES[key] !== undefined) return osascript(`tell application "System Events" to key code ${KEYCODES[key]}${using}`);
  return osascript(`tell application "System Events" to keystroke "${key.replace(/"/g, '\\"')}"${using}`);
}

// ---------- executors ----------
const exec = {
  // ---- knowledge & artifacts ----
  async web_search({ query, num_results = 6 }) {
    if (!process.env.EXA_API_KEY) return { error: 'EXA_API_KEY is not set. Add it to .env to enable web search (get one at exa.ai). Tell the user this briefly.' };
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': process.env.EXA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, numResults: num_results, contents: { text: { maxCharacters: 800 }, highlights: true } }),
    });
    if (!res.ok) return { error: `Exa error ${res.status}` };
    const j = await res.json();
    const results = (j.results || []).map(r => ({ title: r.title, url: r.url, snippet: (r.highlights?.[0] || r.text || '').slice(0, 400), published: r.publishedDate }));
    emit('artifact', { kind: 'search', title: `Web: ${query}`, results });
    logAction('web_search', `Searched web: "${query}"`);
    return { results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) };
  },

  async generate_image({ prompt, size = '1024x1024' }) {
    logAction('generate_image', `Generating image: "${truncate(prompt, 80)}"`);
    emit('artifact', { kind: 'image_loading', title: truncate(prompt, 60) });
    const file = await oa.generateImage(prompt, size);
    emit('artifact', { kind: 'image', title: truncate(prompt, 60), path: file });
    return { ok: true, file, note: 'Image is showing in the artifact panel.' };
  },

  async show_mermaid({ code, title = 'Diagram' }) {
    emit('artifact', { kind: 'mermaid', title, code });
    logAction('show_mermaid', `Rendered diagram: ${title}`);
    return { ok: true };
  },

  async show_artifact({ kind, title, content, language }) {
    emit('artifact', { kind: kind === 'code' ? 'code' : 'doc', title, content, language });
    logAction('show_artifact', `Drafted ${kind}: ${title}`);
    return { ok: true, note: 'Shown in the artifact panel.' };
  },

  async weather({ city }) {
    let lat, lon, place;
    if (city) {
      const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)).json();
      if (!g.results?.length) return { error: `Could not find city "${city}"` };
      ({ latitude: lat, longitude: lon, name: place } = g.results[0]);
    } else {
      const ip = await (await fetch('https://ipapi.co/json/')).json();
      lat = ip.latitude; lon = ip.longitude; place = ip.city || 'your area';
    }
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=3&timezone=auto&temperature_unit=fahrenheit`)).json();
    const out = { place, current: w.current, daily: w.daily };
    emit('artifact', { kind: 'weather', title: `Weather — ${place}`, data: out });
    return out;
  },

  // ---- notes ----
  async note_add({ text, emoji = '📝' }) {
    const item = { id: uid('n_'), text, emoji, done: false, created: nowISO() };
    store.notes.data.items.push(item); store.notes.save();
    emit('artifact', { kind: 'notes', title: 'Notes', items: store.notes.data.items });
    logAction('note_add', `Added note: ${text}`, { undo: { type: 'note_delete', payload: { id: item.id } } });
    return { ok: true, id: item.id };
  },
  async note_list() {
    emit('artifact', { kind: 'notes', title: 'Notes', items: store.notes.data.items });
    return { items: store.notes.data.items.map(({ id, text, emoji, done }) => ({ id, text, emoji, done })) };
  },
  async note_done({ id }) {
    const n = store.notes.data.items.find(i => i.id === id);
    if (!n) return { error: 'note not found' };
    n.done = !n.done; store.notes.save();
    emit('artifact', { kind: 'notes', title: 'Notes', items: store.notes.data.items });
    return { ok: true, done: n.done };
  },
  async note_delete({ id }) {
    const n = store.notes.data.items.find(i => i.id === id);
    if (!n) return { error: 'note not found' };
    store.notes.data.items = store.notes.data.items.filter(i => i.id !== id); store.notes.save();
    emit('artifact', { kind: 'notes', title: 'Notes', items: store.notes.data.items });
    logAction('note_delete', `Deleted note: ${n.text}`, { undo: { type: 'note_restore', payload: n } });
    return { ok: true };
  },

  // ---- database ----
  async db_upsert({ table, record }) {
    const t = (store.db.data.tables[table] ||= []);
    let prev = null;
    if (record.id) {
      const i = t.findIndex(r => r.id === record.id);
      if (i >= 0) { prev = { ...t[i] }; t[i] = { ...t[i], ...record, updated: nowISO() }; }
      else t.push({ ...record, created: nowISO() });
    } else {
      record.id = uid('r_'); t.push({ ...record, created: nowISO() });
    }
    store.db.save();
    emit('artifact', { kind: 'table', title: `db: ${table}`, rows: t });
    logAction('db_upsert', `${prev ? 'Updated' : 'Created'} record ${record.id} in "${table}"`, { undo: prev ? { type: 'db_restore', payload: { table, record: prev } } : { type: 'db_remove', payload: { table, id: record.id } } });
    return { ok: true, id: record.id };
  },
  async db_search({ table, query }) {
    if (!table) return { tables: Object.entries(store.db.data.tables).map(([k, v]) => ({ table: k, rows: v.length })) };
    const t = store.db.data.tables[table] || [];
    const rows = query ? t.filter(r => JSON.stringify(r).toLowerCase().includes(query.toLowerCase())) : t;
    emit('artifact', { kind: 'table', title: `db: ${table}${query ? ` — "${query}"` : ''}`, rows });
    return { count: rows.length, rows: rows.slice(0, 50) };
  },
  async db_delete({ table, id }) {
    const t = store.db.data.tables[table] || [];
    const rec = t.find(r => r.id === id);
    if (!rec) return { error: 'record not found' };
    return requireConfirmation('db_delete', { table, id }, `Delete record ${id} from "${table}": ${truncate(JSON.stringify(rec), 120)}`);
  },

  // ---- memory ----
  async remember({ text, type = 'fact', tags = [] }) {
    const r = await mem.remember(text, type, tags);
    logAction('remember', `Remembered: ${text}`);
    return r;
  },
  async recall({ query }) { return { matches: await mem.recall(query) }; },
  async forget({ id_or_text }) {
    const r = mem.forget(id_or_text);
    logAction('forget', `Forgot ${r.forgotten} memorie(s) matching "${id_or_text}"`);
    emit('artifact', { kind: 'memory', title: 'Long-term memory', items: mem.listAll() });
    return r;
  },
  async memory_list() {
    const items = mem.listAll();
    emit('artifact', { kind: 'memory', title: 'Long-term memory', items });
    return { count: items.length, items: items.slice(0, 60) };
  },
  async working_memory_set({ beliefs }) {
    emit('working_memory', { beliefs });
    return { ok: true, silent: true };
  },

  // ---- task engine ----
  async plan_create({ goal, steps }) {
    const p = { id: uid('p_'), goal, status: 'running', created: nowISO(), steps: steps.map(s => ({ text: s, status: 'pending', note: '' })) };
    store.plan.data.current = p; store.plan.save();
    emit('plan', p);
    logAction('plan_create', `Started plan: ${goal} (${steps.length} steps)`);
    return { ok: true, note: 'Plan is visible. Work through steps, calling plan_update as you go. Stop immediately if status becomes paused/cancelled.' };
  },
  async plan_update({ index, status, note, text }) {
    const p = store.plan.data.current;
    if (!p) return { error: 'no active plan' };
    if (p.status === 'paused') return { paused: true, instruction: 'Plan is paused by the user. Do not continue steps until resumed.' };
    if (p.status === 'cancelled') return { cancelled: true, instruction: 'Plan was cancelled by the user. Stop.' };
    const s = p.steps[index];
    if (!s) return { error: 'bad step index' };
    if (status) s.status = status;
    if (note !== undefined) s.note = note;
    if (text) s.text = text;
    store.plan.save(); emit('plan', p);
    return { ok: true, plan_status: p.status };
  },
  async plan_finish({ outcome = 'done' }) {
    const p = store.plan.data.current;
    if (p) { p.status = outcome; store.plan.save(); emit('plan', p); logAction('plan_finish', `Plan ${outcome}: ${p.goal}`); }
    return { ok: true };
  },

  // ---- interactive menu ----
  async show_menu({ title, options }) {
    emit('artifact', { kind: 'menu', title, options: (options || []).slice(0, 12) });
    logAction('show_menu', `Offered menu: ${title} (${options?.length || 0} options)`);
    return { ok: true, note: 'Menu is on the panel. The user\'s click arrives as a message like "I pick: …". You can keep talking meanwhile.' };
  },

  // ---- computer control ----
  async set_mode({ mode }) {
    if (!['display', 'computer'].includes(mode)) return { error: 'mode must be display or computer' };
    computerMode = mode === 'computer';
    emit('mode', { mode });
    onModeChange(mode); // main shrinks the window to a corner bubble in computer mode
    logAction('set_mode', `Switched to ${mode} mode`);
    return { ok: true, mode, note: computerMode ? 'Computer control unlocked; the window shrank to a corner bubble so you can see the screen. Dry-run and confirmations still apply.' : 'Back to display mode; computer control locked.' };
  },
  async open_app({ name }) {
    if (dryRun()) return dryPreview('open_app', `Would open app "${name}"`);
    const r = await sh('open', ['-a', name]);
    logAction('open_app', `Opened app: ${name}`);
    return r.ok ? { ok: true } : { error: r.stderr || `could not open ${name}` };
  },
  async open_url({ url }) {
    if (!/^https?:\/\//.test(url)) return { error: 'only http(s) urls' };
    if (dryRun()) return dryPreview('open_url', `Would open URL ${url}`);
    await shell.openExternal(url);
    logAction('open_url', `Opened URL: ${url}`);
    return { ok: true };
  },
  async computer_click({ x, y, double = false }) {
    if (dryRun()) return dryPreview('computer_click', `Would ${double ? 'double-' : ''}click at (${x}, ${y})`);
    if (await hasCliclick()) {
      const r = await sh('cliclick', [double ? `dc:${x},${y}` : `c:${x},${y}`]);
      logAction('computer_click', `Clicked at (${x}, ${y})${double ? ' (double)' : ''}`);
      return r.ok ? { ok: true } : { error: r.stderr };
    }
    const r = await osascript(`tell application "System Events" to ${double ? 'click' : 'click'} at {${x}, ${y}}`);
    if (r.ok) { logAction('computer_click', `Clicked at (${x}, ${y})`); return { ok: true }; }
    return { error: 'Clicking needs the "cliclick" utility. Ask the user to run: brew install cliclick' };
  },
  async computer_type({ text }) {
    if (dryRun()) return dryPreview('computer_type', `Would type: "${truncate(text, 100)}"`);
    const r = await osascript(`tell application "System Events" to keystroke "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    logAction('computer_type', `Typed ${text.length} chars`);
    return r.ok ? { ok: true } : { error: r.error + ' (grant Accessibility permission in System Settings → Privacy & Security)' };
  },
  async computer_key({ combo }) {
    if (dryRun()) return dryPreview('computer_key', `Would press: ${combo}`);
    const r = await pressKey(combo);
    logAction('computer_key', `Pressed: ${combo}`);
    return r.ok ? { ok: true } : { error: r.error };
  },
  async computer_scroll({ direction = 'down', amount = 5 }) {
    if (dryRun()) return dryPreview('computer_scroll', `Would scroll ${direction} ${amount}`);
    if (await hasCliclick()) {
      // cliclick has no scroll; use key codes
    }
    const code = direction === 'up' ? 116 : 121; // page up / page down
    const times = Math.max(1, Math.round(amount / 5));
    for (let i = 0; i < times; i++) await osascript(`tell application "System Events" to key code ${code}`);
    logAction('computer_scroll', `Scrolled ${direction}`);
    return { ok: true };
  },
  async read_screen({ question }) {
    const file = path.join(ARTIFACT_DIR, `screen_${uid()}.png`);
    const r = await sh('screencapture', ['-x', file]);
    if (!r.ok) return { error: 'screencapture failed — grant Screen Recording permission in System Settings.' };
    emit('artifact', { kind: 'image', title: `Screen — ${truncate(question, 50)}`, path: file });
    logAction('read_screen', `Read screen: ${truncate(question, 80)}`);
    const answer = await oa.utility(`You are looking at the user's screen. ${question}\nBe concise and specific.`, file);
    return { answer };
  },
  async ui_inspect() {
    const script = `
      tell application "System Events"
        set p to first process whose frontmost is true
        set appName to name of p
        set out to "app: " & appName & "\\n"
        try
          set w to front window of p
          set out to out & "window: " & (name of w) & "\\n"
          repeat with el in (UI elements of w)
            try
              set r to role description of el
              set n to ""
              try
                set n to name of el
              end try
              set pos to position of el
              set out to out & r & " | " & n & " | at " & (item 1 of pos as text) & "," & (item 2 of pos as text) & "\\n"
            end try
          end repeat
        end try
        return out
      end tell`;
    const r = await osascript(script, 15000);
    if (!r.ok) return { error: r.error + ' (needs Accessibility permission)' };
    logAction('ui_inspect', 'Inspected frontmost window UI');
    return { elements: truncate(r.out, 3000) };
  },
  async run_workflow({ description, steps }) {
    if (dryRun()) {
      const preview = steps.map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args || {})}`).join('\n');
      return dryPreview('run_workflow', `Workflow "${description}" would run:\n${preview}`);
    }
    const results = [];
    for (const s of steps) {
      if (!exec[s.tool] || !s.tool.startsWith('computer_') && !['open_app', 'open_url'].includes(s.tool)) { results.push({ step: s.tool, error: 'not allowed in workflow' }); continue; }
      results.push({ step: s.tool, result: await exec[s.tool](s.args || {}) });
      await new Promise(r => setTimeout(r, 400));
    }
    logAction('run_workflow', `Ran workflow: ${description}`);
    return { results };
  },

  // ---- confirmation & undo ----
  async confirm_action({ id, approved }) {
    const p = pending.get(id);
    if (!p) return { error: 'no such pending action (it may have expired)' };
    pending.delete(id);
    emit('confirm_resolved', { id });
    if (!approved) { logAction(p.tool, `CANCELLED (user declined): ${p.summary}`); return { cancelled: true }; }
    const result = await confirmedExecutors[p.tool]?.(p.args) ?? { error: 'no confirmed executor' };
    return result;
  },
  async undo_action({ id }) {
    const entry = store.actionLog.data.items.find(i => i.id === id);
    if (!entry?._undo) return { error: 'action not found or not undoable' };
    const { type, payload } = entry._undo;
    if (type === 'note_delete') await exec.note_delete({ id: payload.id });
    else if (type === 'note_restore') { store.notes.data.items.push(payload); store.notes.save(); emit('artifact', { kind: 'notes', title: 'Notes', items: store.notes.data.items }); }
    else if (type === 'db_restore') { const t = store.db.data.tables[payload.table] || []; const i = t.findIndex(r => r.id === payload.record.id); if (i >= 0) t[i] = payload.record; else t.push(payload.record); store.db.save(); }
    else if (type === 'db_remove') { store.db.data.tables[payload.table] = (store.db.data.tables[payload.table] || []).filter(r => r.id !== payload.id); store.db.save(); }
    else return { error: `undo type ${type} not supported` };
    entry.canUndo = false; store.actionLog.save();
    logAction('undo_action', `Undid: ${entry.summary}`);
    return { ok: true };
  },
  async action_log_show() {
    emit('artifact', { kind: 'log', title: 'Action log', items: publicLog() });
    return { count: store.actionLog.data.items.length };
  },

  // ---- calendar & email ----
  async calendar_events({ days = 3 }) {
    const script = `
      set output to ""
      set startDate to current date
      set endDate to startDate + (${Math.min(days, 14)} * days)
      tell application "Calendar"
        repeat with c in calendars
          try
            set evts to (every event of c whose start date is greater than or equal to startDate and start date is less than or equal to endDate)
            repeat with e in evts
              set output to output & (summary of e) & " | " & ((start date of e) as text) & " | " & (name of c) & "\\n"
            end repeat
          end try
        end repeat
      end tell
      return output`;
    const r = await osascript(script, 45000);
    if (!r.ok) return { error: r.error + ' (grant Calendar access when macOS prompts)' };
    const events = r.out.split('\n').filter(Boolean).map(l => { const [title, start, cal] = l.split(' | '); return { title, start, calendar: cal }; });
    emit('artifact', { kind: 'calendar', title: `Calendar — next ${days} day(s)`, events });
    logAction('calendar_events', `Read calendar (${events.length} events)`);
    return { events };
  },
  async calendar_create(args) {
    return requireConfirmation('calendar_create', args, `Create event "${args.title}" at ${args.start_iso} (${args.minutes || 30} min)`);
  },
  async email_list({ count = 10, unread_only = false }) {
    const script = `
      tell application "Mail"
        set out to ""
        set msgs to messages 1 thru (${Math.min(count, 25)}) of inbox
        repeat with m in msgs
          ${unread_only ? 'if read status of m is false then' : ''}
          set out to out & (subject of m) & " | " & (sender of m) & " | " & ((read status of m) as text) & "\\n"
          ${unread_only ? 'end if' : ''}
        end repeat
        return out
      end tell`;
    const r = await osascript(script, 30000);
    if (!r.ok) return { error: r.error + ' (Mail.app must be set up; grant automation access when prompted)' };
    const emails = r.out.split('\n').filter(Boolean).map((l, i) => { const [subject, sender, read] = l.split(' | '); return { index: i + 1, subject, sender, unread: read === 'false' }; });
    emit('artifact', { kind: 'email', title: 'Inbox', emails });
    logAction('email_list', `Listed ${emails.length} inbox emails`);
    return { emails };
  },
  async email_read({ index }) {
    const r = await osascript(`tell application "Mail" to return content of message ${index} of inbox`, 20000);
    if (!r.ok) return { error: r.error };
    logAction('email_read', `Read inbox email #${index}`);
    return { body: truncate(r.out, 4000) };
  },
  async email_draft({ to, subject, body }) {
    const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
      tell application "Mail"
        set d to make new outgoing message with properties {subject:"${esc(subject)}", content:"${esc(body)}", visible:true}
        tell d to make new to recipient with properties {address:"${esc(to)}"}
      end tell`;
    const r = await osascript(script, 20000);
    if (!r.ok) return { error: r.error };
    emit('artifact', { kind: 'doc', title: `Draft → ${to}: ${subject}`, content: body });
    logAction('email_draft', `Drafted email to ${to}: "${subject}" (NOT sent)`);
    return { ok: true, note: 'Draft opened in Mail.app — the user sends it themselves.' };
  },

  // ---- misc ----
  async clipboard_history({ count = 10 }) {
    const items = store.clipboardHist.data.items.slice(0, count);
    emit('artifact', { kind: 'clipboard', title: 'Clipboard history', items });
    return { items: items.map(i => ({ time: i.time, text: truncate(i.text, 200) })) };
  },
  async file_search({ query, kind = 'name-only' }) {
    const args = kind === 'content' ? [query] : ['-name', query];
    const r = await sh('mdfind', [...args], { timeout: 15000 });
    const files = r.stdout.split('\n').filter(Boolean).slice(0, 25);
    emit('artifact', { kind: 'files', title: `Files: ${query}`, files });
    logAction('file_search', `Searched files: "${query}" (${files.length} hits)`);
    return { files };
  },
  async timer_set({ label, seconds, at_iso }) {
    let fireAt;
    if (seconds) fireAt = Date.now() + seconds * 1000;
    else if (at_iso) fireAt = new Date(at_iso).getTime();
    else return { error: 'need seconds or at_iso' };
    if (fireAt < Date.now()) return { error: 'that time is in the past' };
    const t = { id: uid('t_'), label, fireAt, created: nowISO() };
    store.timers.data.items.push(t); store.timers.save();
    scheduleTimer(t);
    emit('timers', store.timers.data.items);
    logAction('timer_set', `Set ${seconds ? 'timer' : 'reminder'}: "${label}" at ${new Date(fireAt).toLocaleTimeString()}`);
    return { ok: true, id: t.id, fires_at: new Date(fireAt).toISOString() };
  },
  async timer_list() {
    return { timers: store.timers.data.items.map(t => ({ id: t.id, label: t.label, fires_at: new Date(t.fireAt).toISOString() })) };
  },
  async timer_cancel({ id }) {
    clearTimeout(liveTimers.get(id)); liveTimers.delete(id);
    store.timers.data.items = store.timers.data.items.filter(t => t.id !== id); store.timers.save();
    emit('timers', store.timers.data.items);
    logAction('timer_cancel', `Cancelled timer ${id}`);
    return { ok: true };
  },
  async set_mood({ mood }) { emit('mood', { mood }); return { ok: true, silent: true }; },
  async settings_get() { return store.settings.data; },
  async settings_set({ key, value }) {
    if (!(key in store.settings.data)) return { error: 'unknown setting' };
    store.settings.data[key] = value; store.settings.save();
    emit('settings', store.settings.data);
    logAction('settings_set', `Setting changed: ${key} = ${JSON.stringify(value)}`);
    return { ok: true, settings: store.settings.data };
  },
};

// Executors that run only after the user confirms.
const confirmedExecutors = {
  async db_delete({ table, id }) {
    const t = store.db.data.tables[table] || [];
    const rec = t.find(r => r.id === id);
    if (!rec) return { error: 'record vanished' };
    store.db.data.tables[table] = t.filter(r => r.id !== id); store.db.save();
    emit('artifact', { kind: 'table', title: `db: ${table}`, rows: store.db.data.tables[table] });
    logAction('db_delete', `Deleted record ${id} from "${table}"`, { undo: { type: 'db_restore', payload: { table, record: rec } } });
    return { ok: true, deleted: rec };
  },
  async calendar_create({ title, start_iso, minutes = 30, calendar }) {
    const start = new Date(start_iso);
    const end = new Date(start.getTime() + minutes * 60000);
    const fmt = d => `date "${d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}"`;
    const esc = s => s.replace(/"/g, '\\"');
    const calSel = calendar ? `calendar "${esc(calendar)}"` : 'first calendar whose writable is true';
    const r = await osascript(`tell application "Calendar" to make new event at end of events of (${calSel}) with properties {summary:"${esc(title)}", start date:${fmt(start)}, end date:${fmt(end)}}`, 30000);
    if (!r.ok) return { error: r.error };
    logAction('calendar_create', `Created event "${title}" at ${start.toLocaleString()}`);
    return { ok: true };
  },
};

function dryPreview(tool, summary) {
  logAction(tool, `[DRY RUN] ${summary}`, { dryRun: true });
  return { dry_run: true, would_do: summary, note: 'Dry-run mode is on — nothing was executed. Tell the user what would happen and how to disable dry run if they want it done for real.' };
}

// ---------- callbacks into main ----------
let onModeChange = () => {};
function setModeCallback(fn) { onModeChange = fn; }

// ---------- timers ----------
let onTimerFire = () => {};
function setTimerCallback(fn) { onTimerFire = fn; }
function scheduleTimer(t) {
  const delay = Math.max(0, t.fireAt - Date.now());
  if (delay > 2 ** 31 - 1) return;
  liveTimers.set(t.id, setTimeout(() => {
    store.timers.data.items = store.timers.data.items.filter(x => x.id !== t.id);
    store.timers.save();
    liveTimers.delete(t.id);
    emit('timers', store.timers.data.items);
    onTimerFire(t);
  }, delay));
}
function rescheduleAll() {
  const now = Date.now();
  store.timers.data.items = store.timers.data.items.filter(t => t.fireAt > now - 60000);
  store.timers.save();
  store.timers.data.items.forEach(scheduleTimer);
}

async function execute(name, args) {
  if (!exec[name]) return { error: `unknown tool: ${name}` };
  if (NEEDS_COMPUTER_MODE.has(name) && !computerMode) return modeBlocked();
  try {
    return await exec[name](args || {});
  } catch (e) {
    return { error: String(e.message || e).slice(0, 500) };
  }
}

module.exports = { execute, setEmitter, setTimerCallback, setModeCallback, rescheduleAll, logAction, publicLog };
