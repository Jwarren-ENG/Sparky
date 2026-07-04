// Realtime voice session over WebRTC. Tool calls run async in the main
// process so the conversation stays live while tools work.
(() => {
  let pc = null, dc = null, micStream = null;
  let connected = false;
  let activeResponse = false;
  let pendingResponseKick = false;   // response.create queued behind an active response
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
      window.Face.setMouthShape(mouth);
      requestAnimationFrame(loop);
    })();
  }

  function send(obj) { if (dc?.readyState === 'open') dc.send(JSON.stringify(obj)); }

  function kickResponse() {
    if (activeResponse) { pendingResponseKick = true; return; }
    send({ type: 'response.create' });
  }

  async function connect() {
    if (connected) return { ok: true };
    emit('status', 'connecting…', 'thinking');
    const sec = await window.sparky.getSecret();
    if (!sec.ok) { emit('status', 'session error — see console', 'idle'); console.error('client_secret error:', sec.error); return sec; }

    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    pc = new RTCPeerConnection();
    micStream.getTracks().forEach(t => pc.addTrack(t, micStream));
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; attachAnalyser(e.streams[0]); };

    dc = pc.createDataChannel('oai-events');
    dc.onmessage = (e) => handleEvent(JSON.parse(e.data));
    dc.onopen = () => {
      connected = true;
      emit('connected');
      emit('status', 'listening', 'listening');
      // Opening greeting.
      send({ type: 'response.create', instructions: undefined });
    };
    dc.onclose = () => teardown('channel closed');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const resp = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(sec.model)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sec.secret}`, 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!resp.ok) { const t = await resp.text(); console.error('SDP exchange failed:', t); teardown('connect failed'); return { ok: false, error: t }; }
    await pc.setRemoteDescription({ type: 'answer', sdp: await resp.text() });
    return { ok: true };
  }

  function teardown(reason) {
    connected = false; activeResponse = false; pendingResponseKick = false;
    try { dc?.close(); } catch {}
    try { pc?.close(); } catch {}
    micStream?.getTracks().forEach(t => t.stop());
    pc = dc = micStream = null; analyser = null;
    window.Face.setMode('idle');
    emit('disconnected', reason);
    emit('status', 'Say “Hey Sparky”', 'idle');
  }

  function settleToListening() {
    emit('status', 'Done ✨', 'idle');
    setTimeout(() => { if (connected && !runningTools.size) { window.Face.setMode('listening'); emit('status', 'Listening', 'listening'); } }, 900);
  }

  async function handleEvent(ev) {
    switch (ev.type) {
      case 'response.created':
        activeResponse = true;
        break;
      case 'response.done':
        activeResponse = false;
        if (runningTools.size) { emit('status', 'Working…', 'thinking'); window.Face.setMode('thinking'); }
        else if (window.Face.getMode() !== 'speaking') { settleToListening(); }
        if (pendingResponseKick) { pendingResponseKick = false; send({ type: 'response.create' }); }
        break;

      case 'output_audio_buffer.started':
        window.Face.setMode('speaking');
        emit('status', 'Speaking…', 'speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (runningTools.size) { window.Face.setMode('thinking'); emit('status', 'Working…', 'thinking'); }
        else settleToListening();
        break;

      case 'input_audio_buffer.speech_started':
        window.Face.setMode('listening');
        emit('status', 'Listening', 'listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        window.Face.setMode('thinking');
        emit('status', 'Thinking…', 'thinking');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) emit('caption', ev.transcript.trim());
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
    window.Face.setMode('thinking');
    emit('status', 'Working…', 'thinking');

    const cardId = SKIP_CARD.has(name) ? null : window.Cards.startTool(name, summarize(name, args));

    // Ghost "Sparky is controlling" window for computer-control tools.
    if (['open_app', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll', 'run_workflow'].includes(name)) {
      window.Ghost?.show(summarize(name, args), name === 'open_app' ? args.name : null, window.AppState?.dryRun);
    }

    const result = await window.sparky.runTool(name, args);

    runningTools.delete(name);
    if (!connected) return;

    if (cardId) window.Cards.finishTool(cardId);

    send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify(result).slice(0, 30000) },
    });
    // Silent tools (mood, working memory) update the UI without a spoken reply.
    if (!result?.silent) kickResponse();
    if (!runningTools.size && window.Face.getMode() === 'thinking') window.Face.setMode('listening');
  }

  // System-side injections (proactive triggers, timers, panel actions).
  window.sparky.onInject(({ text }) => {
    if (!connected) return; // idle → main falls back to OS notification
    // Surface a light ambient card for proactive nudges / timer fires.
    const clean = text.replace(/^\[[^\]]*\]\s*/, '').replace(/^Proactive trigger[^:]*:\s*/i, '').replace(/^Timer fired:\s*/i, '⏱ ');
    if (/^(Proactive trigger|Timer fired)/i.test(text)) window.Cards?.showAmbient(clean);
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] } });
    kickResponse();
  });

  window.RT = {
    connect,
    disconnect: () => teardown('user ended session'),
    isConnected: () => connected,
    on: (ev, fn) => listeners[ev].push(fn),
    injectText: (text) => {
      if (!connected) return;
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      kickResponse();
    },
  };
})();
