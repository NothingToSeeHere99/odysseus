// Card grading: odds, fees, graded values and the send → wait → reveal → crack flow.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(clock = { t: Date.UTC(2026, 9, 8) }, mem = new Map()) {
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const RealDate = Date;
  const FakeDate = class extends RealDate { static now() { return clock.t; } };
  const ctx = vm.createContext({ console, Math, Date: FakeDate, localStorage });
  for (const f of ['util.js', 'economy.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  ctx.PP.util.store.keys = () => [...mem.keys()];
  return { PP: ctx.PP, clock, mem };
}

test('grade odds sum to 1 and vintage rarely gets a 10', () => {
  const { PP } = load();
  const E = PP.economy;
  for (const era of ['modern', 'classic', 'vintage']) {
    const sum = Object.values(E.GRADE_ODDS[era]).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, era);
  }
  assert.ok(E.GRADE_ODDS.modern[10] > E.GRADE_ODDS.classic[10] && E.GRADE_ODDS.classic[10] > E.GRADE_ODDS.vintage[10]);
  const rng = PP.util.mulberry32(7);
  let tens = 0;
  for (let i = 0; i < 20000; i++) if (E.rollGrade('vintage', rng) === 10) tens++;
  assert.ok(Math.abs(tens / 20000 - 0.02) < 0.005, `vintage 10 rate ${tens / 20000}`);
  assert.strictEqual(E.gradeEra('1999/01/09'), 'vintage');
  assert.strictEqual(E.gradeEra('2010-05-01'), 'classic');
  assert.strictEqual(E.gradeEra('2025/03/28'), 'modern');
});

test('fees follow value tiers; express costs 3x; slabs have a value floor; real PSA prices win', () => {
  const { PP } = load();
  const E = PP.economy;
  assert.deepStrictEqual([0.1, 99, 100, 499, 500, 1499, 1500, 4999, 5000].map((v) => E.gradingFee(v)), [15, 15, 30, 30, 75, 75, 150, 150, 300]);
  assert.strictEqual(E.gradingFee(50, 'express'), 45);
  const common = { r: 'Common', p: { normal: 0.1 } };
  assert.strictEqual(E.gradedPrice(common, 'normal', 10, 'modern'), 18);
  const chase = { r: 'Rare Holo', p: { holofoil: 100 } };
  assert.strictEqual(E.gradedPrice(chase, 'holofoil', 10, 'vintage'), 1500);
  assert.strictEqual(E.gradedPrice(chase, 'holofoil', 8, 'modern'), 85);
  assert.strictEqual(E.gradedPrice({ ...chase, g: { 10: 2500 } }, 'holofoil', 10, 'vintage'), 2500);
  assert.strictEqual(E.gradedPrice({ ...chase, pg: { 10: 3100 } }, 'holofoil', 10, 'vintage'), 3100, 'PokemonPriceTracker PSA price');
  assert.strictEqual(E.gradedPrice({ ...chase, g: { 10: 2500 }, pg: { 10: 3100 } }, 'holofoil', 10, 'vintage'), 2500, 'Scrydex first');
  // Missing grades scale from the nearest real one: vintage 8 is 1.5/3.5 of a real $350 PSA 9.
  assert.strictEqual(E.gradedPrice({ ...chase, pg: { 9: 350 } }, 'holofoil', 8, 'vintage'), 150);
  // Grading cheap cards loses money on average; grading good cards is a gamble that pays off on average.
  assert.ok(E.gradedEV(common, 'normal', 'modern') < E.gradingFee(0.1));
  const pricey = { r: 'Rare Holo', p: { holofoil: 400 } };
  assert.ok(E.gradedEV(pricey, 'holofoil', 'modern') > 400 + E.gradingFee(400));
  // Grades are spread out: 9s and 10s are the minority, low grades happen.
  for (const era of ['modern', 'classic', 'vintage']) {
    const o = E.GRADE_ODDS[era];
    assert.ok(o[9] + o[10] < 0.4, era);
    assert.ok([1, 2, 3, 4, 5, 6].reduce((a, g) => a + o[g], 0) > 0.2, era);
  }
});

test('send → wait → reveal → sell/crack flow, and slabs are protected from bulk selling', () => {
  const { PP, clock, mem } = load();
  const G = PP.game;
  const E = PP.economy;
  const st = G.state;
  st.money = 50;
  st.meta['base1-4'] = { id: 'base1-4', s: 'base1', n: 'Charizard', no: '4', r: 'Rare Holo', p: { holofoil: 400 } };
  st.cards['base1-4|holofoil'] = { id: 'base1-4', v: 'holofoil', n: 2, at: clock.t };

  assert.throws(() => G.sendToGrade('base1-4|holofoil', 'express', 'vintage'), /more/, '$90 express fee is too much');
  const job = G.sendToGrade('base1-4|holofoil', 'standard', 'vintage');
  assert.strictEqual(job.fee, 30);
  assert.strictEqual(st.money, 20);
  assert.strictEqual(st.cards['base1-4|holofoil'].n, 1, 'one copy left the collection');
  assert.ok(job.grade >= 1 && job.grade <= 10);

  // The grade is fixed at send time and survives a reload.
  const reloaded = load(clock, mem).PP.game;
  assert.strictEqual(reloaded.gradingJobs()[0].grade, job.grade);

  assert.throws(() => G.revealGrade(job.uid), /Still being graded/);
  clock.t += PP.HOUR + 1;
  const res = G.revealGrade(job.uid);
  assert.strictEqual(res.key, `base1-4|holofoil|g${job.grade}`);
  assert.strictEqual(G.unitPrice(res.key), E.gradedPrice(st.meta['base1-4'], 'holofoil', job.grade, 'vintage'));
  assert.strictEqual(G.gradingJobs().length, 0);
  assert.strictEqual(st.stats.graded, 1);

  // Bulk selling never touches slabs.
  st.cards['base1-4|holofoil'].n = 3;
  const dupes = G.duplicateItems();
  assert.ok(dupes.every(([k]) => !k.includes('|g')));
  assert.ok(G.cheapItems(1e9).every(([k]) => !k.includes('|g')));

  // Cracking turns it back into a raw copy.
  G.crack(res.key);
  assert.strictEqual(st.cards[res.key], undefined);
  assert.strictEqual(st.cards['base1-4|holofoil'].n, 4);
});

test('the last copy can be graded without losing the card details', () => {
  const { PP, clock } = load();
  const G = PP.game;
  const st = G.state;
  st.money = 100;
  st.meta['sv1-1'] = { id: 'sv1-1', s: 'sv1', n: 'Sprigatito', no: '1', r: 'Common', p: { normal: 0.1 } };
  st.cards['sv1-1|normal'] = { id: 'sv1-1', v: 'normal', n: 1, at: clock.t };
  const job = G.sendToGrade('sv1-1|normal', 'express', 'modern');
  assert.strictEqual(st.cards['sv1-1|normal'], undefined);
  assert.ok(G.owns('sv1-1'), 'still counts as owned while at the grader');
  clock.t += 5 * 60 * 1000;
  const res = G.revealGrade(job.uid);
  assert.ok(st.meta['sv1-1'], 'details kept');
  assert.ok(G.unitPrice(res.key) >= 3, 'slab floor');
});
