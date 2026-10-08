// Holographic card renderer: layered foil, sparkle and glare driven by pointer,
// device tilt, or a slow idle drift. The look depends on rarity and printing.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const h = U.h;

  // Which foil treatment a printing gets.
  function effectFor(tier, variant) {
    if (/reverse/i.test(variant || '')) return 'reverse';
    if (tier === 'SR') return 'rainbow';
    if (tier === 'UR') return 'etched';
    if (tier === 'IR') return 'glitter';
    if (tier === 'DR') return 'full';
    if (tier === 'RH' || /holo/i.test(variant || '')) return 'holo';
    return 'none';
  }

  function cardEl(card, opts = {}) {
    const tier = opts.tier || E.tierOf(card.r);
    const effect = effectFor(tier, opts.variant);
    const img = h('img', {
      class: 'pcard__img',
      alt: card.n,
      src: opts.big ? card.big || card.img : card.img,
      loading: opts.eager ? 'eager' : 'lazy',
      decoding: 'async',
      draggable: 'false',
    });
    const face = h('div', { class: 'pcard__face' }, img, h('div', { class: 'pcard__shine' }), h('div', { class: 'pcard__sparkle' }), h('div', { class: 'pcard__glare' }));
    img.addEventListener('error', () => {
      face.classList.add('is-missing');
      face.append(h('div', { class: 'pcard__fallback' }, h('b', null, card.n), h('span', null, `#${card.no || ''}`)));
    });
    const el = h('div', { class: `pcard fx-${effect} tier-${tier}` + (opts.className ? ' ' + opts.className : ''), 'data-effect': effect }, h('div', { class: 'pcard__rot' }, face));
    el._img = img;
    el._data = card;
    if (opts.interactive) interactive(el, { auto: opts.auto });
    return el;
  }

  // Swap the small scan for the high-resolution one once it has downloaded.
  function upgrade(el) {
    const img = el._img;
    const card = el._data;
    if (!img || !card || !card.big || img.dataset.big) return;
    img.dataset.big = '1';
    const hi = new Image();
    hi.onload = () => (img.src = card.big);
    hi.src = card.big;
  }

  // ---- motion engine -----------------------------------------------------

  const running = new Set();
  let raf = null;
  let orient = null;
  let orientOn = false;

  function interactive(el, { auto = false } = {}) {
    if (el._motion) {
      el._motion.auto = auto || el._motion.auto;
      kick(el);
      return el;
    }
    const st = { cur: { x: 50, y: 50, rx: 0, ry: 0, o: 0 }, tgt: { x: 50, y: 50, rx: 0, ry: 0, o: 0 }, pointer: false, auto, t0: performance.now() + Math.random() * 4000, last: 0 };
    el._motion = st;
    el.classList.add('is-live');
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && !st.touchAim) return;
      const r = el.getBoundingClientRect();
      aim(st, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, 1);
      st.pointer = true;
      st.last = performance.now();
      kick(el);
    });
    el.addEventListener('pointerleave', () => {
      st.pointer = false;
      st.last = performance.now();
      if (!st.auto) aim(st, 0.5, 0.5, 0);
      kick(el);
    });
    if (auto) kick(el);
    return el;
  }

  function aim(st, x, y, o) {
    x = U.clamp(x, 0, 1);
    y = U.clamp(y, 0, 1);
    st.tgt = { x: x * 100, y: y * 100, rx: (0.5 - y) * 24, ry: (x - 0.5) * 28, o };
  }

  function kick(el) {
    running.add(el);
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function loop(now) {
    raf = null;
    const tilt = orient && now - orient.t < 600 ? orient : null;
    for (const el of running) {
      const st = el._motion;
      if (!el.isConnected) {
        running.delete(el);
        continue;
      }
      if (st.auto && !st.pointer && now - st.last > 900) {
        if (tilt) aim(st, 0.5 + U.clamp(tilt.g / 50, -0.5, 0.5), 0.5 + U.clamp((tilt.b - 45) / 50, -0.5, 0.5), 0.9);
        else {
          const t = (now - st.t0) / 1000;
          aim(st, 0.5 + 0.34 * Math.sin(t * 0.8), 0.5 + 0.3 * Math.sin(t * 1.17 + 1.3), 0.8);
        }
      }
      let moving = false;
      for (const k of ['x', 'y', 'rx', 'ry', 'o']) {
        const d = st.tgt[k] - st.cur[k];
        st.cur[k] += d * 0.12;
        if (Math.abs(d) > 0.02) moving = true;
      }
      apply(el, st.cur);
      if (!moving && !st.auto) running.delete(el);
    }
    if (running.size) raf = requestAnimationFrame(loop);
  }

  function apply(el, c) {
    const s = el.style;
    s.setProperty('--mx', `${c.x.toFixed(2)}%`);
    s.setProperty('--my', `${c.y.toFixed(2)}%`);
    s.setProperty('--rx', `${c.rx.toFixed(2)}deg`);
    s.setProperty('--ry', `${c.ry.toFixed(2)}deg`);
    s.setProperty('--o', c.o.toFixed(3));
    s.setProperty('--hyp', Math.min(1, Math.hypot(c.x - 50, c.y - 50) / 50).toFixed(3));
    // Background offsets for the foil layers (they move less than the pointer).
    s.setProperty('--bx', `${(30 + c.x * 0.4).toFixed(2)}%`);
    s.setProperty('--by', `${(30 + c.y * 0.4).toFixed(2)}%`);
  }

  // Phone tilt drives the showcased card. iOS needs permission from a tap.
  function enableOrientation() {
    if (orientOn || !root.DeviceOrientationEvent) return;
    orientOn = true;
    const listen = () =>
      root.addEventListener('deviceorientation', (e) => {
        if (e.gamma == null) return;
        orient = { g: e.gamma, b: e.beta, t: performance.now() };
      });
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then((r) => r === 'granted' && listen())
        .catch(() => {});
    } else listen();
  }

  PP.card = { cardEl, effectFor, interactive, upgrade, enableOrientation };
})(typeof window !== 'undefined' ? window : globalThis);
