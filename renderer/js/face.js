// Sparky's face: DOM-based (not canvas), matching the Apple-inspired design.
// Breathing orb, blinking eyes that track the cursor, mood-driven brows/mouth,
// thinking-dot orbit, listening ring, and audio-driven mouth shape.
  const $ = (id) => document.getElementById(id);
  const browL = $('brow-l'), browR = $('brow-r');
  const eyeL = $('eye-l'), eyeR = $('eye-r');
  const mouth = $('mouth'), mouthSvg = $('mouth-svg');
  const dotA = $('dot-a'), dotB = $('dot-b');
  const ring = $('ring');
  const pillWave = $('pill-wave');

  const MOODS = {
    neutral:   { browTilt: 0,     browLift: 0,  eyeH: 1,    curve: 6 },
    happy:     { browTilt: 0,     browLift: 4,  eyeH: 0.55, curve: 15 },
    excited:   { browTilt: 0,     browLift: 8,  eyeH: 1.12, curve: 18 },
    focused:   { browTilt: 0.22,  browLift: -3, eyeH: 0.66, curve: 2 },
    sheepish:  { browTilt: -0.2,  browLift: 2,  eyeH: 0.8,  curve: 9 },
    concerned: { browTilt: -0.3,  browLift: 5,  eyeH: 1.05, curve: -8 },
  };

  const state = { mood: 'neutral', mode: 'idle', mouthShape: { open: 0, width: 0.5, round: 0 } };
  const cur = { browTilt: 0, browLift: 0, eyeH: 1, curve: 6 };
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  let blink = 0, blinkPhase = -1, nextBlink = performance.now() + 2200;
  let thinkAngle = 0;

  // Cursor tracking within the window, matching the design's onMouseMove.
  let lastMouse = 0;
  window.addEventListener('mousemove', (e) => {
    lastMouse = Date.now();
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2 - 40;
    look.tx = Math.max(-1, Math.min(1, (e.clientX - cx) / 600));
    look.ty = Math.max(-1, Math.min(1, (e.clientY - cy) / 500));
  });

  // Idle gaze: when nothing is happening, glance around occasionally —
  // small saccades with a drift back toward center, so Sparky feels present.
  (function saccade() {
    if (state.mode === 'idle' && Date.now() - lastMouse > 8000) {
      look.tx = (Math.random() - 0.5) * 1.0;
      look.ty = (Math.random() - 0.5) * 0.7;
      setTimeout(() => { if (Date.now() - lastMouse > 8000) { look.tx *= 0.25; look.ty *= 0.25; } }, 1200 + Math.random() * 1400);
    }
    setTimeout(saccade, 4000 + Math.random() * 5000);
  })();

  function clamp(min, max, v) { return Math.max(min, Math.min(max, v)); }

  function tick(t) {
    const target = MOODS[state.mood] || MOODS.neutral;
    for (const k of Object.keys(target)) cur[k] += (target[k] - cur[k]) * 0.08;

    // blink
    if (blinkPhase < 0 && t > nextBlink) blinkPhase = 0;
    if (blinkPhase >= 0) {
      blinkPhase += 0.14;
      blink = Math.sin(Math.min(blinkPhase, Math.PI));
      if (blinkPhase >= Math.PI) {
        blinkPhase = -1; blink = 0;
        nextBlink = t + (Math.random() < 0.15 ? 300 : 1800 + Math.random() * 4200);
      }
    }

    // eased look
    look.x += (look.tx - look.x) * 0.07;
    look.y += (look.ty - look.y) * 0.07;
    const px = look.x * 12, py = look.y * 9;

    const eyeScale = Math.max(0.06, cur.eyeH * (1 - blink * 0.95));
    const eyeCss = `translate(${px}px,${py}px) scaleY(${eyeScale})`;
    eyeL.style.transform = eyeCss;
    eyeR.style.transform = eyeCss;
    const bl = -cur.browLift + py * 0.5;
    browL.style.transform = `translate(${px * 0.6}px,${bl}px) rotate(${cur.browTilt * 14}deg)`;
    browR.style.transform = `translate(${px * 0.6}px,${bl}px) rotate(${-cur.browTilt * 14}deg)`;

    // mouth — same bezier formula as the design, driven by real audio energy
    const speaking = state.mode === 'speaking';
    const ms = state.mouthShape;
    const open = speaking ? clamp(0, 22, ms.open * 20 + 2) : 0;
    const w = speaking ? clamp(24, 40, 34 + (ms.width - 0.5) * 20 - ms.round * 10) : 40;
    const curve = cur.curve;
    const d = `M ${70 - w} 22 Q 70 ${22 + curve + open * 0.4} ${70 + w} 22 Q 70 ${22 + curve + 6 + open} ${70 - w} 22 Z`;
    mouth.setAttribute('d', d);
    mouthSvg.style.transform = `translate(${px * 0.5}px,${py * 0.5}px)`;

    // thinking dots orbit
    const thinking = state.mode === 'thinking';
    if (thinking) thinkAngle += 0.06;
    for (const [el, off] of [[dotA, 0], [dotB, Math.PI]]) {
      el.style.opacity = thinking ? '1' : '0';
      if (thinking) {
        const a = thinkAngle + off;
        el.style.left = (160 + Math.cos(a) * 150) + 'px';
        el.style.top = (150 + Math.sin(a) * 95) + 'px';
      }
    }

    // listening ring; pill bars move while listening or speaking (two-way alive)
    ring.style.opacity = state.mode === 'listening' ? '1' : '0';
    pillWave.classList.toggle('active', state.mode === 'listening' || speaking);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  export const Face = {
    setMood: (m) => { if (MOODS[m]) state.mood = m; },
    setMode: (m) => { state.mode = m; },
    setMouthShape: (s) => { state.mouthShape = s; },
    getMode: () => state.mode,
  };

  window.sparky.onMood(({ mood }) => Face.setMood(mood));

