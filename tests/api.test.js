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

test('auto mode: free API down → TCGdex (free) before Scrydex, and it sticks for the session', async () => {
  const seen = [];
  const PP = load({
    fetch: async (url, init) => {
      seen.push(url);
      if (url.startsWith('https://api.pokemontcg.io')) throw new TypeError('fetch failed');
      if (url.startsWith('https://api.tcgdex.net/v2/graphql')) {
        assert.strictEqual(init.method, 'POST');
        return ok({ data: { sets: [{ id: 'sv03.5', name: '151', releaseDate: '2023-09-22', serie: { id: 'sv', name: 'Scarlet & Violet' }, cardCount: { total: 207, official: 165 }, logo: 'https://assets.tcgdex.net/en/sv/sv03.5/logo' }, { id: 'A1', name: 'Genetic Apex', releaseDate: '2024-10-30', serie: { id: 'tcgp', name: 'Pokémon TCG Pocket' }, cardCount: { total: 286, official: 226 } }] } });
      }
      throw new Error('Scrydex should not be used while TCGdex works: ' + url);
    },
  });
  PP.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  const sets = await PP.api.getSets(true);
  assert.strictEqual(JSON.stringify(sets), JSON.stringify([{ id: 'sv3pt5', name: '151', series: 'Scarlet & Violet', total: 207, printed: 165, date: '2023-09-22', logo: 'https://assets.tcgdex.net/en/sv/sv03.5/logo.png' }]));
  seen.length = 0;
  await PP.api.getSets(true);
  assert.ok(seen[0].startsWith('https://api.tcgdex.net'), 'TCGdex first after the free API failed');
  assert.strictEqual((await PP.api.status()).lastSource, 'tcgdex');
});

test('auto mode falls back to Scrydex when both free sources fail, then stops retrying them first', async () => {
  const calls = [];
  const PP = load({
    fetch: async (url, init) => {
      calls.push(url);
      if (!url.startsWith('https://api.scrydex.com')) throw new TypeError('fetch failed');
      assert.strictEqual(init.headers['X-Api-Key'], 'k');
      assert.strictEqual(init.headers['X-Team-ID'], 't');
      return ok({ data: [{ id: 'me1', name: 'Mega Evolution', series: 'Mega Evolution', total: 188, printed_total: 132, release_date: '2025/09/26' }], total_count: 1 });
    },
  });
  PP.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  const sets = await PP.api.getSets(true);
  assert.strictEqual(sets[0].id, 'me1');
  const st = await PP.api.status();
  assert.strictEqual(st.lastSource, 'scrydex');
  assert.deepStrictEqual([...st.down].sort(), ['legacy', 'tcgdex']);
  calls.length = 0;
  await PP.api.getSets(true);
  assert.ok(calls[0].startsWith('https://api.scrydex.com'), 'failed sources are not retried first');
});

test('source order before and after the Pokémon TCG API shutdown', async () => {
  const first = [];
  const PP = load({ fetch: async (url) => (first.push(url), ok({ data: [{ id: 'base1', name: 'Base', series: 'Base', total: 102, printedTotal: 102, releaseDate: '1999/01/09', images: {} }], totalCount: 1 })) });
  await PP.api.getSets(true);
  assert.ok(first[0].startsWith('https://api.pokemontcg.io'));

  const after = [];
  const tcgdexSets = { data: { sets: [{ id: 'me01', name: 'Mega Evolution', releaseDate: '2025-09-26', serie: { id: 'me', name: 'Mega Evolution' }, cardCount: { total: 188, official: 132 } }] } };
  const PP2 = load({ now: Date.UTC(2027, 2, 2), fetch: async (url) => (after.push(url), ok(url.includes('tcgdex') ? tcgdexSets : { data: [{ id: 'me1' }], total_count: 1 })) });
  await PP2.api.getSets(true);
  assert.ok(after[0].startsWith('https://api.tcgdex.net'), 'no Scrydex: TCGdex replaces the shut-down API');
  assert.ok(!after.some((u) => u.includes('pokemontcg.io')));

  const paid = [];
  const PP3 = load({ now: Date.UTC(2027, 2, 2), fetch: async (url) => (paid.push(url), ok({ data: [{ id: 'me1', name: 'Mega Evolution', release_date: '2025/09/26' }], total_count: 1 })) });
  PP3.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  await PP3.api.getSets(true);
  assert.ok(paid[0].startsWith('https://api.scrydex.com'), 'Scrydex set up: it takes over after the shutdown');
});

