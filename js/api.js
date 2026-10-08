// Card data client with a localStorage cache.
//
// Three sources produce the same compact card/set format, keyed by Pokémon TCG API ids:
//   - the free Pokémon TCG API (pokemontcg.io), which goes offline on March 1, 2027
//   - TCGdex (tcgdex.net), free and open source; its ids are translated to ours
//   - Scrydex (scrydex.com), the paid successor, reached through the bundled proxy
//     (server/proxy.js keeps the key off the browser) or directly with a key.
// In "auto" mode the free sources are tried first and Scrydex last (first once the
// Pokémon TCG API has shut down, if it's set up).
(function (root) {
  const PP = root.PP;
  const U = PP.util;

  const DEFAULT_BASE = 'https://api.pokemontcg.io/v2';
  const SCRYDEX_BASE = 'https://api.scrydex.com/pokemon/v1';
  const TCGDEX_BASE = 'https://api.tcgdex.net/v2';
  const LEGACY_SUNSET = Date.UTC(2027, 2, 1);
  const DAY = 24 * PP.HOUR;
  const CACHE_PREFIX = 'packrush.cache.';
  const SETTINGS_KEY = 'packrush.settings';
  const SELECT = 'id,name,number,rarity,supertype,images,tcgplayer,cardmarket';
  const SOURCE_LABEL = { legacy: 'Pokémon TCG API', tcgdex: 'TCGdex', scrydex: 'Scrydex' };

  function settings() {
    return U.store.get(SETTINGS_KEY, {}) || {};
  }

  function saveSettings(next) {
    U.store.set(SETTINGS_KEY, { ...settings(), ...next });
    down.clear();
  }

  async function fetchJson(url, headers, { retries = 3, timeout = 45000 } = {}, init = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
        if (res.ok) return await res.json();
        lastErr = new Error(`Card API returned ${res.status}`);
        lastErr.status = res.status;
        if (res.status !== 429 && res.status < 500) break;
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('Card API timed out') : e;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < retries) await U.sleep(1000 * 2 ** attempt);
    }
    throw lastErr;
  }

  function withParams(base, params) {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    return url.toString();
  }

  // ---- cache -------------------------------------------------------------

  function cacheEntry(key) {
    return U.store.get(CACHE_PREFIX + key, null);
  }

  function cacheGet(key, ttl) {
    const e = cacheEntry(key);
    return e && Date.now() - e.t < ttl ? e.d : null;
  }

  function evictOldest(except) {
    let oldest = null;
    for (const k of U.store.keys()) {
      if (!k.startsWith(CACHE_PREFIX) || k === CACHE_PREFIX + except || k === CACHE_PREFIX + 'sets') continue;
      const e = U.store.get(k, null);
      if (!oldest || !e || e.t < oldest.t) oldest = { k, t: e ? e.t : 0 };
    }
    if (!oldest) return false;
    U.store.remove(oldest.k);
    return true;
  }

  function cachePut(key, data) {
    const entry = { t: Date.now(), d: data };
    for (let i = 0; i < 40; i++) {
      if (U.store.set(CACHE_PREFIX + key, entry)) return;
      if (!evictOldest(key)) return;
    }
  }

  function clearCache() {
    for (const k of U.store.keys()) if (k.startsWith(CACHE_PREFIX)) U.store.remove(k);
  }

  // ---- source 1: Pokémon TCG API (pokemontcg.io) ---------------------------

  function legacyBase() {
    return (settings().apiBase || DEFAULT_BASE).replace(/\/+$/, '');
  }

  function legacyRequest(path, params, opts) {
    const headers = {};
    const key = settings().apiKey;
    if (key) headers['X-Api-Key'] = key;
    return fetchJson(withParams(legacyBase() + path, params), headers, opts);
  }

  function compactSet(s) {
    return {
      id: s.id,
      name: s.name,
      series: s.series,
      total: s.total,
      printed: s.printedTotal,
      date: s.releaseDate,
      logo: s.images && s.images.logo,
      symbol: s.images && s.images.symbol,
    };
  }

  function compactCard(c) {
    const p = {};
    const tp = c.tcgplayer && c.tcgplayer.prices;
    if (tp) {
      for (const [variant, v] of Object.entries(tp)) {
        const price = v && (v.market ?? v.mid ?? v.low);
        if (price != null && price > 0) p[variant] = U.round2(price);
      }
    }
    const cm = c.cardmarket && c.cardmarket.prices;
    const out = {
      id: c.id,
      s: c.id.slice(0, c.id.lastIndexOf('-')),
      n: c.name,
      no: c.number,
      r: c.rarity || '',
      st: c.supertype,
      img: c.images && c.images.small,
      big: c.images && c.images.large,
      p,
    };
    if (cm) {
      const trend = cm.trendPrice || cm.averageSellPrice;
      if (trend) out.cm = U.round2(trend);
      if (cm.reverseHoloTrend) out.cmr = U.round2(cm.reverseHoloTrend);
    }
    return out;
  }

  const legacy = {
    // Read every page: the set list will eventually outgrow a single page.
    async getSets(opts) {
      const all = [];
      const size = 250;
      for (let page = 1; page < 20; page++) {
        const json = await legacyRequest('/sets', { orderBy: 'releaseDate', pageSize: size, page }, opts);
        const data = json.data || [];
        all.push(...data.map(compactSet));
        if (data.length < size || (json.totalCount && all.length >= json.totalCount)) break;
      }
      return all;
    },
    async getSetCards(setId, opts) {
      const all = [];
      for (let page = 1; page < 20; page++) {
        const json = await legacyRequest('/cards', { q: `set.id:${setId}`, pageSize: 250, page, select: SELECT }, opts);
        all.push(...json.data.map(compactCard));
        if (!json.data.length || all.length >= (json.totalCount || 0)) break;
      }
      return all;
    },
    async getCardsByIds(ids, opts) {
      const out = [];
      for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const q = '(' + chunk.map((id) => `id:"${id}"`).join(' OR ') + ')';
        const json = await legacyRequest('/cards', { q, pageSize: 250, select: SELECT }, opts);
        out.push(...json.data.map(compactCard));
      }
      return out;
    },
    async ping() {
      await legacyRequest('/sets', { pageSize: 1 }, { retries: 0, timeout: 20000 });
    },
  };

  // ---- source 2: Scrydex --------------------------------------------------

  let proxyProbe = null;

  // Is this page being served by server/proxy.js? Resolves to its health info or null.
  function detectProxy() {
    if (!proxyProbe) {
      proxyProbe = (async () => {
        if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
        try {
          const res = await fetch(new URL('scrydex/health', location.href), { cache: 'no-store' });
          if (!res.ok) return null;
          const json = await res.json();
          return json && json.ok ? json : null;
        } catch {
          return null;
        }
      })();
    }
    return proxyProbe;
  }

  async function scrydexTarget() {
    const s = settings();
    if (s.scrydexProxy) return { base: s.scrydexProxy.replace(/\/+$/, ''), headers: {}, via: 'proxy' };
    const proxy = await detectProxy();
    if (proxy && proxy.configured) return { base: new URL('scrydex', location.href).href, headers: {}, via: 'proxy' };
    if (s.scrydexKey && s.scrydexTeam) return { base: SCRYDEX_BASE, headers: { 'X-Api-Key': s.scrydexKey, 'X-Team-ID': s.scrydexTeam }, via: 'direct' };
    return null;
  }

  async function scrydexRequest(path, params, opts) {
    const t = await scrydexTarget();
    if (!t) throw new Error('Scrydex isn’t set up. Add your key on the Profile tab or run the bundled proxy server.');
    return fetchJson(withParams(t.base + path, params), t.headers, opts);
  }

  // Scrydex variant names → the printing keys the game uses for prices.
  function variantKey(name) {
    const raw = String(name || '');
    const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (k === 'normal' || k === 'nonholo' || k === 'regular') return 'normal';
    if (k === 'holofoil' || k === 'holo') return 'holofoil';
    if (k === 'reverseholofoil' || k === 'reverseholo' || k === 'reverse') return 'reverseHolofoil';
    if (k === 'unlimitedholofoil' || k === 'unlimitedholo') return 'unlimitedHolofoil';
    if (k === 'unlimited' || k === 'unlimitednormal') return 'unlimited';
    if (/^(1st|first)edition(holofoil|holo)$/.test(k)) return '1stEditionHolofoil';
    if (/^(1st|first)edition(normal)?$/.test(k)) return '1stEditionNormal';
    return raw.replace(/[_\s-]+(\w)/g, (_, c) => c.toUpperCase());
  }

  function pickImages(images) {
    if (!images) return null;
    if (Array.isArray(images)) return images.find((i) => !i.type || i.type === 'front') || images[0] || null;
    return images;
  }

  // Near-mint, ungraded, USD market price for one variant.
  function variantPrice(v) {
    const list = (v.prices || []).filter((x) => (!x.type || x.type === 'raw') && (!x.currency || x.currency === 'USD'));
    const nm = list.find((x) => !x.condition || /^(nm|near mint)$/i.test(x.condition)) || list[0];
    const price = nm && (nm.market ?? nm.mid ?? nm.low);
    return price > 0 ? U.round2(price) : null;
  }

  function scrydexCard(c) {
    const variants = c.variants || [];
    const img = pickImages(c.images) || variants.map((v) => pickImages(v.images)).find(Boolean) || {};
    const p = {};
    for (const v of variants) {
      const price = variantPrice(v);
      if (price != null) p[variantKey(v.name)] = price;
    }
    return {
      id: c.id,
      s: (c.expansion && c.expansion.id) || c.id.slice(0, c.id.lastIndexOf('-')),
      n: c.name,
      no: c.number,
      r: c.rarity || '',
      st: c.supertype,
      img: img.small || img.medium || img.large,
      big: img.large || img.medium || img.small,
      p,
    };
  }

  function scrydexSet(e) {
    return {
      id: e.id,
      name: e.name,
      series: e.series,
      total: e.total,
      printed: e.printed_total,
      date: e.release_date,
      logo: e.logo || (e.images && e.images.logo),
      symbol: e.symbol || (e.images && e.images.symbol),
    };
  }

  async function scrydexPages(path, params, map, opts) {
    const all = [];
    const size = 100;
    for (let page = 1; page < 40; page++) {
      const json = await scrydexRequest(path, { ...params, page, page_size: size }, opts);
      const data = json.data || [];
      all.push(...data.map(map));
      const total = json.total_count ?? json.totalCount;
      if (data.length < size || (total && page * size >= total)) break;
    }
    return all;
  }

  const scrydex = {
    async getSets(opts) {
      const all = [];
      const size = 100;
      for (let page = 1; page < 40; page++) {
        const json = await scrydexRequest('/en/expansions', { page, page_size: size }, opts);
        const data = json.data || [];
        all.push(...data.filter((e) => !e.is_online_only).map(scrydexSet));
        const total = json.total_count ?? json.totalCount;
        if (data.length < size || (total && page * size >= total)) break;
      }
      return all.sort((a, b) => U.parseDate(a.date) - U.parseDate(b.date));
    },
    getSetCards(setId, opts) {
      return scrydexPages(`/expansions/${encodeURIComponent(setId)}/cards`, { include: 'prices' }, scrydexCard, opts);
    },
    async getCardsByIds(ids, opts) {
      const out = [];
      try {
        for (let i = 0; i < ids.length; i += 25) {
          const q = ids.slice(i, i + 25).map((id) => `id:"${id}"`).join(' OR ');
          out.push(...(await scrydexPages('/cards', { q, include: 'prices' }, scrydexCard, opts)));
        }
        return out;
      } catch (e) {
        // Fall back to whole sets if multi-id search isn't supported.
        const bySet = {};
        for (const id of ids) (bySet[id.slice(0, id.lastIndexOf('-'))] = bySet[id.slice(0, id.lastIndexOf('-'))] || new Set()).add(id);
        const found = [];
        for (const [setId, want] of Object.entries(bySet)) found.push(...(await scrydex.getSetCards(setId, opts)).filter((c) => want.has(c.id)));
        return found;
      }
    },
    async ping() {
      await scrydexRequest('/en/expansions', { page: 1, page_size: 1 }, { retries: 0, timeout: 20000 });
    },
  };

  // ---- source 3: TCGdex (tcgdex.net) --------------------------------------
  //
  // GraphQL returns a whole set's cards in one request but has no prices, so prices
  // come from the REST card endpoint, one request per card (run in parallel).

  // TCGdex set ids that don't follow the "sv03.5" → "sv3pt5" pattern.
  const TCGDEX_IDS = {
    base6: 'lc', bp: 'bog', cel25c: 'cel25cc', fut20: 'fut2020', hsp: 'hgssp', mcd11: '2011bw', mcd12: '2012bw', mcd14: '2014xy', mcd15: '2015xy',
    mcd16: '2016xy', mcd17: '2017sm', mcd18: '2018sm', mcd19: '2019sm', mcd21: '2021swsh', mcd22: '2022swsh', me55: '30th', me55c: '30th-c',
    pgo: 'swsh10.5', rsv10pt5: 'sv10.5w', sm35: 'sm3.5', sm75: 'sm7.5', swsh35: 'swsh3.5', swsh45: 'swsh4.5', swsh45sv: 'swsh4.5sv',
    tk1a: 'tk-ex-latia', tk1b: 'tk-ex-latio', tk2a: 'tk-ex-p', tk2b: 'tk-ex-m', zsv10pt5: 'sv10.5b',
  };
  const FROM_TCGDEX = Object.fromEntries(Object.entries(TCGDEX_IDS).map(([ours, theirs]) => [theirs, ours]));
  // Digital-only (TCG Pocket), oversized, sample or duplicate listings.
  const TCGDEX_SKIP_SERIES = new Set(['tcgp']);
  const TCGDEX_SKIP_SETS = new Set(['jumbo', 'miscp', 'sp', 'ex5.5', 'xya', 'wp', 'mfb', 'mee', 'rc']);

  // "sv03.5" → "sv3pt5", "me01" → "me1", "swsh12.5gg" → "swsh12pt5gg"
  function fromTcgdexSet(id) {
    return FROM_TCGDEX[id] || id.replace(/([a-z])0+(?=\d)/g, '$1').replace(/\./g, 'pt');
  }

  // "001" → "1"; "TG01", "SV001", "SWSH050" stay as printed.
  function fromTcgdexNumber(localId) {
    return /^\d+$/.test(localId) ? String(parseInt(localId, 10)) : localId;
  }

  async function tcgdexBase() {
    const proxy = await detectProxy();
    if (proxy && proxy.tcgdex) return new URL('tcgdex', location.href).href;
    return TCGDEX_BASE;
  }

  async function tcgdexGraphql(query, opts) {
    const base = await tcgdexBase();
    const json = await fetchJson(base + '/graphql', { 'Content-Type': 'application/json' }, opts, { method: 'POST', body: JSON.stringify({ query }) });
    if (json.errors && json.errors.length && !json.data) throw new Error('TCGdex: ' + json.errors[0].message);
    return json.data || {};
  }

  // Shared limit so a few sets loading at once don't flood TCGdex.
  let tcgdexActive = 0;
  const tcgdexQueue = [];
  function tcgdexSlot() {
    if (tcgdexActive < 10) {
      tcgdexActive++;
      return Promise.resolve();
    }
    return new Promise((r) => tcgdexQueue.push(r));
  }
  function tcgdexDone() {
    const next = tcgdexQueue.shift();
    if (next) next();
    else tcgdexActive--;
  }

  async function tcgdexPricing(cardId, opts) {
    const base = await tcgdexBase();
    await tcgdexSlot();
    try {
      const card = await fetchJson(`${base}/en/cards/${encodeURIComponent(cardId)}`, {}, { retries: 1, timeout: 30000, ...opts });
      return card.pricing || null;
    } catch {
      return null; // a card without a price still opens fine; it falls back to rarity defaults
    } finally {
      tcgdexDone();
    }
  }

  function tcgdexCard(c, setId, pricing) {
    const no = fromTcgdexNumber(String(c.localId));
    const p = {};
    const out = {
      id: `${setId}-${no}`,
      s: setId,
      n: c.name,
      no,
      r: c.rarity && c.rarity !== 'None' ? c.rarity : '',
      st: c.category === 'Pokemon' ? 'Pokémon' : c.category,
      img: c.image ? c.image + '/low.webp' : undefined,
      big: c.image ? c.image + '/high.webp' : undefined,
      p,
    };
    const tp = pricing && pricing.tcgplayer;
    if (tp) {
      for (const [k, v] of Object.entries(tp)) {
        if (!v || typeof v !== 'object') continue;
        const price = v.marketPrice ?? v.midPrice ?? v.lowPrice;
        if (price > 0) p[variantKey(k)] = U.round2(price);
      }
    }
    const cm = pricing && pricing.cardmarket;
    if (cm) {
      const trend = cm.trend || cm.avg;
      if (trend) out.cm = U.round2(trend);
      if (cm['trend-holo']) out.cmr = U.round2(cm['trend-holo']);
    }
    return out;
  }

  function tcgdexSet(t) {
    const ext = (u) => (u ? u + '.png' : undefined);
    return {
      id: fromTcgdexSet(t.id),
      name: t.name,
      series: t.serie && t.serie.name,
      total: t.cardCount && t.cardCount.total,
      printed: t.cardCount && t.cardCount.official,
      date: t.releaseDate,
      logo: ext(t.logo),
      symbol: ext(t.symbol),
    };
  }

  let tcgdexIdCache = null;
  // Our set id → TCGdex set id, using the explicit table, then TCGdex's own list.
  async function toTcgdexSet(id, opts) {
    if (TCGDEX_IDS[id]) return TCGDEX_IDS[id];
    if (!tcgdexIdCache) {
      tcgdexIdCache = tcgdexGraphql('{ sets { id } }', opts)
        .then((d) => Object.fromEntries((d.sets || []).filter(Boolean).map((x) => [fromTcgdexSet(x.id), x.id])))
        .catch((e) => {
          tcgdexIdCache = null;
          throw e;
        });
    }
    return (await tcgdexIdCache)[id] || id;
  }

  async function tcgdexSetCardList(setId, opts) {
    const tid = await toTcgdexSet(setId, opts);
    const data = await tcgdexGraphql(`{ set(filters: { id: ${JSON.stringify('eq:' + tid)} }) { id cards { id localId name rarity category image } } }`, opts);
    if (!data.set || data.set.id !== tid) throw new Error(`TCGdex has no set ${tid}`);
    return (data.set.cards || []).filter(Boolean);
  }

  const tcgdex = {
    async getSets(opts) {
      const data = await tcgdexGraphql('{ sets { id name logo symbol releaseDate serie { id name } cardCount { total official } } }', opts);
      if (!data.sets || !data.sets.length) throw new Error('TCGdex returned no sets');
      return data.sets
        .filter((t) => t && t.releaseDate && !TCGDEX_SKIP_SETS.has(t.id) && !(t.serie && TCGDEX_SKIP_SERIES.has(t.serie.id)))
        .map(tcgdexSet)
        .sort((a, b) => U.parseDate(a.date) - U.parseDate(b.date));
    },
    async getSetCards(setId, opts) {
      const list = await tcgdexSetCardList(setId, opts);
      if (!list.length) throw new Error(`TCGdex has no cards for ${setId}`);
      const prices = await Promise.all(list.map((c) => tcgdexPricing(c.id, opts)));
      return list.map((c, i) => tcgdexCard(c, setId, prices[i]));
    },
    async getCardsByIds(ids, opts) {
      const bySet = {};
      for (const id of ids) {
        const setId = id.slice(0, id.lastIndexOf('-'));
        (bySet[setId] = bySet[setId] || new Set()).add(id);
      }
      const out = [];
      for (const [setId, want] of Object.entries(bySet)) {
        const list = (await tcgdexSetCardList(setId, opts)).filter((c) => want.has(`${setId}-${fromTcgdexNumber(String(c.localId))}`));
        const prices = await Promise.all(list.map((c) => tcgdexPricing(c.id, opts)));
        out.push(...list.map((c, i) => tcgdexCard(c, setId, prices[i])));
      }
      return out;
    },
    async ping() {
      await tcgdexGraphql('{ sets(pagination: { page: 1, itemsPerPage: 1 }) { id } }', { retries: 0, timeout: 20000 });
    },
  };

  // ---- source selection --------------------------------------------------

  const SOURCES = { legacy, tcgdex, scrydex };
  const MODE_SOURCE = { pokemontcg: 'legacy', tcgdex: 'tcgdex', scrydex: 'scrydex' };
  const down = new Set(); // sources that failed this session while a later one worked
  let lastSource = null;

  // Auto: free sources before Scrydex (paid). Once the Pokémon TCG API has shut down,
  // a configured Scrydex takes over with TCGdex as the free backup.
  async function sourceOrder() {
    const mode = settings().source || 'auto';
    if (MODE_SOURCE[mode]) return [MODE_SOURCE[mode]];
    const sx = (await scrydexTarget()) ? ['scrydex'] : [];
    const order = Date.now() >= LEGACY_SUNSET ? [...sx, 'tcgdex'] : ['legacy', 'tcgdex', ...sx];
    // Sources that already failed this session go last instead of being retried first.
    return [...order.filter((n) => !down.has(n)), ...order.filter((n) => down.has(n))];
  }

  async function call(method, ...args) {
    const order = await sourceOrder();
    let err;
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      // Give up on the first source quickly when there's another to try.
      const opts = i < order.length - 1 ? { retries: 1, timeout: 25000 } : undefined;
      try {
        const result = await SOURCES[name][method](...args, opts);
        order.slice(0, i).forEach((n) => down.add(n));
        down.delete(name);
        lastSource = name;
        return result;
      } catch (e) {
        err = e;
      }
    }
    throw err;
  }

  // ---- public calls ------------------------------------------------------

  const inflight = new Map();
  function once(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function withStaleFallback(key, ttl, force, load) {
    const fresh = !force && cacheGet(key, ttl);
    if (fresh) return fresh;
    return once(key, async () => {
      try {
        const data = await load();
        cachePut(key, data);
        return data;
      } catch (e) {
        const stale = cacheEntry(key);
        if (stale) return stale.d;
        throw e;
      }
    });
  }

  function getSets(force) {
    return withStaleFallback('sets', DAY, force, () => call('getSets'));
  }

  function getSetCards(setId, force) {
    return withStaleFallback('cards.' + setId, DAY, force, () => call('getSetCards', setId));
  }

  function getCardsByIds(ids) {
    return call('getCardsByIds', ids);
  }

  function peekSets() {
    const e = cacheEntry('sets');
    return e ? e.d : [];
  }

  function peekSetCards(setId) {
    const e = cacheEntry('cards.' + setId);
    return e ? e.d : null;
  }

  // Check each source once (Scrydex costs one credit).
  async function testSources() {
    const out = {};
    for (const name of ['legacy', 'tcgdex', 'scrydex']) {
      if (name === 'scrydex' && !(await scrydexTarget())) {
        out[name] = { ok: false, error: 'Not set up' };
        continue;
      }
      try {
        await SOURCES[name].ping();
        out[name] = { ok: true };
      } catch (e) {
        out[name] = { ok: false, error: e.message || String(e) };
      }
    }
    return out;
  }

  async function status() {
    const t = await scrydexTarget();
    const proxy = await detectProxy();
    return { mode: settings().source || 'auto', scrydex: t ? t.via : null, tcgdexViaProxy: !!(proxy && proxy.tcgdex), lastSource, down: [...down], sunset: LEGACY_SUNSET };
  }

  PP.api = {
    DEFAULT_BASE,
    SCRYDEX_BASE,
    LEGACY_SUNSET,
    SOURCE_LABEL,
    settings,
    saveSettings,
    getSets,
    getSetCards,
    peekSets,
    peekSetCards,
    getCardsByIds,
    clearCache,
    testSources,
    status,
    detectProxy,
    compactCard,
    compactSet,
    scrydexCard,
    scrydexSet,
    tcgdexCard,
    tcgdexSet,
    fromTcgdexSet,
    variantKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
