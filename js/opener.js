// The pack-opening experience: tear the pack, swipe through the cards, then a results screen.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const G = PP.game;
  const h = U.h;

  const CAP = 0.1; // share of the pack's height taken by the tear-off cap
  const TIER_COLORS = {
    RH: ['#bfe9ff', '#ffffff', '#8fd3ff'],
    DR: ['#ffe27a', '#fff6cf', '#ffc93d', '#ffffff'],
    IR: ['#ff9ee0', '#ffd6f3', '#c38bff', '#ffffff'],
    UR: ['#e2d1ff', '#ffffff', '#9ad8ff', '#c9b3ff'],
    SR: ['#ff6b8b', '#ffd36b', '#7dffb0', '#79c8ff', '#d18bff', '#ffffff'],
  };

  const sfx = () => PP.sfx;
  const fx = () => PP.fx;
  const C = () => PP.card;

  let S = null; // the current opening session
  let keyHandler = null;
  let onWallet = null;
  G.onChange(() => onWallet && onWallet());

  function setKeys(fn) {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = fn;
    if (fn) document.addEventListener('keydown', fn);
  }

  // setTimeout that is cancelled if the session changed in the meantime.
  function later(fn, ms) {
    const s = S;
    setTimeout(() => S === s && s && fn(), ms);
  }

  function vibrate(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch {}
  }

  function preload(pulls) {
    for (const p of pulls) {
      new Image().src = p.card.img;
      if (E.tierRank(p.tier) >= E.tierRank('RH') && p.card.big) new Image().src = p.card.big;
    }
  }

  function close() {
    const ov = document.getElementById('overlay');
    ov.className = 'overlay hidden';
    ov.innerHTML = '';
    document.body.classList.remove('no-scroll');
    setKeys(null);
    onWallet = null;
    fx().detach();
    const done = S && S.opts.onClose;
    S = null;
    if (done) done();
  }

  // results: one entry per pack bought together (a bundle opens several in a row).
  function open(model, results, opts = {}) {
    const ov = document.getElementById('overlay');
    ov.innerHTML = '';
    ov.className = 'overlay';
    ov.style.setProperty('--h', PP.ui.hueOf(model.set));
    document.body.classList.add('no-scroll');
    const canvas = h('canvas', { class: 'ov-fx' });
    const title = h('div', { class: 'ov-title' });
    const skip = h('button', { class: 'btn btn--glass btn--sm', onclick: () => skipToSummary() }, 'Skip', PP.ui.icon('right'));
    const stage = h('div', { class: 'ov-stage' });
    ov.append(h('div', { class: 'ov-bg' }, h('div', { class: 'ov-rays' }), h('div', { class: 'ov-glow' })), canvas, h('div', { class: 'ov-top' }, title, skip), stage);
    fx().attach(canvas);
    S = { model, results, opts, index: 0, ov, stage, title, skip };
    showPack();
  }

  function setTitle(sub) {
    const parts = [h('b', null, S.model.set.name)];
    if (sub) parts.push(h('span', null, sub));
    S.title.replaceChildren(...parts);
  }

  function packLabel() {
    return S.results.length > 1 ? `Pack ${S.index + 1} of ${S.results.length}` : S.model.set.series;
  }

  // ---- 1. the pack -------------------------------------------------------

  function showPack() {
    const { model, results, index, stage } = S;
    setTitle(packLabel());
    S.skip.hidden = false;
    S.ov.classList.remove('is-summary', 'is-boost');
    stage.className = 'ov-stage stage-pack';
    stage.innerHTML = '';

    const pack = PP.ui.packEl(model.set, { model, big: true });
    pack.append(h('div', { class: 'pack__tearline' }, h('i')));
    C().interactive(pack);
    const hint = h('div', { class: 'ov-hint' }, h('span', { class: 'ov-hint__swipe' }), 'Swipe across the top to open');
    const banner = S.opts.mystery && index === 0 ? h('div', { class: 'ov-banner' }, PP.ui.icon('sparkle'), 'Your mystery pack is…', h('b', null, model.set.name)) : null;
    const holder = h('div', { class: 'pack-stage' }, pack);
    if (banner) stage.append(banner);
    stage.append(holder, hint);
    sfx().drop();
    preload(results[index].pulls);

    let drag = null;
    let torn = false;
    const rip = () => {
      if (torn) return;
      torn = true;
      doRip(pack, holder, hint, banner);
    };
    pack.addEventListener('pointerdown', (e) => {
      C().enableOrientation();
      drag = { x: e.clientX, moved: false, last: 0 };
      try {
        pack.setPointerCapture(e.pointerId);
      } catch {}
    });
    pack.addEventListener('pointermove', (e) => {
      if (!drag || torn) return;
      const r = pack.getBoundingClientRect();
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 8) drag.moved = true;
      const p = U.clamp(Math.abs(dx) / (r.width * 0.7), 0, 1);
      pack.style.setProperty('--tear', p.toFixed(3));
      pack.style.setProperty('--tear-origin', dx >= 0 ? 'left' : 'right');
      const x = dx >= 0 ? r.left + p * r.width : r.right - p * r.width;
      fx().burst(x, r.top + r.height * CAP, { count: 2, colors: ['#ffffff', '#ffe9a8', '#bde6ff'], speed: 3, life: 26, size: 2, gravity: 0.15 });
      if (performance.now() - drag.last > 70) {
        sfx().tick();
        drag.last = performance.now();
      }
      if (p >= 1) rip();
    });
    pack.addEventListener('pointerup', () => {
      if (!drag || torn) return;
      const moved = drag.moved;
      drag = null;
      if (!moved) rip();
      else pack.style.setProperty('--tear', 0);
    });
    pack.addEventListener('pointercancel', () => (drag = null));
    setKeys((e) => {
      if (e.key === 'Escape') skipToSummary();
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        rip();
      }
    });
  }

  function doRip(pack, holder, hint, banner) {
    hint.classList.add('is-gone');
    if (banner) banner.classList.add('is-gone');
    sfx().tear();
    vibrate(25);
    const r = pack.getBoundingClientRect();
    const y = r.top + r.height * CAP;
    for (let i = 0; i <= 6; i++) fx().burst(r.left + (r.width * i) / 6, y, { count: 9, colors: ['#ffffff', '#ffe9a8', '#bde6ff'], speed: 5, life: 45, size: 2.4 });
    pack.style.setProperty('--tear', 1);
    pack.classList.add('is-torn');
    later(() => {
      pack.classList.add('is-spent');
      showStack(holder);
    }, 650);
  }

  // ---- 2. the cards ------------------------------------------------------

  function infoFor(el) {
    const p = el._pull;
    if (el.classList.contains('is-down')) {
      return [h('div', { class: 'ri-tease' }, 'Something rare is inside…'), h('div', { class: 'ri-sub' }, 'Tap to reveal')];
    }
    const row = [PP.ui.rarityEl(p.tier), PP.ui.variantChip(p.variant), p.isNew ? PP.ui.chip('NEW', 'chip--new') : null].filter(Boolean);
    return [h('div', { class: 'ri-name' }, p.card.n), h('div', { class: 'ri-row' }, row), h('div', { class: 'ri-price' }, U.money(p.price))];
  }

  function showStack(leftover) {
    const { stage, results, index } = S;
    const pulls = results[index].pulls;
    stage.className = 'ov-stage stage-stack';
    const stack = h('div', { class: 'stack' });
    const info = h('div', { class: 'reveal-info' });
    const dots = h(
      'div',
      { class: 'reveal-dots' },
      pulls.map((p) => h('i', { class: `tier-${p.tier}` }))
    );
    stage.append(h('div', { class: 'stack-wrap' }, stack, info, dots));
    if (leftover) later(() => leftover.remove(), 900);

    const els = pulls.map((p, i) => {
      const special = E.tierRank(p.tier) >= E.tierRank('DR');
      const card = C().cardEl(p.card, { variant: p.variant, tier: p.tier, eager: true });
      const el = h(
        'div',
        { class: 'rcard' + (special ? ' is-down' : ''), 'data-tier': p.tier, style: `--i:${i};z-index:${pulls.length - i}` },
        special ? h('div', { class: 'rcard__aura' }) : null,
        h('div', { class: 'rcard__flip' }, h('div', { class: 'rcard__front' }, card), h('div', { class: 'rcard__back' }, PP.ui.cardBack()))
      );
      el._card = card;
      el._pull = p;
      stack.append(el);
      return el;
    });
    els.slice(0, 5).forEach((_, i) => sfx().deal(i));

    let idx = 0;
    let busy = false;
    const show = () => {
      els.forEach((el, i) => el.style.setProperty('--depth', U.clamp(i - idx, 0, 4)));
      [idx, idx + 1, idx + 2].forEach((i) => els[i] && C().upgrade(els[i]._card));
      const el = els[idx];
      el.classList.add('is-top');
      C().interactive(el._card, { auto: true });
      [...dots.children].forEach((d, i) => {
        d.classList.toggle('is-done', i < idx);
        d.classList.toggle('is-now', i === idx);
      });
      info.replaceChildren(...infoFor(el));
    };

    const flip = (el) => {
      busy = true;
      const p = el._pull;
      el.classList.remove('is-down');
      el.classList.add('is-flipping');
      sfx().reveal(p.tier);
      vibrate(E.tierRank(p.tier) >= E.tierRank('UR') ? [30, 40, 70] : 30);
      later(() => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const colors = TIER_COLORS[p.tier] || TIER_COLORS.RH;
        fx().burst(cx, cy, { count: 60, colors, speed: 12, life: 70, size: 4, shape: 'star', gravity: 0.03 });
        fx().burst(cx, cy, { count: 60, colors, speed: 7, life: 90, size: 2.4 });
        if (E.tierRank(p.tier) >= E.tierRank('UR')) fx().confetti(cx, r.top + r.height * 0.2, p.tier === 'SR' ? 220 : 120);
        S.ov.dataset.boost = p.tier;
        S.ov.classList.add('is-boost');
        later(() => S.ov.classList.remove('is-boost'), 2400);
        busy = false;
        info.replaceChildren(...infoFor(el));
      }, 280);
    };

    const next = (dir = -1, dy = 0) => {
      const el = els[idx];
      if (!el || busy) return;
      if (el.classList.contains('is-down')) return flip(el);
      sfx().swoosh();
      el.classList.add('is-gone');
      el.style.transform = `translate(${dir * 110}vw, ${dy * 1.2 - 40}px) rotate(${dir * 26}deg)`;
      idx++;
      later(() => el.remove(), 550);
      if (idx >= els.length) {
        busy = true;
        later(() => showSummary(S.index, S.index), 380);
      } else show();
    };

    let drag = null;
    stack.addEventListener('pointerdown', (e) => {
      const el = els[idx];
      if (!el || busy) return;
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), el, dx: 0, dy: 0, moving: false };
      try {
        stack.setPointerCapture(e.pointerId);
      } catch {}
    });
    stack.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.dx = e.clientX - drag.x;
      drag.dy = e.clientY - drag.y;
      if (!drag.moving && Math.hypot(drag.dx, drag.dy) > 10 && !drag.el.classList.contains('is-down')) {
        drag.moving = true;
        drag.el.classList.add('is-dragging');
      }
      if (drag.moving) drag.el.style.transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 16}deg)`;
    });
    stack.addEventListener('pointerup', () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.el.classList.remove('is-dragging');
      if (!d.moving) return next(-1);
      const v = Math.abs(d.dx) / Math.max(1, performance.now() - d.t);
      if (Math.abs(d.dx) > 80 || v > 0.7) next(Math.sign(d.dx) || -1, d.dy);
      else d.el.style.transform = '';
    });
    stack.addEventListener('pointercancel', () => {
      if (!drag) return;
      drag.el.classList.remove('is-dragging');
      drag.el.style.transform = '';
      drag = null;
    });
    setKeys((e) => {
      if (e.key === 'Escape') skipToSummary();
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        next(e.key === 'ArrowRight' ? 1 : -1);
      }
    });
    show();
  }

  // ---- 3. results --------------------------------------------------------

  function skipToSummary() {
    if (!S || S.ov.classList.contains('is-summary')) return;
    showSummary(S.index, S.index);
  }

  function sumStat(label, value, cls = '') {
    return h('div', { class: 'sum-stat ' + cls }, h('span', null, label), value instanceof Node ? value : h('b', null, value));
  }

  function showSummary(from, to) {
    const { stage, results, model, opts } = S;
    S.index = to;
    const group = results.slice(from, to + 1);
    let pulls = group.flatMap((r) => r.pulls);
    if (group.length > 1) pulls = pulls.slice().sort((a, b) => b.price - a.price);
    const paid = U.round2(group.reduce((s, r) => s + r.paid, 0));
    const value = U.round2(group.reduce((s, r) => s + r.value, 0));
    const diff = U.round2(value - paid);

    S.ov.classList.add('is-summary');
    S.ov.classList.remove('is-boost');
    S.skip.hidden = true;
    setTitle(group.length > 1 ? `Packs ${from + 1}–${to + 1} of ${results.length}` : results.length > 1 ? `Pack ${to + 1} of ${results.length}` : 'Results');
    stage.className = 'ov-stage stage-summary';
    stage.innerHTML = '';

    const sold = new Set();
    let soldTotal = 0;
    const pulledEl = h('b', null, U.money(0));
    PP.ui.countUp(pulledEl, 0, value, 900);
    const soldEl = h('b', null, '');
    const soldStat = sumStat('Sold', soldEl, 'is-good');
    soldStat.hidden = true;
    const stats = h(
      'div',
      { class: 'sum-stats' },
      sumStat('Paid', U.money(paid)),
      sumStat('Pulled', pulledEl),
      sumStat('Net', `${diff >= 0 ? '+' : '−'}${U.money(Math.abs(diff))}`, diff >= 0 ? 'is-good' : 'is-bad'),
      soldStat
    );

    const best = pulls.reduce((a, b) => (b.price > a.price ? b : a), pulls[0]);
    const heroCard = C().cardEl(best.card, { variant: best.variant, tier: best.tier, big: true, eager: true, interactive: true, auto: true });
    const hero = h(
      'div',
      { class: `sum-hero tier-${best.tier}` },
      h('div', { class: 'sum-hero__label' }, PP.ui.icon('trophy'), 'Best pull'),
      h('div', { class: 'sum-hero__card' }, heroCard),
      h('div', { class: 'sum-hero__name' }, best.card.n),
      h('div', { class: 'sum-hero__meta' }, [PP.ui.rarityEl(best.tier), PP.ui.variantChip(best.variant)].filter(Boolean)),
      h('div', { class: 'sum-hero__price' }, U.money(best.price))
    );

    const markSold = (tile, btn) => {
      btn.disabled = true;
      btn.replaceChildren('Sold');
      tile.classList.add('is-sold');
    };
    const updateSold = () => {
      soldStat.hidden = !soldTotal;
      soldEl.textContent = U.money(soldTotal);
    };
    const tiles = pulls.map((p, i) => {
      const card = C().cardEl(p.card, { variant: p.variant, tier: p.tier, interactive: true });
      const btn = h('button', { class: 'btn btn--sm btn--sell' }, PP.ui.icon('tag'), U.money(p.price));
      const tile = h(
        'div',
        { class: `sum-tile tier-${p.tier}`, style: `--d:${Math.min(i, 30) * 35}ms` },
        h('div', { class: 'sum-tile__card' }, card, p.isNew ? h('span', { class: 'ribbon-new' }, 'NEW') : null),
        h('div', { class: 'sum-tile__name', title: p.card.n }, p.card.n),
        h('div', { class: 'sum-tile__meta' }, [PP.ui.rarityEl(p.tier, { short: true }), PP.ui.variantChip(p.variant)].filter(Boolean)),
        btn
      );
      btn.addEventListener('click', () => {
        if (sold.has(i) || !G.state.cards[p.key]) return;
        soldTotal = U.round2(soldTotal + G.sell(p.key, 1));
        sold.add(i);
        sfx().sell();
        markSold(tile, btn);
        updateSold();
      });
      tile._btn = btn;
      return tile;
    });

    const sellAll = h('button', { class: 'btn' }, PP.ui.icon('tag'), 'Sell all');
    sellAll.addEventListener('click', () => {
      const idxs = pulls.map((_, i) => i).filter((i) => !sold.has(i) && G.state.cards[pulls[i].key]);
      if (!idxs.length) return;
      const { gain } = G.sellMany(idxs.map((i) => [pulls[i].key, 1]));
      soldTotal = U.round2(soldTotal + gain);
      idxs.forEach((i) => {
        sold.add(i);
        markSold(tiles[i], tiles[i]._btn);
      });
      sfx().coin();
      updateSold();
    });

    const actions = [h('div', { class: 'sum-wallet' }, 'Wallet', h('b', { 'data-bind': 'money' }, U.money(G.state.money))), sellAll];
    const remaining = results.length - 1 - to;
    let primary;
    if (remaining > 0) {
      actions.push(h('button', { class: 'btn btn--glass', onclick: () => (sfx().tap(), showSummary(to + 1, results.length - 1)) }, `Open all ${remaining}`));
      primary = h('button', { class: 'btn btn--primary', onclick: () => ((S.index = to + 1), showPack()) }, `Next pack · ${to + 2}/${results.length}`, PP.ui.icon('right'));
      actions.push(primary);
    } else {
      const again = h('button', { class: 'btn btn--buy' }, opts.againLabel || `Open another · ${U.money(model.price)}`);
      const refresh = () => (again.disabled = !opts.onAgain || G.state.money < (opts.againPrice || model.price));
      again.addEventListener('click', () => {
        const next = opts.onAgain && opts.onAgain();
        if (next) open(next.model || model, next.results, { ...opts, ...next.opts });
        else refresh();
      });
      refresh();
      onWallet = refresh;
      actions.push(again);
      primary = again;
    }
    const done = h('button', { class: 'btn btn--glass', onclick: close }, 'Done');
    actions.push(done);

    stage.append(
      h(
        'div',
        { class: 'summary' },
        hero,
        h('div', { class: 'sum-main' }, h('div', { class: 'sum-head' }, stats), h('div', { class: 'sum-grid' }, tiles)),
        h('div', { class: 'sum-actions' }, actions)
      )
    );
    setKeys((e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && remaining > 0) primary.click();
    });
  }

  PP.opener = { open, close };
})(typeof window !== 'undefined' ? window : globalThis);
