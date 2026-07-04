// Glue: voice pill, typing, chips, settings sheet, theme, captions/status.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const wallpaper = $('wallpaper');
  const statusText = $('status-text');
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
  voicePill.addEventListener('click', async () => {
    if (window.RT.isConnected()) window.RT.disconnect();
    else await window.RT.connect();
  });

  window.RT.on('status', (text, mode) => {
    statusText.textContent = text;
    pillLabelEl.textContent = PILL_LABEL[mode] || PILL_LABEL.idle;
  });
  window.RT.on('caption', (text) => {
    caption.textContent = text;
    caption.hidden = false;
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { caption.hidden = true; }, 6000);
  });
  window.RT.on('connected', () => { window.Wake.onSessionStart(); });
  window.RT.on('disconnected', () => { window.Wake.onSessionEnd(); caption.hidden = true; });

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
    if (!window.RT.isConnected()) await window.RT.connect();
    window.RT.injectText(text);
  }
  $('text-send').addEventListener('click', submitText);
  textField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitText(); });

  // ---------- chips ----------
  const CHIPS = [
    { label: 'Book a flight', prompt: 'Help me find a flight — ask me where and when, then search for options.' },
    { label: 'Open an app', prompt: 'Open an app for me — switch to computer mode and ask which one.' },
    { label: 'Send a file', prompt: 'Help me send a file to someone — ask what file and who.' },
    { label: 'Search the web', prompt: 'Search the web for the latest AI news.' },
    { label: 'Check the weather', prompt: "What's the weather like right now?" },
    { label: 'Set a timer', prompt: 'Set a timer for 5 minutes.' },
    { label: 'Plan a trip', prompt: 'Plan a weekend trip to Austin — make a checklist plan and work through it.' },
  ];
  const chipsEl = $('chips');
  chipsEl.innerHTML = CHIPS.map((c, i) => `<button class="chip" data-i="${i}">${c.label}</button>`).join('');
  chipsEl.querySelectorAll('.chip').forEach((btn) => btn.addEventListener('click', async () => {
    if (!window.RT.isConnected()) await window.RT.connect();
    window.RT.injectText(CHIPS[+btn.dataset.i].prompt);
  }));

  // ---------- settings ----------
  const overlay = $('settings-overlay');
  const sheet = $('settings-sheet');
  const rowsEl = $('settings-rows');
  const ROW_DEFS = [
    ['wakeWord', 'Wake word “Hey Sparky”'],
    ['dryRun', 'Dry-run mode'],
    ['proactivity', 'Proactive nudges'],
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
  sheet.addEventListener('click', (e) => e.stopPropagation());
  $('s-qstart').addEventListener('change', persistQuietTimes);
  $('s-qend').addEventListener('change', persistQuietTimes);
  async function persistQuietTimes() {
    settings = await window.sparky.setSettings({ quietHours: { ...settings.quietHours, start: $('s-qstart').value, end: $('s-qend').value } });
  }

  window.sparky.onSettings((s) => { settings = s; window.AppState.dryRun = !!s.dryRun; window.Wake.setEnabled(s.wakeWord); });

  // ---------- computer mode: badge + mini-bubble layout ----------
  window.sparky.onMode(({ mode }) => {
    settingsBtn.classList.toggle('computer-mode', mode === 'computer');
    stage.classList.toggle('mini', mode === 'computer');
  });

  // ---------- fullscreen ----------
  $('fullscreen-btn').addEventListener('click', () => window.sparky.toggleFullscreen());

  // ---------- artifacts / plan / memory / log / notes → panel; menus → cards ----------
  window.sparky.onArtifact((a) => {
    if (a.kind === 'menu') window.Cards.showMenu(a.title, a.options);
    else if (a.kind === 'notes') { window.Panel.renderNotes(a.items); window.Panel.openTo('notes'); }
    else if (a.kind === 'log') { window.Panel.renderLog(a.items); window.Panel.openTo('log'); }
    else window.Panel.renderArtifact(a);
  });
  window.sparky.onPlan((plan) => window.Panel.renderPlan(plan));
  window.sparky.onWorkingMemory(({ beliefs }) => window.Panel.renderWorkingMemory(beliefs));
  window.sparky.onLog((items) => window.Panel.renderLog(items));
  window.sparky.onTimers((items) => window.TimerPill.render(items));

  // ---------- risky-action confirmation ----------
  window.sparky.onConfirm(({ id, summary }) => window.Cards.showConfirm(id, summary));
  window.sparky.onConfirmResolved(({ id }) => window.Cards.resolveConfirm(id));

  // ---------- init ----------
  (async () => {
    const init = await window.sparky.initState();
    settings = init.settings;
    window.AppState.dryRun = !!settings.dryRun;
    window.Wake.setEnabled(settings.wakeWord);
    window.Panel.renderPlan(init.plan);
    window.Panel.renderLog(init.log);
    window.Panel.renderNotes(init.notes);
    window.TimerPill.render(init.timers || []);
  })();

  window.AppState = { dryRun: false };
  window.App = {
    activate: async () => { if (!window.RT.isConnected()) await window.RT.connect(); },
  };

  // Escape hides the window (design has no visible close control).
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.sparky.hideWindow(); });
})();
