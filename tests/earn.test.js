// Other ways to earn: daily missions, collector requests and set completion rewards.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(clock = { t: Date.UTC(2026, 9, 8, 12) }, mem = new Map()) {
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const RealDate = Date;
  const FakeDate = class extends RealDate { static now() { return clock.t; } };
  const ctx = vm.createContext({ console, Math, Date: FakeDate, localStorage });
  for (const f of ['util.js', 'economy.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  return { PP: ctx.PP, clock, mem };
}

function fakeSet(E, id, date) {
  const cards = [];
  const add = (r, n, price) => {
    for (let i = 0; i < n; i++) cards.push({ id: `${id}-${cards.length + 1}`, s: id, n: `${r} ${i}`, no: String(cards.length + 1), r, p: /Holo|Double/.test(r) ? { holofoil: price } : { normal: price } });
  };
  add('Common', 40, 0.05);
  add('Uncommon', 25, 0.1);
  add('Rare', 10, 0.3);
  add('Rare Holo', 10, 2);
  add('Double Rare', 6, 5);
  const set = { id, name: id, series: 'Test', date, total: cards.length };
  return E.packModel(set, cards);
}

test('daily missions: three different ones a day, same for everyone, at most one pull mission', () => {
  const { PP } = load();
  const E = PP.economy;
  for (let day = 20000; day < 20200; day++) {
    const ms = E.dailyMissions(day);
    assert.strictEqual(ms.length, 3);
    assert.strictEqual(new Set(ms.map((m) => m.type)).size, 3);
    assert.ok(ms.every((m) => m.reward > 0 && m.target > 0 && m.progress === 0));
  }
  assert.deepStrictEqual(JSON.stringify(E.dailyMissions(20371)), JSON.stringify(E.dailyMissions(20371)));
});

test('opening, selling and grading count towards missions; claims pay once', () => {
  const { PP, clock } = load();
  const G = PP.game;
  const E = PP.economy;
  const st = G.state;
  st.money = 10000;
  const d = G.daily();
  d.missions = [
    { id: 'a', type: 'packs', target: 3, reward: 12, progress: 0, claimed: false },
    { id: 'b', type: 'oldpack', target: 1, reward: 20, progress: 0, claimed: false },
    { id: 'c', type: 'sell', target: 5, reward: 8, money: true, progress: 0, claimed: false },
  ];
  const modern = fakeSet(E, 'sv1', '2023/03/31');
  G.purchase(modern, { count: 2, price: 10 });
  assert.strictEqual(d.missions[0].progress, 2);
  assert.strictEqual(d.missions[1].progress, 0, 'a 2023 pack is not old');
  assert.throws(() => G.claimMission('a'), /Not finished/);
  G.purchase(fakeSet(E, 'base1', '1999/01/09'), { price: 5 });
  assert.strictEqual(d.missions[0].progress, 3);
  assert.strictEqual(d.missions[1].progress, 1);

  const before = st.money;
  assert.strictEqual(G.claimMission('a'), 12);
  assert.strictEqual(st.money, before + 12);
  assert.throws(() => G.claimMission('a'), /Already/);
  assert.throws(() => G.claimDailyBonus(), /all three/);

  st.meta['x-1'] = { id: 'x-1', s: 'x', n: 'Pricey', no: '1', r: 'Rare Holo', p: { holofoil: 7 } };
  st.cards['x-1|holofoil'] = { id: 'x-1', v: 'holofoil', n: 1, at: clock.t };
  G.sell('x-1|holofoil');
  assert.strictEqual(d.missions[2].progress, 5, 'progress is capped at the target');
  G.claimMission('b');
  G.claimMission('c');
  const b2 = st.money;
  assert.strictEqual(G.claimDailyBonus(), E.DAILY_BONUS);
  assert.strictEqual(st.money, b2 + E.DAILY_BONUS);
  assert.throws(() => G.claimDailyBonus(), /Already/);
  assert.strictEqual(st.stats.rewards, 12 + 20 + 8 + E.DAILY_BONUS);

  // A new day brings new missions.
  clock.t += 24 * PP.HOUR;
  assert.notStrictEqual(G.daily().day, d.day);
  assert.ok(G.daily().missions.every((m) => !m.claimed && m.progress === 0));
});

test('pull missions only count cards of the right rarity or better', () => {
  const { PP } = load();
  const G = PP.game;
  const E = PP.economy;
  G.state.money = 10000;
  const d = G.daily();
  d.missions = [
    { id: 'p', type: 'pull', tier: 'DR', target: 1, reward: 25, progress: 0, claimed: false },
    { id: 'n', type: 'new', target: 500, reward: 1, progress: 0, claimed: false },
    { id: 'b', type: 'bundle', target: 1, reward: 30, progress: 0, claimed: false },
  ];
  const model = fakeSet(E, 'sv2', '2023/06/09');
  let sawDR = false;
  let newCards = 0;
  for (let i = 0; i < 40 && !sawDR; i++) {
    const [res] = G.purchase(model, { price: 1 });
    newCards += res.pulls.filter((p) => p.isNew).length;
    sawDR = res.pulls.some((p) => E.tierRank(p.tier) >= E.tierRank('DR'));
    assert.strictEqual(d.missions[0].progress, sawDR ? 1 : 0);
  }
  assert.ok(sawDR);
  assert.strictEqual(d.missions[1].progress, newCards);
  assert.strictEqual(d.missions[2].progress, 0);
  G.purchase(model, { count: 6, price: 6 });
  assert.strictEqual(d.missions[2].progress, 1);
});

test('collector requests: fixed per rotation, pay a premium for your cheapest raw copy', () => {
  const { PP, clock, mem } = load();
  const G = PP.game;
  const E = PP.economy;
  const st = G.state;
  const models = [fakeSet(E, 'sv3', '2023/08/11'), fakeSet(E, 'sv4', '2023/11/03')];
  st.meta['old-1'] = { id: 'old-1', s: 'old', n: 'Old Card', no: '1', r: 'Rare', p: { normal: 3, reverseHolofoil: 6 } };
  st.cards['old-1|normal'] = { id: 'old-1', v: 'normal', n: 1, at: clock.t };
  st.cards['old-1|reverseHolofoil'] = { id: 'old-1', v: 'reverseHolofoil', n: 1, at: clock.t };
  st.cards['old-1|normal|g9'] = { id: 'old-1', v: 'normal', g: 9, era: 'modern', n: 1, at: clock.t };

  const list = E.collectorRequests(77, models, [st.meta['old-1']]);
  assert.deepStrictEqual(JSON.stringify(list), JSON.stringify(E.collectorRequests(77, models.slice().reverse(), [st.meta['old-1']])), 'order of loading does not matter');
  assert.strictEqual(list.filter((r) => r.kind === 'shop').length, 3);
  assert.ok(list.every((r) => r.mult >= 1.2 && r.mult <= 2));
  const owned = list.find((r) => r.kind === 'owned');
  assert.ok(owned && owned.id === 'old-1');

  G.setRequests(77, list);
  assert.strictEqual(G.setRequests(77, []).length, list.length, 'kept for the rotation');
  assert.strictEqual(G.requests(78), null);

  const shop = list.find((r) => r.kind === 'shop');
  assert.throws(() => G.fulfillRequest(shop.id), /don't have/);

  const before = st.money;
  const offer = G.requestPrice(owned);
  assert.ok(offer > E.priceOf(st.meta['old-1'], 'normal'));
  assert.strictEqual(G.fulfillRequest('old-1'), offer);
  assert.strictEqual(st.money, before + offer);
  assert.strictEqual(st.cards['old-1|normal'], undefined, 'the cheapest raw copy goes');
  assert.ok(st.cards['old-1|reverseHolofoil'] && st.cards['old-1|normal|g9'], 'others stay');
  assert.throws(() => G.fulfillRequest('old-1'), /no longer open/);

  const reloaded = load(clock, mem).PP.game;
  assert.ok(reloaded.requests(77).find((r) => r.id === 'old-1').done);
});

test('set rewards: every reached level is paid once', () => {
  const { PP, clock } = load();
  const G = PP.game;
  const E = PP.economy;
  const st = G.state;
  assert.deepStrictEqual(E.setMilestones(200).map((l) => l.reward).join(), '20,50,100,300');
  for (let i = 1; i <= 10; i++) {
    st.meta[`s-${i}`] = { id: `s-${i}`, s: 's', n: `C${i}`, no: String(i), r: 'Common', p: { normal: 0.1 } };
    if (i <= 6) st.cards[`s-${i}|normal`] = { id: `s-${i}`, v: 'normal', n: 1, at: clock.t };
  }
  const s1 = G.milestoneStatus('s', 10);
  assert.strictEqual(s1.have, 6);
  assert.deepStrictEqual(s1.levels.map((l) => l.ready).join(), 'true,true,false,false');
  const before = st.money;
  const got = G.claimMilestones('s', 10);
  assert.strictEqual(got, s1.claimable);
  assert.strictEqual(st.money, before + got);
  assert.throws(() => G.claimMilestones('s', 10), /Nothing/);
  for (let i = 7; i <= 10; i++) st.cards[`s-${i}|normal`] = { id: `s-${i}`, v: 'normal', n: 1, at: clock.t };
  const s2 = G.milestoneStatus('s', 10);
  assert.deepStrictEqual(s2.levels.map((l) => l.ready).join(), 'false,false,true,true');
  assert.strictEqual(G.claimMilestones('s', 10), E.setMilestones(10)[2].reward + E.setMilestones(10)[3].reward);
});

test('higher or lower: streak rewards, wrong answers reset, daily prize cap', () => {
  const { PP, clock } = load();
  const G = PP.game;
  const E = PP.economy;
  const st = G.state;
  const cheap = { id: 'a-1', n: 'Cheap', r: 'Common', p: { normal: 0.5 } };
  const dear = { id: 'b-1', n: 'Dear', r: 'Rare Holo', p: { holofoil: 30 } };
  const pair = E.guessPair([cheap, dear, { id: 'c-1', n: 'Bulk', r: 'Common', p: { normal: 0.02 } }], PP.util.mulberry32(3));
  assert.ok(pair && pair.every((c) => c.id !== 'c-1'), 'cards under 25¢ are left out');
  assert.strictEqual(E.guessPair([cheap, { ...cheap, id: 'a-2', n: 'Same' }]), null, 'prices too close');

  const start = st.money;
  assert.deepStrictEqual([G.guess(cheap, dear, false).reward, G.guess(dear, cheap, true).reward], [0.25, 0.5]);
  const wrong = G.guess(cheap, dear, true);
  assert.strictEqual(wrong.correct, false);
  assert.strictEqual(wrong.streak, 0);
  assert.strictEqual(st.money, start + 0.75);
  let total = 0.75;
  for (let i = 0; i < 40; i++) total += G.guess(cheap, dear, false).reward;
  assert.strictEqual(PP.util.round2(total), E.GUESS_CAP, 'never more than the daily cap');
  assert.strictEqual(G.guessState().best, 40);
  clock.t += 24 * PP.HOUR;
  assert.strictEqual(G.guessState().earned, 0, 'cap resets the next day');
  assert.ok(G.guess(cheap, dear, false).reward > 0, 'streak carries over');
});