test('TCGdex set ids translate to Pokémon TCG API ids for every set', () => {
  const PP = load({ fetch: async () => fail(500) });
  const pairs = require('./fixtures/tcgdex-set-ids.json');
  const wrong = Object.entries(pairs).filter(([theirs, ours]) => PP.api.fromTcgdexSet(theirs) !== ours);
  assert.strictEqual(Object.keys(pairs).length, 176);
  assert.deepStrictEqual(wrong, []);
  // Unknown future sets follow the same pattern.
  assert.strictEqual(PP.api.fromTcgdexSet('sv11'), 'sv11');
  assert.strictEqual(PP.api.fromTcgdexSet('me06.5'), 'me6pt5');
});

test('TCGdex cards convert to the same shape, with numbers and prices matching the other sources', () => {
  const PP = load({ fetch: async () => fail(500) });
  const c = PP.api.tcgdexCard(
    { id: 'sv03.5-006', localId: '006', name: 'Charizard ex', rarity: 'Double rare', category: 'Pokemon', image: 'https://assets.tcgdex.net/en/sv/sv03.5/006' },
    'sv3pt5',
    {
      tcgplayer: { unit: 'USD', updated: '2026-10-08', holofoil: { lowPrice: 4, midPrice: 6, marketPrice: 5.555 }, 'reverse-holofoil': { lowPrice: 9, midPrice: 11 }, normal: { lowPrice: 0 } },
      cardmarket: { unit: 'EUR', trend: 4.2, 'trend-holo': 8.9 },
    }
  );
  assert.strictEqual(
    JSON.stringify(c),
    JSON.stringify({ id: 'sv3pt5-6', s: 'sv3pt5', n: 'Charizard ex', no: '6', r: 'Double rare', st: 'Pokémon', img: 'https://assets.tcgdex.net/en/sv/sv03.5/006/low.webp', big: 'https://assets.tcgdex.net/en/sv/sv03.5/006/high.webp', p: { holofoil: 5.56, reverseHolofoil: 11 }, cm: 4.2, cmr: 8.9 })
  );
  const tg = PP.api.tcgdexCard({ id: 'swsh9tg-TG01', localId: 'TG01', name: 'Flareon', rarity: 'None', category: 'Pokemon' }, 'swsh9tg', null);
  assert.strictEqual(tg.id, 'swsh9tg-TG01');
  assert.strictEqual(tg.r, '');
  assert.strictEqual(tg.img, undefined);
});

test('TCGdex set cards: one GraphQL request with an exact id match, then one price request per card', async () => {
  const graph = [];
  const rest = [];
  const PP = load({
    fetch: async (url, init) => {
      if (url.startsWith('https://api.pokemontcg.io')) throw new TypeError('down');
      if (url.endsWith('/graphql')) {
        const q = JSON.parse(init.body).query;
        graph.push(q);
        if (q.includes('{ sets { id } }')) return ok({ data: { sets: [{ id: 'sv03' }, { id: 'sv03.5' }] } });
        return ok({ data: { set: { id: 'sv03.5', cards: [{ id: 'sv03.5-001', localId: '001', name: 'Bulbasaur', rarity: 'Common', category: 'Pokemon', image: 'https://a/1' }, { id: 'sv03.5-199', localId: '199', name: 'Charizard ex', rarity: 'Special illustration rare', category: 'Pokemon', image: 'https://a/199' }] } } });
      }
      rest.push(url);
      const id = url.split('/').pop();
      return ok({ id, pricing: { tcgplayer: id.endsWith('199') ? { holofoil: { marketPrice: 250 } } : { normal: { marketPrice: 0.12 }, 'reverse-holofoil': { marketPrice: 0.5 } } } });
    },
  });
  PP.api.saveSettings({ source: 'tcgdex' });
  const cards = await PP.api.getSetCards('sv3pt5', true);
  assert.strictEqual(cards.map((c) => `${c.id}:${JSON.stringify(c.p)}`).join(' '), 'sv3pt5-1:{"normal":0.12,"reverseHolofoil":0.5} sv3pt5-199:{"holofoil":250}');
  assert.ok(graph.some((q) => q.includes('"eq:sv03.5"')), 'exact match so sv03 doesn\'t match sv03.5');
  assert.deepStrictEqual(rest.sort(), ['https://api.tcgdex.net/v2/en/cards/sv03.5-001', 'https://api.tcgdex.net/v2/en/cards/sv03.5-199']);
  // Price refresh for owned cards maps our ids back to TCGdex's.
  rest.length = 0;
  const owned = await PP.api.getCardsByIds(['sv3pt5-199']);
  assert.strictEqual(owned.length, 1);
  assert.strictEqual(owned[0].p.holofoil, 250);
  assert.deepStrictEqual(rest, ['https://api.tcgdex.net/v2/en/cards/sv03.5-199']);
});

test('without Scrydex, auto mode never calls it', async () => {
  const seen = [];
  const PP = load({ fetch: async (url) => (seen.push(url), ok({ data: [], totalCount: 0 })) });
  await PP.api.getSets(true).catch(() => {});
  assert.ok(!seen.some((u) => u.includes('scrydex')));
});
