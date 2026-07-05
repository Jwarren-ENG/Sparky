// "Sparky's desk" — the right-side glass panel with Artifact / Plan / Memory /
// Log / Notes tabs. Rich content lands here; ephemeral feedback stays in cards.
import { esc } from './shared.js';

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const panel = $('panel');
  const pages = {};
  document.querySelectorAll('.ppage').forEach((p) => { pages[p.dataset.page] = p; });

  let open = false;
  let activeTab = 'artifact';
  const DOT_COLORS = ['#e0762e', '#4a90e2', '#7d5fc7'];

  // Mermaid is 3.5MB — load it only when a diagram actually arrives.
  let mermaidReady = null;
  function ensureMermaid() {
    if (window.mermaid) return Promise.resolve();
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../node_modules/mermaid/dist/mermaid.min.js';
      s.onload = () => {
        // useMaxWidth:false renders at natural size — panel scrolls, and the
        // expand affordance gives diagrams the full window.
        window.mermaid.initialize({
          startOnLoad: false, theme: 'neutral',
          flowchart: { useMaxWidth: false }, sequence: { useMaxWidth: false },
          gantt: { useMaxWidth: false }, journey: { useMaxWidth: false }, pie: { useMaxWidth: false },
        });
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return mermaidReady;
  }

  // ---------- open/close/tabs ----------
  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    stage.classList.toggle('panel-open', v);
  }
  function selectTab(name) {
    activeTab = name;
    document.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    Object.entries(pages).forEach(([k, el]) => el.classList.toggle('active', k === name));
  }
  function openTo(tab) { setOpen(true); selectTab(tab); }

  $('panel-btn').addEventListener('click', () => setOpen(!open));
  $('panel-close').addEventListener('click', () => { panel.classList.remove('fullscreen'); setOpen(false); });
  $('panel-expand').addEventListener('click', () => panel.classList.toggle('fullscreen'));
  document.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

  // ---------- empty states (straight from the design) ----------
  const EMPTIES = {
    artifact: '<div class="pempty"><div class="pempty-ic">&#9707;</div><p>Search results, images, drafts and diagrams appear here as Sparky works.</p></div>',
    plan: '<div class="pempty"><p>Give Sparky a multi-step goal and the checklist appears here &mdash; pause, resume or edit any step.</p></div>',
    memory: '<div class="pempty"><p>What Sparky believes about the current task shows up here &mdash; tap any line to correct it.</p></div>',
    log: '<div class="pempty"><p>Every action Sparky takes is logged here with one-click undo.</p></div>',
    notes: '<div class="pempty"><p>Say &ldquo;take a note&rdquo; and it lands here.</p></div>',
  };
  for (const [k, el] of Object.entries(pages)) el.innerHTML = EMPTIES[k];

  // ---------- Artifact tab ----------
  function renderArtifact(a) {
    const el = pages.artifact;
    if (a.kind === 'search') {
      el.innerHTML = `<div class="psection">Web results &middot; ${esc(a.title.replace(/^Web:\s*/, ''))}</div>` +
        a.results.map((r, i) => `
          <div class="pcard clickable" data-url="${esc(r.url)}">
            <div class="presult-head"><span class="presult-dot" style="background:${DOT_COLORS[i % 3]}"></span><span class="presult-title">${esc(r.title || r.url)}</span></div>
            <div class="presult-url">${esc(hostOf(r.url))}</div>
            <div class="presult-snip">${esc(r.snippet || '')}</div>
          </div>`).join('');
      el.querySelectorAll('[data-url]').forEach((x) => x.addEventListener('click', () => window.sparky.runTool('open_url', { url: x.dataset.url })));
    } else if (a.kind === 'weather') {
      const c = a.data.current, d = a.data.daily;
      // Clean SF-style line icons that match the widget, instead of emoji glyphs.
      const SUN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"></circle><line x1="8" y1="0.8" x2="8" y2="2.4"></line><line x1="8" y1="13.6" x2="8" y2="15.2"></line><line x1="0.8" y1="8" x2="2.4" y2="8"></line><line x1="13.6" y1="8" x2="15.2" y2="8"></line><line x1="2.9" y1="2.9" x2="4" y2="4"></line><line x1="12" y1="12" x2="13.1" y2="13.1"></line><line x1="13.1" y1="2.9" x2="12" y2="4"></line><line x1="4" y1="12" x2="2.9" y2="13.1"></line></svg>';
      const CLOUD = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 A 3 3 0 0 1 5 6.6 A 4 4 0 0 1 12.8 7.8 A 2.6 2.6 0 0 1 12.2 12.5 Z"></path></svg>';
      const RAIN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10 A 3 3 0 0 1 5 4.6 A 4 4 0 0 1 12.8 5.8 A 2.6 2.6 0 0 1 12.2 10 Z"></path><line x1="5.5" y1="12" x2="5" y2="14"></line><line x1="8.5" y1="12" x2="8" y2="14"></line><line x1="11.5" y1="12" x2="11" y2="14"></line></svg>';
      const icon = (p) => (p > 50 ? RAIN : p > 20 ? CLOUD : SUN);
      const day = (t) => new Date(t + 'T12:00').toLocaleDateString([], { weekday: 'short' });
      el.innerHTML = `<div class="pweather">
        <div class="pweather-city">${esc(a.data.place || a.title.replace(/^Weather — /, ''))}</div>
        <div class="pweather-temp">${Math.round(c.temperature_2m)}&deg;</div>
        <div class="pweather-cond">Feels ${Math.round(c.apparent_temperature)}&deg; &middot; H ${Math.round(d.temperature_2m_max[0])}&deg; &middot; L ${Math.round(d.temperature_2m_min[0])}&deg;</div>
        <div class="pweather-row">${d.time.map((t, i) => `
          <div class="pweather-day"><span class="d">${day(t)}</span><span class="i">${icon(d.precipitation_probability_max[i])}</span><span class="h">${Math.round(d.temperature_2m_max[i])}&deg;</span></div>`).join('')}
        </div></div>`;
    } else if (a.kind === 'image' || a.kind === 'image_loading') {
      el.innerHTML = `<div class="psection">${esc(a.title)}</div><div class="prich">${a.kind === 'image' ? `<img src="file://${esc(a.path)}?t=${Date.now()}">` : '<div class="pempty"><div class="pempty-ic" style="animation: spin 1s linear infinite;">&#9696;</div><p>Generating&hellip;</p></div>'}</div>`;
    } else if (a.kind === 'mermaid') {
      el.innerHTML = `<div class="psection">${esc(a.title)} <span class="psection-hint">tap diagram to expand</span></div><div class="prich"><div class="mermaid-holder"><pre>${esc(a.code)}</pre></div></div>`;
      ensureMermaid().then(() => window.mermaid.render(`pm_${Date.now()}`, a.code)).then(({ svg }) => {
        const h = el.querySelector('.mermaid-holder');
        if (h) { h.innerHTML = svg; h.addEventListener('click', () => panel.classList.toggle('fullscreen')); }
      }).catch(() => {});
    } else if (a.kind === 'code') {
      el.innerHTML = `<div class="psection">${esc(a.title)}</div><div class="prich"><pre>${esc(a.content)}</pre></div>`;
    } else if (a.kind === 'doc' || a.kind === 'markdown') {
      el.innerHTML = `<div class="psection">${esc(a.title)}</div><div class="prich"><div class="doc">${window.marked ? marked.parse(a.content || '') : esc(a.content)}</div></div>`;
    } else if (a.kind === 'table') {
      const rows = a.rows || [];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 6);
      el.innerHTML = `<div class="psection">${esc(a.title)}</div><div class="prich"><div class="pcard">` + (rows.length
        ? `<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${rows.slice(0, 30).map((r) => `<tr>${cols.map((c) => `<td>${esc(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</table>`
        : '<p style="opacity:.55;font-size:13px;margin:0">Empty table.</p>') + '</div></div>';
    } else if (a.kind === 'calendar') {
      el.innerHTML = `<div class="psection">${esc(a.title)}</div>` + (a.events.length
        ? a.events.map((e) => `<div class="pcard"><div style="font-size:13.5px;font-weight:600;color:#1d1d1f">${esc(e.title)}</div><div style="font-size:11.5px;color:rgba(60,60,67,.5);margin-top:2px">${esc(e.start)} &middot; ${esc(e.calendar || '')}</div></div>`).join('')
        : '<div class="pempty"><p>No events.</p></div>');
    } else if (a.kind === 'email') {
      el.innerHTML = `<div class="psection">${esc(a.title)}</div>` + a.emails.map((e) => `<div class="pcard"><div style="font-size:13.5px;font-weight:600;color:#1d1d1f">${e.unread ? '&#128994; ' : ''}${esc(e.subject)}</div><div style="font-size:11.5px;color:rgba(60,60,67,.5);margin-top:2px">#${e.index} &middot; ${esc(e.sender)}</div></div>`).join('');
    } else if (a.kind === 'files') {
      el.innerHTML = `<div class="psection">${esc(a.title)}</div>` + a.files.map((f) => `<div class="pcard clickable" data-file="${esc(f)}"><div style="font-size:13.5px;font-weight:600;color:#0b57b4">${esc(f.split('/').pop())}</div><div style="font-size:11.5px;color:rgba(60,60,67,.5);margin-top:2px">${esc(f)}</div></div>`).join('');
      el.querySelectorAll('[data-file]').forEach((x) => x.addEventListener('click', () => window.sparky.runTool('open_file', { path: x.dataset.file })));
    } else if (a.kind === 'clipboard') {
      el.innerHTML = `<div class="psection">Clipboard history</div>` + a.items.map((i) => `<div class="pcard"><div style="font-size:11px;color:rgba(60,60,67,.45)">${esc(new Date(i.time).toLocaleTimeString())}</div><div style="font-size:12.5px;color:rgba(29,29,31,.8);margin-top:3px">${esc((i.text || '').slice(0, 200))}</div></div>`).join('');
    } else if (a.kind === 'memory') {
      el.innerHTML = `<div class="psection">Long-term memory</div>` + a.items.map((i) => `<div class="pcard"><div style="font-size:12.5px;color:rgba(29,29,31,.85)"><b>[${esc(i.type)}]</b> ${esc(i.text)}</div></div>`).join('');
    } else {
      el.innerHTML = `<div class="psection">${esc(a.title || a.kind)}</div><div class="prich"><pre>${esc(JSON.stringify(a, null, 2))}</pre></div>`;
    }
    openTo('artifact');
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

  // ---------- Plan tab ----------
  function renderPlan(plan) {
    const el = pages.plan;
    if (!plan || ['done', 'cancelled'].includes(plan.status) && !plan.steps.length) { el.innerHTML = EMPTIES.plan; return; }
    if (!plan.steps) { el.innerHTML = EMPTIES.plan; return; }
    const live = ['running', 'paused'].includes(plan.status);
    el.innerHTML = `
      <div class="pplan-head">
        <div class="pplan-title">${esc(plan.goal)}</div>
        <div class="pplan-actions">
          ${plan.status === 'running' ? '<button data-a="pause">Pause</button>' : ''}
          ${plan.status === 'paused' ? '<button data-a="resume">Resume</button>' : ''}
          ${live ? '<button class="cancel" data-a="cancel">&#215;</button>' : ''}
        </div>
      </div>
      ${plan.steps.map((s, i) => {
        const st = s.status === 'done' ? '<span class="st-done">&#10003;</span>'
          : s.status === 'running' ? '<span class="st-active"></span>'
          : s.status === 'failed' ? '<span class="st-failed">&#215;</span>'
          : '<span class="st-pending"></span>';
        return `<div class="pstep ${s.status === 'done' ? 'done' : ''}">${st}<span class="txt" contenteditable="true" data-i="${i}">${esc(s.text)}</span></div>`;
      }).join('')}`;
    el.querySelectorAll('.pplan-actions button').forEach((b) => b.addEventListener('click', () => window.sparky.planControl({ action: b.dataset.a })));
    el.querySelectorAll('.pstep .txt').forEach((t) => t.addEventListener('blur', () => window.sparky.planControl({ action: 'edit_step', index: +t.dataset.i, text: t.textContent.trim() })));
    if (live) openTo('plan');
  }

  // ---------- Memory tab (working memory) ----------
  function renderWorkingMemory(beliefs) {
    const el = pages.memory;
    if (!beliefs?.length) { el.innerHTML = EMPTIES.memory; return; }
    el.innerHTML = `<div class="psection">What Sparky believes right now</div>` +
      beliefs.map((b) => `<div class="pmem"><span class="dot"></span><span class="txt" contenteditable="true">${esc(b)}</span><span class="hint">edit</span></div>`).join('');
    const send = () => {
      const vals = [...el.querySelectorAll('.pmem .txt')].map((n) => n.textContent.trim()).filter(Boolean);
      window.sparky.wmCorrect(vals);
    };
    el.querySelectorAll('.pmem .txt').forEach((n) => n.addEventListener('blur', send));
  }

  // ---------- Log tab ----------
  function logRowHTML(i) {
    return `<div class="plog">
      <span class="t">${esc(new Date(i.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>
      <span class="txt">${i.dryRun ? '<b style="color:#e0762e">[dry]</b> ' : ''}${esc(i.summary)}</span>
      ${i.canUndo ? `<button data-id="${i.id}">Undo</button>` : ''}
    </div>`;
  }
  function wireUndo(scope) {
    scope.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => window.sparky.runTool('undo_action', { id: b.dataset.id }), { once: true }));
  }
  function renderLog(items) {
    const el = pages.log;
    if (!items?.length) { el.innerHTML = EMPTIES.log; return; }
    el.innerHTML = items.slice(0, 60).map(logRowHTML).join('');
    wireUndo(el);
  }
  // Delta path: one IPC message → one prepended row (no full re-render).
  function appendLog(entry) {
    const el = pages.log;
    if (el.querySelector('.pempty')) el.innerHTML = '';
    el.insertAdjacentHTML('afterbegin', logRowHTML(entry));
    wireUndo(el.firstElementChild);
    while (el.children.length > 60) el.lastElementChild.remove();
  }

  // ---------- Notes tab ----------
  function renderNotes(items) {
    const el = pages.notes;
    if (!items?.length) { el.innerHTML = EMPTIES.notes; return; }
    el.innerHTML = items.map((n) => `
      <div class="pnote ${n.done ? 'done' : ''}">
        <span>${esc(n.emoji || '\u{1F4DD}')}</span><span class="txt">${esc(n.text)}</span>
        <button data-act="done" data-id="${n.id}" title="toggle">&#10003;</button>
        <button data-act="del" data-id="${n.id}" title="delete">&#128465;</button>
      </div>`).join('');
    el.querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () =>
      window.sparky.runTool(b.dataset.act === 'done' ? 'note_done' : 'note_delete', { id: b.dataset.id })));
  }

  export const Panel = { setOpen, openTo, renderArtifact, renderPlan, renderWorkingMemory, renderLog, appendLog, renderNotes, isOpen: () => open };

