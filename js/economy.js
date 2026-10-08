// Rarity tiers, pack contents, card pricing, pack pricing and the rotating shop.
(function (root) {
  const PP = root.PP;
  const U = PP.util;

  const EUR_USD = 1.08;
  const ROTATION_MS = 12 * PP.HOUR;
  const YEAR_MS = 365.25 * 24 * PP.HOUR;

  // ---- rarity tiers ------------------------------------------------------

  const TIERS = ['C', 'U', 'R', 'RH', 'DR', 'IR', 'UR', 'SR'];
  const TIER_LABEL = {
    C: 'Common',
    U: 'Uncommon',
    R: 'Rare',
    RH: 'Holo Rare',
    DR: 'Double Rare',
    IR: 'Illustration Rare',
    UR: 'Ultra Rare',
    SR: 'Secret Rare',
  };
  // Used only when a card has no market price at all.
  const DEFAULT_PRICE = { C: 0.1, U: 0.15, R: 0.35, RH: 1, DR: 2, IR: 5, UR: 6, SR: 15 };

  // The API uses ~50 different rarity strings across eras; fold them into 8 tiers.
  function tierOf(rarity) {
    const r = String(rarity || '').toLowerCase().trim();
    if (!r || r === 'common') return 'C';
    if (r === 'uncommon') return 'U';
    if (/special illustration|hyper|secret|rainbow|shiny ultra|holo star|mega hyper|black white|shining/.test(r)) return 'SR';
    if (/illustration rare|trainer gallery/.test(r)) return 'IR';
    if (/ultra|shiny/.test(r)) return 'UR';
    if (/double|holo (ex|gx|v|vmax|vstar|lv\.x)$|prime|legend|break|prism|amazing|radiant|\bace\b/.test(r)) return 'DR';
    if (/holo/.test(r)) return 'RH';
    return 'R'; // plain "Rare", promos, anything unknown
  }

  function tierRank(tier) {
    return TIERS.indexOf(tier);
  }

  // ---- variants & prices -------------------------------------------------

  const VARIANT_LABEL = {
    normal: 'Normal',
    unlimited: 'Normal',
    holofoil: 'Holo',
    unlimitedHolofoil: 'Holo',
    reverseHolofoil: 'Reverse Holo',
    '1stEdition': '1st Edition',
    '1stEditionNormal': '1st Edition',
    '1stEditionHolofoil': '1st Edition Holo',
  };

  const PREF = {
    normal: ['normal', 'unlimited', 'holofoil', 'unlimitedHolofoil', 'reverseHolofoil'],
    holo: ['holofoil', 'unlimitedHolofoil', 'normal', 'unlimited', 'reverseHolofoil'],
  };

  // Which printing a card in a given slot is (and therefore which price applies).
  function variantFor(card, kind, tier) {
    if (kind === 'reverse') return 'reverseHolofoil';
    const list = kind === 'rare' && tierRank(tier) >= tierRank('RH') ? PREF.holo : PREF.normal;
    const p = card.p || {};
    for (const v of list) if (p[v] != null) return v;
    // Only first-edition prices exist: still the right card, so use that printing.
    const any = Object.keys(p)[0];
    if (any) return any;
    return list[0];
  }

  function basePrice(card) {
    const p = card.p || {};
    for (const v of PREF.normal) if (p[v] != null) return p[v];
    const any = Object.values(p)[0];
    if (any != null) return any;
    if (card.cm) return U.round2(card.cm * EUR_USD);
    return DEFAULT_PRICE[tierOf(card.r)];
  }

  // Real-world market value (TCGplayer market, falling back to Cardmarket trend).
  function priceOf(card, variant) {
    const p = card.p || {};
    let v = p[variant];
    if (v == null && variant === 'reverseHolofoil') v = card.cmr ? card.cmr * EUR_USD : basePrice(card) * 1.4;
    if (v == null) v = basePrice(card);
    return Math.max(0.01, U.round2(v));
  }

  function variantLabel(v) {
    return VARIANT_LABEL[v] || v.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  }

  // ---- pack layouts ------------------------------------------------------

  function eraOf(set) {
    if (/mcdonald/i.test(set.name)) return 'mini';
    const t = U.parseDate(set.date);
    if (t < Date.UTC(2002, 8, 1)) return 'wotc'; // Base Set through Legendary Collection
    if (t >= Date.UTC(2023, 2, 1)) return 'sv'; // Scarlet & Violet onward
    return 'reverse'; // e-Card through Sword & Shield
  }

  const LAYOUTS = {
    wotc: [['C', 7], ['U', 3], ['RARE', 1]],
    reverse: [['C', 5], ['U', 3], ['REV', 1], ['RARE', 1]],
    sv: [['C', 4], ['U', 3], ['REV', 1], ['HIT', 1], ['RARE', 1]],
    mini: [['ANY', 4]],
  };

  // Approximate real pull rates for the rare slot. Tiers a set lacks are dropped
  // and the rest renormalised, so the same table works across very different sets.
  const RARE_WEIGHTS = {
    wotc: { R: 0.66, RH: 0.33, DR: 0.03, UR: 0.03, SR: 0.01 },
    reverse: { R: 0.62, RH: 0.2, DR: 0.12, IR: 0.03, UR: 0.045, SR: 0.012 },
    sv: { R: 0.72, RH: 0.05, DR: 0.17, UR: 0.067, SR: 0.008 },
  };
  const REV_WEIGHTS = { C: 0.55, U: 0.3, R: 0.1, RH: 0.05 };
  // Scarlet & Violet's second reverse slot can upgrade to an Illustration / Special Illustration rare.
  const HIT_WEIGHTS = { REV: 0.915, IR: 0.077, SR: 0.008 };

  function buildPools(cards) {
    const pools = { ALL: cards.slice() };
    for (const t of TIERS) pools[t] = [];
    for (const c of cards) pools[tierOf(c.r)].push(c);
    return pools;
  }

  function weighted(weights, pools, kind) {
    return Object.entries(weights)
      .filter(([t]) => pools[t] && pools[t].length)
      .map(([tier, w]) => ({ tier, w, kind }));
  }

  function normalise(dist) {
    const total = dist.reduce((s, d) => s + d.w, 0);
    return dist.map((d) => ({ ...d, w: d.w / total }));
  }

  function firstPresent(pools, tiers) {
    return tiers.find((t) => pools[t] && pools[t].length) || 'ALL';
  }

  function slotDistribution(slot, era, pools) {
    let dist;
    if (slot === 'C') dist = [{ tier: firstPresent(pools, ['C', 'U']), w: 1, kind: 'normal' }];
    else if (slot === 'U') dist = [{ tier: firstPresent(pools, ['U', 'C']), w: 1, kind: 'normal' }];
    else if (slot === 'ANY') dist = [{ tier: 'ALL', w: 1, kind: 'normal' }];
    else if (slot === 'REV') dist = weighted(REV_WEIGHTS, pools, 'reverse');
    else if (slot === 'HIT') {
      const rev = normalise(weighted(REV_WEIGHTS, pools, 'reverse')).map((d) => ({ ...d, w: d.w * HIT_WEIGHTS.REV }));
      dist = rev.concat(weighted({ IR: HIT_WEIGHTS.IR, SR: HIT_WEIGHTS.SR }, pools, 'rare'));
    } else dist = weighted(RARE_WEIGHTS[era] || RARE_WEIGHTS.reverse, pools, 'rare');
    if (!dist.length) dist = [{ tier: 'ALL', w: 1, kind: slot === 'REV' ? 'reverse' : 'rare' }];
    return normalise(dist);
  }

  // ---- pack value & price ------------------------------------------------

  // Sealed packs get pricier with age: (out of print, opened over time).
  function agePremium(years) {
    return 1 + 0.004 * Math.pow(Math.max(0, years), 2.6);
  }

  // Retail-style price endings: $4.49, $4.99, $37.99.
  function charm(x) {
    x = U.clamp(x, 1, 500);
    const y = x < 10 ? Math.ceil(x * 2) / 2 - 0.01 : Math.ceil(x) - 0.01;
    return U.round2(Math.max(1, y));
  }

  const MARKUP = 1.2;
  const BASE_COST = 1; // printing, distribution, the shop's cut

  function packModel(set, cards, now = Date.now()) {
    const era = eraOf(set);
    const pools = buildPools(cards);
    const slots = LAYOUTS[era].map(([slot, n]) => ({ slot, n, dist: slotDistribution(slot, era, pools) }));

    let ev = 0;
    for (const s of slots) {
      for (const d of s.dist) {
        const pool = pools[d.tier];
        const mean = pool.reduce((sum, c) => sum + priceOf(c, variantFor(c, d.kind, d.tier)), 0) / pool.length;
        ev += s.n * d.w * mean;
      }
    }
    const years = (now - U.parseDate(set.date)) / YEAR_MS;
    const age = agePremium(years);
    const price = charm((ev * MARKUP + BASE_COST) * age);
    const size = slots.reduce((s, x) => s + x.n, 0);
    return { set, era, pools, slots, ev: U.round2(ev), years, age, price, size, cardCount: cards.length };
  }

  const SPECIAL_SLOTS = new Set(['REV', 'HIT', 'RARE']);

  function openPack(model, rng = Math.random) {
    const pulls = [];
    for (const s of model.slots) {
      const used = new Set();
      for (let i = 0; i < s.n; i++) {
        const d = U.pickWeighted(rng, s.dist.map((x) => [x, x.w]));
        const pool = model.pools[d.tier];
        let card;
        // Real packs don't repeat a common within the same pack.
        for (let tries = 0; tries < 8; tries++) {
          card = pool[Math.floor(rng() * pool.length)];
          if (!used.has(card.id)) break;
        }
        used.add(card.id);
        const variant = variantFor(card, d.kind, d.tier);
        pulls.push({ card, variant, tier: tierOf(card.r), price: priceOf(card, variant), slot: s.slot });
      }
    }
    // Save the best for last: the special slots reveal in ascending order.
    const normal = pulls.filter((p) => !SPECIAL_SLOTS.has(p.slot));
    const special = pulls
      .filter((p) => SPECIAL_SLOTS.has(p.slot))
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.price - b.price);
    return normal.concat(special);
  }

  // ---- rotating shop -----------------------------------------------------

  const EXCLUDE = /promo|trainer gallery|galarian gallery|shiny vault|futsal|trainer kit|energies|classic collection|best of game/i;

  function isEligible(set, now) {
    if (EXCLUDE.test(set.name)) return false;
    if (U.parseDate(set.date) > now) return false;
    if (/mcdonald/i.test(set.name)) return set.total >= 6;
    return set.total >= 30;
  }

  function bucketOf(set) {
    if (/mcdonald/i.test(set.name)) return 'mini';
    const y = U.yearOf(set.date);
    if (y < 2003) return 'vintage';
    if (y < 2011) return 'classic';
    if (y < 2020) return 'modern';
    return 'current';
  }

  const SHOP_PLAN = [['vintage', 1], ['classic', 2], ['modern', 2], ['current', 2], ['wild', 1]];

  function rotationIndex(now) {
    return Math.floor(now / ROTATION_MS);
  }

  function rotationEndsAt(now) {
    return (rotationIndex(now) + 1) * ROTATION_MS;
  }

  // Same rotation index -> same packs for everyone. Only sets released before the
  // rotation began are eligible, so a new set release can't reshuffle a live rotation.
  function shopSets(sets, now = Date.now()) {
    const idx = rotationIndex(now);
    const start = idx * ROTATION_MS;
    const rng = U.mulberry32(U.hashStr('packrush-shop-' + idx));
    const eligible = sets.filter((s) => isEligible(s, start)).sort((a, b) => (a.id < b.id ? -1 : 1));
    const buckets = { vintage: [], classic: [], modern: [], current: [], mini: [] };
    for (const s of eligible) buckets[bucketOf(s)].push(s);

    const chosen = [];
    for (const [bucket, n] of SHOP_PLAN) {
      let pool;
      if (bucket === 'wild') pool = rng() < 0.4 && buckets.mini.length ? buckets.mini : eligible;
      else pool = buckets[bucket];
      const picks = U.shuffle(pool.filter((s) => !chosen.includes(s)), rng).slice(0, n);
      chosen.push(...picks);
    }
    return chosen;
  }

  PP.economy = {
    TIERS,
    TIER_LABEL,
    ROTATION_MS,
    tierOf,
    tierRank,
    variantFor,
    priceOf,
    variantLabel,
    eraOf,
    agePremium,
    charm,
    packModel,
    openPack,
    isEligible,
    shopSets,
    rotationIndex,
    rotationEndsAt,
    MARKUP,
    BASE_COST,
  };
})(typeof window !== 'undefined' ? window : globalThis);
