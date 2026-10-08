// Views (shop, binder, collection, profile), routing, modal and toasts.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const G = PP.game;
  const API = PP.api;
  const h = U.h;

  const view = () => document.getElementById('view');
  let renderToken = 0;

  // ---- toasts & modal ----------------------------------------------------

  function toast(msg, kind = '') {
    const el = h('div', { class: `toast ${kind}` }, msg);
    document.getElementById('toasts').append(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  function closeModal() {
    const m = document.getElementById('modal');
    m.classList.add('hidden');
    m.innerHTML = '';
  }

  function openModal(content) {
    const m = document.getElementById('modal');
    m.innerHTML = '';
    m.append(h('div', { class: 'modal-box' }, h('button', { class: 'modal-x', onclick: closeModal, 'aria-label': 'Close' }, '×'), content));
    m.classList.remove('hidden');
  }

  function confirmBox(text, okLabel, onOk) {
    openModal(
      h(
        'div',
        { class: 'confirm' },
        h('p', null, text),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => (closeModal(), onOk()) }, okLabel)
        )
      )
    );
  }

  // ---- header ------------------------------------------------------------

  function updateHeader() {
    document.getElementById('balance').textContent = U.money(G.state.money);
    document.querySelectorAll('[data-bind=money]').forEach((el) => (el.textContent = U.money(G.state.money)));
    document.querySelectorAll('[data-bind=value]').forEach((el) => (el.textContent = U.money(G.collectionValue())));
  }

  function tick() {
    const now = Date.now();
    const gained = G.accrue(now);
    if (gained) toast(`+${U.money(gained)} income collected`, 'good');
    document.getElementById('income').textContent = `+$${G.INCOME} in ${U.fmtDuration(G.nextIncomeIn(now))}`;
    document.querySelectorAll('[data-countdown]').forEach((el) => (el.textContent = U.fmtDuration(Number(el.dataset.countdown) - now)));
    if (E.rotationIndex(now) !== shownRotation && currentRoute().name === 'shop' && shownRotation != null) {
      toast('The shop has restocked with new packs!', 'good');
      render();
    }
  }

  // ---- routing -----------------------------------------------------------

  function currentRoute() {
    const [name, arg] = (location.hash.replace(/^#\/?/, '') || 'shop').split('/');
    return { name, arg: arg && decodeURIComponent(arg) };
  }

  function render() {
    const { name, arg } = currentRoute();
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    const token = ++renderToken;
    const v = view();
    v.innerHTML = '';
    window.scrollTo(0, 0);
    const views = { shop: renderShop, binder: arg ? (v, t) => renderBinderSet(v, t, arg) : renderBinder, collection: renderCollection, profile: renderProfile };
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
      h('b', null, 'Could not reach the card database.'),
      h('p', null, String(err && err.message ? err.message : err)),
      h('p', { class: 'muted' }, 'The free pokemontcg.io API can be slow or rate limited. Adding a free API key on the Profile tab helps.'),
      h('button', { class: 'btn', onclick: retry }, 'Try again')
    );
  }

  // Fetch a set's cards and keep prices of owned cards fresh as a side effect.
  async function setCards(setId, force) {
    const cards = await API.getSetCards(setId, force);
    G.updateMeta(cards);
    return cards;
  }

  // ---- shop --------------------------------------------------------------

  let shownRotation = null;
  const modelCache = new Map(); // `${rotation}:${setId}` -> Promise<model>

  function getModel(set, rotation) {
    const key = `${rotation}:${set.id}`;
    if (!modelCache.has(key)) {
      const p = setCards(set.id).then((cards) => {
        if (!cards.length) throw new Error('This set has no card data yet');
        return E.packModel(set, cards);
      });
      p.catch(() => modelCache.delete(key));
      modelCache.set(key, p);
    }
    return modelCache.get(key);
  }

  async function renderShop(v, token) {
    const now = Date.now();
    shownRotation = E.rotationIndex(now);
    v.append(
      h(
        'div',
        { class: 'view-head' },
        h('div', null, h('h1', null, 'Pack Shop'), h('p', { class: 'muted' }, 'Prices follow real market values. The lineup changes every 12 hours.')),
        h('div', { class: 'rotation' }, h('span', { class: 'muted' }, 'New packs in'), h('b', { 'data-countdown': E.rotationEndsAt(now) }, U.fmtDuration(E.rotationEndsAt(now) - now)))
      )
    );
    const grid = h('div', { class: 'shop-grid' });
    const status = loading('Loading the shop…');
    v.append(status, grid);

    let sets;
    try {
      sets = await API.getSets();
    } catch (e) {
      if (stale(token)) return;
      status.replaceWith(errorBox(e, render));
      return;
    }
    if (stale(token)) return;
    status.remove();

    const chosen = E.shopSets(sets, now);
    const tiles = chosen.map((set) => {
      const tile = h('div', { class: 'shop-tile loading-tile' }, PP.ui.packEl(set), h('div', { class: 'tile-info' }, h('div', { class: 'tile-name' }, set.name), h('div', { class: 'muted small' }, 'Pricing…')));
      grid.append(tile);
      return { set, tile };
    });

    // A few at a time to stay friendly with the API's rate limit.
    const queue = tiles.slice();
    const worker = async () => {
      while (queue.length) {
        const { set, tile } = queue.shift();
        try {
          const model = await getModel(set, shownRotation);
          if (stale(token)) return;
          fillTile(tile, model);
        } catch (e) {
          if (stale(token)) return;
          tile.classList.remove('loading-tile');
          tile.querySelector('.tile-info').replaceChildren(h('div', { class: 'tile-name' }, set.name), h('div', { class: 'bad small' }, 'Could not load this pack.'), h('button', { class: 'btn small', onclick: render }, 'Retry'));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (stale(token)) return;
    // Cheapest first once everything is priced.
    const priced = [...grid.children].filter((t) => t.dataset.price).sort((a, b) => a.dataset.price - b.dataset.price);
    priced.forEach((t) => grid.append(t));
  }

  function fillTile(tile, model) {
    const { set } = model;
    tile.classList.remove('loading-tile');
    tile.dataset.price = model.price;
    const pack = PP.ui.packEl(set, { size: model.size });
    tile.querySelector('.pack').replaceWith(pack);
    const buy = h('button', { class: 'btn primary buy' }, `Buy · ${U.money(model.price)}`);
    const refresh = () => (buy.disabled = G.state.money < model.price);
    refresh();
    tile._refresh = refresh;
    const doBuy = () => {
      if (G.state.money < model.price) {
        toast(`You need ${U.money(model.price - G.state.money)} more for this pack.`, 'bad');
        return;
      }
      openPack(model);
    };
    buy.addEventListener('click', doBuy);
    pack.addEventListener('click', doBuy);
    tile.querySelector('.tile-info').replaceChildren(
      h('div', { class: 'tile-name' }, set.name),
      h('div', { class: 'muted small' }, `${set.series} · ${U.yearOf(set.date)} · ${model.size} cards`),
      h(
        'details',
        { class: 'breakdown' },
        h('summary', null, 'Why this price?'),
        h(
          'div',
          { class: 'small' },
          row('Expected card value', U.money(model.ev)),
          row(`Store markup`, `×${E.MARKUP} + ${U.money(E.BASE_COST)}`),
          row(`Sealed age premium (${model.years.toFixed(1)} yrs)`, `×${model.age.toFixed(2)}`),
          row('Shop price', U.money(model.price))
        )
      ),
      buy
    );
  }

  function row(label, value) {
    return h('div', { class: 'kv' }, h('span', null, label), h('b', null, value));
  }

  function openPack(model) {
    let result;
    try {
      result = G.buyAndOpen(model);
    } catch (e) {
      toast(e.message, 'bad');
      return;
    }
    PP.opener.open(model, result, {
      onAgain: () => {
        if (G.state.money < model.price) return null;
        return G.buyAndOpen(model);
      },
      onClose: () => currentRoute().name !== 'shop' && render(),
    });
  }

  // ---- binder ------------------------------------------------------------

  async function renderBinder(v, token) {
    v.append(h('div', { class: 'view-head' }, h('div', null, h('h1', null, 'Binder'), h('p', { class: 'muted' }, 'Every set you have pulled from. Open one to flip through its pages.'))));
    const summary = G.setSummary();
    const ids = Object.keys(summary);
    if (!ids.length) {
      v.append(emptyState('Your binder is empty', 'Open a few packs in the shop and your cards will show up here.'));
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
          const pct = Math.round((s.unique.size / total) * 100);
          return h(
            'a',
            { class: 'set-tile', href: `#binder/${encodeURIComponent(id)}` },
            h('div', { class: 'set-logo' }, set.logo ? h('img', { src: set.logo, alt: set.name, loading: 'lazy' }) : h('b', null, set.name)),
            h('div', { class: 'set-name' }, set.name),
            h('div', { class: 'muted small' }, [set.series, set.date && U.yearOf(set.date)].filter(Boolean).join(' · ')),
            h('div', { class: 'progress' }, h('div', { style: `width:${pct}%` })),
            h('div', { class: 'kv small' }, h('span', null, `${s.unique.size} / ${total} cards · ${pct}%`), h('b', null, U.money(s.value)))
          );
        })
      )
    );
  }

  async function renderBinderSet(v, token, setId) {
    v.append(h('a', { class: 'back', href: '#binder' }, '← All sets'));
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

    const ownedCount = (id) => G.copiesOf(id).reduce((s, e) => s + e.n, 0);
    const owned = cards.filter((c) => ownedCount(c.id) > 0).length;
    const perPage = 9;
    const spread = window.matchMedia('(min-width: 860px)').matches ? 2 : 1;
    let page = 0;
    let onlyOwned = false;

    const head = h(
      'div',
      { class: 'view-head' },
      h('div', null, h('h1', null, set.name), h('p', { class: 'muted' }, `${owned} of ${cards.length} collected · ${Math.round((owned / Math.max(1, cards.length)) * 100)}% complete`)),
      set.logo ? h('img', { class: 'binder-logo', src: set.logo, alt: '' }) : null
    );
    const book = h('div', { class: 'binder' });
    const nav = h('div', { class: 'binder-nav' });
    const toggle = h('label', { class: 'toggle' }, h('input', { type: 'checkbox', onchange: (e) => ((onlyOwned = e.target.checked), (page = 0), draw()) }), ' Only show cards I own');
    v.append(head, toggle, book, nav);

    const draw = () => {
      const list = onlyOwned ? cards.filter((c) => ownedCount(c.id) > 0) : cards;
      const total = Math.max(1, Math.ceil(list.length / perPage));
      page = U.clamp(page, 0, Math.max(0, total - spread));
      book.innerHTML = '';
      for (let p = page; p < Math.min(page + spread, total); p++) {
        const slots = list.slice(p * perPage, p * perPage + perPage);
        book.append(
          h(
            'div',
            { class: 'binder-page' },
            Array.from({ length: perPage }, (_, i) => {
              const c = slots[i];
              if (!c) return h('div', { class: 'pocket empty' });
              const n = ownedCount(c.id);
              if (!n) return h('div', { class: 'pocket missing' }, h('span', { class: 'pocket-no' }, `#${c.no}`), h('span', { class: 'pocket-name' }, c.n));
              const best = G.copiesOf(c.id).sort((a, b) => E.tierRank(E.tierOf(b.meta.r)) - E.tierRank(E.tierOf(a.meta.r)) || b.price - a.price)[0];
              return h(
                'button',
                { class: `pocket owned tier-${E.tierOf(c.r)}` + (PP.ui.isShiny(E.tierOf(c.r), best.v) ? ' shiny' : ''), onclick: () => showCard(c.id) },
                PP.ui.cardImg(c),
                n > 1 ? h('span', { class: 'count' }, `×${n}`) : null
              );
            }),
            h('div', { class: 'page-no' }, `Page ${p + 1}`)
          )
        );
      }
      nav.innerHTML = '';
      nav.append(
        h('button', { class: 'btn ghost', disabled: page === 0, onclick: () => ((page -= spread), draw()) }, '‹ Prev'),
        h('span', { class: 'muted' }, `Pages ${page + 1}${spread > 1 && page + 2 <= total ? `–${page + 2}` : ''} of ${total}`),
        h('button', { class: 'btn ghost', disabled: page + spread >= total, onclick: () => ((page += spread), draw()) }, 'Next ›')
      );
    };
    draw();
    redrawBinder = draw;
  }

  let redrawBinder = null;

  // ---- card detail modal -------------------------------------------------

  function showCard(id) {
    const copies = G.copiesOf(id);
    if (!copies.length) return closeModal();
    const meta = copies[0].meta;
    const tier = E.tierOf(meta.r);
    const art = PP.ui.attachTilt(h('div', { class: `detail-card tier-${tier}` + (PP.ui.isShiny(tier, copies[0].v) ? ' shiny' : '') }, PP.ui.cardImg(meta, { big: true, eager: true }), h('div', { class: 'glare' })));
    const rows = copies
      .sort((a, b) => b.price - a.price)
      .map((e) =>
        h(
          'div',
          { class: 'variant-row' },
          h('div', null, h('b', null, E.variantLabel(e.v)), h('div', { class: 'muted small' }, `Owned ×${e.n} · ${U.money(e.price)} each`)),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn small', onclick: () => sellAndRefresh(id, e.key, 1) }, `Sell 1`),
            e.n > 1 ? h('button', { class: 'btn small ghost', onclick: () => sellAndRefresh(id, e.key, e.n) }, `Sell all ${U.money(e.price * e.n)}`) : null
          )
        )
      );
    openModal(
      h(
        'div',
        { class: 'detail' },
        art,
        h(
          'div',
          { class: 'detail-info' },
          h('h2', null, meta.n),
          h('div', { class: 'muted' }, `#${meta.no} · ${meta.r || 'No rarity'}`),
          h('div', { class: 'row wrap' }, PP.ui.tierBadge(tier)),
          rows,
          h('p', { class: 'muted small' }, `Market prices from TCGplayer via pokemontcg.io, updated ${new Date(meta.t || Date.now()).toLocaleDateString()}.`)
        )
      )
    );
  }

  function sellAndRefresh(id, key, qty) {
    const gain = G.sell(key, qty);
    toast(`Sold for ${U.money(gain)}`, 'good');
    if (G.copiesOf(id).length) showCard(id);
    else closeModal();
    if (currentRoute().name === 'binder' && redrawBinder) redrawBinder();
    if (currentRoute().name === 'collection') render();
  }

  // ---- collection --------------------------------------------------------

  const colPrefs = { sort: 'value', q: '', limit: 120 };

  function renderCollection(v) {
    const all = G.entries();
    const totalCards = all.reduce((s, e) => s + e.n, 0);
    v.append(
      h(
        'div',
        { class: 'view-head' },
        h('div', null, h('h1', null, 'Collection'), h('p', { class: 'muted' }, `${totalCards} cards · ${new Set(all.map((e) => e.id)).size} unique · worth `, h('b', { 'data-bind': 'value' }, U.money(G.collectionValue()))))
      )
    );
    if (!all.length) {
      v.append(emptyState('No cards yet', 'Head to the shop and open your first pack.'));
      return;
    }

    const dupes = G.duplicateItems();
    const cheapInput = h('input', { type: 'number', min: '0', step: '0.25', value: '0.50', class: 'input narrow' });
    v.append(
      h(
        'div',
        { class: 'toolbar' },
        h('input', {
          class: 'input',
          type: 'search',
          placeholder: 'Search cards…',
          value: colPrefs.q,
          oninput: (e) => ((colPrefs.q = e.target.value), drawList()),
        }),
        h(
          'select',
          { class: 'input', onchange: (e) => ((colPrefs.sort = e.target.value), drawList()) },
          [
            ['value', 'Most valuable'],
            ['recent', 'Recently pulled'],
            ['name', 'Name'],
            ['rarity', 'Rarity'],
          ].map(([val, label]) => h('option', { value: val, selected: colPrefs.sort === val }, label))
        ),
        h(
          'button',
          {
            class: 'btn',
            disabled: !dupes.length,
            onclick: () => {
              const items = G.duplicateItems();
              confirmBox(`Sell ${items.reduce((s, i) => s + i[1], 0)} duplicate cards for ${U.money(G.itemsValue(items))}? You keep one of each card (the most valuable printing).`, 'Sell duplicates', () => {
                const r = G.sellMany(items);
                toast(`Sold ${r.count} cards for ${U.money(r.gain)}`, 'good');
                render();
              });
            },
          },
          'Sell duplicates'
        ),
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'muted small' }, 'Sell all under $'),
          cheapInput,
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                const max = Number(cheapInput.value) || 0;
                const items = G.cheapItems(max);
                if (!items.length) return toast(`Nothing under ${U.money(max)}.`);
                confirmBox(`Sell ${items.reduce((s, i) => s + i[1], 0)} cards worth less than ${U.money(max)} each, for ${U.money(G.itemsValue(items))}?`, 'Sell', () => {
                  const r = G.sellMany(items);
                  toast(`Sold ${r.count} cards for ${U.money(r.gain)}`, 'good');
                  render();
                });
              },
            },
            'Sell'
          )
        )
      )
    );
    const grid = h('div', { class: 'card-grid' });
    const more = h('div', { class: 'center' });
    v.append(grid, more);

    const drawList = () => {
      const q = colPrefs.q.trim().toLowerCase();
      let list = G.entries().filter((e) => e.meta && (!q || e.meta.n.toLowerCase().includes(q)));
      const sorts = {
        value: (a, b) => b.price - a.price,
        recent: (a, b) => (b.at || 0) - (a.at || 0),
        name: (a, b) => a.meta.n.localeCompare(b.meta.n),
        rarity: (a, b) => E.tierRank(E.tierOf(b.meta.r)) - E.tierRank(E.tierOf(a.meta.r)) || b.price - a.price,
      };
      list.sort(sorts[colPrefs.sort]);
      grid.innerHTML = '';
      list.slice(0, colPrefs.limit).forEach((e) => {
        const tier = E.tierOf(e.meta.r);
        grid.append(
          h(
            'div',
            { class: `col-card tier-${tier}` + (PP.ui.isShiny(tier, e.v) ? ' shiny' : '') },
            h('button', { class: 'col-img', onclick: () => showCard(e.id) }, PP.ui.cardImg(e.meta), e.n > 1 ? h('span', { class: 'count' }, `×${e.n}`) : null),
            h('div', { class: 'sum-name', title: e.meta.n }, e.meta.n),
            h('div', { class: 'sum-sub' }, E.variantLabel(e.v)),
            h(
              'button',
              {
                class: 'btn small',
                onclick: () => {
                  const gain = G.sell(e.key, 1);
                  toast(`Sold ${e.meta.n} for ${U.money(gain)}`, 'good');
                  drawList();
                },
              },
              `Sell ${U.money(e.price)}`
            )
          )
        );
      });
      more.innerHTML = '';
      if (list.length > colPrefs.limit) more.append(h('button', { class: 'btn ghost', onclick: () => ((colPrefs.limit += 120), drawList()) }, `Show more (${list.length - colPrefs.limit} left)`));
    };
    drawList();
  }

  // ---- profile -----------------------------------------------------------

  function renderProfile(v) {
    const s = G.state.stats;
    const best = s.best;
    v.append(h('div', { class: 'view-head' }, h('div', null, h('h1', null, 'Profile'), h('p', { class: 'muted' }, 'Stats, settings and your save file.'))));
    v.append(
      h(
        'div',
        { class: 'stat-grid' },
        stat('Wallet', h('span', { 'data-bind': 'money' }, U.money(G.state.money))),
        stat('Collection value', h('span', { 'data-bind': 'value' }, U.money(G.collectionValue()))),
        stat('Packs opened', s.packs.toLocaleString()),
        stat('Spent on packs', U.money(s.spent)),
        stat('Earned from sales', U.money(s.earned)),
        stat('Cards sold', s.sold.toLocaleString()),
        stat('Income collected', U.money(s.income))
      )
    );
    if (best) {
      v.append(
        h(
          'div',
          { class: 'panel best' },
          h('img', { src: best.img, alt: best.name }),
          h('div', null, h('div', { class: 'muted small' }, 'Best pull'), h('h2', null, best.name), h('div', null, `${E.variantLabel(best.v)} · ${best.set}`), h('div', { class: 'big-num' }, U.money(best.price)))
        )
      );
    }
    if (G.state.log.length) {
      v.append(
        h(
          'div',
          { class: 'panel' },
          h('h3', null, 'Recent packs'),
          G.state.log.slice(0, 10).map((l) => {
            const diff = U.round2(l.value - l.paid);
            return h('div', { class: 'kv' }, h('span', null, `${l.name} · ${new Date(l.t).toLocaleString()}`), h('b', { class: diff >= 0 ? 'good' : 'bad' }, `${U.money(l.paid)} → ${U.money(l.value)}`));
          })
        )
      );
    }

    const settings = API.settings();
    const keyInput = h('input', { class: 'input', type: 'password', placeholder: 'Optional pokemontcg.io API key', value: settings.apiKey || '' });
    const baseInput = h('input', { class: 'input', placeholder: API.DEFAULT_BASE, value: settings.apiBase || '' });
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
    v.append(
      h(
        'div',
        { class: 'panel' },
        h('h3', null, 'Card data'),
        h('p', { class: 'muted small' }, 'Card images and prices come from the free pokemontcg.io API. A free key from dev.pokemontcg.io raises the rate limit.'),
        h('label', { class: 'field' }, 'API key', keyInput),
        h('label', { class: 'field' }, 'API base URL', baseInput),
        h(
          'div',
          { class: 'row wrap' },
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                API.saveSettings({ apiKey: keyInput.value.trim(), apiBase: baseInput.value.trim() });
                toast('Settings saved', 'good');
              },
            },
            'Save settings'
          ),
          h(
            'button',
            {
              class: 'btn',
              onclick: async (e) => {
                e.target.disabled = true;
                const n = await refreshPrices(0);
                e.target.disabled = false;
                toast(n == null ? 'Price refresh failed, try again later.' : `Refreshed prices for ${n} cards`, n == null ? 'bad' : 'good');
                render();
              },
            },
            'Refresh my card prices'
          ),
          h('button', { class: 'btn ghost', onclick: () => (API.clearCache(), modelCache.clear(), toast('Card data cache cleared')) }, 'Clear card cache')
        )
      ),
      h(
        'div',
        { class: 'panel' },
        h('h3', null, 'Save file'),
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
            'Export save'
          ),
          h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import save'),
          fileInput,
          h('button', { class: 'btn danger', onclick: () => confirmBox('Erase all progress and start over with $50?', 'Reset', () => (G.reset(), render())) }, 'Reset progress')
        )
      ),
      h(
        'div',
        { class: 'panel' },
        h('h3', null, 'How it works'),
        h(
          'ul',
          { class: 'small how' },
          h('li', null, `You earn $${G.INCOME} every hour, even while away (up to ${G.CAP_HOURS} hours banked).`),
          h('li', null, 'The shop shows 8 packs from across Pokémon TCG history and restocks every 12 hours (midnight and noon UTC).'),
          h('li', null, 'Card values are real TCGplayer market prices for that exact printing (normal, holo, reverse holo). Selling pays that market price.'),
          h('li', null, 'Pack price = (expected value of its cards × 1.2 + $1) × sealed age premium, where the premium is 1 + 0.004 × years^2.6. Then rounded and capped to $1–$500.'),
          h('li', null, 'Pull rates approximate each era: 11-card WOTC packs with 1-in-3 holos, 10-card modern packs with a reverse holo slot, and Scarlet & Violet packs with an extra illustration-rare slot.')
        )
      )
    );
  }

  function stat(label, value) {
    return h('div', { class: 'stat' }, h('div', { class: 'muted small' }, label), h('div', { class: 'big-num' }, value));
  }

  function emptyState(title, text) {
    return h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, PP.ui.cardBack()), h('h2', null, title), h('p', { class: 'muted' }, text), h('a', { class: 'btn primary', href: '#shop' }, 'Go to the shop'));
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
    document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => (location.hash = b.dataset.view)));
    document.getElementById('modal').addEventListener('click', (e) => e.target.id === 'modal' && closeModal());
    document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());
    window.addEventListener('hashchange', () => (closeModal(), render()));
    G.onChange(() => {
      updateHeader();
      document.querySelectorAll('.shop-tile').forEach((t) => t._refresh && t._refresh());
    });
    updateHeader();
    tick();
    setInterval(tick, 1000);
    render();
    setTimeout(() => refreshPrices(), 4000);
  }

  Object.assign(PP.ui, { toast, render, showCard });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
