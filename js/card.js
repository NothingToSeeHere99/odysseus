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

  // ---- placeholder pictures ------------------------------------------------
  //
  // Some database entries point at a picture of the official card back instead of a
  // scan. Images are checked once (a 20×28 thumbnail: blue border, red-over-white Poké Ball
  // in the middle) and replaced with TCGdex's scan, or a name card if there isn't one.
  // Hosts that don't allow inspection (no CORS) just display normally.

  const BACKS_KEY = 'packrush.cardbacks';
  const CORS_KEY = 'packrush.imgcors';
  const backs = new Set(U.store.get(BACKS_KEY, []) || []);
  const fronts = new Set();
  const cors = U.store.get(CORS_KEY, {}) || {};

  function hostOf(url) {
    try {
      return new URL(url, root.location && root.location.href).host;
    } catch {
      return '';
    }
  }

  function looksLikeCardBack(imgEl) {
    const W = 20;
    const H = 28;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data; // throws if the image can't be inspected
    const px = (x, y) => {
      const i = (y * W + x) * 4;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    };
    const isBlue = ([r, g, b, a]) => a > 128 && b > r + 35 && b > g + 10;
    const isRed = ([r, g, b, a]) => a > 128 && r > 140 && g < 120 && b < 120;
    const isWhite = ([r, g, b, a]) => a > 128 && r > 175 && g > 175 && b > 175;
    let edge = 0;
    let blue = 0;
    for (let y = 3; y < H - 3; y++) for (const x of [0, 1, W - 2, W - 1]) (edge++, isBlue(px(x, y)) && blue++);
    for (let x = 3; x < W - 3; x++) for (const y of [0, 1, H - 2, H - 1]) (edge++, isBlue(px(x, y)) && blue++);
    const count = (pts, test) => pts.filter(([x, y]) => test(px(x, y))).length;
    const red = count([[9, 10], [10, 10], [8, 11], [11, 11], [10, 9]], isRed);
    const white = count([[9, 17], [10, 17], [8, 16], [11, 16], [10, 18]], isWhite);
    return blue / edge > 0.55 && red >= 3 && white >= 3;
  }

  function remember(urls, isBack) {
    for (const u of urls.filter(Boolean)) (isBack ? backs : fronts).add(u);
    if (isBack) U.store.set(BACKS_KEY, [...backs].slice(-500));
  }

  // Resolves true if the picture at url is a card back (false if unknown or a real scan).
  function checkImage(url) {
    if (!url || fronts.has(url)) return Promise.resolve(false);
    if (backs.has(url)) return Promise.resolve(true);
    if (cors[hostOf(url)] === false) return Promise.resolve(false);
    return new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => {
        try {
          const b = looksLikeCardBack(im);
          remember([url], b);
          resolve(b);
        } catch {
          resolve(false);
        }
      };
      im.onerror = () => resolve(false);
      im.src = url;
    });
  }

  function cardEl(card, opts = {}) {
    const tier = opts.tier || E.tierOf(card);
    const effect = effectFor(tier, opts.variant);
    const src = opts.big ? card.big || card.img : card.img;
    const img = h('img', { class: 'pcard__img', alt: card.n, loading: opts.eager ? 'eager' : 'lazy', decoding: 'async', draggable: 'false' });
    const face = h('div', { class: 'pcard__face' }, img, h('div', { class: 'pcard__shine' }), h('div', { class: 'pcard__sparkle' }), h('div', { class: 'pcard__glare' }));
    const el = h('div', { class: `pcard fx-${effect} tier-${tier}` + (opts.className ? ' ' + opts.className : ''), 'data-effect': effect }, h('div', { class: 'pcard__rot' }, face));
    el._img = img;
    el._data = card;

    const missing = () => {
      if (face.classList.contains('is-missing')) return;
      face.classList.add('is-missing');
      img.removeAttribute('src');
      face.append(h('div', { class: 'pcard__fallback' }, h('b', null, card.n), h('span', null, `#${card.no || ''}`)));
    };
    // The database's picture is a card back: try TCGdex's scan, else a name card.
    const replace = async () => {
      remember([card.img, card.big], true);
      img.style.visibility = 'hidden';
      const alt = PP.api && PP.api.altImage ? await PP.api.altImage(card) : null;
      if (!alt) return missing();
      el._data = { ...card, ...alt };
      img.removeAttribute('crossorigin');
      img.addEventListener('load', () => (img.style.visibility = ''), { once: true });
      img.src = opts.big ? alt.big : alt.img;
    };

    if (!src) missing();
    else if (backs.has(src)) replace();
    else {
      const host = hostOf(src);
      const inspect = !fronts.has(src) && cors[host] !== false;
      if (inspect) img.crossOrigin = 'anonymous';
      img.addEventListener('load', () => {
        if (!img.crossOrigin || img.dataset.checked) return;
        img.dataset.checked = '1';
        let isBack;
        try {
          isBack = looksLikeCardBack(img);
        } catch {
          return;
        }
        if (cors[host] !== true) U.store.set(CORS_KEY, Object.assign(cors, { [host]: true }));
        remember([src], isBack);
        if (isBack) replace();
      });
      img.addEventListener('error', () => {
        // Host refuses inspection: show the picture normally from now on.
        if (img.crossOrigin && cors[host] !== true && !img.dataset.retried) {
          img.dataset.retried = '1';
          U.store.set(CORS_KEY, Object.assign(cors, { [host]: false }));
          img.removeAttribute('crossorigin');
          img.src = src;
          return;
        }
        missing();
      });
      img.src = src;
    }
    if (opts.interactive) interactive(el, { auto: opts.auto });
    return el;
  }

  // Swap the small scan for the high-resolution one once it has downloaded.
  function upgrade(el) {
    const img = el._img;
    const card = el._data;
    if (!img || !card || !card.big || img.dataset.big || !img.getAttribute('src')) return;
    if (backs.has(card.img)) return;
    img.dataset.big = '1';
    const hi = new Image();
    if (img.crossOrigin) hi.crossOrigin = 'anonymous';
    hi.onload = () => img.getAttribute('src') && (img.src = card.big);
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

  PP.card = { cardEl, effectFor, interactive, upgrade, enableOrientation, checkImage, looksLikeCardBack };
})(typeof window !== 'undefined' ? window : globalThis);
