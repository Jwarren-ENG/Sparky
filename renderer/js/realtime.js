// Realtime voice session over WebRTC. Tool calls run async in the main
// process so the conversation stays live while tools work.
import { Face } from './face.js';
import { Cards, Ghost } from './cards.js';
import { AppState } from './state.js';

  let pc = null, dc = null, micStream = null;
  let connected = false;
  let activeResponse = false;
  let pendingResponseKick = false;   // response.create queued behind an active response
  let userEnded = false;             // distinguishes ⏹ from network drops
  let reconnectUsed = false;         // one silent reconnect per drop
  let assistantBuf = '';             // streaming caption accumulator
  const transcript = [];             // rolling session transcript → episodic memory
  const runningTools = new Set();

  const audioEl = document.getElementById('remote-audio');
  const listeners = { status: [], caption: [], connected: [], disconnected: [] };
  const emit = (ev, ...a) => listeners[ev].forEach(f => f(...a));

  // Mouth sync from remote audio: frequency bands → viseme-ish mouth shape
  // (low energy rounds the mouth, mids open it, highs stretch it / show teeth).
  let audioCtx = null, analyser = null;
  let mouth = { open: 0, width: 0.2, round: 0, teeth: 0 };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function bandAvg(freq, s, e) {
    let sum = 0; const end = Math.min(e, freq.length);
    for (let i = s; i < end; i++) sum += freq[i];
    return end > s ? sum / (end - s) / 255 : 0;
  }
  function attachAnalyser(stream) {
    audioCtx = audioCtx || new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    (function loop() {
      if (!analyser) return;
      analyser.getByteTimeDomainData(samples);
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) { const d = (samples[i] - 128) / 128; sum += d * d; }
      const energy = clamp01(Math.sqrt(sum / samples.length) * 10.5);
      const low = clamp01(bandAvg(freq, 2, 14) * 2.2);
      const mid = clamp01(bandAvg(freq, 14, 48) * 2.1);
      const high = clamp01(bandAvg(freq, 48, 110) * 2.8);
      const target = {
        open: clamp01(energy * 0.75 + mid * 0.45 - high * 0.16),
        width: clamp01(0.28 + mid * 0.55 + high * 0.74 - low * 0.28),
        round: clamp01(0.08 + low * 0.95 + energy * 0.1 - high * 0.42),
        teeth: clamp01(high * 1.4 + mid * 0.25 - low * 0.35),
      };
      for (const k of Object.keys(mouth)) mouth[k] = lerp(mouth[k], target[k], 0.36);
      Face.setMouthShape(mouth);
      requestAnimationFrame(loop);
    })();
  }

  function send(obj) { if (dc?.readyState === 'open') dc.send(JSON.stringify(obj)); }

  // Never create a response while the user is mid-utterance — it would occupy
  // the response slot and the server then silently skips responding to their
  // turn (the "I have to ask twice" bug).
  let userSpeaking = false;
  let pendingUserTurn = false;   // a committed user turn that has no response yet
  let watchdog = null;

  function kickResponse() {
    if (activeResponse || userSpeaking) { pendingResponseKick = true; return; }
    send({ type: 'response.create' });
  }

  // Guarantee: every committed user turn (and every queued tool-output kick)
  // gets a response within ~1s, even if the server-side VAD's auto-response
  // was suppressed by a collision.
  function ensureResponseSoon() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (connected && !activeResponse && !userSpeaking && (pendingUserTurn || pendingResponseKick)) {
        console.log('[watchdog] recovering dropped turn');
        pendingUserTurn = false; pendingResponseKick = false;
        send({ type: 'response.create' });
      }
    }, 1000);
  }

  let micEnabled = true;
  let audioSender = null; // RTCRtpSender — hard mute detaches the track entirely

  async function connect(opts = {}) {
    if (connected) return { ok: true };
    micEnabled = opts.micEnabled !== false;
    emit('status', 'connecting…', 'thinking');
    try {
      const sec = await window.sparky.getSecret();
      if (!sec.ok) throw new Error('session error: ' + (sec.error || 'could not create session'));

      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        throw new Error('microphone unavailable — check System Settings → Privacy → Microphone');
      }
      micStream.getTracks().forEach(t => { t.enabled = micEnabled; });
      pc = new RTCPeerConnection();
      micStream.getTracks().forEach(t => { audioSender = pc.addTrack(t, micStream); });
      pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; attachAnalyser(e.streams[0]); };

      // connect() must not resolve until the data channel is actually open —
      // otherwise the first typed message is sent into a closed channel.
      let dcOpenResolve;
      const dcOpen = new Promise((res, rej) => {
        dcOpenResolve = res;
        setTimeout(() => rej(new Error('connection timed out')), 15000);
      });

      dc = pc.createDataChannel('oai-events');
      dc.onmessage = (e) => handleEvent(JSON.parse(e.data));
      dc.onopen = () => {
        connected = true;
        emit('connected');
        emit('status', micEnabled ? 'Listening' : 'Ready', micEnabled ? 'listening' : 'idle');
        if (micEnabled) Face.setMode('listening');
        // Greeting only for voice sessions — typed sessions answer the typed message instead.
        if (micEnabled) send({ type: 'response.create' });
        dcOpenResolve();
      };
      dc.onclose = () => {
        const wasLive = connected;
        const mic = micEnabled;
        teardown('channel closed');
        // Unexpected drop mid-session → one silent reconnect attempt.
        if (wasLive && !userEnded && !reconnectUsed) {
          reconnectUsed = true;
          emit('status', 'Reconnecting…', 'thinking');
          setTimeout(async () => {
            const r = await connect({ micEnabled: mic });
            if (r.ok) send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: '[session resumed after a brief disconnect — continue naturally, no need to mention it]' }] } });
          }, 800);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(sec.model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sec.secret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!resp.ok) throw new Error('connection failed: ' + (await resp.text()).slice(0, 200));
      await pc.setRemoteDescription({ type: 'answer', sdp: await resp.text() });
      await dcOpen; // fully usable before we return
      return { ok: true };
    } catch (e) {
      // Full cleanup on any startup failure — never leave the UI stuck on "connecting".
      console.error('connect failed:', e);
      teardown('connect failed');
      Face.setMood('concerned');
      emit('status', String(e.message || e).slice(0, 80), 'idle');
      setTimeout(() => { Face.setMood('neutral'); emit('status', 'Say “Hey Sparky”', 'idle'); }, 5000);
      return { ok: false, error: String(e.message || e) };
    }
  }

  function teardown(reason) {
    connected = false; activeResponse = false; pendingResponseKick = false;
    userSpeaking = false; pendingUserTurn = false; clearTimeout(watchdog);
    try { dc?.close(); } catch {}
    try { pc?.close(); } catch {}
    micStream?.getTracks().forEach(t => t.stop());
    pc = dc = micStream = null; analyser = null;
    Face.setMode('idle');
    emit('disconnected', reason);
    emit('status', 'Say “Hey Sparky”', 'idle');
  }

  function settleToListening() {
    emit('status', 'Done ✨', 'idle');
    setTimeout(() => {
      if (!connected || runningTools.size) return;
      if (micEnabled) { Face.setMode('listening'); emit('status', 'Listening', 'listening'); }
      else { Face.setMode('idle'); emit('status', 'Ready', 'idle'); }
    }, 900);
  }

  async function handleEvent(ev) {
    switch (ev.type) {
      case 'response.created':
        activeResponse = true;
        reconnectUsed = false; // healthy traffic resets the reconnect budget
        assistantBuf = '';
        // Any new response covers the latest conversation state.
        pendingUserTurn = false;
        pendingResponseKick = false;
        clearTimeout(watchdog);
        // Thinking state starts here (not on speech_stopped) so VAD false
        // positives — a cough, a pause — don't flicker the face.
        if (Face.getMode() !== 'speaking') { Face.setMode('thinking'); emit('status', 'Thinking…', 'thinking'); }
        break;
      case 'response.done':
        activeResponse = false;
        if (runningTools.size) { emit('status', 'Working…', 'thinking'); Face.setMode('thinking'); }
        else if (Face.getMode() !== 'speaking') { settleToListening(); }
        if ((pendingResponseKick || pendingUserTurn) && !userSpeaking) {
          pendingResponseKick = false; pendingUserTurn = false;
          send({ type: 'response.create' });
        }
        break;

      case 'input_audio_buffer.committed':
        // The user's turn is in the conversation — make sure it gets answered.
        pendingUserTurn = true;
        ensureResponseSoon();
        break;

      case 'output_audio_buffer.started':
        Face.setMode('speaking');
        emit('status', 'Speaking…', 'speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (runningTools.size) { Face.setMode('thinking'); emit('status', 'Working…', 'thinking'); }
        else settleToListening();
        break;

      case 'input_audio_buffer.speech_started':
        userSpeaking = true;
        Face.setMode('listening');
        emit('status', 'Listening', 'listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        userSpeaking = false;
        if (pendingResponseKick || pendingUserTurn) ensureResponseSoon();
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) {
          emit('caption', ev.transcript.trim(), 'you');
          transcript.push('User: ' + ev.transcript.trim());
        }
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        // Streaming caption of Sparky's own words as it speaks.
        assistantBuf += ev.delta || '';
        emit('caption', assistantBuf, 'sparky');
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (ev.transcript?.trim()) transcript.push('Sparky: ' + ev.transcript.trim());
        if (transcript.length > 40) transcript.splice(0, transcript.length - 40);
        break;

      case 'response.output_item.done':
        if (ev.item?.type === 'function_call') runTool(ev.item);
        break;

      case 'error':
        console.error('realtime error:', ev.error);
        break;
    }
  }

  // Tools whose UI feedback is already handled elsewhere (a dedicated card,
  // or an invisible state update) — no need for a generic spinner card too.
  const SKIP_CARD = new Set(['show_menu', 'set_mood', 'working_memory_set', 'plan_update', 'settings_get']);

  function summarize(name, args) {
    if (name === 'web_search') return `Searching: "${args.query || ''}"`.slice(0, 60);
    if (name === 'generate_image') return `Generating image: "${args.prompt || ''}"`.slice(0, 60);
    if (name === 'open_app') return `Opening ${args.name || 'app'}`;
    if (name === 'computer_click') return `Clicking at (${args.x}, ${args.y})`;
    if (name === 'computer_type') return `Typing ${args.text?.length || 0} chars`;
    if (name === 'read_screen') return 'Reading screen';
    if (name === 'note_add') return `Adding note: "${args.text || ''}"`.slice(0, 60);
    if (name === 'timer_set') return `Setting timer: ${args.label || ''}`;
    if (name === 'calendar_create') return `Creating event: ${args.title || ''}`;
    if (name === 'plan_create') return `Planning: ${args.goal || ''}`.slice(0, 60);
    return name.replace(/_/g, ' ');
  }

  async function runTool(item) {
    const { name, call_id } = item;
    let args = {};
    try { args = JSON.parse(item.arguments || '{}'); } catch {}
    runningTools.add(name);
    Face.setMode('thinking');
    emit('status', summarize(name, args) + '…', 'thinking');

    const cardId = SKIP_CARD.has(name) ? null : Cards.startTool(name, summarize(name, args));

    // Ghost "Sparky is controlling" window for computer-control tools.
    if (['open_app', 'computer_click', 'computer_click_element', 'computer_type', 'computer_key', 'computer_scroll', 'run_workflow'].includes(name)) {
      Ghost.show(summarize(name, args), name === 'open_app' ? args.name : null, AppState.dryRun);
    }
    if (name === 'read_screen' || name === 'ui_inspect') Face.react('focused', 1500); // squint while studying the screen

    const result = await window.sparky.runTool(name, args);

    runningTools.delete(name);
    if (!connected) return;

    if (cardId) {
      const outcome = result?.error ? 'error'
        : result?.dry_run ? 'dry'
        : result?.status === 'awaiting_confirmation' ? 'confirm'
        : result?.cancelled ? 'cancelled'
        : 'done';
      const note = result?.error ? String(result.error).slice(0, 90)
        : outcome === 'dry' ? 'dry run — nothing executed'
        : outcome === 'confirm' ? 'waiting for your approval'
        : null;
      Cards.finishTool(cardId, outcome, note);
    }

    send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify(result).slice(0, 30000) },
    });
    // Silent tools (mood, working memory) update the UI without a spoken reply.
    if (!result?.silent) kickResponse();
    if (!runningTools.size && Face.getMode() === 'thinking') Face.setMode('listening');
  }

  // System-side injections (proactive triggers, timers, panel actions).
  window.sparky.onInject(({ text, id }) => {
    // Ambient card shows regardless of session state — nudges are never invisible.
    const clean = text.replace(/^\[[^\]]*\]\s*/, '').replace(/^Proactive trigger[^:]*:\s*/i, '').replace(/^Timer fired:\s*/i, '⏱ ');
    if (/^(Proactive trigger|Timer fired)/i.test(text)) Cards.showAmbient(clean);
    if (!connected) return; // no ack → main raises an OS notification too
    if (id) window.sparky.injectDelivered(id);
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    kickResponse();
  });

  export const RT = {
    connect: (opts) => { userEnded = false; return connect(opts); },
    disconnect: () => {
      userEnded = true;
      // Hand the transcript to main for an episodic memory summary.
      if (transcript.length >= 4) window.sparky.sessionEnded?.(transcript.slice(-30));
      transcript.length = 0;
      teardown('user ended session');
    },
    isConnected: () => connected,
    isMicEnabled: () => micEnabled,
    setMicEnabled: (v) => {
      micEnabled = !!v;
      const track = micStream?.getAudioTracks()[0] || null;
      if (track) track.enabled = micEnabled;
      // Hard mute: detach the track from the peer connection entirely so the
      // server receives zero audio, and flush anything already buffered.
      try { audioSender?.replaceTrack(micEnabled ? track : null); } catch {}
      if (connected) {
        if (micEnabled) { Face.setMode('listening'); emit('status', 'Listening', 'listening'); }
        else {
          send({ type: 'input_audio_buffer.clear' });
          userSpeaking = false; pendingUserTurn = false; clearTimeout(watchdog);
          Face.setMode('idle');
          emit('status', 'Muted — tap mic to talk', 'idle');
        }
      }
    },
    on: (ev, fn) => listeners[ev].push(fn),
    injectText: (text) => {
      if (!connected) return;
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      kickResponse();
    },
    // Shared image → vision input for the model.
    sendImage: (dataUrl, name) => {
      if (!connected) return;
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [
          { type: 'input_text', text: `[The user shared an image: ${name}] Look at it and respond.` },
          { type: 'input_image', image_url: dataUrl },
        ] },
      });
      kickResponse();
    },
  };

