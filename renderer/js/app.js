// UI glue: voice orb, text input toggle, settings drawer, status.
(() => {
  const $ = (s) => document.querySelector(s);
  const voiceInput = $('#voice-input');
  const voiceStatus = $('#voice-status');
  const textInput = $('#text-input');
  const textField = $('#text-field');
  const kbdToggle = $('#kbd-toggle');
  const textSend = $('#text-send');
  const settingsBtn = $('#settings-btn');
  const settingsDrawer = $('#settings-drawer');
  const settingsClose = $('#settings-close');
  const closeBtn = $('#close-btn');

  let settings = {};
  let cardMap = new Map(); // tool call ID -> card ID
  let listening = false;

  // ---- Voice input orb ----
  voiceInput.addEventListener('click', async () => {
    if (window.RT.isConnected()) return;
    listening = true;
    voiceInput.classList.add('listening');
    await window.RT.connect();
  });

  // ---- Keyboard toggle ----
  kbdToggle.addEventListener('click', () => {
    if (textInput.hidden) {
      textInput.hidden = false;
      textField.focus();
    } else {
      textInput.hidden = true;
      textField.value = '';
    }
  });

  // ---- Text send ----
  textSend.addEventListener('click', () => {
    const text = textField.value.trim();
    if (!text) return;
    window.RT.injectText(text);
    textField.value = '';
  });
  textField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { textSend.click(); }
  });

  // ---- Settings ----
  settingsBtn.addEventListener('click', () => {
    fillSettings();
    settingsDrawer.hidden = false;
  });
  settingsClose.addEventListener('click', async () => {
    const patch = {
      wakeWord: $('#s-wake').checked,
      dryRun: $('#s-dry').checked,
      proactivity: $('#s-pro').checked,
      quietHours: {
        enabled: $('#s-quiet').checked,
        start: $('#s-qstart').value || '22:00',
        end: $('#s-qend').value || '08:00',
      },
      userName: $('#s-name').value.trim(),
    };
    settings = await window.sparky.setSettings(patch);
    window.Wake.setEnabled(settings.wakeWord);
    settingsDrawer.hidden = true;
  });
  $('#s-quiet').addEventListener('change', (e) => {
    $('#quiet-times').hidden = !e.target.checked;
  });

  function fillSettings() {
    $('#s-wake').checked = !!settings.wakeWord;
    $('#s-dry').checked = !!settings.dryRun;
    $('#s-pro').checked = !!settings.proactivity;
    $('#s-quiet').checked = !!settings.quietHours?.enabled;
    $('#s-qstart').value = settings.quietHours?.start || '22:00';
    $('#s-qend').value = settings.quietHours?.end || '08:00';
    $('#s-name').value = settings.userName || '';
    $('#quiet-times').hidden = !settings.quietHours?.enabled;
  }

  // ---- Close window ----
  closeBtn.addEventListener('click', () => window.sparky.hideWindow());

  // ---- Realtime events ----
  window.RT.on('status', (text, mode) => {
    if (mode === 'listening') {
      voiceInput.classList.add('listening');
      listening = true;
    } else if (mode === 'idle') {
      voiceInput.classList.remove('listening');
      listening = false;
    }
    voiceStatus.textContent = text;
  });

  window.RT.on('connected', () => {
    window.Face.setMode('listening');
    voiceInput.classList.add('listening');
  });

  window.RT.on('disconnected', () => {
    window.Face.setMode('idle');
    voiceInput.classList.remove('listening');
    window.Wake.onSessionEnd();
  });

  // ---- Settings sync ----
  window.sparky.onSettings((s) => { settings = s; });

  // ---- Init ----
  (async () => {
    const init = await window.sparky.initState();
    settings = init.settings;
    window.Wake.setEnabled(settings.wakeWord);
    voiceStatus.textContent = 'Say "Hey Sparky"';
  })();

  // ---- Export for realtime ----
  window.App = { voiceStatus, cardMap };
})();
