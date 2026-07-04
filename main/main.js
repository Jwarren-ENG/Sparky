const { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard, systemPreferences, Notification } = require('electron');
const path = require('path');
const { loadEnv, nowISO, uid } = require('./util');
loadEnv();

const store = require('./store');
const tools = require('./tools');
const proactive = require('./proactive');
const oa = require('./openai');
const instructions = require('./instructions');
const { TOOLS } = require('./tooldefs');

let win = null;
const COMPACT = { width: 380, height: 560 };
const EXPANDED = { width: 1160, height: 720 };

function createWindow() {
  win = new BrowserWindow({
    ...COMPACT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('preload-error', (_e, path_, err) => console.log('[preload-error]', path_, err));

  const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
  tools.setEmitter((channel, payload) => emit('sparky:' + channel, payload));

  // Timers fire back into the conversation (or a notification if idle).
  tools.setTimerCallback((t) => {
    injectOrNotify(`Timer fired: "${t.label}". Tell the user now, briefly.`, `⏰ ${t.label}`);
  });

  proactive.setNotifier((text) => {
    injectOrNotify(`Proactive trigger — mention this to the user naturally and briefly: ${text}`, text);
  });

  // Cursor position → eye tracking (screen coords relative to window center).
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    try {
      const c = screen.getCursorScreenPoint();
      const b = win.getBounds();
      emit('sparky:cursor', { dx: c.x - (b.x + 190), dy: c.y - (b.y + 160) });
    } catch {}
  }, 80);

  // Clipboard history poller.
  let lastClip = clipboard.readText();
  setInterval(() => {
    try {
      const t = clipboard.readText();
      if (t && t !== lastClip && t.length < 20000) {
        lastClip = t;
        store.clipboardHist.data.items.unshift({ id: uid('cb_'), text: t, time: nowISO() });
        store.clipboardHist.data.items = store.clipboardHist.data.items.slice(0, 50);
        store.clipboardHist.save();
      }
    } catch {}
  }, 2000);
}

function injectOrNotify(sessionText, notifText) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('sparky:inject', { text: sessionText });
  }
  // Also raise an OS notification if window is hidden (renderer ignores inject when disconnected).
  if (!win?.isVisible() && Notification.isSupported()) {
    new Notification({ title: 'Sparky', body: notifText }).show();
  }
}

// ---------- IPC ----------
ipcMain.handle('session:secret', async () => {
  const sessionConfig = {
    type: 'realtime',
    model: process.env.REALTIME_MODEL || 'gpt-realtime-2',
    output_modalities: ['audio'],
    audio: {
      input: {
        transcription: { model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe' },
        turn_detection: { type: 'semantic_vad' },
      },
      output: { voice: process.env.VOICE || 'cedar' },
    },
    instructions: instructions.build(),
    tools: TOOLS,
    tool_choice: 'auto',
  };
  try {
    const j = await oa.mintRealtimeSecret(sessionConfig);
    return { ok: true, secret: j.value || j.client_secret?.value, model: sessionConfig.model };
  } catch (e) {
    // Fallback: some accounts may not have gpt-realtime-2 yet.
    if (String(e).includes('model') && sessionConfig.model !== 'gpt-realtime') {
      try {
        sessionConfig.model = 'gpt-realtime';
        const j = await oa.mintRealtimeSecret(sessionConfig);
        return { ok: true, secret: j.value || j.client_secret?.value, model: 'gpt-realtime', note: 'fell back to gpt-realtime' };
      } catch (e2) { return { ok: false, error: String(e2.message || e2) }; }
    }
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('tool:run', async (_e, { name, args }) => tools.execute(name, args));

ipcMain.handle('wake:transcribe', async (_e, buf) => {
  try { return { text: await oa.transcribeWebm(Buffer.from(buf)) }; }
  catch (e) { return { error: String(e.message || e) }; }
});

ipcMain.handle('settings:get', () => store.settings.data);
ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(store.settings.data, patch);
  store.settings.save();
  if ('proactivity' in patch || 'proactiveIntervalMin' in patch) proactive.start();
  return store.settings.data;
});
ipcMain.handle('state:init', () => ({
  settings: store.settings.data,
  plan: store.plan.data.current,
  notes: store.notes.data.items,
  log: tools.publicLog(),
}));

// Plan controls from the panel (pause/resume/cancel/edit) — persist + inform the model.
ipcMain.handle('plan:control', (_e, { action, index, text }) => {
  const p = store.plan.data.current;
  if (!p) return { ok: false };
  let msg = '';
  if (action === 'pause') { p.status = 'paused'; msg = '[plan] The user PAUSED the plan. Stop executing steps and acknowledge.'; }
  if (action === 'resume') { p.status = 'running'; msg = '[plan] The user RESUMED the plan. Continue from the next incomplete step.'; }
  if (action === 'cancel') { p.status = 'cancelled'; msg = '[plan] The user CANCELLED the plan. Stop and acknowledge.'; }
  if (action === 'edit_step' && p.steps[index]) { p.steps[index].text = text; msg = `[plan] The user edited step ${index + 1} to: "${text}". Adjust accordingly.`; }
  store.plan.save();
  win?.webContents.send('sparky:plan', p);
  if (msg) win?.webContents.send('sparky:inject', { text: msg });
  return { ok: true };
});

ipcMain.handle('wm:correct', (_e, { beliefs }) => {
  win?.webContents.send('sparky:inject', { text: `[working memory corrected by the user] Your beliefs should now be: ${beliefs.join(' | ')}. Acknowledge briefly and adjust.` });
  return { ok: true };
});

ipcMain.handle('confirm:resolve', (_e, { id, approved }) => {
  win?.webContents.send('sparky:inject', { text: `[confirmation ${approved ? 'APPROVED' : 'DECLINED'} via panel button] Call confirm_action with id "${id}" and approved=${approved}.` });
  return { ok: true };
});

ipcMain.handle('window:mode', (_e, mode) => {
  if (!win) return;
  if (mode === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (mode === 'expanded') { win.setFullScreen(false); const b = win.getBounds(); win.setBounds({ ...EXPANDED, x: Math.max(20, b.x - (EXPANDED.width - b.width)), y: b.y }); }
  else { win.setFullScreen(false); const b = win.getBounds(); win.setBounds({ ...COMPACT, x: b.x + Math.max(0, b.width - COMPACT.width), y: b.y }); }
});

ipcMain.handle('window:hide', () => win?.hide());

// ---------- app lifecycle ----------
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch {}
  }
  createWindow();
  tools.rescheduleAll();
  proactive.start();

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!win) return;
    if (win.isVisible() && win.isFocused()) win.hide();
    else { win.show(); win.focus(); }
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else win?.show(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
