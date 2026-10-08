// Card data sources: pagination, Scrydex conversion and automatic fallback.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load({ fetch, now } = {}) {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i],
    get length() {
      return mem.size;
    },
  };
  const RealDate = Date;
  const FakeDate = now ? class extends RealDate { static now() { return now; } } : RealDate;
  const ctx = vm.createContext({ console, Math, Date: FakeDate, URL, AbortController, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, fetch, localStorage });
  Object.defineProperty(ctx, 'localStorage', { value: localStorage });
  for (const f of ['util.js', 'api.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  // util.store reads the global localStorage; expose Object.keys over our map.
  ctx.PP.util.store.keys = () => [...mem.keys()];
  return ctx.PP;
}

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

test('legacy set list reads every page (no 250-set cap)', async () => {
  const sets = Array.from({ length: 280 }, (_, i) => ({ id: `s${i}`, name: `Set ${i}`, series: 'X', releaseDate: '2000/01/01', total: 100, printedTotal: 100, images: {} }));
  const calls = [];
  const PP = load({
    fetch: async (url) => {
      const u = new URL(url);
      calls.push(u.searchParams.get('page'));
      const page = Number(u.searchParams.get('page'));
      return ok({ data: sets.slice((page - 1) * 250, page * 250), totalCount: 280 });
    },
  });
  const got = await PP.api.getSets(true);
  assert.strictEqual(got.length, 280);
  assert.strictEqual(calls.join(), '1,2');
});

test('Scrydex cards convert to the same shape as legacy cards', () => {
  const PP = load({ fetch: async () => fail(500) });
  const c = PP.api.scrydexCard({
    id: 'sv3pt5-199',
    name: 'Charizard ex',
    supertype: 'Pokémon',
    number: '199',
    printed_number: '199/165',
    rarity: 'Special Illustration Rare',
    images: [{ type: 'front', small: 'https://img/s.png', medium: 'https://img/m.png', large: 'https://img/l.png' }],
    expansion: { id: 'sv3pt5', name: '151' },
    variants: [
      { name: 'holofoil', prices: [{ condition: 'LP', type: 'raw', market: 90, currency: 'USD' }, { condition: 'NM', type: 'raw', market: 120.456, currency: 'USD' }, { grade: '10', company: 'PSA', type: 'graded', market: 900, currency: 'USD' }] },
      { name: 'reverse_holofoil', prices: [{ condition: 'NM', type: 'raw', low: 5, currency: 'USD' }] },
      { name: 'firstEditionHolofoil', prices: [{ condition: 'NM', type: 'raw', market: 300, currency: 'USD' }] },
    ],
  });
  assert.strictEqual(JSON.stringify(c), JSON.stringify({ id: 'sv3pt5-199', s: 'sv3pt5', n: 'Charizard ex', no: '199', r: 'Special Illustration Rare', st: 'Pokémon', img: 'https://img/s.png', big: 'https://img/l.png', p: { holofoil: 120.46, reverseHolofoil: 5, '1stEditionHolofoil': 300 } }));
  const set = PP.api.scrydexSet({ id: 'me2', name: 'Phantasmal Flames', series: 'Mega Evolution', total: 130, printed_total: 94, release_date: '2025/11/14', logo: 'L', symbol: 'S' });
  assert.strictEqual(JSON.stringify(set), JSON.stringify({ id: 'me2', name: 'Phantasmal Flames', series: 'Mega Evolution', total: 130, printed: 94, date: '2025/11/14', logo: 'L', symbol: 'S' }));
  assert.strictEqual(PP.api.variantKey('Normal'), 'normal');
  assert.strictEqual(PP.api.variantKey('reverseHolofoil'), 'reverseHolofoil');
});

test('auto mode falls back to Scrydex when the free API is down, then sticks with it', async () => {
  const seen = [];
  const PP = load({
    fetch: async (url, init) => {
      seen.push(url);
      if (url.startsWith('https://api.pokemontcg.io')) throw new TypeError('fetch failed');
      assert.strictEqual(init.headers['X-Api-Key'], 'k');
      assert.strictEqual(init.headers['X-Team-ID'], 't');
      return ok({ data: [{ id: 'me1', name: 'Mega Evolution', series: 'Mega Evolution', total: 188, printed_total: 132, release_date: '2025/09/26' }], total_count: 1 });
    },
  });
  PP.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  const sets = await PP.api.getSets(true);
  assert.strictEqual(sets[0].id, 'me1');
  assert.ok(seen.some((u) => u.startsWith('https://api.scrydex.com/pokemon/v1/en/expansions')));
  seen.length = 0;
  await PP.api.getSets(true);
  assert.ok(seen[0].startsWith('https://api.scrydex.com'), 'Scrydex first after the free API failed');
  assert.strictEqual((await PP.api.status()).lastSource, 'scrydex');
});

test('without Scrydex, auto mode only uses the free API; after the shutdown date Scrydex goes first', async () => {
  const first = [];
  const PP = load({ fetch: async (url) => (first.push(url), ok({ data: [], totalCount: 0 })) });
  await PP.api.getSets(true);
  assert.ok(first[0].startsWith('https://api.pokemontcg.io'));

  const later = [];
  const PP2 = load({ now: Date.UTC(2027, 2, 2), fetch: async (url) => (later.push(url), ok({ data: [], total_count: 0 })) });
  PP2.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  await PP2.api.getSets(true);
  assert.ok(later[0].startsWith('https://api.scrydex.com'));
});
