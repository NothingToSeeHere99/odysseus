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
      stats: { packs: 0, spent: 0, sold: 0, earned: 0, income: 0, best: null, graded: 0, gradingSpent: 0, bestGrade: null, rewards: 0 },
      grading: [], // cards at the grader: { uid, id, v, era, speed, fee, sent, ready, grade, cert }
      daily: null, // { day, missions, bonusClaimed }
      requests: null, // { rot, list: [{ id, kind, setName?, card, mult, done }] }
      milestones: {}, // setId -> highest completion reward claimed (1-4)
      guess: { day: null, earned: 0, streak: 0, best: 0, played: 0 }, // higher-or-lower minigame
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
    const year = model.set && model.set.date ? U.yearOf(model.set.date) : 9999;
    if (year < 2011) track('oldpack', 1);
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
    track('packs', 1);
    track('new', pulls.filter((p) => p.isNew).length);
    for (const p of pulls) track('pull', 1, p.tier || E.tierOf(p.card));
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
    if (count > 1) track('bundle', 1);
    if (/mystery/i.test(label || '')) track('mystery', 1);
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
    track('sell', gain);
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
    track('grade', 1);
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

  // ---- earning: daily missions, collector requests, set rewards ------------

  function daily(now = Date.now()) {
    const day = E.dayIndex(now);
    if (!state.daily || state.daily.day !== day) state.daily = { day, missions: E.dailyMissions(day), bonusClaimed: false };
    return state.daily;
  }

  // Count progress towards today's missions. Callers save.
  function track(type, amount, tier) {
    if (!amount) return;
    for (const m of daily().missions) {
      if (m.type !== type || m.claimed) continue;
      if (type === 'pull' && E.tierRank(tier) < E.tierRank(m.tier)) continue;
      m.progress = Math.min(m.target, U.round2(m.progress + amount));
    }
  }

  function pay(amount) {
    state.money = U.round2(state.money + amount);
    state.stats.rewards = U.round2((state.stats.rewards || 0) + amount);
  }

  function claimMission(id) {
    const m = daily().missions.find((x) => x.id === id);
    if (!m) throw new Error('That mission has expired.');
    if (m.claimed) throw new Error('Already claimed.');
    if (m.progress < m.target) throw new Error('Not finished yet.');
    m.claimed = true;
    pay(m.reward);
    save();
    emit();
    return m.reward;
  }

  function claimDailyBonus() {
    const d = daily();
    if (d.bonusClaimed) throw new Error('Already claimed.');
    if (!d.missions.every((m) => m.claimed)) throw new Error('Claim all three missions first.');
    d.bonusClaimed = true;
    pay(E.DAILY_BONUS);
    save();
    emit();
    return E.DAILY_BONUS;
  }

  // The rotation's requests are made once (the shop has to be loaded) and kept.
  function requests(rot) {
    return state.requests && state.requests.rot === rot ? state.requests.list : null;
  }

  function setRequests(rot, list) {
    if (requests(rot)) return state.requests.list;
    state.requests = { rot, list: list.map((r) => ({ ...r, done: false })) };
    save();
    return state.requests.list;
  }

  const requestPrice = (r) => E.requestOffer(state.meta[r.id] || r.card, r.mult);

  // The cheapest raw copy you have of a requested card (slabs are never handed over).
  function requestCopy(r) {
    return entries()
      .filter((e) => e.id === r.id && !e.g)
      .sort((a, b) => a.price - b.price)[0] || null;
  }

  function fulfillRequest(id) {
    const r = state.requests && state.requests.list.find((x) => x.id === id);
    if (!r || r.done) throw new Error('That request is no longer open.');
    const copy = requestCopy(r);
    if (!copy) throw new Error(`You don't have ${r.card.n} yet.`);
    const offer = requestPrice(r);
    const e = state.cards[copy.key];
    e.n -= 1;
    if (e.n <= 0) {
      delete state.cards[copy.key];
      if (!owns(e.id)) delete state.meta[e.id];
    }
    r.done = true;
    pay(offer);
    state.stats.sold += 1;
    track('request', 1);
    save();
    emit();
    return offer;
  }

  // Completion rewards for a set of `total` cards: every reached, unclaimed level.
  function milestoneStatus(setId, total) {
    const s = setSummary()[setId];
    const have = s ? s.unique.size : 0;
    const claimed = state.milestones[setId] || 0;
    const levels = E.setMilestones(Math.max(total, have)).map((l) => ({ ...l, claimed: l.level <= claimed, ready: l.level > claimed && have >= l.need }));
    return { have, levels, claimable: levels.filter((l) => l.ready).reduce((a, l) => a + l.reward, 0) };
  }

  function claimMilestones(setId, total) {
    const st = milestoneStatus(setId, total);
    const ready = st.levels.filter((l) => l.ready);
    if (!ready.length) throw new Error('Nothing to claim yet.');
    state.milestones[setId] = ready[ready.length - 1].level;
    pay(st.claimable);
    save();
    emit();
    return st.claimable;
  }

  // Higher-or-lower: the answer is checked here, the prize is capped per day.
  function guessState(now = Date.now()) {
    const day = E.dayIndex(now);
    const g = (state.guess = state.guess || { day: null, earned: 0, streak: 0, best: 0, played: 0 });
    if (g.day !== day) Object.assign(g, { day, earned: 0 });
    return g;
  }

  function guess(a, b, pickA) {
    const g = guessState();
    const va = E.cardValue(a);
    const vb = E.cardValue(b);
    const correct = pickA ? va >= vb : vb >= va;
    g.played += 1;
    let reward = 0;
    if (correct) {
      g.streak += 1;
      g.best = Math.max(g.best, g.streak);
      reward = U.round2(Math.max(0, Math.min(E.guessReward(g.streak), E.GUESS_CAP - g.earned)));
      if (reward) {
        g.earned = U.round2(g.earned + reward);
        pay(reward);
      }
    } else g.streak = 0;
    save();
    emit();
    return { correct, reward, streak: g.streak, earned: g.earned };
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

  // Real PSA prices by grade from PokemonPriceTracker, kept apart from the main source's data.
  function setGraded(id, pg) {
    const m = state.meta[id];
    if (!m || !pg || JSON.stringify(m.pg || {}) === JSON.stringify(pg)) return false;
    m.pg = pg;
    save();
    emit();
    return true;
  }

  // Cards whose graded value matters: slabs and cards at the grader.
  function slabIds() {
    const ids = new Set();
    for (const e of Object.values(state.cards)) if (e.g) ids.add(e.id);
    for (const j of state.grading || []) ids.add(j.id);
    return [...ids];
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
    daily,
    claimMission,
    claimDailyBonus,
    requests,
    setRequests,
    requestPrice,
    requestCopy,
    fulfillRequest,
    milestoneStatus,
    claimMilestones,
    guessState,
    guess,
    sell,
    sellMany,
    duplicateItems,
    cheapItems,
    itemsValue,
    updateMeta,
    setGraded,
    slabIds,
    staleIds,
    exportSave,
    importSave,
    reset,
  };
})(typeof window !== 'undefined' ? window : globalThis);
