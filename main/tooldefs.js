// Function schemas exposed to the Realtime model.
const P = (props, required = []) => ({ type: 'object', properties: props, required });
const S = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'number', description });
const B = (description) => ({ type: 'boolean', description });

const TOOLS = [
  // ---- knowledge & artifacts ----
  { name: 'web_search', description: 'Search the web via Exa. Results are shown in the artifact panel.', parameters: P({ query: S('search query'), num_results: N('how many results, default 6') }, ['query']) },
  { name: 'generate_image', description: 'Generate an image with GPT Image and show it in the artifact panel.', parameters: P({ prompt: S('image description'), size: S('1024x1024 | 1536x1024 | 1024x1536') }, ['prompt']) },
  { name: 'show_mermaid', description: 'Render a Mermaid diagram in the artifact panel.', parameters: P({ code: S('mermaid source'), title: S('short title') }, ['code']) },
  { name: 'show_artifact', description: 'Show content in the artifact panel: a drafted document, message, code snippet, or markdown. Use this whenever you draft something.', parameters: P({ kind: S('one of: doc | message | code | markdown'), title: S('short title'), content: S('the content'), language: S('code language if kind=code') }, ['kind', 'title', 'content']) },
  { name: 'weather', description: 'Current weather + short forecast for a city (or the local area if omitted).', parameters: P({ city: S('city name, optional') }) },

  // ---- notes ----
  { name: 'note_add', description: 'Add a note to the fun notes list.', parameters: P({ text: S('note text'), emoji: S('a single fitting emoji') }, ['text']) },
  { name: 'note_list', description: 'Show all notes in the artifact panel.', parameters: P({}) },
  { name: 'note_done', description: 'Toggle a note done/undone by id.', parameters: P({ id: S('note id') }, ['id']) },
  { name: 'note_delete', description: 'Delete a note by id.', parameters: P({ id: S('note id') }, ['id']) },

  // ---- database ----
  { name: 'db_upsert', description: 'Create or update a record in a named table. Records are free-form JSON objects.', parameters: P({ table: S('table name'), record: { type: 'object', description: 'fields; include "id" to update an existing record' } }, ['table', 'record']) },
  { name: 'db_search', description: 'Search records in a table (substring match across fields), or list all tables if table omitted.', parameters: P({ table: S('table name, optional'), query: S('search text, optional') }) },
  { name: 'db_delete', description: 'Delete a record. RISKY: requires user confirmation via confirm_action.', parameters: P({ table: S('table name'), id: S('record id') }, ['table', 'id']) },

  // ---- memory ----
  { name: 'remember', description: 'Store a durable fact/preference about the user or the world in long-term memory.', parameters: P({ text: S('the fact, phrased in third person'), type: S('fact | preference | task'), tags: { type: 'array', items: { type: 'string' } } }, ['text']) },
  { name: 'recall', description: 'Search long-term memory.', parameters: P({ query: S('what to look for') }, ['query']) },
  { name: 'forget', description: 'Delete memories matching an id or substring. Confirm with the user first for broad matches.', parameters: P({ id_or_text: S('memory id, or substring of the memory text') }, ['id_or_text']) },
  { name: 'memory_list', description: 'Show everything in long-term memory in the artifact panel.', parameters: P({}) },
  { name: 'working_memory_set', description: 'Replace the working-memory panel: your current beliefs about the active task. Keep to <=8 short bullets. Update whenever your understanding changes.', parameters: P({ beliefs: { type: 'array', items: { type: 'string' } } }, ['beliefs']) },

  // ---- task engine ----
  { name: 'plan_create', description: 'For multi-step goals: create a visible checklist plan, then work through it, narrating briefly.', parameters: P({ goal: S('the goal'), steps: { type: 'array', items: { type: 'string' } } }, ['goal', 'steps']) },
  { name: 'plan_update', description: 'Update a plan step: mark running/done/failed/skipped, optionally add a note or edit text.', parameters: P({ index: N('0-based step index'), status: S('pending | running | done | failed | skipped'), note: S('optional short note'), text: S('optional new step text') }, ['index']) },
  { name: 'plan_finish', description: 'Mark the plan finished (or cancelled).', parameters: P({ outcome: S('done | cancelled') }, ['outcome']) },

  // ---- interactive menu ----
  { name: 'show_menu', description: 'Show a clickable menu of options in the artifact panel whenever you offer the user a set of choices. Their pick comes back as a user message. Prefer this over listing options aloud.', parameters: P({ title: S('menu title'), options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] } } }, ['title', 'options']) },

  // ---- computer control ----
  { name: 'set_mode', description: 'Switch between "display" mode (default) and "computer" mode. Computer-control tools (open_app, click, type, keys, scroll, workflows) only work in computer mode. Switch when the user asks you to control the computer; announce the switch briefly.', parameters: P({ mode: S('display | computer') }, ['mode']) },
  { name: 'open_app', description: 'Open a macOS application by name (e.g. "Safari", "Notes"). Requires computer mode.', parameters: P({ name: S('app name') }, ['name']) },
  { name: 'open_url', description: 'Open a URL in the default browser.', parameters: P({ url: S('https URL') }, ['url']) },
  { name: 'open_file', description: 'Open a local file or folder in its default application.', parameters: P({ path: S('absolute path to the file or folder') }, ['path']) },
  { name: 'computer_click_element', description: 'Click a UI element by its title (from ui_inspect). ALWAYS prefer this over computer_click — element targeting is reliable, pixel coordinates are not.', parameters: P({ title: S('element title/name, exact or partial'), role: S('optional AX role filter, e.g. AXButton') }, ['title']) },
  { name: 'computer_click', description: 'Click at raw screen coordinates. Fallback only — prefer computer_click_element. Use ui_inspect first to find real coordinates.', parameters: P({ x: N('screen x'), y: N('screen y'), double: B('double click') }, ['x', 'y']) },
  { name: 'computer_type', description: 'Type text into the focused control.', parameters: P({ text: S('text to type') }, ['text']) },
  { name: 'computer_key', description: 'Press a key or shortcut, e.g. "return", "tab", "cmd+s", "cmd+shift+t".', parameters: P({ combo: S('key combo') }, ['combo']) },
  { name: 'computer_scroll', description: 'Scroll the frontmost window.', parameters: P({ direction: S('up | down'), amount: N('lines, default 5') }, ['direction']) },
  { name: 'read_screen', description: 'Take a screenshot and answer a question about what is on screen (also good for "what is this error?").', parameters: P({ question: S('what to look for / answer') }, ['question']) },
  { name: 'ui_inspect', description: 'List interactive UI elements of the frontmost window as structured data (role, title, position, size). Call this before clicking anything, then use computer_click_element.', parameters: P({}) },
  { name: 'run_workflow', description: 'Run a short sequence of computer-control steps (open_app/click/type/key/scroll) as one workflow. Respects dry-run mode.', parameters: P({ description: S('what this workflow does'), steps: { type: 'array', items: { type: 'object' }, description: 'each: {tool, args}' } }, ['description', 'steps']) },

  // ---- browser (Safari/Chrome via AppleScript — no computer mode needed for reading) ----
  { name: 'browser_tabs', description: 'List open tabs (title + URL) in Safari and Chrome.', parameters: P({}) },
  { name: 'browser_read_page', description: 'Read the text content of the frontmost browser tab. Use for "summarize this page", "what am I reading".', parameters: P({ browser: S('safari | chrome — optional, defaults to whichever is running') }) },
  { name: 'browser_open_tab', description: 'Open a URL in a new browser tab.', parameters: P({ url: S('https URL'), browser: S('safari | chrome — optional') }, ['url']) },

  // ---- confirmation & safety ----
  { name: 'confirm_action', description: 'Execute (or cancel) a pending risky action after the user explicitly said yes or no out loud.', parameters: P({ id: S('pending action id'), approved: B('true only if the user clearly approved') }, ['id', 'approved']) },
  { name: 'undo_action', description: 'Undo a logged action by its action-log id, where undo is possible.', parameters: P({ id: S('action log id') }, ['id']) },
  { name: 'action_log_show', description: 'Show the action log in the artifact panel.', parameters: P({}) },

  // ---- calendar & email (macOS Calendar.app / Mail.app) ----
  { name: 'calendar_events', description: 'List upcoming calendar events for the next N days.', parameters: P({ days: N('default 3') }) },
  { name: 'calendar_create', description: 'Create a calendar event. RISKY: requires confirm_action.', parameters: P({ title: S('event title'), start_iso: S('start datetime ISO'), minutes: N('duration, default 30'), calendar: S('calendar name, optional') }, ['title', 'start_iso']) },
  { name: 'email_list', description: 'List recent inbox emails (subject, sender, unread).', parameters: P({ count: N('default 10'), unread_only: B('only unread') }) },
  { name: 'email_read', description: 'Read the body of an inbox email by its list index (from email_list).', parameters: P({ index: N('1-based index in inbox') }, ['index']) },
  { name: 'email_draft', description: 'Create a draft email in Mail.app (never sends). Sending is up to the user.', parameters: P({ to: S('recipient'), subject: S('subject'), body: S('body') }, ['to', 'subject', 'body']) },

  // ---- misc utilities ----
  { name: 'clipboard_history', description: 'Show recent clipboard entries.', parameters: P({ count: N('default 10') }) },
  { name: 'file_search', description: 'Search files on this Mac by name or content (Spotlight).', parameters: P({ query: S('search terms'), kind: S('optional: name-only | content') }, ['query']) },
  { name: 'timer_set', description: 'Set a timer or reminder. Sparky will speak up when it fires.', parameters: P({ label: S('what for'), seconds: N('seconds from now (for timers)'), at_iso: S('absolute time ISO (for reminders)') }, ['label']) },
  { name: 'timer_list', description: 'List active timers/reminders.', parameters: P({}) },
  { name: 'timer_cancel', description: 'Cancel a timer by id.', parameters: P({ id: S('timer id') }, ['id']) },
  { name: 'set_mood', description: 'Set your face mood: neutral | happy | excited | focused | sheepish | concerned.', parameters: P({ mood: S('the mood') }, ['mood']) },
  { name: 'mic_control', description: 'Mute or unmute your microphone when the user asks ("stop listening", "mute yourself", "unmute"). While muted, "Hey Sparky" or the mic button unmutes.', parameters: P({ muted: B('true to mute, false to unmute') }, ['muted']) },
  { name: 'settings_get', description: 'Read Sparky settings (dry run, quiet hours, wake word, proactivity).', parameters: P({}) },
  { name: 'settings_set', description: 'Change a Sparky setting. RISKY for quietHours/proactivity changes only if user asked.', parameters: P({ key: S('dryRun | wakeWord | proactivity | quietHours | userName | proactiveIntervalMin'), value: { description: 'new value (bool, string, number, or {enabled,start,end} for quietHours)' } }, ['key']) },
];

const RISKY_TOOLS = new Set(['db_delete', 'calendar_create']);
// Heuristics for risky content routed through generic tools:
const RISKY_HINT = 'Anything that sends a message, deletes data, spends money, changes account settings, or shares private information MUST go through a pending confirmation: describe it, wait for a clear verbal yes, then call confirm_action.';

module.exports = { TOOLS: TOOLS.map(t => ({ type: 'function', ...t })), RISKY_TOOLS, RISKY_HINT };
