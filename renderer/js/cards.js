// Dynamic action cards: float in as Sparky does things, disappear when done.
(() => {
  const container = document.getElementById('cards');
  const cards = new Map(); // id -> { el, timeout }

  const ICONS = {
    'web_search': '🔍',
    'generate_image': '🎨',
    'open_app': '📱',
    'computer_click': '🖱',
    'computer_type': '⌨',
    'computer_key': '⌨',
    'computer_scroll': '📜',
    'read_screen': '📸',
    'ui_inspect': '🔎',
    'note_add': '📝',
    'db_upsert': '💾',
    'db_search': '🔍',
    'calendar_create': '📅',
    'email_draft': '✉',
    'remember': '🧠',
    'timer_set': '⏱',
    'plan_create': '📋',
    'show_menu': '📌',
    'set_mode': '⌨',
  };

  function addCard(id, tool, summary) {
    if (cards.has(id)) removeCard(id);

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-icon spinner">${ICONS[tool] || '⚙'}</div>
      <div class="card-text">${summary.slice(0, 100)}</div>
    `;
    container.appendChild(card);
    cards.set(id, { el: card, timeout: null });

    // Auto-remove after 6 seconds if not marked done
    const timeout = setTimeout(() => removeCard(id), 6000);
    cards.get(id).timeout = timeout;
  }

  function markDone(id) {
    const c = cards.get(id);
    if (!c) return;
    c.el.classList.add('done');
    c.el.innerHTML = `
      <div class="card-icon">✓</div>
      <div class="card-text">${c.el.querySelector('.card-text').textContent}</div>
      <div class="card-check">✓</div>
    `;
    clearTimeout(c.timeout);
    c.timeout = setTimeout(() => removeCard(id), 2000);
    cards.set(id, c);
  }

  function removeCard(id) {
    const c = cards.get(id);
    if (!c) return;
    clearTimeout(c.timeout);
    c.el.style.animation = 'none'; // Stop animation
    setTimeout(() => c.el.remove(), 50);
    cards.delete(id);
  }

  function showToolRunning(tool, summary) {
    const id = 'tool_' + Date.now();
    addCard(id, tool, summary);
    return id;
  }

  window.Cards = { addCard, markDone, removeCard, showToolRunning };
})();
