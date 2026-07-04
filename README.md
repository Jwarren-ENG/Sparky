# Sparky ⚡

A Jarvis-like desktop AI companion for macOS. Real-time voice via OpenAI
`gpt-realtime-2` (WebRTC), an animated face, an artifact panel, persistent
memory, a task engine, proactive nudges, and (careful) computer control.

## Opening & closing (no terminal needed)

- **Open**: double-click **Sparky** in `/Applications`, click its Dock icon, or find it in Spotlight. Also summonable anywhere with **⌘⇧S**. (The Electron runtime bundle itself is branded as Sparky and always boots Sparky — pin either icon to the Dock, both work.)
- **Note**: running `npm install`/updating the `electron` package rebuilds its bundle and removes the embedded launcher shim — if the Dock icon ever shows Electron's welcome screen after an update, run `npm run shim` to re-apply it.
- **Close (red button)**: hides the window — Sparky keeps running in the Dock. Click the Dock icon or press ⌘⇧S to bring it back.
- **Minimize (yellow button)**: standard macOS minimize.
- **Quit fully**: right-click the Dock icon → Quit, or **⌘Q** in the app.

## Setup (first time / development)

```bash
npm install
npm start
```

Your OpenAI key lives in `.env` as `OPENAI_API_KEY` (already configured, git-ignored).
Optional extras in `.env`:

- `EXA_API_KEY` — enables web search (get one at https://exa.ai)
- `REALTIME_MODEL` / `VOICE` / `UTILITY_MODEL` — model overrides. If your
  account doesn't have `gpt-realtime-2` yet, Sparky automatically falls back
  to `gpt-realtime`.

### macOS permissions (grant when prompted)

| Permission | Needed for |
|---|---|
| Microphone | voice + wake word |
| Accessibility (System Settings → Privacy & Security) | typing, keys, UI inspection |
| Screen Recording | `read_screen` / screenshot-to-answer |
| Automation → Calendar / Mail | calendar + email tools, proactive nudges |

For pixel-accurate mouse clicks, install cliclick: `brew install cliclick`
(typing, keys, scrolling, and app launching work without it).

## Using Sparky

- **Talk**: click **🎙 Talk**, or say **“Hey Sparky”** while in standby, or press **⌘⇧S** anywhere to summon/hide the window.
- **Interrupt freely** — just start talking over it.
- **Artifact panel**: the ◧ button expands it (⛶ for fullscreen). Tools push web results, images, Mermaid diagrams, drafts, code, tables, weather, calendars, and email lists there. Tabs: Artifact · Plan · Working memory · Action log · Notes.
- **Memory**: say “remember that …”, “what do you remember about …?”, “forget …”. Working-memory tab shows its live beliefs about the current task — click a line to correct it.
- **Task engine**: give it a multi-step goal; a checklist appears in the Plan tab with Pause / Resume / Cancel, and step text is editable in place.
- **Safety**: risky actions (deleting records, creating events, sending anything, purchases, private info) pause for your explicit approval — verbally or with the Approve/Decline buttons. Everything is logged in the Action log with one-click undo where possible. **Dry-run mode** (Settings ⚙︎) previews computer-control actions instead of executing them.
- **Proactivity**: every few minutes Sparky checks for imminent calendar events, urgent-looking unread email, and paused plans, and speaks up — unless **quiet hours** (Settings) are active.

## Try these to test each system

1. Voice: “Good morning Sparky, what can you do?”
2. Memory: “Remember that my name is Jacob and I like short answers.” → end session, reconnect → it should greet you by name.
3. Artifacts: “Make me a mermaid diagram of a login flow.” / “Generate an image of a neon robot.”
4. Task engine: “Plan a weekend trip to Austin — research, budget, itinerary.” Then hit Pause mid-run.
5. Computer control (turn on dry-run first): “Open Safari and search for coffee grinders.”
6. Screenshot: put an error on screen → “What’s this error?”
7. Tools: “What’s the weather?” · “Note to buy oat milk.” · “Set a timer for 1 minute.” · “Show your action log.”

## Data

Everything lives in `data/` (git-ignored): memory, notes, database tables,
action log, clipboard history, timers, settings. Generated images and
screenshots go to `artifacts/`.
