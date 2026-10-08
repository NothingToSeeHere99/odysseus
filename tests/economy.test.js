// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({ console, Math, Date });
for (const f of ['util.js', 'economy.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
const { economy: E, util: U } = ctx.PP;

function fakeSet(id, date, rarities, prices) {
  const cards = [];
  let no = 1;
  for (const [rarity, count] of Object.entries(rarities)) {
    for (let i = 0; i < count; i++) {
      const price = prices[rarity];
      const holo = /holo|ex|illustration|ultra|secret|hyper|double/i.test(rarity) && rarity !== 'Rare';
      cards.push({ id: `${id}-${no}`, s: id, n: `${rarity} ${i}`, no: String(no++), r: rarity, p: holo ? { holofoil: price } : { normal: price, reverseHolofoil: price * 2 } });
    }
  }
  return { set: { id, name: id, series: 'Test', date, total: cards.length }, cards };
}

test('rarity strings map to tiers', () => {
  const cases = {
    Common: 'C', Uncommon: 'U', Rare: 'R', 'Rare Holo': 'RH', 'Rare Holo EX': 'DR', 'Double Rare': 'DR', 'Rare Holo VMAX': 'DR',
    'Illustration Rare': 'IR', 'Special Illustration Rare': 'SR', 'Hyper Rare': 'SR', 'Ultra Rare': 'UR', 'Rare Ultra': 'UR',
    'Rare Secret': 'SR', 'Rare Rainbow': 'SR', 'Shiny Ultra Rare': 'SR', 'Shiny Rare': 'UR', 'Rare Holo Star': 'SR', 'ACE SPEC Rare': 'DR',
    'Trainer Gallery Rare Holo': 'IR', 'Amazing Rare': 'DR', Promo: 'R', '': 'C',
    // TCGdex spellings
    'Double rare': 'DR', 'Holo Rare': 'RH', 'Holo Rare V': 'DR', 'Holo Rare VMAX': 'DR', 'Holo Rare VSTAR': 'DR', 'Illustration rare': 'IR',
    'Special illustration rare': 'SR', 'Hyper rare': 'SR', 'Shiny rare': 'UR', 'Shiny rare V': 'UR', 'Full Art Trainer': 'UR', 'Rare PRIME': 'DR',
    'Character Rare': 'IR', 'Character Super Rare': 'SR', 'Mega Attack Rare': 'UR', None: 'C',
  };
  for (const [r, t] of Object.entries(cases)) assert.strictEqual(E.tierOf(r), t, r);
});

test('pack layouts have the right sizes and the best card last', () => {
  const { set, cards } = fakeSet('sv9', '2025/03/28', { Common: 60, Uncommon: 40, Rare: 20, 'Double Rare': 10, 'Illustration Rare': 15, 'Special Illustration Rare': 8, 'Hyper Rare': 3, 'Ultra Rare': 10 }, { Common: 0.05, Uncommon: 0.1, Rare: 0.3, 'Double Rare': 1.5, 'Illustration Rare': 6, 'Special Illustration Rare': 60, 'Hyper Rare': 20, 'Ultra Rare': 4 });
  const model = E.packModel(set, cards, Date.UTC(2026, 9, 8));
  assert.strictEqual(model.era, 'sv');
  assert.strictEqual(model.size, 10);
  const rng = U.mulberry32(1);
  for (let i = 0; i < 200; i++) {
    const pulls = E.openPack(model, rng);
    assert.strictEqual(pulls.length, 10);
    const last = pulls[pulls.length - 1];
    for (const p of pulls) assert.ok(E.tierRank(p.tier) <= E.tierRank(last.tier) || p.slot === 'C' || p.slot === 'U');
    assert.ok(pulls.slice(0, 4).every((p) => p.tier === 'C'));
  }
});

test('simulated pull value matches computed expected value', () => {
  const { set, cards } = fakeSet('swsh7', '2021/08/27', { Common: 70, Uncommon: 50, Rare: 20, 'Rare Holo': 15, 'Rare Holo V': 20, 'Rare Ultra': 25, 'Rare Secret': 15 }, { Common: 0.08, Uncommon: 0.12, Rare: 0.4, 'Rare Holo': 1, 'Rare Holo V': 2, 'Rare Ultra': 8, 'Rare Secret': 30 });
  const model = E.packModel(set, cards, Date.UTC(2026, 9, 8));
  const rng = U.mulberry32(42);
  let total = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) total += E.openPack(model, rng).reduce((s, p) => s + p.price, 0);
  const avg = total / N;
  assert.ok(Math.abs(avg - model.ev) / model.ev < 0.05, `sim ${avg.toFixed(2)} vs ev ${model.ev}`);
});

test('pack prices stay within $1-$500 and older sets cost more', () => {
  const prices = { Common: 0.3, Uncommon: 0.5, Rare: 3, 'Rare Holo': 40 };
  const vintage = fakeSet('base1', '1999/01/09', { Common: 32, Uncommon: 32, Rare: 16, 'Rare Holo': 16 }, { ...prices, 'Rare Holo': 120 });
  const mid = fakeSet('xy12', '2016/11/02', { Common: 40, Uncommon: 30, Rare: 15, 'Rare Holo': 15 }, prices);
  const modern = fakeSet('sv1', '2023/03/31', { Common: 80, Uncommon: 50, Rare: 20, 'Double Rare': 15 }, { Common: 0.05, Uncommon: 0.08, Rare: 0.2, 'Double Rare': 1 });
  const now = Date.UTC(2026, 9, 8);
  const pv = E.packModel(vintage.set, vintage.cards, now).price;
  const pm = E.packModel(mid.set, mid.cards, now).price;
  const pn = E.packModel(modern.set, modern.cards, now).price;
  assert.strictEqual(pv, 499.99);
  assert.ok(pn >= 1 && pn < pm && pm < pv, `${pn} ${pm} ${pv}`);
  assert.strictEqual(E.packModel(vintage.set, vintage.cards, now).size, 11);
  assert.strictEqual(E.charm(0.2), 1);
  assert.strictEqual(E.charm(4.1), 4.49);
  assert.strictEqual(E.charm(37.2), 37.99);
});

test('shop: featured newest set plus 13 deterministic rotating packs, one of them promo', () => {
  const sets = [];
  for (let y = 1999; y <= 2025; y++) for (let k = 0; k < 4; k++) sets.push({ id: `s${y}${k}`, name: `Set ${y}-${k}`, series: 'X', date: `${y}/0${k + 1}/15`, total: 100 });
  sets.push({ id: 'mcd21', name: "McDonald's Collection 2021", series: 'Other', date: '2021/02/09', total: 25 });
  sets.push({ id: 'cel25', name: 'Celebrations', series: 'Sword & Shield', date: '2021/10/08', total: 25 });
  sets.push({ id: 'swshp', name: 'SWSH Black Star Promos', series: 'Sword & Shield', date: '2019/11/15', total: 300 });
  sets.push({ id: 'fut20', name: 'Pokémon Futsal Collection', series: 'Other', date: '2020/09/11', total: 5 });
  sets.push({ id: 'swsh12tg', name: 'Silver Tempest Trainer Gallery', series: 'Sword & Shield', date: '2022/11/11', total: 30 });
  sets.push({ id: 'future', name: 'Not Out Yet', series: 'X', date: '2027/01/01', total: 200 });
  const t = Date.UTC(2026, 9, 8, 3);
  const a = E.shopSets(sets, t);
  const b = E.shopSets(sets, t + 5 * 3600e3);
  const c = E.shopSets(sets, t + 12 * 3600e3);
  const ids = (x) => x.rotation.map((s) => s.id);
  assert.strictEqual(a.featured.id, 's20253');
  assert.deepStrictEqual(ids(a), ids(b));
  assert.notDeepStrictEqual(ids(a), ids(c));
  assert.strictEqual(a.rotation.length, 13);
  assert.strictEqual(new Set(ids(a)).size, 13);
  assert.ok(ids(a).includes('swshp'), 'promo slot');
  for (const bad of ['fut20', 'swsh12tg', 'future', 's20253']) assert.ok(!ids(a).includes(bad), bad);
  assert.ok(ids(a).filter((id) => Number(id.slice(1, 5)) < 2003).length >= 2);
});

test('small special sets open as 4-card packs; bundles are discounted', () => {
  const { set, cards } = fakeSet('cel25', '2021/10/08', { 'Rare Holo': 20, 'Rare Holo V': 5 }, { 'Rare Holo': 2, 'Rare Holo V': 6 });
  set.total = 25;
  const model = E.packModel(set, cards, Date.UTC(2026, 9, 8));
  assert.strictEqual(model.era, 'mini');
  assert.strictEqual(E.openPack(model, U.mulberry32(3)).length, 4);
  assert.strictEqual(model.bundle, E.bundlePrice(model.price));
  assert.ok(model.bundle < model.price * 6 && model.bundle > model.price * 5);
  assert.strictEqual(model.chase.length, 8);
  assert.ok(model.chase[0].value >= model.chase[7].value);
});

test('pull-rate odds are probabilities that shrink with rarity', () => {
  const { set, cards } = fakeSet('swsh7', '2021/08/27', { Common: 70, Uncommon: 50, Rare: 20, 'Rare Holo': 15, 'Rare Holo V': 20, 'Rare Ultra': 25, 'Rare Secret': 15 }, { Common: 0.08, Uncommon: 0.12, Rare: 0.4, 'Rare Holo': 1, 'Rare Holo V': 2, 'Rare Ultra': 8, 'Rare Secret': 30 });
  const model = E.packModel(set, cards, Date.UTC(2026, 9, 8));
  const odds = E.packOdds(model);
  assert.strictEqual(odds.map((o) => o.tier).join(), 'RH,DR,UR,SR');
  for (let i = 0; i < odds.length; i++) {
    assert.ok(odds[i].p > 0 && odds[i].p < 1);
    if (i) assert.ok(odds[i].p < odds[i - 1].p);
  }
  // Simulate: share of packs with a secret rare should match the stated odds.
  const rng = U.mulberry32(9);
  let hits = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) if (E.openPack(model, rng).some((p) => p.tier === 'SR')) hits++;
  const sr = odds.find((o) => o.tier === 'SR').p;
  assert.ok(Math.abs(hits / N - sr) < 0.004, `${hits / N} vs ${sr}`);
});

