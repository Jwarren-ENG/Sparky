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
const OVERLAY = { width: 1040, height: 760 };

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.workArea.x + (display.workArea.width - OVERLAY.width) / 2);
  const y = Math.round(display.workArea.y + (display.workArea.height - OVERLAY.height) / 2);
  win = new BrowserWindow({
    ...OVERLAY,
    x, y,
    minWidth: 860,
    minHeight: 620,
    titleBarStyle: 'hidden',                    // native traffic lights, no title bar
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#e9e2e6',
    title: 'Sparky',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Behave like a normal macOS app: the red button hides the window;
  // clicking the Dock icon (or ⌘⇧S) brings it back. ⌘Q actually quits.
  win.on('close', (e) => {
    if (!app.isQuittingForReal) { e.preventDefault(); win.hide(); }
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('preload-error', (_e, path_, err) => console.log('[preload-error]', path_, err));

  const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
  tools.setEmitter((channel, payload) => emit('sparky:' + channel, payload));
  tools.setModeCallback((mode) => setWindowMode(mode));

  // Timers fire back into the conversation (or a notification if idle).
  tools.setTimerCallback((t) => {
    injectOrNotify(`Timer fired: "${t.label}". Tell the user now, briefly.`, `⏰ ${t.label}`);
  });

  proactive.setNotifier((text) => {
    injectOrNotify(`Proactive trigger — mention this to the user naturally and briefly: ${text}`, text);
  });

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
    reasoning: { effort: 'low' },
    audio: {
      input: {
        // language pinned so captions never come back transcribed into another language
        transcription: { model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe', language: process.env.SPEECH_LANGUAGE || 'en' },
        turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true },
      },
      output: { voice: process.env.VOICE || 'cedar' },
    },
    instructions: instructions.build(),
    tools: TOOLS,
    tool_choice: 'auto',
    tracing: { workflow_name: 'Sparky Desktop Companion' },
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
  timers: store.timers.data.items,
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

ipcMain.handle('window:hide', () => win?.hide());
ipcMain.handle('window:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

// Computer mode: shrink to a corner bubble on the display the cursor is on,
// always on top, so Sparky stays visible while it drives the Mac (rileyjarvis-style).
let normalBounds = null;
function setWindowMode(mode) {
  if (!win || win.isDestroyed()) return;
  if (mode === 'computer') {
    if (win.isFullScreen()) win.setFullScreen(false);
    const b = win.getBounds();
    if (b.width > 400 && b.height > 400) normalBounds = b;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { workArea } = display;
    const mini = 210, margin = 18;
    win.setMinimumSize(150, 150);
    win.setResizable(false);
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setBounds({ x: workArea.x + margin, y: workArea.y + workArea.height - mini - margin, width: mini, height: mini });
    return;
  }
  win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(false);
  win.setResizable(true);
  win.setMinimumSize(860, 620);
  if (normalBounds) win.setBounds(normalBounds);
  else { win.setBounds({ width: OVERLAY.width, height: OVERLAY.height }); win.center(); }
}

// ---------- app lifecycle ----------
app.setName('Sparky');

// Single instance: double-clicking Sparky.app while running just summons the window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch {}
    try {
      const { nativeImage } = require('electron');
      const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) app.dock.setIcon(img);
    } catch {}
  }
  createWindow();
  tools.rescheduleAll();
  proactive.start();

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!win) return;
    if (win.isVisible() && win.isFocused()) win.hide();
    else { win.show(); win.focus(); }
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else { win?.show(); win?.focus(); } });
});

app.on('before-quit', () => { app.isQuittingForReal = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
