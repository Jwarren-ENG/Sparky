// Shared presentation constants — the single source for escaping, tool
// icons/gradients, and outcome colors. Do not duplicate these per-module.

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const DONE_BG = 'linear-gradient(135deg,#43c465,#2fa14e)';
export const AMBER_BG = 'linear-gradient(135deg,#f0a04a,#e07b28)';
export const DEFAULT_META = { icon: '⚙', bg: 'linear-gradient(135deg,#8e8e93,#6e6e73)' };

export const svgSun = (size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3.2"></circle><line x1="8" y1="0.8" x2="8" y2="2.4"></line><line x1="8" y1="13.6" x2="8" y2="15.2"></line><line x1="0.8" y1="8" x2="2.4" y2="8"></line><line x1="13.6" y1="8" x2="15.2" y2="8"></line><line x1="2.9" y1="2.9" x2="4" y2="4"></line><line x1="12" y1="12" x2="13.1" y2="13.1"></line><line x1="13.1" y1="2.9" x2="12" y2="4"></line><line x1="4" y1="12" x2="2.9" y2="13.1"></line></svg>`;
export const svgCloud = (size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 A 3 3 0 0 1 5 6.6 A 4 4 0 0 1 12.8 7.8 A 2.6 2.6 0 0 1 12.2 12.5 Z"></path></svg>`;
export const svgRain = (size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10 A 3 3 0 0 1 5 4.6 A 4 4 0 0 1 12.8 5.8 A 2.6 2.6 0 0 1 12.2 10 Z"></path><line x1="5.5" y1="12" x2="5" y2="14"></line><line x1="8.5" y1="12" x2="8" y2="14"></line><line x1="11.5" y1="12" x2="11" y2="14"></line></svg>`;

const BLUE = 'linear-gradient(135deg,#4a90e2,#0071e3)';
const INDIGO = 'linear-gradient(135deg,#5b8def,#3b5fd9)';
const PURPLE = 'linear-gradient(135deg,#a78bda,#7d5fc7)';
const RED = 'linear-gradient(135deg,#e2665a,#c94c40)';

export const TOOL_META = {
  web_search: { icon: '🔍', bg: BLUE },
  generate_image: { icon: '🎨', bg: PURPLE },
  show_mermaid: { icon: '📊', bg: BLUE },
  show_artifact: { icon: '📄', bg: BLUE },
  weather: { icon: svgSun(17), bg: AMBER_BG },
  open_app: { icon: '◳', bg: INDIGO },
  open_file: { icon: '📄', bg: INDIGO },
  computer_click: { icon: '🖱', bg: INDIGO },
  computer_click_element: { icon: '🖱', bg: INDIGO },
  computer_type: { icon: '⌨', bg: INDIGO },
  computer_key: { icon: '⌨', bg: INDIGO },
  computer_scroll: { icon: '📜', bg: INDIGO },
  run_workflow: { icon: '⚡', bg: INDIGO },
  read_screen: { icon: '📸', bg: INDIGO },
  ui_inspect: { icon: '🔎', bg: INDIGO },
  set_mode: { icon: '⌨', bg: INDIGO },
  browser_tabs: { icon: '🌐', bg: BLUE },
  browser_read_page: { icon: '🌐', bg: BLUE },
  browser_open_tab: { icon: '🌐', bg: BLUE },
  note_add: { icon: '📝', bg: AMBER_BG },
  db_upsert: { icon: '💾', bg: BLUE },
  db_delete: { icon: '🗑', bg: RED },
  calendar_create: { icon: '📅', bg: RED },
  calendar_events: { icon: '📅', bg: RED },
  email_draft: { icon: '✉', bg: BLUE },
  remember: { icon: '🧠', bg: PURPLE },
  recall: { icon: '🧠', bg: PURPLE },
  forget: { icon: '🧠', bg: PURPLE },
  show_menu: { icon: '📌', bg: PURPLE },
  timer_set: { icon: '⏱', bg: AMBER_BG },
  file_search: { icon: '📁', bg: BLUE },
  plan_create: { icon: '📋', bg: INDIGO },
};
