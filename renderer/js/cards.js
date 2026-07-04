// Floating glass cards: ephemeral tool feedback, interactive menus, risky-
// action confirmations, and proactive nudges. Rich content lives in the panel.
// Also owns the timer pill and the ghost "Sparky is controlling" app window.
(() => {
  const container = document.getElementById('cards');
  const cards = new Map(); // id -> { el, timeout }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (window.mermaid) window.mermaid.initialize({ startOnLoad: false, theme: 'neutral' });

  const TOOL_META = {
    web_search: { icon: '🔍', bg: 'linear-gradient(135deg,#4a90e2,#0071e3)' },
    generate_image: { icon: '🎨', bg: 'linear-gradient(135deg,#a78bda,#7d5fc7)' },
    show_mermaid: { icon: '📊', bg: 'linear-gradient(135deg,#4a90e2,#0071e3)' },
    show_artifact: { icon: '📄', bg: 'linear-gradient(135deg,#4a90e2,#0071e3)' },
    weather: { icon: '☀️', bg: 'linear-gradient(135deg,#4ec1e0,#2a9fc2)' },
    open_app: { icon: '◳', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    computer_click: { icon: '🖱', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    computer_type: { icon: '⌨', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    computer_key: { icon: '⌨', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    computer_scroll: { icon: '📜', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    run_workflow: { icon: '⚡', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    read_screen: { icon: '📸', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    ui_inspect: { icon: '🔎', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    set_mode: { icon: '⌨', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
    note_add: { icon: '📝', bg: 'linear-gradient(135deg,#f0a04a,#e07b28)' },
    db_upsert: { icon: '💾', bg: 'linear-gradient(135deg,#4a90e2,#0071e3)' },
    db_delete: { icon: '🗑', bg: 'linear-gradient(135deg,#e2665a,#c94c40)' },
    calendar_create: { icon: '📅', bg: 'linear-gradient(135deg,#e2665a,#c94c40)' },
    calendar_events: { icon: '📅', bg: 'linear-gradient(135deg,#e2665a,#c94c40)' },
    email_draft: { icon: '✉', bg: 'linear-gradient(135deg,#4a90e2,#0071e3)' },
    remember: { icon: '🧠', bg: 'linear-gradient(135deg,#a78bda,#7d5fc7)' },
    recall: { icon: '🧠', bg: 'linear-gradient(135deg,#a78bda,#7d5fc7)' },
    forget: { icon: '🧠', bg: 'linear-gradient(135deg,#a78bda,#7d5fc7)' },
    show_menu: { icon: '📌', bg: 'linear-gradient(135deg,#a78bda,#7d5fc7)' },
    timer_set: { icon: '⏱', bg: 'linear-gradient(135deg,#f0a04a,#e07b28)' },
    file_search: { icon: '📁', bg: 'linear-gradient(135deg,#4a90e2,#0071e3)' },
    plan_create: { icon: '📋', bg: 'linear-gradient(135deg,#5b8def,#3b5fd9)' },
  };
  const DEFAULT_META = { icon: '⚙', bg: 'linear-gradient(135deg,#8e8e93,#6e6e73)' };
  const DONE_BG = 'linear-gradient(135deg,#43c465,#2fa14e)';
  const AMBER_BG = 'linear-gradient(135deg,#f0a04a,#e07b28)';

  function shell(id) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = id;
    return el;
  }
  function head(icon, iconBg, title, sub, spinning) {
    return `<div class="card-head">
      <div class="card-icon" style="background:${iconBg}">${icon}</div>
      <div class="card-text">
        <div class="card-title">${esc(title)}</div>
        ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
      </div>
      ${spinning ? '<div class="card-spinner"></div>' : ''}
    </div>`;
  }
  function upsert(id, el, { autoRemoveMs } = {}) {
    const existing = cards.get(id);
    if (existing) { existing.el.replaceWith(el); clearTimeout(existing.timeout); }
    else container.appendChild(el);
    const rec = { el, timeout: null };
    if (autoRemoveMs) rec.timeout = setTimeout(() => remove(id), autoRemoveMs);
    cards.set(id, rec);
    const ids = [...cards.keys()];
    while (ids.length > 3) remove(ids.shift());
  }
  function remove(id) {
    const rec = cards.get(id);
    if (!rec) return;
    clearTimeout(rec.timeout);
    rec.el.classList.add('dropping');
    setTimeout(() => rec.el.remove(), 420);
    cards.delete(id);
  }

  // ---------- ephemeral tool feedback ----------
  function startTool(tool, summary) {
    const id = 'tool_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const meta = TOOL_META[tool] || DEFAULT_META;
    const el = shell(id);
    el.innerHTML = head(meta.icon, meta.bg, summary, null, true);
    upsert(id, el, { autoRemoveMs: 10000 });
    return id;
  }
  function finishTool(id) {
    const rec = cards.get(id);
    if (!rec) return;
    const title = rec.el.querySelector('.card-title')?.textContent || 'Done';
    const el = shell(id);
    el.innerHTML = head('✓', DONE_BG, title, null, false);
    upsert(id, el, { autoRemoveMs: 1800 });
  }

  // ---------- interactive menu ----------
  function showMenu(title, options) {
    const id = 'menu_' + Date.now();
    const el = shell(id);
    el.innerHTML = head('📌', TOOL_META.show_menu.bg, title, null, false) + `
      <div class="card-options">
        ${(options || []).map((o, i) => `
          <button class="card-opt" data-i="${i}">
            <div class="card-opt-text">
              <div class="card-opt-label">${esc(o.label)}</div>
              ${o.description ? `<div class="card-opt-sub">${esc(o.description)}</div>` : ''}
            </div>
            <div class="card-opt-cta">Choose</div>
          </button>`).join('')}
      </div>`;
    upsert(id, el); // waits for the user's pick
    el.querySelectorAll('.card-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const o = options[+btn.dataset.i];
        const confirmEl = shell(id);
        confirmEl.innerHTML = head('✓', DONE_BG, `You picked: ${o.label}`, title, false);
        upsert(id, confirmEl, { autoRemoveMs: 1800 });
        window.RT?.injectText(`I pick: "${o.label}" (from the "${title}" menu)`);
      });
    });
    return id;
  }

  // ---------- risky-action confirmation ----------
  function showConfirm(id, summary) {
    const cardId = 'confirm_' + id;
    const el = shell(cardId);
    el.innerHTML = head('⚠️', AMBER_BG, 'Approval needed', summary, false) + `
      <div class="card-options">
        <button class="card-opt" data-approve="true"><div class="card-opt-text"><div class="card-opt-label">Approve</div><div class="card-opt-sub">Do it now</div></div><div class="card-opt-cta">Go</div></button>
        <button class="card-opt" data-approve="false"><div class="card-opt-text"><div class="card-opt-label">Decline</div><div class="card-opt-sub">Cancel this action</div></div><div class="card-opt-cta">Cancel</div></button>
      </div>`;
    upsert(cardId, el);
    el.querySelectorAll('.card-opt').forEach((btn) => btn.addEventListener('click', () => {
      window.sparky.confirmResolve(id, btn.dataset.approve === 'true');
      remove(cardId);
    }));
    return cardId;
  }
  function resolveConfirm(id) { remove('confirm_' + id); }

  // ---------- ambient / proactive nudges ----------
  function showAmbient(text) {
    const id = 'ambient_' + Date.now();
    const el = shell(id);
    el.innerHTML = head('🔔', AMBER_BG, text.slice(0, 90), null, false);
    upsert(id, el, { autoRemoveMs: 9000 });
    el.addEventListener('click', () => remove(id));
  }

  window.Cards = { startTool, finishTool, showMenu, showConfirm, resolveConfirm, showAmbient, remove };

  // ================= timer pill =================
  const pill = document.getElementById('timer-pill');
  const pillText = document.getElementById('timer-text');
  let timers = [];
  let pillIv = null;
  function renderTimers(list) {
    timers = (list || []).slice().sort((a, b) => a.fireAt - b.fireAt);
    clearInterval(pillIv);
    if (!timers.length) { pill.hidden = true; return; }
    pill.hidden = false;
    const tick = () => {
      const t = timers[0];
      if (!t) { pill.hidden = true; clearInterval(pillIv); return; }
      const left = Math.max(0, Math.round((t.fireAt - Date.now()) / 1000));
      const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
      pillText.textContent = `${mm}:${ss}` + (timers.length > 1 ? `  +${timers.length - 1}` : '');
      if (left <= 0) { timers.shift(); if (!timers.length) { pill.hidden = true; clearInterval(pillIv); } }
    };
    tick();
    pillIv = setInterval(tick, 1000);
  }
  document.getElementById('timer-cancel').addEventListener('click', () => {
    const t = timers[0];
    if (t) window.sparky.runTool('timer_cancel', { id: t.id });
  });
  window.TimerPill = { render: renderTimers };

  // ================= ghost app window =================
  const ghost = document.getElementById('ghost-win');
  const ghostTitle = document.getElementById('ghost-title');
  const ghostAction = document.getElementById('ghost-action');
  const ghostBadge = document.getElementById('ghost-badge-text');
  let ghostHide = null;
  let lastApp = 'This Mac';
  function ghostShow(action, appName, dry) {
    if (appName) lastApp = appName;
    ghostTitle.textContent = lastApp;
    ghostAction.textContent = action;
    ghostBadge.textContent = dry ? 'Sparky is controlling · dry run' : 'Sparky is controlling this app';
    ghost.hidden = false;
    document.getElementById('stage').classList.add('ghost-open'); // face eases right, out of the way
    clearTimeout(ghostHide);
    ghostHide = setTimeout(ghostHideNow, 4000);
  }
  function ghostHideNow() {
    ghost.hidden = true;
    document.getElementById('stage').classList.remove('ghost-open');
  }
  window.Ghost = { show: ghostShow, hide: () => { clearTimeout(ghostHide); ghostHideNow(); } };
})();
