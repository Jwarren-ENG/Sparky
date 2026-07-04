// Sparky's face: minimal, floating, alive through micro-animations.
// Just eyes, brows, nose, mouth. No circle. Simple Pixar-ish style.
(() => {
  const canvas = document.getElementById('face');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const state = {
    mood: 'neutral',
    mode: 'idle',
    mouth: { open: 0, width: 0.2, round: 0, teeth: 0 },
    look: { x: 0, y: 0 },
    blink: 0,
  };

  // Natural blinking
  let nextBlink = performance.now() + 2000;
  let blinkPhase = -1;
  function updateBlink(t) {
    if (blinkPhase < 0 && t > nextBlink) blinkPhase = 0;
    if (blinkPhase >= 0) {
      blinkPhase += 0.12;
      state.blink = Math.sin(Math.min(blinkPhase, Math.PI));
      if (blinkPhase >= Math.PI) {
        blinkPhase = -1;
        state.blink = 0;
        nextBlink = t + (Math.random() < 0.15 ? 250 : 1800 + Math.random() * 4200);
      }
    }
  }

  window.sparky.onCursor(({ dx, dy }) => {
    const m = 900;
    state.look.x = Math.max(-1, Math.min(1, dx / m));
    state.look.y = Math.max(-1, Math.min(1, dy / m));
  });

  const MOODS = {
    neutral:   { browTilt: 0,    browLift: 0,  eyeH: 1,    mouthCurve: 0.06 },
    happy:     { browTilt: 0,    browLift: 4,  eyeH: 0.92, mouthCurve: 0.5 },
    excited:   { browTilt: 0,    browLift: 8,  eyeH: 1.15, mouthCurve: 0.65 },
    focused:   { browTilt: 0.22, browLift: -3, eyeH: 0.68, mouthCurve: 0.02 },
    sheepish:  { browTilt: -0.2, browLift: 2,  eyeH: 0.8,  mouthCurve: 0.22 },
    concerned: { browTilt: -0.3, browLift: 5,  eyeH: 1.05, mouthCurve: -0.3 },
  };
  const cur = { ...MOODS.neutral };

  let thinkAngle = 0;
  let breathe = 0;

  function draw(t) {
    updateBlink(t);
    const target = MOODS[state.mood] || MOODS.neutral;
    for (const k of Object.keys(target)) cur[k] += (target[k] - cur[k]) * 0.08;
    breathe = Math.sin(t / 1600) * 3;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2 + 8 + breathe;

    // Eyes
    const eyeY = cy - 28;
    const eyeDX = 54;
    const eyeW = 32;
    const eyeH = 36 * cur.eyeH * (1 - state.blink * 0.94);
    const px = state.look.x * 10;
    const py = state.look.y * 8;

    for (const s of [-1, 1]) {
      const ex = cx + s * eyeDX + px;
      ctx.save();
      ctx.fillStyle = '#1a1a1a';
      roundRect(ex - eyeW / 2, eyeY - eyeH / 2 + py, eyeW, Math.max(2, eyeH), 8);
      ctx.fill();
      // Eyebrow
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const by = eyeY - 32 - cur.browLift + py * 0.5;
      ctx.moveTo(ex - 18, by + s * cur.browTilt * -16);
      ctx.lineTo(ex + 18, by + s * cur.browTilt * 16);
      ctx.stroke();
      ctx.restore();
    }

    // Tiny nose (subtle)
    ctx.fillStyle = 'rgba(26,26,26,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy + 8, 3, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    const my = cy + 48;
    const speaking = state.mode === 'speaking';
    const m = state.mouth;
    const open = speaking ? 2 + m.open * 28 : 2;
    const wHalf = speaking
      ? (28 + m.width * 26) * (1 - m.round * 0.38)
      : 40;

    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    const curve = speaking ? m.round * -7 : cur.mouthCurve * 20;
    ctx.moveTo(cx - wHalf, my);
    ctx.quadraticCurveTo(cx, my - curve + open / 2, cx + wHalf, my);
    ctx.quadraticCurveTo(cx, my + curve + open, cx - wHalf, my);
    ctx.fill();

    // Teeth on bright consonants
    if (speaking && open > 9 && m.teeth > 0.25) {
      ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
      ctx.fillRect(cx - wHalf * 0.65, my - open * 0.08, wHalf * 1.3, Math.min(5, open * 0.28));
    }

    // Thinking: subtle orbiting particles
    if (state.mode === 'thinking') {
      thinkAngle += 0.07;
      for (let i = 0; i < 2; i++) {
        const a = thinkAngle + (i * Math.PI);
        const ox = cx + Math.cos(a) * 110;
        const oy = cy - 20 + Math.sin(a) * 70;
        ctx.fillStyle = `rgba(26, 26, 26, ${0.3 + 0.3 * Math.sin(a)})`;
        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Listening: subtle pulse ring
    if (state.mode === 'listening') {
      const r = 130 + Math.sin(t / 250) * 4;
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  requestAnimationFrame(draw);

  window.Face = {
    setMood: (m) => { if (MOODS[m]) state.mood = m; },
    setMode: (m) => { state.mode = m; },
    setMouthShape: (s) => { state.mouth = s; },
    getMode: () => state.mode,
  };

  window.sparky.onMood(({ mood }) => window.Face.setMood(mood));
})();
