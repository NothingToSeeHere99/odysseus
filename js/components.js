// Reusable visual pieces: booster packs, card backs, card tiles, holo tilt.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const h = U.h;

  const ERA_LABEL = { wotc: 'Booster', reverse: 'Booster', sv: 'Booster', mini: 'Promo Pack' };

  function packEl(set, opts = {}) {
    const hue = U.hashStr(set.id) % 360;
    const size = opts.size ? `${opts.size} cards` : '';
    return h(
      'div',
      { class: 'pack' + (opts.big ? ' pack-big' : ''), style: `--h:${hue}` },
      h('div', { class: 'pack-top' }, h('div', { class: 'crimp' })),
      h(
        'div',
        { class: 'pack-body' },
        h('div', { class: 'pack-series' }, set.series),
        h(
          'div',
          { class: 'pack-logo' },
          set.logo
            ? h('img', {
                src: set.logo,
                alt: set.name,
                draggable: 'false',
                onerror: (e) => e.target.replaceWith(h('span', { class: 'pack-logo-text' }, set.name)),
              })
            : h('span', { class: 'pack-logo-text' }, set.name)
        ),
        h('div', { class: 'pack-emblem' }),
        h('div', { class: 'pack-foot' }, h('span', null, ERA_LABEL[E.eraOf(set)]), h('span', null, size))
      ),
      h('div', { class: 'crimp crimp-bottom' }),
      h('div', { class: 'pack-shine' })
    );
  }

  function cardBack() {
    return h('div', { class: 'card-back' }, h('div', { class: 'card-back-ball' }));
  }

  function tierBadge(tier) {
    return h('span', { class: `badge tier-${tier}` }, E.TIER_LABEL[tier]);
  }

  // Interactive tilt + light glare that follows the pointer.
  function attachTilt(el) {
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--rx', `${(0.5 - y) * 18}deg`);
      el.style.setProperty('--ry', `${(x - 0.5) * 22}deg`);
      el.style.setProperty('--mx', `${x * 100}%`);
      el.style.setProperty('--my', `${y * 100}%`);
      el.classList.add('tilting');
    };
    const leave = () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.classList.remove('tilting');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return el;
  }

  function cardImg(meta, opts = {}) {
    return h('img', {
      class: 'card-img',
      src: opts.big ? meta.big || meta.img : meta.img,
      alt: meta.n,
      loading: opts.eager ? 'eager' : 'lazy',
      draggable: 'false',
      onerror: (e) => e.target.classList.add('img-missing'),
    });
  }

  function isShiny(tier, variant) {
    return E.tierRank(tier) >= E.tierRank('RH') || /holo/i.test(variant);
  }

  PP.ui = PP.ui || {};
  Object.assign(PP.ui, { packEl, cardBack, tierBadge, attachTilt, cardImg, isShiny });
})(typeof window !== 'undefined' ? window : globalThis);
