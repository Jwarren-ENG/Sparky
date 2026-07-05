// Glue: voice pill, typing, file sharing, settings sheet, theme, captions.
import { Face } from './face.js';
import { Cards, TimerPill, Ghost, initCards } from './cards.js';
import { Panel } from './panel.js';
import { RT } from './realtime.js';
import { Wake } from './wake.js';
import { AppState } from './state.js';

initCards({ injectText: (t) => RT.injectText(t) });

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const wallpaper = $('wallpaper');
  const caption = $('caption');
  const pillLabelEl = $('pill-label');
  const voicePill = $('voice-pill');
  const settingsBtn = $('settings-btn');

  let settings = {};
  let captionTimer = null;

  const PILL_LABEL = { idle: 'Tap to talk', listening: 'Listening…', thinking: 'Working…', speaking: 'Speaking…' };

  function applyTheme() {
    const hour = new Date().getHours();
    const theme = hour >= 21 || hour < 6 ? 'midnight' : hour >= 6 && hour < 9 ? 'dawn' : hour >= 17 ? 'dawn' : 'mist';
    wallpaper.className = 'theme-' + theme;
    stage.classList.toggle('dark-text', theme === 'midnight');
  }
  applyTheme();
  setInterval(applyTheme, 10 * 60 * 1000);

  // ---------- voice pill: always a TALK toggle ----------
  // Not connected → start talking. Connected → mute/unmute. The ✕ next to it
  // ends the session — the pill never kills your conversation by surprise.
  voicePill.addEventListener('click', async () => {
    if (!RT.isConnected()) await RT.connect({ micEnabled: true });
    else if (!RT.isMicEnabled()) { setMuted(false); }
    else setMuted(true);
  });
  $('end-btn').addEventListener('click', () => RT.disconnect());

  const ariaStatus = document.createElement('div');
  ariaStatus.setAttribute('aria-live', 'polite');
  ariaStatus.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  document.body.appendChild(ariaStatus);

  RT.on('status', (text, mode) => {
    // Specific beats generic: tool summaries ("Searching the web…") show in the pill.
    pillLabelEl.textContent = text || PILL_LABEL[mode] || PILL_LABEL.idle;
    ariaStatus.textContent = text;
    $('mini-status').textContent = text || ''; // bubble mode gets the same live status
  });
  RT.on('caption', (text, who) => {
    if (settings.captions === false) return;
    caption.textContent = text;
    caption.classList.toggle('sparky', who === 'sparky');
    caption.hidden = false;
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { caption.hidden = true; }, who === 'sparky' ? 8000 : 6000);
  });
  // Keep the wake listener alive during mic-muted (typed) sessions so
  // "Hey Sparky" can upgrade them to voice.
  RT.on('connected', () => { if (RT.isMicEnabled()) Wake.onSessionStart(); muteBtn.hidden = false; $('end-btn').hidden = false; syncMuteBtn(); });
  RT.on('disconnected', () => { Wake.onSessionEnd(); caption.hidden = true; muteBtn.hidden = true; $('end-btn').hidden = true; muteBtn.classList.remove('muted'); voicePill.classList.remove('muted'); });

  // ---------- mic mute / unmute (button, ⌘⇧M, and voice tool) ----------
  const muteBtn = $('mute-btn');
  function syncMuteBtn() {
    const muted = !RT.isMicEnabled();
    muteBtn.classList.toggle('muted', muted);
    $('mini-mute').classList.toggle('muted', muted);
    voicePill.classList.toggle('muted', muted && RT.isConnected());
  }
  function setMuted(muted) {
    if (!RT.isConnected()) return;
    RT.setMicEnabled(!muted);
    if (muted) Wake.onSessionEnd();   // "Hey Sparky" can unmute
    else Wake.onSessionStart();
    syncMuteBtn();
  }
  muteBtn.addEventListener('click', () => setMuted(RT.isMicEnabled()));
  RT.on('status', () => syncMuteBtn()); // covers wake-word unmutes too
  window.sparky.onToggleMic(() => setMuted(RT.isMicEnabled()));
  window.sparky.onMic(({ muted }) => setMuted(!!muted));

  // ---------- typing ----------
  const typingRow = $('typing-row');
  const textField = $('text-field');
  $('kbd-toggle').addEventListener('click', () => {
    typingRow.hidden = !typingRow.hidden;
    if (!typingRow.hidden) textField.focus(); else textField.value = '';
  });
  // Typing intent = mute: the mic goes quiet the moment the field is focused,
  // so composing text never competes with voice pickup.
  textField.addEventListener('focus', () => {
    if (RT.isConnected() && RT.isMicEnabled()) setMuted(true);
  });
  async function submitText() {
    const text = textField.value.trim();
    if (!text) return;
    textField.value = '';
    // Typed input: connect with the mic muted — no listening mode, just a reply.
    if (!RT.isConnected()) await RT.connect({ micEnabled: false });
    RT.injectText(text);
  }
  $('text-send').addEventListener('click', submitText);
  textField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitText(); });

  // ---------- file / image sharing ----------
  $('attach-btn').addEventListener('click', async () => {
    const { files } = await window.sparky.pickFiles();
    if (!files.length) return;
    if (!RT.isConnected()) await RT.connect({ micEnabled: false });
    for (const f of files) {
      if (f.kind === 'image' && f.dataUrl) {
        Panel.renderArtifact({ kind: 'image', title: f.name, path: f.path });
        RT.sendImage(f.dataUrl, f.name);
      } else if (f.kind === 'text') {
        RT.injectText(`[The user shared a file: ${f.name} (${f.path})]\n\n${f.text}`);
      } else {
        RT.injectText(`[The user shared a file: ${f.name} at ${f.path}${f.note ? ` — ${f.note}` : ''}] Use your tools if you need to work with it.`);
      }
    }
  });

  // ---------- settings ----------
  const overlay = $('settings-overlay');
  const sheet = $('settings-sheet');
  const rowsEl = $('settings-rows');
  const ROW_DEFS = [
    ['wakeWord', 'Wake word “Hey Sparky”'],
    ['dryRun', 'Dry-run mode'],
    ['proactivity', 'Proactive nudges'],
    ['clipboardHistory', 'Clipboard history'],
    ['captions', 'Live captions'],
    ['quietHoursEnabled', 'Quiet hours'],
  ];
  function renderSettingsRows() {
    rowsEl.innerHTML = ROW_DEFS.map(([key, label]) => {
      const on = key === 'quietHoursEnabled' ? !!settings.quietHours?.enabled : !!settings[key];
      return `<button class="settings-row" data-key="${key}">
        <span class="settings-row-label">${label}</span>
        <span class="settings-switch ${on ? 'on' : ''}"><span class="knob"></span></span>
      </button>`;
    }).join('');
    rowsEl.querySelectorAll('.settings-row').forEach((btn) => btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      if (key === 'quietHoursEnabled') {
        const enabled = !settings.quietHours?.enabled;
        settings = await window.sparky.setSettings({ quietHours: { ...settings.quietHours, enabled } });
      } else {
        settings = await window.sparky.setSettings({ [key]: !settings[key] });
      }
      renderSettingsRows();
      $('quiet-times').hidden = !settings.quietHours?.enabled;
    }));
  }
  settingsBtn.addEventListener('click', () => {
    renderSettingsRows();
    $('s-qstart').value = settings.quietHours?.start || '22:00';
    $('s-qend').value = settings.quietHours?.end || '08:00';
    $('s-name').value = settings.userName || '';
    $('quiet-times').hidden = !settings.quietHours?.enabled;
    overlay.hidden = false;
  });
  $('settings-close').addEventListener('click', async () => {
    settings = await window.sparky.setSettings({
      quietHours: { ...settings.quietHours, start: $('s-qstart').value || '22:00', end: $('s-qend').value || '08:00' },
      userName: $('s-name').value.trim(),
    });
    overlay.hidden = true;
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });
  $('s-clear-clipboard').addEventListener('click', async (e) => {
    await window.sparky.clearClipboard();
    e.target.textContent = 'Cleared ✓';
    setTimeout(() => { e.target.textContent = 'Clear clipboard history'; }, 1500);
  });
  sheet.addEventListener('click', (e) => e.stopPropagation());
  $('s-qstart').addEventListener('change', persistQuietTimes);
  $('s-qend').addEventListener('change', persistQuietTimes);
  async function persistQuietTimes() {
    settings = await window.sparky.setSettings({ quietHours: { ...settings.quietHours, start: $('s-qstart').value, end: $('s-qend').value } });
  }

  window.sparky.onSettings((s) => { settings = s; AppState.dryRun = !!s.dryRun; Wake.setEnabled(s.wakeWord); });

  // ---------- computer-control indicator ----------
  const ccIndicator = $('cc-indicator');
  window.sparky.onMode(({ mode }) => {
    const on = mode === 'computer';
    settingsBtn.classList.toggle('computer-mode', on);
    ccIndicator.classList.toggle('on', on);
    ccIndicator.title = on ? 'Computer control: ON — click to turn off' : 'Computer control: off (Sparky enables it when a task needs it)';
  });
  // Kill switch: clicking the lit indicator revokes computer control immediately.
  ccIndicator.addEventListener('click', () => {
    if (ccIndicator.classList.contains('on')) window.sparky.runTool('set_mode', { mode: 'display' });
  });

  // ---------- mini bubble (window state, decoupled from the tool gate) ----------
  let isMini = false;
  window.sparky.onMini(({ mini }) => {
    isMini = mini;
    stage.classList.toggle('mini', mini);
  });
  // Click the face (or anywhere non-button) in mini mode → restore the window.
  stage.addEventListener('click', (e) => {
    if (!isMini) return;
    if (e.target.closest('#mini-controls')) return;
    window.sparky.setMini(false);
  });
  $('mini-expand').addEventListener('click', () => window.sparky.setMini(false));
  $('mini-kbd').addEventListener('click', async () => {
    await window.sparky.setMini(false);
    typingRow.hidden = false;
    setTimeout(() => textField.focus(), 150); // focus after the window restores (also auto-mutes)
  });
  $('mini-mute').addEventListener('click', () => setMuted(RT.isMicEnabled()));

  // ---------- fullscreen ----------
  $('fullscreen-btn').addEventListener('click', () => window.sparky.toggleFullscreen());

  // ---------- artifacts / plan / memory / log / notes → panel; menus → cards ----------
  // Panel auto-opens only for content the user must READ; notes/log update
  // silently with a badge dot on the panel button.
  const panelBtn = $('panel-btn');
  const badge = () => { if (!Panel.isOpen()) panelBtn.classList.add('has-badge'); };
  panelBtn.addEventListener('click', () => panelBtn.classList.remove('has-badge'));
  window.sparky.onArtifact((a) => {
    if (a.kind === 'menu') Cards.showMenu(a.title, a.options);
    else if (a.kind === 'notes') { Panel.renderNotes(a.items); badge(); }
    else if (a.kind === 'log') { Panel.renderLog(a.items); Panel.openTo('log'); }
    else { Panel.renderArtifact(a); Face.glanceRight(); } // eye-dart toward new content
  });
  window.sparky.onPlan((plan) => Panel.renderPlan(plan));
  window.sparky.onWorkingMemory(({ beliefs }) => { Panel.renderWorkingMemory(beliefs); badge(); });
  window.sparky.onLog((items) => Panel.renderLog(items));
  window.sparky.onLogAppend((entry) => { Panel.appendLog(entry); });
  window.sparky.onTimers((items) => TimerPill.render(items));

  // ---------- risky-action confirmation ----------
  window.sparky.onConfirm(({ id, summary, detail }) => Cards.showConfirm(id, summary, detail));
  window.sparky.onConfirmResolved(({ id }) => Cards.resolveConfirm(id));

  // ---------- init ----------
  (async () => {
    const init = await window.sparky.initState();
    settings = init.settings;
    AppState.dryRun = !!settings.dryRun;
    Wake.setEnabled(settings.wakeWord);
    Panel.renderPlan(init.plan);
    Panel.renderLog(init.log);
    Panel.renderNotes(init.notes);
    TimerPill.render(init.timers || []);
  })();

  const App = {
    activate: async () => { if (!RT.isConnected()) await RT.connect({ micEnabled: true }); },
  };

  // Escape hides the window; ⌘K summons the type-to-Sparky field.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.sparky.hideWindow();
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      typingRow.hidden = false;
      textField.focus();
    }
  });

// Debug namespace — intentional; also used by the test harness.
Object.assign(window, { Face, Cards, Panel, RT, Wake, TimerPill, Ghost, AppState, App });
