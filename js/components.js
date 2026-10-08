// Reusable visual pieces: icons, booster packs, card backs, rarity marks.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const h = U.h;

  const ICONS = {
    shop: '<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    binder: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5z"/><path d="M9 3v18"/><path d="M12.5 8h3.5M12.5 12h3.5"/>',
    cards: '<rect x="8" y="3" width="12" height="16" rx="2"/><path d="M5 6.5v12A2.5 2.5 0 0 0 7.5 21H15"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 13h18"/><path d="M12 8C10 4 6 4 6 6.5S9 8 12 8zm0 0c2-4 6-4 6-1.5S15 8 12 8z"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.5"/><path d="M20 3.5v5h-5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  };

  function icon(name, cls = '') {
    const el = h('span', { class: 'ico ' + cls, 'aria-hidden': 'true' });
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return el;
  }

  function hueOf(set) {
    return U.hashStr(set.id) % 360;
  }

  // A foil booster wrapper. The cap is a separate piece so it can be torn off.
  function packEl(set, opts = {}) {
    const model = opts.model;
    const mystery = !!opts.mystery;
    const promo = !mystery && E.isPromo(set);
    const art = !mystery && model && model.art;
    const size = model ? model.size : opts.size;
    const style = `--h:${mystery ? 268 : hueOf(set)}` + (art ? `;--art:url("${String(art).replace(/"/g, '')}")` : '');
    const logo = mystery
      ? h('div', { class: 'pack__q' }, '?')
      : set.logo
        ? h('img', {
            src: set.logo,
            alt: set.name,
            draggable: 'false',
            onerror: (e) => e.target.replaceWith(h('span', { class: 'pack__logo-text' }, set.name)),
          })
        : h('span', { class: 'pack__logo-text' }, set.name);
    const el = h(
      'div',
      { class: 'pack' + (opts.big ? ' pack--big' : '') + (mystery ? ' pack--mystery' : '') + (promo ? ' pack--promo' : '') + (art ? ' has-art' : ''), style },
      h('div', { class: 'pack__cap' }),
      h(
        'div',
        { class: 'pack__body' },
        h('div', { class: 'pack__art' }),
        h('div', { class: 'pack__logo' }, logo),
        h('div', { class: 'pack__band' }, mystery ? 'Mystery Pack' : promo ? '★ Promo Pack ★' : 'Booster Pack'),
        h(
          'div',
          { class: 'pack__foot' },
          h('span', null, size ? `${size} cards` : ''),
          !mystery && set.symbol ? h('img', { class: 'pack__symbol', src: set.symbol, alt: '', onerror: (e) => e.target.remove() }) : null
        )
      )
    );
    // Don't use a card-back placeholder picture as the wrapper's artwork.
    if (art && PP.card) PP.card.checkImage(art).then((isBack) => isBack && el.classList.remove('has-art'));
    return el;
  }

  function cardBack() {
    return h('div', { class: 'card-back' }, h('div', { class: 'card-back__burst' }), h('div', { class: 'card-back__mark' }), h('div', { class: 'card-back__word' }, 'PACK RUSH'));
  }

  // Rarity marks in the style printed on modern cards.
  const SYMBOLS = { C: '●', U: '◆', R: '★', RH: '★', DR: '★★', IR: '★', UR: '★★', SR: '★★★' };
  function rarityEl(tier, opts = {}) {
    return h('span', { class: `rarity r-${tier}` }, h('span', { class: 'rarity__sym' }, SYMBOLS[tier]), opts.short ? null : h('span', { class: 'rarity__label' }, E.TIER_LABEL[tier]));
  }

  function chip(text, cls = '') {
    return h('span', { class: 'chip ' + cls }, text);
  }

  function variantChip(variant) {
    if (/reverse/i.test(variant)) return chip('Reverse Holo', 'chip--foil');
    if (/1stEdition/.test(variant)) return chip('1st Edition', 'chip--gold');
    if (/holo/i.test(variant)) return chip('Holo', 'chip--foil');
    return null;
  }

  function isShiny(tier, variant) {
    return E.tierRank(tier) >= E.tierRank('RH') || /holo/i.test(variant || '');
  }

  // Animate a money figure between two values.
  function countUp(el, from, to, ms = 700) {
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = U.money(from + (to - from) * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  PP.ui = PP.ui || {};
  Object.assign(PP.ui, { icon, hueOf, packEl, cardBack, rarityEl, chip, variantChip, isShiny, countUp });
})(typeof window !== 'undefined' ? window : globalThis);
