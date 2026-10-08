// Card data client with a localStorage cache.
//
// Two sources produce the same compact card/set format:
//   - the free Pokémon TCG API (pokemontcg.io), which goes offline on March 1, 2027
//   - Scrydex (scrydex.com), its paid successor, reached either through the bundled
//     proxy (server/proxy.js keeps the key off the browser) or directly with a key.
// In "auto" mode the free API is tried first and Scrydex is the fallback.
(function (root) {
  const PP = root.PP;
  const U = PP.util;

  const DEFAULT_BASE = 'https://api.pokemontcg.io/v2';
  const SCRYDEX_BASE = 'https://api.scrydex.com/pokemon/v1';
  const LEGACY_SUNSET = Date.UTC(2027, 2, 1);
  const DAY = 24 * PP.HOUR;
  const CACHE_PREFIX = 'packrush.cache.';
  const SETTINGS_KEY = 'packrush.settings';
  const SELECT = 'id,name,number,rarity,supertype,images,tcgplayer,cardmarket';
  const SOURCE_LABEL = { legacy: 'Pokémon TCG API', scrydex: 'Scrydex' };

  function settings() {
    return U.store.get(SETTINGS_KEY, {}) || {};
  }

  function saveSettings(next) {
    U.store.set(SETTINGS_KEY, { ...settings(), ...next });
    legacyDown = false;
  }

  async function fetchJson(url, headers, { retries = 3, timeout = 45000 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, { headers, signal: ctrl.signal });
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

  // Is this page being served by server/proxy.js with a Scrydex key configured?
  function detectProxy() {
    if (!proxyProbe) {
      proxyProbe = (async () => {
        if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
        try {
          const res = await fetch(new URL('scrydex/health', location.href), { cache: 'no-store' });
          if (!res.ok) return false;
          const json = await res.json();
          return !!(json && json.ok && json.configured);
        } catch {
          return false;
        }
      })();
    }
    return proxyProbe;
  }

  async function scrydexTarget() {
    const s = settings();
    if (s.scrydexProxy) return { base: s.scrydexProxy.replace(/\/+$/, ''), headers: {}, via: 'proxy' };
    if (await detectProxy()) return { base: new URL('scrydex', location.href).href, headers: {}, via: 'proxy' };
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

  // ---- source selection --------------------------------------------------

  const SOURCES = { legacy, scrydex };
  let legacyDown = false; // the free API failed this session and Scrydex worked instead
  let lastSource = null;

  async function sourceOrder() {
    const mode = settings().source || 'auto';
    if (mode === 'pokemontcg') return ['legacy'];
    if (mode === 'scrydex') return ['scrydex'];
    if (!(await scrydexTarget())) return ['legacy'];
    if (legacyDown || Date.now() >= LEGACY_SUNSET) return ['scrydex', 'legacy'];
    return ['legacy', 'scrydex'];
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
        if (name === 'scrydex' && order.includes('legacy')) legacyDown = true;
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
    for (const name of ['legacy', 'scrydex']) {
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
    return { mode: settings().source || 'auto', scrydex: t ? t.via : null, lastSource, legacyDown, sunset: LEGACY_SUNSET };
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
    variantKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