test('mystery pack is priced at the rotation average', () => {
  assert.strictEqual(E.mysteryPrice([{ price: 4.49 }, { price: 20.99 }, { price: 99.99 }]), 41.99);
  assert.strictEqual(E.mysteryPrice([]), null);
});

test('reverse holo price falls back sensibly', () => {
  assert.strictEqual(E.priceOf({ r: 'Common', p: { normal: 0.1 } }, 'reverseHolofoil'), 0.14);
  assert.strictEqual(E.priceOf({ r: 'Common', p: { normal: 0.1, reverseHolofoil: 0.5 } }, 'reverseHolofoil'), 0.5);
  assert.strictEqual(E.priceOf({ r: 'Rare Holo', p: {} }, 'holofoil'), 1);
  assert.strictEqual(E.priceOf({ r: 'Rare', p: {}, cm: 2 }, 'normal'), 2.16);
});

test('promo packs: 3 cards, ranked by market value', () => {
  const set = { id: 'svp', name: 'Scarlet & Violet Black Star Promos', series: 'Scarlet & Violet', date: '2023/01/01', total: 6 };
  const card = (n, price) => ({ id: `svp-${n}`, s: 'svp', n: `Promo ${n}`, no: String(n), r: 'Promo', p: { holofoil: price } });
  const cards = [card(1, 0.5), card(2, 4), card(3, 12), card(4, 45), card(5, 250), card(6, 1)];
  assert.strictEqual(E.isPromo(set), true);
  assert.strictEqual(E.eraOf(set), 'promo');
  assert.strictEqual(E.bucketOf(set), 'promo');
  assert.strictEqual(E.isEligible(set, Date.UTC(2026, 0, 1)), true);
  assert.strictEqual(cards.map((c) => E.tierOf(c)).join(), 'R,RH,DR,UR,SR,R');
  assert.strictEqual(E.tierOf({ r: 'Rare Holo', p: { holofoil: 500 } }), 'RH');
  const model = E.packModel(set, cards, Date.UTC(2026, 9, 8));
  assert.strictEqual(model.size, 3);
  const pulls = E.openPack(model, U.mulberry32(5));
  assert.strictEqual(pulls.length, 3);
  assert.strictEqual(new Set(pulls.map((p) => p.card.id)).size, 3);
  assert.ok(E.packOdds(model).some((o) => o.tier === 'SR'));
});
