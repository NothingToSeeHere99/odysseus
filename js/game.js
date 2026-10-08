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
      cards: {}, // "cardId|variant" (raw) or "cardId|variant|gN" (graded) -> { id, v, n, at, g?, era? }
      meta: {}, // cardId -> compact card (name, images, prices) + t (price timestamp)
      stats: { packs: 0, spent: 0, sold: 0, earned: 0, income: 0, best: null, graded: 0, gradingSpent: 0, bestGrade: null },
      grading: [], // cards at the grader: { uid, id, v, era, speed, fee, sent, ready, grade, cert }
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
    return (state.grading || []).some((j) => j.id === id);
  }

  function unitPrice(key) {
    const e = state.cards[key];
    const m = e && state.meta[e.id];
    if (!m) return 0;
    return e.g ? E.gradedPrice(m, e.v, e.g, e.era) : E.priceOf(m, e.v);
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

  function openOne(model, paid, now, label) {
    const pulls = E.openPack(model);
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
        state.stats.best = { id: card.id, name: card.n, img: card.img, big: card.big, r: card.r, tier: pull.tier, v: variant, price: pull.price, set: model.set.name, at: now };
      }
    }
    state.stats.packs += 1;
    state.log.unshift({ t: now, set: model.set.id, name: label || model.set.name, paid, value: U.round2(value) });
    return { pulls, paid, value: U.round2(value) };
  }

  // Buy `count` packs for `price` in total and open them all. Returns one result per pack.
  function purchase(model, { count = 1, price = model.price * count, label } = {}) {
    price = U.round2(price);
    if (state.money < price) throw new Error(`You need ${U.money(price - state.money)} more.`);
    const now = Date.now();
    state.money = U.round2(state.money - price);
    state.stats.spent = U.round2(state.stats.spent + price);
    const each = U.round2(price / count);
    const results = [];
    for (let i = 0; i < count; i++) results.push(openOne(model, each, now, label));
    state.log = state.log.slice(0, 50);
    save();
    emit();
    return results;
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
    for (const e of entries()) if (!e.g) (byId[e.id] = byId[e.id] || []).push(e); // slabs are never bulk-sold
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
      .filter((e) => !e.g && e.price < maxPrice)
      .map((e) => [e.key, e.n]);
  }

  function itemsValue(items) {
    return U.round2(items.reduce((s, [key, qty]) => s + unitPrice(key) * qty, 0));
  }

  // ---- grading -----------------------------------------------------------

  // Send one raw copy to the grader. The grade is decided now (so reloading can't
  // re-roll it) and revealed once the turnaround time has passed.
  function sendToGrade(key, speed = 'standard', era = 'modern') {
    const e = state.cards[key];
    if (!e || e.g) throw new Error('Only raw cards can be graded.');
    const fee = E.gradingFee(unitPrice(key), speed);
    if (state.money < fee) throw new Error(`You need ${U.money(fee - state.money)} more.`);
    const now = Date.now();
    state.money = U.round2(state.money - fee);
    e.n -= 1;
    if (e.n <= 0) delete state.cards[key];
    const job = {
      uid: now.toString(36) + Math.random().toString(36).slice(2, 7),
      id: e.id,
      v: e.v,
      era,
      speed,
      fee,
      sent: now,
      ready: now + E.GRADING[speed].ms,
      grade: E.rollGrade(era),
      cert: String(Math.floor(1e7 + Math.random() * 9e7)),
    };
    state.grading.push(job);
    state.stats.gradingSpent = U.round2((state.stats.gradingSpent || 0) + fee);
    save();
    emit();
    return job;
  }

  function gradingJobs() {
    return (state.grading || []).slice().sort((a, b) => a.ready - b.ready);
  }

  // Collect a finished card: it goes into the collection as a slab.
  function revealGrade(uid, now = Date.now()) {
    const i = state.grading.findIndex((j) => j.uid === uid);
    if (i < 0) throw new Error('Not at the grader.');
    const job = state.grading[i];
    if (now < job.ready) throw new Error('Still being graded.');
    state.grading.splice(i, 1);
    const key = `${job.id}|${job.v}|g${job.grade}`;
    const e = (state.cards[key] = state.cards[key] || { id: job.id, v: job.v, g: job.grade, era: job.era, n: 0, certs: [], at: now });
    e.n += 1;
    e.at = now;
    e.certs = [...(e.certs || []), job.cert];
    state.stats.graded = (state.stats.graded || 0) + 1;
    const price = unitPrice(key);
    const m = state.meta[job.id];
    if (!state.stats.bestGrade || job.grade > state.stats.bestGrade.grade || (job.grade === state.stats.bestGrade.grade && price > state.stats.bestGrade.price)) {
      state.stats.bestGrade = { id: job.id, name: m ? m.n : job.id, grade: job.grade, price };
    }
    save();
    emit();
    return { ...job, key, price };
  }

  // Break a slab open: the card goes back to being a raw copy.
  function crack(key) {
    const e = state.cards[key];
    if (!e || !e.g) throw new Error('Not a graded card.');
    e.n -= 1;
    if (e.certs) e.certs.pop();
    if (e.n <= 0) delete state.cards[key];
    const rawKey = keyOf(e.id, e.v);
    const raw = (state.cards[rawKey] = state.cards[rawKey] || { id: e.id, v: e.v, n: 0, at: Date.now() });
    raw.n += 1;
    save();
    emit();
    return rawKey;
  }

  // ---- prices ------------------------------------------------------------

  // Merge fresh data (full cards or price-only updates) into owned cards' details.
  function updateMeta(cards) {
    const now = Date.now();
    let changed = false;
    for (const c of cards) {
      const old = state.meta[c.id];
      if (!old) continue;
      const next = { ...old, ...c, t: now };
      if (c.p && !Object.keys(c.p).length && old.p && Object.keys(old.p).length) next.p = old.p;
      const { t: _a, ...a } = old;
      const { t: _b, ...b } = next;
      if (JSON.stringify(a) !== JSON.stringify(b)) changed = true;
      state.meta[c.id] = next;
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
    purchase,
    sendToGrade,
    gradingJobs,
    revealGrade,
    crack,
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
