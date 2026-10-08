// Views (shop, binder, collection, profile), routing, modals and toasts.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const G = PP.game;
  const API = PP.api;
  const C = PP.card;
  const sfx = PP.sfx;
  const h = U.h;
  const ui = PP.ui;

  const view = () => document.getElementById('view');
  let renderToken = 0;

  // ---- toasts & modal ----------------------------------------------------

  function toast(msg, kind = '') {
    const ico = kind === 'good' ? 'sparkle' : kind === 'bad' ? 'info' : 'info';
    const el = h('div', { class: `toast ${kind}` }, ui.icon(ico), h('span', null, msg));
    document.getElementById('toasts').append(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  function closeModal() {
    const m = document.getElementById('modal');
    m.className = 'modal hidden';
    m.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function openModal(content, opts = {}) {
    const m = document.getElementById('modal');
    m.innerHTML = '';
    m.className = 'modal' + (opts.dark ? ' modal--dark' : '') + (opts.cls ? ' ' + opts.cls : '');
    if (opts.style) m.setAttribute('style', opts.style);
    else m.removeAttribute('style');
    m.append(h('div', { class: 'modal__box' + (opts.wide ? ' modal__box--wide' : '') }, h('button', { class: 'modal__x', onclick: closeModal, 'aria-label': 'Close' }, ui.icon('close')), content));
    document.body.classList.add('modal-open');
  }

  function confirmBox(title, text, okLabel, onOk) {
    openModal(
      h(
        'div',
        { class: 'confirm' },
        h('h3', null, title),
        h('p', { class: 'muted' }, text),
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
          h('button', { class: 'btn btn--primary', onclick: () => (closeModal(), onOk()) }, okLabel)
        )
      )
    );
  }

  // ---- header ------------------------------------------------------------

  let shownMoney = null;
  function updateHeader() {
    const money = G.state.money;
    const bal = document.getElementById('balance');
    if (shownMoney != null && Math.abs(money - shownMoney) >= 0.01) {
      ui.countUp(bal, shownMoney, money, 600);
      const chip = document.getElementById('wallet');
      chip.classList.remove('bump-up', 'bump-down');
      void chip.offsetWidth;
      chip.classList.add(money > shownMoney ? 'bump-up' : 'bump-down');
    } else bal.textContent = U.money(money);
    shownMoney = money;
    document.querySelectorAll('[data-bind=money]').forEach((el) => (el.textContent = U.money(money)));
    document.querySelectorAll('[data-bind=value]').forEach((el) => (el.textContent = U.money(G.collectionValue())));
    document.querySelectorAll('[data-afford]').forEach((el) => (el.disabled = money < Number(el.dataset.afford)));
  }

  const notifiedGrades = new Set();

  function tick() {
    const now = Date.now();
    const gained = G.accrue(now);
    if (gained) {
      toast(`+${U.money(gained)} income collected`, 'good');
      sfx.coin();
    }
    const ready = G.gradingJobs().filter((j) => j.ready <= now);
    const colTab = document.querySelector('#tabs [data-view=collection]');
    if (colTab) colTab.dataset.badge = ready.length ? String(ready.length) : '';
    const fresh = ready.filter((j) => !notifiedGrades.has(j.uid));
    if (fresh.length) {
      fresh.forEach((j) => notifiedGrades.add(j.uid));
      toast(`${fresh.length > 1 ? `${fresh.length} cards are` : 'A card is'} back from the grader! Open your Collection to reveal.`, 'good');
      if (currentRoute().name === 'collection' && !document.body.classList.contains('no-scroll') && !document.body.classList.contains('modal-open')) render();
    }
    const left = G.nextIncomeIn(now);
    document.getElementById('incomeText').textContent = U.fmtDuration(left);
    document.getElementById('incomeRing').style.setProperty('--p', (1 - left / PP.HOUR).toFixed(4));
    document.querySelectorAll('[data-countdown]').forEach((el) => (el.textContent = U.fmtDuration(Number(el.dataset.countdown) - now)));
    const end = E.rotationEndsAt(now);
    document.querySelectorAll('[data-rotation-bar]').forEach((el) => el.style.setProperty('--p', (1 - (end - now) / E.ROTATION_MS).toFixed(4)));
    if (shownRotation != null && E.rotationIndex(now) !== shownRotation && currentRoute().name === 'shop') {
      toast('The shop has restocked with new packs!', 'good');
      render();
    }
  }

  function updateSoundBtn() {
    const b = document.getElementById('soundBtn');
    b.replaceChildren(ui.icon(sfx.muted ? 'soundOff' : 'soundOn'));
    b.setAttribute('aria-label', sfx.muted ? 'Unmute sounds' : 'Mute sounds');
    b.classList.toggle('is-off', sfx.muted);
  }

  // ---- routing -----------------------------------------------------------

  function currentRoute() {
    const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'shop').split('/');
    return { name, arg: arg && decodeURIComponent(arg) };
  }

  function render() {
    const { name, arg } = currentRoute();
    document.querySelectorAll('#tabs [data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
    const token = ++renderToken;
    const v = view();
    v.innerHTML = '';
    v.className = 'view view--' + name;
    window.scrollTo(0, 0);
    const views = { shop: renderShop, binder: arg ? (el, t) => renderBinderSet(el, t, arg) : renderBinder, collection: renderCollection, profile: renderProfile };
    (views[name] || renderShop)(v, token);
  }

  const stale = (token) => token !== renderToken;

  function loading(text) {
    return h('div', { class: 'loading' }, h('div', { class: 'spinner' }), text);
  }

  function errorBox(err, retry) {
    return h(
      'div',
      { class: 'error-box' },
      ui.icon('info', 'ico--lg'),
      h('h3', null, 'Couldn’t reach the card database'),
      h('p', { class: 'muted' }, String(err && err.message ? err.message : err)),
      h('p', { class: 'muted small' }, 'The free Pokémon TCG API can be slow, rate limited or offline. You can add an API key or set up Scrydex as a backup on the Profile tab.'),
      h('button', { class: 'btn btn--primary', onclick: retry }, ui.icon('refresh'), 'Try again')
    );
  }

  function emptyState(title, text) {
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'empty__art' }, ui.cardBack()),
      h('h2', null, title),
      h('p', { class: 'muted' }, text),
      h('a', { class: 'btn btn--buy', href: '#shop' }, ui.icon('shop'), 'Visit the shop')
    );
  }

  function pageHead(title, sub, extra) {
    return h('header', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', { class: 'muted' }, sub) : null), extra || null);
  }

  // Fetch a set's cards and keep prices of owned cards fresh as a side effect.
  async function setCards(setId, force) {
    const cards = await API.getSetCards(setId, force);
    G.updateMeta(cards);
    return cards;
  }

  // A set's pack pool includes sub-sets pulled from the same packs (Trainer Gallery etc.).
  async function packCards(set) {
    const ids = [set.id, ...(E.SUBSETS[set.id] || [])];
    const lists = await Promise.all(
      ids.map((id, i) =>
        setCards(id).catch((e) => {
          if (i === 0) throw e;
          return [];
        })
      )
    );
    return lists.flat();
  }

  // ---- shop --------------------------------------------------------------

  let shownRotation = null;
  const modelCache = new Map(); // `${rotation}:${setId}` -> Promise<model>

  function getModel(set, rotation) {
    const key = `${rotation}:${set.id}`;
    if (!modelCache.has(key)) {
      const p = packCards(set).then((cards) => {
        if (!cards.length) throw new Error('This set has no card data yet');
        return E.packModel(set, cards);
      });
      p.catch(() => modelCache.delete(key));
      modelCache.set(key, p);
    }
    return modelCache.get(key);
  }

  function priceButton(label, price, onclick, cls = 'btn--buy') {
    return h('button', { class: `btn ${cls}`, 'data-afford': price, disabled: G.state.money < price, onclick }, label, h('span', { class: 'btn__price' }, U.money(price)));
  }

  function setYear(set) {
    return set.date ? U.yearOf(set.date) : '';
  }

  async function renderShop(v, token) {
    const now = Date.now();
    shownRotation = E.rotationIndex(now);
    const end = E.rotationEndsAt(now);
    const hero = h('section', { class: 'hero is-loading' }, h('div', { class: 'hero__copy' }, h('div', { class: 'skel skel--line w40' }), h('div', { class: 'skel skel--title' }), h('div', { class: 'skel skel--line w60' })), h('div', { class: 'hero__visual' }, h('div', { class: 'skel skel--pack' })));
    const restock = h(
      'div',
      { class: 'restock' },
      ui.icon('clock'),
      h('div', null, h('span', { class: 'restock__label' }, 'Restocks in'), h('b', { 'data-countdown': end }, U.fmtDuration(end - now))),
      h('div', { class: 'restock__bar', 'data-rotation-bar': '' }, h('i'))
    );
    const grid = h('div', { class: 'shop-grid' });
    v.append(hero, h('div', { class: 'section-head' }, h('div', null, h('h2', null, 'Rotating packs'), h('p', { class: 'muted' }, 'Thirteen packs from across the game’s history, including a Black Star promo pack, plus a mystery pack. The lineup changes every 12 hours.')), restock), grid);
    tick();

    let sets;
    try {
      sets = await API.getSets();
    } catch (e) {
      if (stale(token)) return;
      hero.replaceWith(errorBox(e, render));
      grid.remove();
      return;
    }
    if (stale(token)) return;

    const { featured, rotation } = E.shopSets(sets, now);
    const tiles = rotation.map((set) => {
      const tile = skeletonTile(set);
      grid.append(tile);
      return { set, tile };
    });
    const mystery = mysteryTile();
    grid.append(mystery);

    const models = [];
    const jobs = [];
    if (featured) jobs.push({ set: featured, done: (m) => fillHero(hero, m), fail: (e) => hero.replaceWith(errorBox(e, render)) });
    else hero.remove();
    for (const { set, tile } of tiles) {
      jobs.push({
        set,
        done: (m) => {
          models.push(m);
          fillTile(tile, m);
        },
        fail: () => failTile(tile, set),
      });
    }
    // A few at a time to stay friendly with the API's rate limit.
    const worker = async () => {
      while (jobs.length) {
        const job = jobs.shift();
        try {
          const m = await getModel(job.set, shownRotation);
          if (stale(token)) return;
          job.done(m);
        } catch (e) {
          if (stale(token)) return;
          job.fail(e);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (stale(token)) return;
    fillMystery(mystery, models);
  }

  function skeletonTile(set) {
    return h(
      'article',
      { class: 'ptile is-loading', style: `--h:${ui.hueOf(set)}` },
      h('div', { class: 'ptile__stage' }, h('div', { class: 'skel skel--pack' })),
      h('div', { class: 'ptile__body' }, h('div', { class: 'ptile__name' }, set.name), h('div', { class: 'skel skel--line w60' }), h('div', { class: 'skel skel--btn' }))
    );
  }

  function failTile(tile, set) {
    tile.classList.remove('is-loading');
    tile.querySelector('.ptile__body').replaceChildren(h('div', { class: 'ptile__name' }, set.name), h('p', { class: 'muted small' }, 'Couldn’t load this pack.'), h('button', { class: 'btn btn--sm', onclick: render }, ui.icon('refresh'), 'Retry'));
  }

  function stagePack(model, opts = {}) {
    const pack = ui.packEl(model.set, { model, ...opts });
    C.interactive(pack);
    return pack;
  }

  function fillTile(tile, model) {
    const { set } = model;
    tile.classList.remove('is-loading');
    const pack = stagePack(model);
    pack.addEventListener('click', () => showPackDetails(model));
    tile.querySelector('.ptile__stage').replaceChildren(pack);
    const top = model.chase[0];
    tile.querySelector('.ptile__body').replaceChildren(
      h('div', { class: 'ptile__chips' }, ui.chip(E.BUCKET_LABEL[model.bucket], `chip--era chip--${model.bucket}`), ui.chip(String(setYear(set)))),
      h('h3', { class: 'ptile__name', title: set.name }, set.name),
      h('div', { class: 'ptile__sub' }, `${set.series} · ${model.size} cards`),
      top ? h('div', { class: 'ptile__chase' }, ui.icon('sparkle'), h('span', null, 'Top pull: ', h('b', null, top.card.n)), h('span', { class: 'ptile__chase-price' }, U.money(top.value))) : null,
      priceButton('Buy', model.price, () => buy(model, 1)),
      h(
        'div',
        { class: 'ptile__links' },
        h('button', { class: 'link', 'data-afford': model.bundle, disabled: G.state.money < model.bundle, onclick: () => buy(model, E.BUNDLE_SIZE) }, ui.icon('gift'), `×${E.BUNDLE_SIZE} · ${U.money(model.bundle)}`),
        h('button', { class: 'link', onclick: () => showPackDetails(model) }, ui.icon('info'), 'Odds & cards')
      )
    );
  }

  function mysteryTile() {
    const set = { id: 'mystery', name: 'Mystery Pack', series: 'Any era' };
    return h(
      'article',
      { class: 'ptile ptile--mystery is-loading' },
      h('div', { class: 'ptile__stage' }, ui.packEl(set, { mystery: true })),
      h('div', { class: 'ptile__body' }, h('div', { class: 'ptile__chips' }, ui.chip('Mystery', 'chip--era chip--mystery')), h('h3', { class: 'ptile__name' }, 'Mystery Pack'), h('div', { class: 'ptile__sub' }, 'Pricing…'), h('div', { class: 'skel skel--btn' }))
    );
  }

  function fillMystery(tile, models) {
    if (!models.length) return tile.remove();
    const price = E.mysteryPrice(models);
    tile.classList.remove('is-loading');
    const pack = tile.querySelector('.pack');
    C.interactive(pack);
    tile.querySelector('.ptile__body').replaceChildren(
      h('div', { class: 'ptile__chips' }, ui.chip('Mystery', 'chip--era chip--mystery'), ui.chip(`${models.length} possible`)),
      h('h3', { class: 'ptile__name' }, 'Mystery Pack'),
      h('div', { class: 'ptile__sub' }, 'A random pack from this rotation. Every pack is equally likely, from the cheapest to the most expensive.'),
      priceButton('Buy', price, () => buyMystery(models, price))
    );
  }

  function fillHero(hero, model) {
    const { set } = model;
    hero.className = 'hero';
    hero.style.setProperty('--h', ui.hueOf(set));
    const fan = h(
      'div',
      { class: 'hero__fan' },
      model.chase.slice(0, 2).map((c, i) => {
        const el = C.cardEl(c.card, { tier: E.tierOf(c.card), variant: 'holofoil', interactive: true, className: `fan-${i}` });
        el.addEventListener('click', () => showPackDetails(model));
        return el;
      })
    );
    const released = new Date(U.parseDate(set.date)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    hero.replaceChildren(
      h('div', { class: 'hero__bg' }),
      h(
        'div',
        { class: 'hero__copy' },
        h('span', { class: 'eyebrow' }, ui.icon('sparkle'), 'Newest release · Always in stock'),
        set.logo ? h('img', { class: 'hero__logo', src: set.logo, alt: set.name, onerror: (e) => e.target.remove() }) : null,
        h('h1', { class: 'hero__title' }, set.name),
        h('p', { class: 'hero__sub' }, `${set.series} · Released ${released} · ${model.size} cards per pack`),
        h(
          'div',
          { class: 'hero__buy' },
          priceButton('Buy pack', model.price, () => buy(model, 1)),
          priceButton(h('span', null, ui.icon('gift'), `Bundle ×${E.BUNDLE_SIZE}`), model.bundle, () => buy(model, E.BUNDLE_SIZE), 'btn--glass'),
          h('button', { class: 'btn btn--ghost', onclick: () => showPackDetails(model) }, ui.icon('info'), 'Odds & cards')
        )
      ),
      h('div', { class: 'hero__visual' }, fan, h('div', { class: 'hero__pack' }, stagePack(model)))
    );
  }

  function showPackDetails(model) {
    const { set } = model;
    const odds = E.packOdds(model);
    const chase = h(
      'div',
      { class: 'chase-grid' },
      model.chase.map((c) =>
        h(
          'div',
          { class: 'chase' },
          C.cardEl(c.card, { tier: E.tierOf(c.card), variant: 'holofoil', interactive: true }),
          h('div', { class: 'chase__name', title: c.card.n }, c.card.n),
          h('div', { class: 'chase__price' }, U.money(c.value))
        )
      )
    );
    const oddsRows = odds.map((o) => {
      const one = o.p > 0 ? Math.max(1, Math.round(1 / o.p)) : null;
      return h(
        'div',
        { class: 'odds-row' },
        ui.rarityEl(o.tier),
        h('span', { class: 'odds-row__bar' }, h('i', { style: `width:${Math.max(2, Math.min(100, o.p * 100)).toFixed(1)}%` })),
        h('b', null, one === 1 ? 'Every pack' : `1 in ${one}`)
      );
    });
    const row = (label, value) => h('div', { class: 'kv' }, h('span', null, label), h('b', null, value));
    openModal(
      h(
        'div',
        { class: 'details', style: `--h:${ui.hueOf(set)}` },
        h(
          'div',
          { class: 'details__side' },
          h('div', { class: 'details__pack' }, stagePack(model)),
          priceButton('Buy pack', model.price, () => buy(model, 1)),
          priceButton(h('span', null, ui.icon('gift'), `Bundle ×${E.BUNDLE_SIZE}`), model.bundle, () => buy(model, E.BUNDLE_SIZE), 'btn--primary'),
          h('p', { class: 'muted small center' }, `Bundles save ${Math.round(E.BUNDLE_DISCOUNT * 100)}%.`)
        ),
        h(
          'div',
          { class: 'details__main' },
          h('div', { class: 'ptile__chips' }, ui.chip(E.BUCKET_LABEL[model.bucket], `chip--era chip--${model.bucket}`), ui.chip(String(setYear(set))), ui.chip(`${model.cardCount} cards in set`)),
          h('h2', null, set.name),
          h('p', { class: 'muted' }, `${set.series} · ${model.size} cards per pack`),
          h('h4', null, 'Chase cards'),
          chase,
          odds.length ? h('h4', null, 'Pull rates') : null,
          odds.length ? h('div', { class: 'odds' }, oddsRows) : null,
          h('h4', null, 'How this pack is priced'),
          h(
            'div',
            { class: 'breakdown' },
            row('Expected value of the cards', U.money(model.ev)),
            row('Store markup', `×${E.MARKUP} + ${U.money(E.BASE_COST)}`),
            row(`Sealed age premium (${model.years.toFixed(1)} years)`, `×${model.age.toFixed(2)}`),
            row('Shop price', U.money(model.price))
          )
        )
      ),
      { wide: true }
    );
  }

  function afterOpen() {
    if (currentRoute().name !== 'shop') render();
  }

  function buy(model, count) {
    const price = count > 1 ? model.bundle : model.price;
    const go = () => G.purchase(model, { count, price });
    let results;
    try {
      results = go();
    } catch (e) {
      sfx.error();
      toast(e.message, 'bad');
      return;
    }
    sfx.buy();
    closeModal();
    PP.opener.open(model, results, {
      againLabel: count > 1 ? `Another bundle · ${U.money(price)}` : `Open another · ${U.money(price)}`,
      againPrice: price,
      onAgain: () => {
        if (G.state.money < price) return null;
        sfx.buy();
        return { results: go() };
      },
      onClose: afterOpen,
    });
  }

  function buyMystery(models, price) {
    const pick = () => models[Math.floor(Math.random() * models.length)];
    const go = (model) => G.purchase(model, { price, label: `Mystery Pack (${model.set.name})` });
    const model = pick();
    let results;
    try {
      results = go(model);
    } catch (e) {
      sfx.error();
      toast(e.message, 'bad');
      return;
    }
    sfx.buy();
    PP.opener.open(model, results, {
      mystery: true,
      againLabel: `Another mystery · ${U.money(price)}`,
      againPrice: price,
      onAgain: () => {
        if (G.state.money < price) return null;
        sfx.buy();
        const m = pick();
        return { model: m, results: go(m) };
      },
      onClose: afterOpen,
    });
  }

  // ---- binder ------------------------------------------------------------

  async function renderBinder(v, token) {
    const summary = G.setSummary();
    const ids = Object.keys(summary);
    v.append(pageHead('Binder', 'Every set you’ve pulled from. Open one to flip through its pages.'));
    if (!ids.length) {
      v.append(emptyState('Your binder is empty', 'Open a few packs and your cards will be filed here, set by set.'));
      return;
    }
    const status = loading('Loading sets…');
    v.append(status);
    let sets = [];
    try {
      sets = await API.getSets();
    } catch {}
    if (stale(token)) return;
    status.remove();
    const byId = Object.fromEntries(sets.map((s) => [s.id, s]));
    const list = ids
      .map((id) => ({ id, set: byId[id] || { id, name: id, series: '', date: '', total: summary[id].unique.size }, s: summary[id] }))
      .sort((a, b) => U.parseDate(b.set.date) - U.parseDate(a.set.date));
    v.append(
      h(
        'div',
        { class: 'set-grid' },
        list.map(({ id, set, s }) => {
          const total = Math.max(set.total || 0, s.unique.size);
          const pct = s.unique.size / total;
          return h(
            'a',
            { class: 'set-tile', href: `#binder/${encodeURIComponent(id)}`, style: `--h:${ui.hueOf(set)}` },
            h('div', { class: 'set-tile__logo' }, set.logo ? h('img', { src: set.logo, alt: set.name, loading: 'lazy' }) : h('b', null, set.name)),
            h('div', { class: 'set-tile__ring', style: `--p:${pct.toFixed(4)}` }, h('span', null, `${Math.round(pct * 100)}%`)),
            h('div', { class: 'set-tile__name' }, set.name),
            h('div', { class: 'muted small' }, [set.series, setYear(set)].filter(Boolean).join(' · ')),
            h('div', { class: 'set-tile__foot' }, h('span', null, `${s.unique.size} / ${total}`), h('b', null, U.money(s.value)))
          );
        })
      )
    );
  }

  let redrawBinder = null;

  async function renderBinderSet(v, token, setId) {
    v.append(h('a', { class: 'back', href: '#binder' }, ui.icon('left'), 'All sets'));
    const status = loading('Opening binder…');
    v.append(status);
    let cards, sets;
    try {
      [cards, sets] = await Promise.all([setCards(setId), API.getSets()]);
    } catch (e) {
      if (stale(token)) return;
      status.replaceWith(errorBox(e, render));
      return;
    }
    if (stale(token)) return;
    status.remove();
    const set = sets.find((s) => s.id === setId) || { id: setId, name: setId, series: '' };
    cards = cards.slice().sort((a, b) => U.cmpNum(a.no, b.no));

    const copies = (id) => G.copiesOf(id);
    const owned = () => cards.filter((c) => copies(c.id).length).length;
    const perPage = 9;
    const spread = window.matchMedia('(min-width: 900px)').matches ? 2 : 1;
    let page = 0;
    let onlyOwned = false;

    const progress = h('div', { class: 'progress' }, h('i'));
    const countEl = h('span');
    const head = h(
      'header',
      { class: 'binder-head', style: `--h:${ui.hueOf(set)}` },
      set.logo ? h('img', { class: 'binder-head__logo', src: set.logo, alt: '' }) : null,
      h('div', { class: 'binder-head__text' }, h('h1', null, set.name), h('p', { class: 'muted' }, [set.series, setYear(set)].filter(Boolean).join(' · ')), progress, countEl),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', onchange: (e) => ((onlyOwned = e.target.checked), (page = 0), draw()) }), h('span', { class: 'switch__track' }), 'Only cards I own')
    );
    const book = h('div', { class: 'binder' });
    const prev = h('button', { class: 'binder-arrow left', 'aria-label': 'Previous page', onclick: () => turn(-1) }, ui.icon('left'));
    const next = h('button', { class: 'binder-arrow right', 'aria-label': 'Next page', onclick: () => turn(1) }, ui.icon('right'));
    const pager = h('div', { class: 'pager' });
    v.append(head, h('div', { class: 'binder-wrap' }, prev, book, next), pager);

    const turn = (dir) => {
      const before = page;
      page += dir * spread;
      draw();
      if (page !== before) {
        sfx.swoosh();
        book.classList.remove('turn-next', 'turn-prev');
        void book.offsetWidth;
        book.classList.add(dir > 0 ? 'turn-next' : 'turn-prev');
      }
    };

    const pocket = (c) => {
      if (!c) return h('div', { class: 'pocket is-empty' });
      const mine = copies(c.id);
      if (!mine.length) return h('div', { class: 'pocket is-missing' }, set.symbol ? h('img', { class: 'pocket__symbol', src: set.symbol, alt: '' }) : null, h('span', { class: 'pocket__no' }, `#${c.no}`), h('span', { class: 'pocket__name' }, c.n));
      const best = mine.sort((a, b) => b.price - a.price)[0];
      const n = mine.reduce((s, e) => s + e.n, 0);
      const card = C.cardEl(c, { variant: best.v, tier: E.tierOf(c), interactive: true });
      const bestGrade = Math.max(0, ...mine.map((e) => e.g || 0));
      return h(
        'button',
        { class: 'pocket is-owned', onclick: () => showCard(c.id) },
        card,
        n > 1 ? h('span', { class: 'count' }, `×${n}`) : null,
        bestGrade ? h('span', { class: 'grade-badge' + (bestGrade === 10 ? ' is-gem' : '') }, `PRG ${bestGrade}`) : null
      );
    };

    const draw = () => {
      const have = owned();
      countEl.textContent = `${have} of ${cards.length} collected`;
      progress.style.setProperty('--p', (have / Math.max(1, cards.length)).toFixed(4));
      const list = onlyOwned ? cards.filter((c) => copies(c.id).length) : cards;
      const total = Math.max(1, Math.ceil(list.length / perPage));
      page = U.clamp(page, 0, Math.max(0, total - spread));
      book.innerHTML = '';
      for (let p = page; p < Math.min(page + spread, total); p++) {
        const slots = list.slice(p * perPage, p * perPage + perPage);
        book.append(h('div', { class: 'binder-page' }, Array.from({ length: perPage }, (_, i) => pocket(slots[i])), h('div', { class: 'binder-page__no' }, `${p + 1}`)));
      }
      if (spread > 1) book.append(h('div', { class: 'binder-rings' }, h('i'), h('i'), h('i')));
      prev.disabled = page === 0;
      next.disabled = page + spread >= total;
      pager.textContent = `Page ${page + 1}${spread > 1 && page + 2 <= total ? `–${page + 2}` : ''} of ${total}`;
    };
    draw();
    redrawBinder = draw;
    setKeysForBinder(turn);
  }

  let binderKeys = null;
  function setKeysForBinder(turn) {
    if (binderKeys) document.removeEventListener('keydown', binderKeys);
    binderKeys = (e) => {
      if (currentRoute().name !== 'binder' || document.body.classList.contains('modal-open') || document.body.classList.contains('no-scroll')) return;
      if (e.key === 'ArrowRight') turn(1);
      if (e.key === 'ArrowLeft') turn(-1);
    };
    document.addEventListener('keydown', binderKeys);
  }

  // ---- card showcase -----------------------------------------------------

  function showCard(id) {
    const copies = G.copiesOf(id).sort((a, b) => b.price - a.price);
    if (!copies.length) return closeModal();
    const meta = copies[0].meta;
    const tier = E.tierOf(meta);
    let card;
    if (copies[0].g) card = PP.grading.slabEl(meta, copies[0], { big: true, eager: true, interactive: true, auto: true, cert: (copies[0].certs || [])[0] });
    else {
      card = C.cardEl(meta, { variant: copies[0].v, tier, big: true, eager: true, interactive: true, auto: true });
      C.upgrade(card);
    }
    const rows = copies.map((e) =>
      h(
        'div',
        { class: 'variant-row' + (e.g ? ' is-graded' : '') },
        h(
          'div',
          null,
          h('b', null, e.g ? `PRG ${e.g} ${E.GRADE_NAMES[e.g]}` : E.variantLabel(e.v)),
          h('div', { class: 'muted small' }, `${e.g ? E.variantLabel(e.v) + ' · ' : ''}Owned ×${e.n} · ${U.money(e.price)} each`)
        ),
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn btn--sm btn--sell', onclick: () => sellAndRefresh(id, e.key, 1) }, ui.icon('tag'), `Sell 1`),
          e.g
            ? h('button', { class: 'btn btn--sm', title: 'Take the card out of its slab', onclick: () => crackAndRefresh(id, e.key) }, 'Crack')
            : h('button', { class: 'btn btn--sm', onclick: () => PP.grading.gradeDialog(e, afterGradingChange) }, ui.icon('sparkle'), 'Grade'),
          !e.g && e.n > 1 ? h('button', { class: 'btn btn--sm', onclick: () => sellAndRefresh(id, e.key, e.n) }, `Sell all · ${U.money(e.price * e.n)}`) : null
        )
      )
    );
    const total = copies.reduce((s, e) => s + e.price * e.n, 0);
    openModal(
      h(
        'div',
        { class: 'showcase' },
        h('div', { class: 'showcase__card' }, card),
        h(
          'div',
          { class: 'showcase__info' },
          h('div', { class: 'showcase__set' }, `${(API.peekSets().find((x) => x.id === meta.s) || { name: meta.s }).name} · #${meta.no}`),
          h('h2', null, meta.n),
          h('div', { class: 'row wrap' }, ui.rarityEl(tier), meta.r && meta.r !== E.TIER_LABEL[tier] ? ui.chip(meta.r) : null),
          h('div', { class: 'showcase__value' }, h('span', null, copies[0].g ? (meta.g && meta.g[copies[0].g] ? `PSA ${copies[0].g} sales` : `Estimated value at grade ${copies[0].g}`) : 'Market value'), h('b', null, U.money(copies[0].price))),
          rows,
          copies.length > 1 || copies[0].n > 1 ? h('div', { class: 'kv' }, h('span', null, 'All copies'), h('b', null, U.money(total))) : null,
          h('p', { class: 'muted small' }, `TCGplayer market prices via pokemontcg.io · updated ${new Date(meta.t || Date.now()).toLocaleDateString()}`)
        )
      ),
      { dark: true, wide: true, cls: `tier-${tier}` }
    );
  }

  function crackAndRefresh(id, key) {
    confirmBox('Crack the slab?', 'The card comes back out as a raw copy and loses its grade. You can send it for grading again later.', 'Crack it', () => {
      G.crack(key);
      sfx.swoosh();
      toast('Slab cracked. The card is raw again.');
      showCard(id);
      afterGradingChange();
    });
  }

  function afterGradingChange() {
    if (currentRoute().name === 'binder' && redrawBinder) redrawBinder();
    if (currentRoute().name === 'collection') render();
  }

  function sellAndRefresh(id, key, qty) {
    const gain = G.sell(key, qty);
    sfx.sell();
    toast(`Sold for ${U.money(gain)}`, 'good');
    if (G.copiesOf(id).length) showCard(id);
    else closeModal();
    if (currentRoute().name === 'binder' && redrawBinder) redrawBinder();
    if (currentRoute().name === 'collection' && drawCollection) drawCollection();
  }

  // ---- collection --------------------------------------------------------

  const colPrefs = { sort: 'value', q: '', tier: 'all', limit: 120 };
  let drawCollection = null;
  const TIER_FILTERS = [
    ['all', 'All'],
    ['RH', 'Holo+'],
    ['DR', 'Double Rare+'],
    ['IR', 'Illustration+'],
    ['UR', 'Ultra+'],
    ['SR', 'Secret'],
    ['graded', 'Graded'],
  ];

  function renderCollection(v) {
    const all = G.entries();
    const totalCards = all.reduce((s, e) => s + e.n, 0);
    v.append(
      pageHead(
        'Collection',
        null,
        h(
          'div',
          { class: 'head-stats' },
          h('div', null, h('span', null, 'Cards'), h('b', null, totalCards.toLocaleString())),
          h('div', null, h('span', null, 'Unique'), h('b', null, new Set(all.map((e) => e.id)).size.toLocaleString())),
          h('div', { class: 'is-accent' }, h('span', null, 'Value'), h('b', { 'data-bind': 'value' }, U.money(G.collectionValue())))
        )
      )
    );
    const panel = PP.grading.gradingPanel(render);
    if (panel) v.append(panel);
    if (!all.length) {
      if (!panel) v.append(emptyState('No cards yet', 'Head to the shop and open your first pack.'));
      return;
    }

    const cheapInput = h('input', { type: 'number', min: '0', step: '0.25', value: '0.50', class: 'input input--narrow', 'aria-label': 'Price limit' });
    const chips = h(
      'div',
      { class: 'filter-chips' },
      TIER_FILTERS.map(([key, label]) => h('button', { class: 'fchip' + (colPrefs.tier === key ? ' is-on' : ''), onclick: (e) => ((colPrefs.tier = key), [...chips.children].forEach((c) => c.classList.toggle('is-on', c === e.currentTarget)), draw()) }, label))
    );
    v.append(
      h(
        'div',
        { class: 'toolbar' },
        h('label', { class: 'search' }, ui.icon('search'), h('input', { type: 'search', placeholder: 'Search your cards', value: colPrefs.q, oninput: (e) => ((colPrefs.q = e.target.value), draw()) })),
        h(
          'select',
          { class: 'input', onchange: (e) => ((colPrefs.sort = e.target.value), draw()) },
          [
            ['value', 'Most valuable'],
            ['recent', 'Recently pulled'],
            ['rarity', 'Rarity'],
            ['name', 'Name'],
          ].map(([val, label]) => h('option', { value: val, selected: colPrefs.sort === val }, label))
        ),
        h(
          'div',
          { class: 'toolbar__sell' },
          h(
            'button',
            {
              class: 'btn btn--sm',
              onclick: () => {
                const items = G.duplicateItems();
                if (!items.length) return toast('No duplicates to sell.');
                confirmBox('Sell duplicates?', `Sell ${items.reduce((s, i) => s + i[1], 0)} extra copies for ${U.money(G.itemsValue(items))}. You keep one of each card, the most valuable printing.`, 'Sell duplicates', () => {
                  const r = G.sellMany(items);
                  sfx.coin();
                  toast(`Sold ${r.count} cards for ${U.money(r.gain)}`, 'good');
                  render();
                });
              },
            },
            ui.icon('tag'),
            'Sell duplicates'
          ),
          h(
            'div',
            { class: 'under' },
            h('span', null, 'Sell all under $'),
            cheapInput,
            h(
              'button',
              {
                class: 'btn btn--sm',
                onclick: () => {
                  const max = Number(cheapInput.value) || 0;
                  const items = G.cheapItems(max);
                  if (!items.length) return toast(`Nothing under ${U.money(max)}.`);
                  confirmBox('Bulk sell?', `Sell ${items.reduce((s, i) => s + i[1], 0)} cards worth less than ${U.money(max)} each, for ${U.money(G.itemsValue(items))}.`, 'Sell', () => {
                    const r = G.sellMany(items);
                    sfx.coin();
                    toast(`Sold ${r.count} cards for ${U.money(r.gain)}`, 'good');
                    render();
                  });
                },
              },
              'Sell'
            )
          )
        )
      ),
      chips
    );
    const grid = h('div', { class: 'card-grid' });
    const more = h('div', { class: 'center' });
    v.append(grid, more);

    const draw = () => {
      const q = colPrefs.q.trim().toLowerCase();
      const gradedOnly = colPrefs.tier === 'graded';
      const min = colPrefs.tier === 'all' || gradedOnly ? -1 : E.tierRank(colPrefs.tier);
      const list = G.entries().filter((e) => e.meta && (!q || e.meta.n.toLowerCase().includes(q)) && E.tierRank(E.tierOf(e.meta)) >= min && (!gradedOnly || e.g));
      const sorts = {
        value: (a, b) => b.price - a.price,
        recent: (a, b) => (b.at || 0) - (a.at || 0),
        name: (a, b) => a.meta.n.localeCompare(b.meta.n),
        rarity: (a, b) => E.tierRank(E.tierOf(b.meta)) - E.tierRank(E.tierOf(a.meta)) || b.price - a.price,
      };
      list.sort(sorts[colPrefs.sort]);
      grid.innerHTML = '';
      if (!list.length) grid.append(h('p', { class: 'muted center span-all' }, 'No cards match.'));
      list.slice(0, colPrefs.limit).forEach((e, i) => {
        const tier = E.tierOf(e.meta);
        const card = e.g ? PP.grading.slabEl(e.meta, e, { small: true, interactive: true }) : C.cardEl(e.meta, { variant: e.v, tier, interactive: true });
        grid.append(
          h(
            'div',
            { class: `ctile tier-${tier}` + (e.g ? ' is-graded' : ''), style: `--d:${Math.min(i, 24) * 20}ms` },
            h('button', { class: 'ctile__card', onclick: () => showCard(e.id), 'aria-label': e.meta.n }, card, e.n > 1 ? h('span', { class: 'count' }, `×${e.n}`) : null),
            h('div', { class: 'ctile__name', title: e.meta.n }, e.meta.n),
            h('div', { class: 'ctile__meta' }, [ui.rarityEl(tier, { short: true }), e.g ? ui.chip(`PRG ${e.g}`, e.g === 10 ? 'chip--gold' : 'chip--foil') : null, ui.variantChip(e.v)].filter(Boolean)),
            h(
              'button',
              {
                class: 'btn btn--sm btn--sell',
                onclick: () => {
                  const gain = G.sell(e.key, 1);
                  sfx.sell();
                  toast(`Sold ${e.meta.n} for ${U.money(gain)}`, 'good');
                  draw();
                },
              },
              ui.icon('tag'),
              U.money(e.price)
            )
          )
        );
      });
      more.innerHTML = '';
      if (list.length > colPrefs.limit) more.append(h('button', { class: 'btn', onclick: () => ((colPrefs.limit += 120), draw()) }, `Show more (${list.length - colPrefs.limit} left)`));
    };
    drawCollection = draw;
    draw();
  }

  // ---- profile -----------------------------------------------------------

  function renderProfile(v) {
    const s = G.state.stats;
    const best = s.best;
    v.append(pageHead('Profile', 'Your stats, settings and save file.'));
    const stat = (ico, label, value, cls = '') => h('div', { class: 'stat ' + cls }, ui.icon(ico), h('span', null, label), h('b', null, value));
    v.append(
      h(
        'div',
        { class: 'stat-grid' },
        stat('cards', 'Wallet', h('span', { 'data-bind': 'money' }, U.money(G.state.money)), 'is-accent'),
        stat('binder', 'Collection value', h('span', { 'data-bind': 'value' }, U.money(G.collectionValue()))),
        stat('gift', 'Packs opened', s.packs.toLocaleString()),
        stat('shop', 'Spent on packs', U.money(s.spent)),
        stat('tag', 'Earned from sales', U.money(s.earned)),
        stat('chart', 'Cards graded', (s.graded || 0).toLocaleString()),
        stat('sparkle', 'Unique cards', new Set(G.entries().map((e) => e.id)).size.toLocaleString()),
        stat('clock', 'Income collected', U.money(s.income))
      )
    );
    const cols = h('div', { class: 'profile-cols' });
    v.append(cols);
    if (best) {
      const card = C.cardEl({ n: best.name, img: best.img, big: best.big, r: best.r }, { variant: best.v, tier: best.tier, big: true, interactive: true, auto: true });
      cols.append(
        h(
          'section',
          { class: 'panel best' },
          h('div', { class: 'best__card' }, card),
          h('div', null, h('span', { class: 'eyebrow' }, ui.icon('trophy'), 'Best pull'), h('h2', null, best.name), h('p', { class: 'muted' }, `${E.variantLabel(best.v)} · ${best.set}`), h('div', { class: 'big-num' }, U.money(best.price)))
        )
      );
    }
    if (G.state.log.length) {
      cols.append(
        h(
          'section',
          { class: 'panel' },
          h('h3', null, 'Recent packs'),
          h(
            'div',
            { class: 'log' },
            G.state.log.slice(0, 10).map((l) => {
              const diff = U.round2(l.value - l.paid);
              return h('div', { class: 'log__row' }, h('div', null, h('b', null, l.name), h('div', { class: 'muted small' }, new Date(l.t).toLocaleString())), h('div', { class: 'log__val ' + (diff >= 0 ? 'good' : 'bad') }, `${diff >= 0 ? '+' : '−'}${U.money(Math.abs(diff))}`));
            })
          )
        )
      );
    }

    const fileInput = h('input', {
      type: 'file',
      accept: 'application/json',
      class: 'hidden',
      onchange: async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          G.importSave(await file.text());
          toast('Save imported', 'good');
          render();
        } catch (err) {
          toast(err.message, 'bad');
        }
      },
    });
    const soundToggle = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !sfx.muted, onchange: () => (sfx.toggle(), updateSoundBtn()) }), h('span', { class: 'switch__track' }), 'Sound effects');
    v.append(
      h(
        'div',
        { class: 'settings' },
        cardDataPanel(),
        h(
          'section',
          { class: 'panel' },
          h('h3', null, 'Preferences'),
          soundToggle,
          h('h3', { class: 'mt' }, 'Save file'),
          h('p', { class: 'muted small' }, 'Progress lives in this browser. Export a backup to move it to another device.'),
          h(
            'div',
            { class: 'row wrap' },
            h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  const blob = new Blob([G.exportSave()], { type: 'application/json' });
                  const a = h('a', { href: URL.createObjectURL(blob), download: `pack-rush-save-${new Date().toISOString().slice(0, 10)}.json` });
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                },
              },
              ui.icon('download'),
              'Export'
            ),
            h('button', { class: 'btn', onclick: () => fileInput.click() }, ui.icon('upload'), 'Import'),
            fileInput,
            h('button', { class: 'btn btn--danger', onclick: () => confirmBox('Reset progress?', 'This erases your cards and money and starts you over with $50.', 'Reset', () => (G.reset(), render())) }, 'Reset')
          )
        ),
        h(
          'section',
          { class: 'panel' },
          h('h3', null, 'How it works'),
          h(
            'ul',
            { class: 'how' },
            h('li', null, `You earn $${G.INCOME} every hour, even while away (up to ${G.CAP_HOURS} hours banked).`),
            h('li', null, `The shop always stocks the newest set, plus 13 rotating packs from across the game’s history (one of them a Black Star promo pack) and a mystery pack. The rotation changes every 12 hours (midnight and noon UTC). Bundles of ${E.BUNDLE_SIZE} save ${Math.round(E.BUNDLE_DISCOUNT * 100)}%.`),
            h('li', null, 'Card values are real TCGplayer market prices for that exact printing (normal, holo, reverse holo). Selling pays that market price.'),
            h('li', null, 'Pack price = (expected value of its cards × 1.2 + $1) × sealed age premium (1 + 0.004 × years^2.6), rounded and kept between $1 and $500.'),
            h('li', null, 'Pull rates approximate each era: 11-card WOTC packs with 1-in-3 holos, 10-card modern packs with a reverse holo slot, Scarlet & Violet packs with an extra illustration-rare slot, 4-card packs for small special sets, and 3-card promo packs. Promo cards are ranked by market value, so a valuable promo still gets a rare reveal.')
          )
        )
      )
    );
  }

  function cardDataPanel() {
    const s = API.settings();
    const sunset = new Date(API.LEGACY_SUNSET).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const input = (value, attrs = {}) => h('input', { class: 'input', value: value || '', autocomplete: 'off', spellcheck: 'false', ...attrs });
    const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
    const source = h(
      'select',
      { class: 'input' },
      [
        ['auto', 'Automatic: free sources first, Scrydex as backup'],
        ['pokemontcg', 'Pokémon TCG API only'],
        ['tcgdex', 'TCGdex only'],
        ['scrydex', 'Scrydex only'],
      ].map(([val, label]) => h('option', { value: val, selected: (s.source || 'auto') === val }, label))
    );
    const legacyKey = input(s.apiKey, { type: 'password', placeholder: 'Optional' });
    const legacyBase = input(s.apiBase, { placeholder: API.DEFAULT_BASE });
    const sxProxy = input(s.scrydexProxy, { placeholder: 'http://localhost:8787/scrydex' });
    const sxKey = input(s.scrydexKey, { type: 'password', placeholder: 'Scrydex API key' });
    const sxTeam = input(s.scrydexTeam, { placeholder: 'Scrydex team ID' });
    const statusEl = h('div', { class: 'source-status' }, 'Checking…');
    const cacheInfo = h('p', { class: 'muted small cache-info' });
    const refreshCacheInfo = async () => {
      const st = await API.cacheStats();
      const mb = st.bytes != null ? ` · ${(st.bytes / 1048576).toFixed(1)} MB` : '';
      const ago = (ms) => (ms < 3600e3 ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 172800e3 ? `${Math.round(ms / 3600e3)} h` : `${Math.round(ms / 86400e3)} days`);
      const age = st.oldestPrice ? ` Oldest prices: ${ago(Date.now() - st.oldestPrice)} old.` : '';
      cacheInfo.textContent = st.sets
        ? `Saved on this device: ${st.sets} sets, ${st.cards.toLocaleString()} cards${mb}. Card details refresh weekly and prices daily, in the background.${age}`
        : 'Nothing saved on this device yet.';
    };
    refreshCacheInfo();
    const tests = h('div', { class: 'source-tests' });

    const refreshStatus = async () => {
      const st = await API.status();
      const modeSource = { pokemontcg: 'legacy', tcgdex: 'tcgdex', scrydex: 'scrydex' }[st.mode];
      const using = API.SOURCE_LABEL[st.lastSource || modeSource || (Date.now() >= st.sunset ? (st.scrydex ? 'scrydex' : 'tcgdex') : 'legacy')];
      const sx = st.scrydex === 'proxy' ? 'connected through the Pack Rush server (key kept off this browser)' : st.scrydex === 'direct' ? 'set up with a key in this browser' : 'not set up';
      statusEl.replaceChildren(
        h('div', null, h('span', null, 'Loading cards from'), h('b', null, using)),
        h('div', null, h('span', null, 'TCGdex'), h('b', { class: 'good' }, st.tcgdexViaProxy ? 'ready, cached by the Pack Rush server' : 'ready (free, no key)')),
        h('div', null, h('span', null, 'Scrydex'), h('b', { class: st.scrydex ? 'good' : '' }, sx))
      );
    };
    refreshStatus();

    const save = () => {
      API.saveSettings({
        source: source.value,
        apiKey: legacyKey.value.trim(),
        apiBase: legacyBase.value.trim(),
        scrydexProxy: sxProxy.value.trim(),
        scrydexKey: sxKey.value.trim(),
        scrydexTeam: sxTeam.value.trim(),
      });
      modelCache.clear();
      toast('Card data settings saved', 'good');
      refreshStatus();
    };

    const test = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      save();
      tests.replaceChildren(loading('Testing connections…'));
      const r = await API.testSources();
      b.disabled = false;
      tests.replaceChildren(
        ...Object.entries(r).map(([name, res]) =>
          h('div', { class: 'source-test ' + (res.ok ? 'is-ok' : 'is-bad') }, h('b', null, API.SOURCE_LABEL[name]), h('span', null, res.ok ? 'Working' : res.error))
        )
      );
    };

    return h(
      'section',
      { class: 'panel span-2' },
      h('h3', null, 'Card data'),
      h(
        'div',
        { class: 'notice' },
        ui.icon('info'),
        h(
          'div',
          null,
          h('b', null, `The free Pokémon TCG API shuts down on ${sunset}.`),
          h('p', null, 'After that, automatic mode loads cards from TCGdex, a free open-source database, with nothing to set up. Scrydex, the official paid successor (from $29/month), is optional: once set up it becomes the main source after the shutdown, with TCGdex as its backup.')
        )
      ),
      statusEl,
      field('Source', source),
      h(
        'div',
        { class: 'source-grid' },
        h(
          'div',
          null,
          h('h4', null, 'Pokémon TCG API · free'),
          h('p', { class: 'muted small' }, 'A free key from dev.pokemontcg.io raises the rate limit.'),
          field('API key', legacyKey),
          field('Base URL', legacyBase),
          h('h4', null, 'TCGdex · free'),
          h('p', { class: 'muted small' }, 'Needs no setup. It looks up each card’s price separately, so a set takes a few seconds to load the first time; after that it’s cached (and the bundled server caches it on disk too).')
        ),
        h(
          'div',
          null,
          h('h4', null, 'Scrydex · paid'),
          h('p', { class: 'muted small' }, 'Recommended: start the bundled server with your Scrydex credentials (see the README). It keeps the key private, caches responses to save credits, and the game finds it automatically when you open it from that server.'),
          field('Server URL (only if the game is hosted somewhere else)', sxProxy),
          h(
            'details',
            { class: 'adv' },
            h('summary', null, 'Or use a key directly in this browser'),
            h('p', { class: 'muted small' }, 'The key is saved in this browser and sent from it. Scrydex advises against putting keys in web pages, and its API may refuse requests made straight from a browser. The server is the reliable option.'),
            field('API key', sxKey),
            field('Team ID', sxTeam)
          )
        )
      ),
      tests,
      cacheInfo,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn btn--primary', onclick: save }, 'Save'),
        h('button', { class: 'btn', onclick: test }, 'Test connections'),
        h(
          'button',
          {
            class: 'btn',
            onclick: async (e) => {
              const b = e.currentTarget;
              b.disabled = true;
              const n = await refreshPrices(0);
              b.disabled = false;
              toast(n == null ? 'Price refresh failed, try again later.' : `Refreshed prices for ${n} cards`, n == null ? 'bad' : 'good');
              render();
            },
          },
          ui.icon('refresh'),
          'Refresh my prices'
        ),
        h(
          'button',
          {
            class: 'btn btn--ghost',
            onclick: async () => {
              await API.clearCache();
              modelCache.clear();
              toast('Card data cache cleared');
              refreshCacheInfo();
            },
          },
          'Clear cache'
        )
      )
    );
  }

  // ---- background price refresh -----------------------------------------

  async function refreshPrices(maxAge = 24 * PP.HOUR) {
    const ids = G.staleIds(maxAge).slice(0, 250);
    if (!ids.length) return 0;
    try {
      const cards = await API.getCardsByIds(ids);
      G.updateMeta(cards);
      return cards.length;
    } catch {
      return null;
    }
  }

  // ---- boot --------------------------------------------------------------

  function boot() {
    document.querySelectorAll('#tabs [data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        sfx.tap();
        location.hash = b.dataset.view;
      })
    );
    document.getElementById('soundBtn').addEventListener('click', () => (sfx.toggle(), updateSoundBtn()));
    document.getElementById('modal').addEventListener('click', (e) => e.target.id === 'modal' && closeModal());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && document.body.classList.contains('modal-open') && closeModal());
    window.addEventListener('hashchange', () => (closeModal(), render()));
    G.onChange(updateHeader);
    // Background price refreshes: update owned cards now, reprice affected packs on next view.
    API.onPrices((setId, cards) => {
      G.updateMeta(cards);
      for (const key of [...modelCache.keys()]) {
        const packSet = key.slice(key.indexOf(':') + 1);
        if (packSet === setId || (E.SUBSETS[packSet] || []).includes(setId)) modelCache.delete(key);
      }
    });
    updateSoundBtn();
    updateHeader();
    tick();
    setInterval(tick, 1000);
    render();
    setTimeout(() => refreshPrices(), 4000);
  }

  Object.assign(ui, { toast, render, showCard, closeModal, openModal });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
