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

  // ---------- voice pill ----------
  // Not connected → start a voice session. Connected with mic muted (typed
  // session) → unmute. Connected and live → end the session.
  voicePill.addEventListener('click', async () => {
    if (!RT.isConnected()) await RT.connect({ micEnabled: true });
    else if (!RT.isMicEnabled()) { RT.setMicEnabled(true); Wake.onSessionStart(); }
    else RT.disconnect();
  });

  const ariaStatus = document.createElement('div');
  ariaStatus.setAttribute('aria-live', 'polite');
  ariaStatus.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  document.body.appendChild(ariaStatus);

  RT.on('status', (text, mode) => {
    // Specific beats generic: tool summaries ("Searching the web…") show in the pill.
    pillLabelEl.textContent = text || PILL_LABEL[mode] || PILL_LABEL.idle;
    ariaStatus.textContent = text;
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
  RT.on('connected', () => { if (RT.isMicEnabled()) Wake.onSessionStart(); });
  RT.on('disconnected', () => { Wake.onSessionEnd(); caption.hidden = true; });

  // ---------- typing ----------
  const typingRow = $('typing-row');
  const textField = $('text-field');
  $('kbd-toggle').addEventListener('click', () => {
    typingRow.hidden = !typingRow.hidden;
    if (!typingRow.hidden) textField.focus(); else textField.value = '';
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

  // ---------- computer mode: badge + mini-bubble layout ----------
  window.sparky.onMode(({ mode }) => {
    settingsBtn.classList.toggle('computer-mode', mode === 'computer');
    stage.classList.toggle('mini', mode === 'computer');
  });

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
    else Panel.renderArtifact(a);
  });
  window.sparky.onPlan((plan) => Panel.renderPlan(plan));
  window.sparky.onWorkingMemory(({ beliefs }) => { Panel.renderWorkingMemory(beliefs); badge(); });
  window.sparky.onLog((items) => Panel.renderLog(items));
  window.sparky.onLogAppend((entry) => { Panel.appendLog(entry); });
  window.sparky.onTimers((items) => TimerPill.render(items));

  // ---------- risky-action confirmation ----------
  window.sparky.onConfirm(({ id, summary }) => Cards.showConfirm(id, summary));
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

  // Escape hides the window (design has no visible close control).
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.sparky.hideWindow(); });

// Debug namespace — intentional; also used by the test harness.
Object.assign(window, { Face, Cards, Panel, RT, Wake, TimerPill, Ghost, AppState, App });
