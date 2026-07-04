// Wake-word listener: energy-gated recording → transcription → "hey sparky".
// Runs only while disconnected and wakeWord setting is on.
(() => {
  let enabled = false;
  let running = false;
  let stream = null, ctx = null, analyser = null, recorder = null;
  let chunks = [];

  const WAKE_RE = /\b(hey|hi|ok|okay|yo)?[,\s]*spark(y|ie|ee)\b/i;

  async function start() {
    if (running || !enabled) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { console.warn('wake: mic denied', e); return; }
    running = true;
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    loop();
  }

  function stop() {
    running = false;
    try { recorder?.state !== 'inactive' && recorder?.stop(); } catch {}
    recorder = null;
    stream?.getTracks().forEach(t => t.stop());
    try { ctx?.close(); } catch {}
    stream = ctx = analyser = null;
  }

  function rms() {
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
    return Math.sqrt(sum / buf.length);
  }

  let speechMs = 0, silenceMs = 0, recording = false;
  const TICK = 60;
  function loop() {
    if (!running) return;
    const level = rms();
    const speaking = level > 0.025;

    if (!recording) {
      speechMs = speaking ? speechMs + TICK : 0;
      if (speechMs > 180) beginRecording();
    } else {
      silenceMs = speaking ? 0 : silenceMs + TICK;
      if (silenceMs > 900 || recordedMs() > 4000) endRecording();
    }
    setTimeout(loop, TICK);
  }

  let recStart = 0;
  const recordedMs = () => Date.now() - recStart;

  function beginRecording() {
    recording = true; silenceMs = 0; recStart = Date.now(); chunks = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      recording = false; speechMs = 0;
      if (blob.size < 2000 || !running) return;
      try {
        const buf = await blob.arrayBuffer();
        const r = await window.sparky.wakeTranscribe(buf);
        if (r.text && WAKE_RE.test(r.text)) {
          console.log('wake word heard:', r.text);
          stop();
          window.App?.activate();
        }
      } catch (e) { console.warn('wake transcribe failed', e); }
    };
    recorder.start();
  }

  function endRecording() {
    try { recorder?.state !== 'inactive' && recorder.stop(); } catch { recording = false; }
  }

  window.Wake = {
    setEnabled(v) { enabled = v; if (!v) stop(); else if (!window.RT.isConnected()) start(); },
    onSessionEnd() { if (enabled) setTimeout(start, 500); },
    onSessionStart() { stop(); },
  };
})();
