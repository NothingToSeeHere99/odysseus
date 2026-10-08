// Lightweight canvas particle system for sparks, bursts and confetti.
(function (root) {
  const PP = root.PP;

  let canvas = null;
  let ctx = null;
  let parts = [];
  let raf = null;
  let dpr = 1;
  const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.round(root.innerWidth * dpr);
    canvas.height = Math.round(root.innerHeight * dpr);
  }

  function attach(c) {
    canvas = c;
    ctx = c.getContext('2d');
    parts = [];
    resize();
  }

  function detach() {
    canvas = null;
    ctx = null;
    parts = [];
  }

  if (root.addEventListener) root.addEventListener('resize', resize);

  function burst(x, y, o = {}) {
    if (!canvas || reduced) return;
    const n = o.count || 40;
    const colors = o.colors || ['#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread || Math.PI * 2) : Math.random() * Math.PI * 2;
      const sp = (o.speed || 6) * (0.35 + Math.random() * 0.85);
      parts.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (o.lift || 0),
        life: 0,
        max: (o.life || 60) * (0.6 + Math.random() * 0.7),
        size: (o.size || 3) * (0.5 + Math.random()),
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: o.shape || 'spark',
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        g: o.gravity != null ? o.gravity : 0.08,
        drag: o.drag || 0.96,
      });
    }
    if (parts.length > 900) parts.splice(0, parts.length - 900);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  const CONFETTI = ['#ff5a7a', '#ffcb05', '#4ade80', '#38bdf8', '#a78bfa', '#ffffff', '#fb923c'];

  function confetti(x, y, count = 140) {
    burst(x, y, { count, colors: CONFETTI, shape: 'confetti', speed: 13, lift: 5, gravity: 0.22, drag: 0.97, life: 140, size: 5 });
  }

  function star(c, r) {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 ? r * 0.28 : r;
      const a = (i * Math.PI) / 4;
      c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath();
    c.fill();
  }

  function loop() {
    raf = null;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const next = [];
    for (const p of parts) {
      p.life++;
      if (p.life > p.max) continue;
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const k = 1 - p.life / p.max;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'confetti') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.scale(1, Math.cos(p.life * 0.25));
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else if (p.shape === 'star') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        star(ctx, p.size * (0.6 + k * 0.6));
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * k + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      next.push(p);
    }
    parts = next;
    if (parts.length) raf = requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  PP.fx = { attach, detach, burst, confetti };
})(typeof window !== 'undefined' ? window : globalThis);
