// Player state: wallet, hourly income, collection, buying and selling.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;

  const SAVE_KEY = 'packrush.save.v1';
  const INCOME = 10;
  const CAP_HOURS = 48;
  const START_MONEY = 50;

  let state;
  const listeners = new Set();

  function fresh() {
    return {
      v: 1,
      money: START_MONEY,
      anchor: Date.now(),
      cards: {}, // "cardId|variant" -> { id, v, n, at }
      meta: {}, // cardId -> compact card (name, images, prices) + t (price timestamp)
      stats: { packs: 0, spent: 0, sold: 0, earned: 0, income: 0, best: null },
      log: [],
    };
  }

  function load() {
    const saved = U.store.get(SAVE_KEY, null);
    state = saved && saved.v === 1 ? { ...fresh(), ...saved, stats: { ...fresh().stats, ...saved.stats } } : fresh();
  }

  let saveFailed = false;
  function save() {
    const ok = U.store.set(SAVE_KEY, state);
    if (!ok && !saveFailed && PP.ui) PP.ui.toast('Could not save progress (browser storage is full or blocked).', 'bad');
    saveFailed = !ok;
  }

  function emit() {
    listeners.forEach((fn) => fn());
  }

  function onChange(fn) {
    listeners.add(fn);
  }

  // ---- income ------------------------------------------------------------

  // $10 per full hour, banked while away up to CAP_HOURS worth.
  function accrue(now = Date.now()) {
    if (now < state.anchor - PP.HOUR) state.anchor = now; // clock went backwards
    const hours = Math.floor((now - state.anchor) / PP.HOUR);
    if (hours <= 0) return 0;
    const amount = Math.min(hours, CAP_HOURS) * INCOME;
    state.anchor += hours * PP.HOUR;
    state.money = U.round2(state.money + amount);
    state.stats.income += amount;
    save();
    emit();
    return amount;
  }

  function nextIncomeIn(now = Date.now()) {
    return state.anchor + PP.HOUR - now;
  }

  // ---- collection --------------------------------------------------------

  const keyOf = (id, variant) => id + '|' + variant;

  function owns(id) {
    for (const e of Object.values(state.cards)) if (e.id === id) return true;
    return false;
  }

  function unitPrice(key) {
    const e = state.cards[key];
    const m = e && state.meta[e.id];
    return m ? E.priceOf(m, e.v) : 0;
  }

  function entries() {
    return Object.entries(state.cards).map(([key, e]) => ({ key, ...e, meta: state.meta[e.id], price: unitPrice(key) }));
  }

  function collectionValue() {
    return U.round2(entries().reduce((s, e) => s + e.price * e.n, 0));
  }

  function setSummary() {
    const out = {};
    for (const e of entries()) {
      const setId = e.meta ? e.meta.s : e.id.slice(0, e.id.lastIndexOf('-'));
      const s = (out[setId] = out[setId] || { unique: new Set(), count: 0, value: 0 });
      s.unique.add(e.id);
      s.count += e.n;
      s.value += e.price * e.n;
    }
    return out;
  }

  function copiesOf(id) {
    return entries().filter((e) => e.id === id);
  }

  // ---- buying ------------------------------------------------------------

  function buyAndOpen(model) {
    if (state.money < model.price) throw new Error('Not enough money');
    const pulls = E.openPack(model);
    const now = Date.now();
    state.money = U.round2(state.money - model.price);
    let value = 0;
    for (const pull of pulls) {
      const { card, variant } = pull;
      pull.isNew = !owns(card.id);
      pull.key = keyOf(card.id, variant);
      state.meta[card.id] = { ...card, t: now };
      const e = (state.cards[pull.key] = state.cards[pull.key] || { id: card.id, v: variant, n: 0, at: now });
      e.n += 1;
      e.at = now;
      value += pull.price;
      if (!state.stats.best || pull.price > state.stats.best.price) {
        state.stats.best = { id: card.id, name: card.n, img: card.img, big: card.big, v: variant, price: pull.price, set: model.set.name, at: now };
      }
    }
    state.stats.packs += 1;
    state.stats.spent = U.round2(state.stats.spent + model.price);
    state.log.unshift({ t: now, set: model.set.id, name: model.set.name, paid: model.price, value: U.round2(value) });
    state.log = state.log.slice(0, 50);
    save();
    emit();
    return { pulls, paid: model.price, value: U.round2(value) };
  }

  // ---- selling -----------------------------------------------------------

  function sellNoEmit(key, qty) {
    const e = state.cards[key];
    if (!e) return 0;
    qty = Math.min(qty, e.n);
    const gain = U.round2(unitPrice(key) * qty);
    e.n -= qty;
    if (e.n <= 0) {
      delete state.cards[key];
      if (!owns(e.id)) delete state.meta[e.id];
    }
    state.money = U.round2(state.money + gain);
    state.stats.sold += qty;
    state.stats.earned = U.round2(state.stats.earned + gain);
    return gain;
  }

  function sell(key, qty = 1) {
    const gain = sellNoEmit(key, qty);
    save();
    emit();
    return gain;
  }

  // items: [[key, qty]]
  function sellMany(items) {
    let gain = 0;
    let count = 0;
    for (const [key, qty] of items) {
      const n = Math.min(qty, (state.cards[key] || { n: 0 }).n);
      gain += sellNoEmit(key, n);
      count += n;
    }
    save();
    emit();
    return { gain: U.round2(gain), count };
  }

  // Keep one copy of every card (preferring the most valuable printing), sell the rest.
  function duplicateItems() {
    const byId = {};
    for (const e of entries()) (byId[e.id] = byId[e.id] || []).push(e);
    const items = [];
    for (const list of Object.values(byId)) {
      list.sort((a, b) => b.price - a.price);
      list.forEach((e, i) => {
        const qty = i === 0 ? e.n - 1 : e.n;
        if (qty > 0) items.push([e.key, qty]);
      });
    }
    return items;
  }

  function cheapItems(maxPrice) {
    return entries()
      .filter((e) => e.price < maxPrice)
      .map((e) => [e.key, e.n]);
  }

  function itemsValue(items) {
    return U.round2(items.reduce((s, [key, qty]) => s + unitPrice(key) * qty, 0));
  }

  // ---- prices ------------------------------------------------------------

  function updateMeta(cards) {
    const now = Date.now();
    let changed = false;
    for (const c of cards) {
      if (state.meta[c.id]) {
        state.meta[c.id] = { ...c, t: now };
        changed = true;
      }
    }
    if (changed) {
      save();
      emit();
    }
  }

  function staleIds(maxAge) {
    const now = Date.now();
    return Object.values(state.meta)
      .filter((m) => now - (m.t || 0) > maxAge)
      .map((m) => m.id);
  }

  // ---- save management ---------------------------------------------------

  function exportSave() {
    return JSON.stringify(state);
  }

  function importSave(text) {
    const data = JSON.parse(text);
    if (!data || data.v !== 1 || typeof data.money !== 'number' || typeof data.cards !== 'object') throw new Error('Not a Pack Rush save file');
    U.store.set(SAVE_KEY, data);
    load();
    emit();
  }

  function reset() {
    state = fresh();
    save();
    emit();
  }

  load();

  PP.game = {
    INCOME,
    CAP_HOURS,
    get state() {
      return state;
    },
    onChange,
    accrue,
    nextIncomeIn,
    owns,
    unitPrice,
    entries,
    collectionValue,
    setSummary,
    copiesOf,
    buyAndOpen,
    sell,
    sellMany,
    duplicateItems,
    cheapItems,
    itemsValue,
    updateMeta,
    staleIds,
    exportSave,
    importSave,
    reset,
  };
})(typeof window !== 'undefined' ? window : globalThis);
