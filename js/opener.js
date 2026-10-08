// The pack-opening experience: tear the pack, swipe through cards, then a summary.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const G = PP.game;
  const h = U.h;

  let keyHandler = null;
  let onWalletChange = null;
  G.onChange(() => onWalletChange && onWalletChange());

  function close() {
    const ov = document.getElementById('overlay');
    ov.classList.add('hidden');
    ov.innerHTML = '';
    document.body.classList.remove('no-scroll');
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    onWalletChange = null;
  }

  function preload(pulls) {
    for (const p of pulls) {
      new Image().src = p.card.img;
      if (E.tierRank(p.tier) >= E.tierRank('RH')) new Image().src = p.card.big;
    }
  }

  function setKeys(fn) {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = fn;
    document.addEventListener('keydown', fn);
  }

  // opts.onAgain(): buy & open another of the same pack; returns a result or null.
  function open(model, result, opts = {}) {
    const ov = document.getElementById('overlay');
    ov.innerHTML = '';
    ov.classList.remove('hidden');
    document.body.classList.add('no-scroll');
    preload(result.pulls);

    const stage = h('div', { class: 'open-stage' });
    const hint = h('div', { class: 'open-hint' }, 'Tap or swipe across the pack to tear it open');
    const pack = PP.ui.packEl(model.set, { big: true, size: model.size });
    const skip = h('button', { class: 'btn ghost open-skip', onclick: () => summary(model, result, opts) }, 'Skip to results');
    stage.append(h('div', { class: 'pack-wrap' }, pack), hint);
    ov.append(stage, skip);

    let torn = false;
    let startX = null;
    const tear = () => {
      if (torn) return;
      torn = true;
      pack.classList.add('tearing');
      hint.textContent = '';
      setTimeout(() => reveal(stage, model, result, opts), 750);
    };
    pack.addEventListener('pointerdown', (e) => (startX = e.clientX));
    pack.addEventListener('pointermove', (e) => {
      if (startX != null && Math.abs(e.clientX - startX) > 50) tear();
    });
    pack.addEventListener('click', tear);
    setKeys((e) => {
      if (e.key === 'Escape') summary(model, result, opts);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        tear();
      }
    });
  }

  function reveal(stage, model, result, opts) {
    const pulls = result.pulls;
    stage.innerHTML = '';
    const stack = h('div', { class: 'stack' });
    const info = h('div', { class: 'reveal-info' });
    const counter = h('div', { class: 'reveal-counter' });
    stage.append(counter, stack, info);

    const els = pulls.map((p, i) => {
      const special = E.tierRank(p.tier) >= E.tierRank('DR');
      const big = E.tierRank(p.tier) >= E.tierRank('RH');
      const el = h(
        'div',
        { class: `reveal-card tier-${p.tier}` + (special ? ' facedown' : '') + (PP.ui.isShiny(p.tier, p.variant) ? ' shiny' : ''), style: `z-index:${pulls.length - i}` },
        h(
          'div',
          { class: 'flip' },
          h('div', { class: 'face front' }, PP.ui.cardImg(p.card, { big, eager: true }), h('div', { class: 'glare' })),
          h('div', { class: 'face back' }, PP.ui.cardBack())
        )
      );
      el.style.setProperty('--i', Math.min(i, 4));
      stack.append(el);
      return el;
    });

    let idx = 0;
    const show = () => {
      counter.textContent = `${idx + 1} / ${pulls.length}`;
      els.forEach((el, i) => el.style.setProperty('--depth', Math.min(i - idx, 4)));
      const p = pulls[idx];
      const el = els[idx];
      el.classList.add('top');
      PP.ui.attachTilt(el);
      info.innerHTML = '';
      if (el.classList.contains('facedown')) {
        info.append(h('div', { class: 'reveal-tease' }, 'Something special… tap to flip'));
        return;
      }
      info.append(
        h('div', { class: 'reveal-name' }, p.card.n),
        h(
          'div',
          { class: 'reveal-meta' },
          PP.ui.tierBadge(p.tier),
          /reverse/i.test(p.variant) ? h('span', { class: 'badge variant' }, 'Reverse Holo') : null,
          p.isNew ? h('span', { class: 'badge new' }, 'NEW') : null,
          h('span', { class: 'reveal-price' }, U.money(p.price))
        )
      );
    };
    const advance = () => {
      const el = els[idx];
      if (!el) return;
      if (el.classList.contains('facedown')) {
        el.classList.remove('facedown');
        el.classList.add('flipping');
        const flash = `flash-${pulls[idx].tier}`;
        stage.classList.add('flash', flash);
        setTimeout(() => stage.classList.remove('flash', flash), 900);
        show();
        return;
      }
      el.classList.add('fly');
      idx += 1;
      setTimeout(() => el.remove(), 450);
      if (idx >= pulls.length) setTimeout(() => summary(model, result, opts), 350);
      else show();
    };
    stack.addEventListener('click', advance);
    setKeys((e) => {
      if (e.key === 'Escape') summary(model, result, opts);
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      }
    });
    show();
  }

  function summary(model, result, opts) {
    const ov = document.getElementById('overlay');
    ov.innerHTML = '';
    let soldTotal = 0;
    const sold = new Set();
    const net = h('div', { class: 'sum-net' });
    const updateNet = () => {
      const diff = U.round2(result.value - result.paid);
      net.innerHTML = '';
      net.append(
        h('span', null, `Paid ${U.money(result.paid)}`),
        h('span', null, `Pulled ${U.money(result.value)}`),
        h('span', { class: diff >= 0 ? 'good' : 'bad' }, `${diff >= 0 ? '+' : ''}${U.money(diff)}`)
      );
      if (soldTotal) net.append(h('span', { class: 'good' }, `Sold for ${U.money(soldTotal)}`));
    };

    const sellBtn = (p, i) => {
      const btn = h('button', { class: 'btn small' }, `Sell ${U.money(p.price)}`);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sold.has(i) || !G.state.cards[p.key]) return;
        soldTotal = U.round2(soldTotal + G.sell(p.key, 1));
        sold.add(i);
        markSold(btn);
        updateNet();
      });
      return btn;
    };
    const markSold = (btn) => {
      btn.disabled = true;
      btn.textContent = 'Sold';
      btn.closest('.sum-card').classList.add('sold');
    };

    const buttons = [];
    const grid = h(
      'div',
      { class: 'sum-grid' },
      result.pulls.map((p, i) => {
        const btn = sellBtn(p, i);
        buttons.push(btn);
        return h(
          'div',
          { class: `sum-card tier-${p.tier}` + (PP.ui.isShiny(p.tier, p.variant) ? ' shiny' : ''), style: `--d:${i * 40}ms` },
          h('div', { class: 'sum-img' }, PP.ui.cardImg(p.card), p.isNew ? h('span', { class: 'badge new corner' }, 'NEW') : null),
          h('div', { class: 'sum-name', title: p.card.n }, p.card.n),
          h('div', { class: 'sum-sub' }, E.variantLabel(p.variant), ' · ', E.TIER_LABEL[p.tier]),
          btn
        );
      })
    );

    const sellAll = h('button', { class: 'btn' }, 'Sell all');
    sellAll.addEventListener('click', () => {
      const items = [];
      result.pulls.forEach((p, i) => {
        if (!sold.has(i)) items.push([p.key, 1, i]);
      });
      const { gain } = G.sellMany(items.map(([k, q]) => [k, q]));
      soldTotal = U.round2(soldTotal + gain);
      items.forEach(([, , i]) => {
        sold.add(i);
        markSold(buttons[i]);
      });
      updateNet();
    });

    const again = h('button', { class: 'btn primary' }, `Open another · ${U.money(model.price)}`);
    const refreshAgain = () => {
      again.disabled = G.state.money < model.price;
    };
    again.addEventListener('click', () => {
      const next = opts.onAgain && opts.onAgain();
      if (next) open(model, next, opts);
      else refreshAgain();
    });
    refreshAgain();

    const done = h('button', { class: 'btn ghost' }, 'Done');
    done.addEventListener('click', () => {
      close();
      opts.onClose && opts.onClose();
    });

    updateNet();
    ov.append(
      h(
        'div',
        { class: 'summary' },
        h('div', { class: 'sum-head' }, h('h2', null, model.set.name), net),
        grid,
        h('div', { class: 'sum-actions' }, h('div', { class: 'sum-wallet' }, 'Wallet: ', h('b', { 'data-bind': 'money' }, U.money(G.state.money))), sellAll, again, done)
      )
    );
    onWalletChange = refreshAgain;
    setKeys((e) => {
      if (e.key === 'Escape') done.click();
    });
  }

  PP.opener = { open, close };
})(typeof window !== 'undefined' ? window : globalThis);
