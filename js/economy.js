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

  // Promo cards all share the rarity "Promo", so their tier comes from market value instead.
  const PROMO_TIERS = [
    [100, 'SR'],
    [30, 'UR'],
    [10, 'DR'],
    [3, 'RH'],
  ];

  // The API uses ~50 different rarity strings across eras; fold them into 8 tiers.
  // Accepts a rarity string or a card (needed for promos).
  function tierOf(rarity) {
    if (rarity && typeof rarity === 'object') {
      const card = rarity;
      if (!/^promo$/i.test(String(card.r || '').trim())) return tierOf(card.r);
      const v = cardValue(card);
      for (const [min, t] of PROMO_TIERS) if (v >= min) return t;
      return 'R';
    }
    const r = String(rarity || '').toLowerCase().trim();
    if (!r || r === 'common' || r === 'none') return 'C';
    if (r === 'uncommon') return 'U';
    if (/special illustration|hyper|secret|rainbow|shiny ultra|holo star|mega hyper|black white|shining|character super/.test(r)) return 'SR';
    if (/illustration rare|trainer gallery|character rare/.test(r)) return 'IR';
    if (/ultra|shiny|full art|mega attack|triple rare/.test(r)) return 'UR';
    if (/double|holo (ex|gx|v|vmax|vstar|lv\.x)$|holo rare (v|vmax|vstar)$|prime|legend|break|prism|amazing|radiant|\bace\b/.test(r)) return 'DR';
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

  // The most a card can be pulled for from an unlimited pack (used for chase lists and pack art).
  function cardValue(card) {
    const p = card.p || {};
    let best = 0;
    for (const [v, price] of Object.entries(p)) if (!/^1stEdition/.test(v) && price > best) best = price;
    return best || priceOf(card, variantFor(card, 'rare', tierOf(card.r)));
  }

  function variantLabel(v) {
    return VARIANT_LABEL[v] || v.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  }

  // ---- sets --------------------------------------------------------------

  // Sub-sets whose cards were pulled from the parent set's packs.
  const SUBSETS = {
    swsh9: ['swsh9tg'],
    swsh10: ['swsh10tg'],
    swsh11: ['swsh11tg'],
    swsh12: ['swsh12tg'],
    swsh12pt5: ['swsh12pt5gg'],
    swsh45: ['swsh45sv'],
    sm115: ['sma'],
    cel25: ['cel25c'],
    me55: ['me55c'],
  };
  const SUBSET_IDS = new Set(Object.values(SUBSETS).flat());

  // Black Star promo sets (and similar promo collections) open as promo packs.
  function isPromo(set) {
    return /promo|best of game/i.test(set.name);
  }

  function isMini(set) {
    return !isPromo(set) && (/mcdonald/i.test(set.name) || (set.total > 0 && set.total < 30));
  }

  function eraOf(set) {
    if (isPromo(set)) return 'promo';
    if (isMini(set)) return 'mini';
    const t = U.parseDate(set.date);
    if (t < Date.UTC(2002, 8, 1)) return 'wotc'; // Base Set through Legendary Collection
    if (t >= Date.UTC(2023, 2, 1)) return 'sv'; // Scarlet & Violet onward
    return 'reverse'; // e-Card through Sword & Shield
  }

  function bucketOf(set) {
    if (isPromo(set)) return 'promo';
    if (isMini(set)) return 'special';
    const y = U.yearOf(set.date);
    if (y < 2003) return 'vintage';
    if (y < 2011) return 'classic';
    if (y < 2020) return 'modern';
    return 'current';
  }

  const BUCKET_LABEL = { vintage: 'Vintage', classic: 'Classic', modern: 'Modern', current: 'Current', special: 'Special', promo: 'Promo' };

  // ---- pack layouts ------------------------------------------------------

  const LAYOUTS = {
    wotc: [['C', 7], ['U', 3], ['RARE', 1]],
    reverse: [['C', 5], ['U', 3], ['REV', 1], ['RARE', 1]],
    sv: [['C', 4], ['U', 3], ['REV', 1], ['HIT', 1], ['RARE', 1]],
    mini: [['ANY', 3], ['RARE', 1]],
    promo: [['ANY', 3]],
  };

  // Approximate real pull rates for the rare slot. Tiers a set lacks are dropped
  // and the rest renormalised, so the same table works across very different sets.
  const RARE_WEIGHTS = {
    wotc: { R: 0.66, RH: 0.33, DR: 0.03, UR: 0.03, SR: 0.01 },
    reverse: { R: 0.62, RH: 0.2, DR: 0.12, IR: 0.03, UR: 0.045, SR: 0.012 },
    sv: { R: 0.72, RH: 0.05, DR: 0.17, UR: 0.067, SR: 0.008 },
    mini: { R: 0.5, RH: 0.3, DR: 0.12, IR: 0.03, UR: 0.04, SR: 0.01 },
  };
  const REV_WEIGHTS = { C: 0.55, U: 0.3, R: 0.1, RH: 0.05 };
  // Scarlet & Violet's second reverse slot can upgrade to an Illustration / Special Illustration rare.
  const HIT_WEIGHTS = { REV: 0.915, IR: 0.077, SR: 0.008 };

  function buildPools(cards) {
    const pools = { ALL: cards.slice() };
    for (const t of TIERS) pools[t] = [];
    for (const c of cards) pools[tierOf(c)].push(c);
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

  // Sealed packs get pricier with age (out of print, opened over time).
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
  const BUNDLE_SIZE = 6;
  const BUNDLE_DISCOUNT = 0.05;

  function bundlePrice(price) {
    return U.round2(Math.max(1, Math.ceil(price * BUNDLE_SIZE * (1 - BUNDLE_DISCOUNT)) - 0.01));
  }

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
    const chase = cards
      .map((c) => ({ card: c, value: cardValue(c) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const star = chase.find((x) => x.card.st === 'Pokémon') || chase[0];
    return {
      set,
      era,
      bucket: bucketOf(set),
      pools,
      slots,
      ev: U.round2(ev),
      years,
      age,
      price,
      bundle: bundlePrice(price),
      size,
      cardCount: cards.length,
      chase,
      art: star ? star.card.big || star.card.img : null,
    };
  }

  // Chance that one pack contains at least one card of each tier or better.
  function packOdds(model) {
    const out = [];
    for (const t of ['RH', 'DR', 'IR', 'UR', 'SR']) {
      if (!model.pools[t].length) continue;
      const r = tierRank(t);
      let none = 1;
      for (const s of model.slots) {
        let p = 0;
        for (const d of s.dist) {
          const pool = model.pools[d.tier];
          const frac = d.tier === 'ALL' ? pool.filter((c) => tierRank(tierOf(c)) >= r).length / pool.length : tierRank(d.tier) >= r ? 1 : 0;
          p += d.w * frac;
        }
        none *= Math.pow(1 - p, s.n);
      }
      out.push({ tier: t, p: 1 - none });
    }
    return out;
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
        pulls.push({ card, variant, tier: tierOf(card), price: priceOf(card, variant), slot: s.slot });
      }
    }
    // Save the best for last: the special slots reveal in ascending order.
    const normal = pulls.filter((p) => !SPECIAL_SLOTS.has(p.slot));
    const special = pulls
      .filter((p) => SPECIAL_SLOTS.has(p.slot))
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.price - b.price);
    return normal.concat(special);
  }

  // ---- grading -----------------------------------------------------------
  //
  // Modeled on real grading: pack-fresh modern cards often get a 10, vintage rarely.
  // A graded card's value is its raw price times a multiplier that grows steeply with
  // grade and age, with a floor (even a common is worth something in a 10 slab).

  const GRADE_NAMES = { 10: 'Gem Mint', 9: 'Mint', 8: 'NM-Mint', 7: 'Near Mint', 6: 'EX-MT', 5: 'Excellent', 4: 'VG-EX', 3: 'Very Good', 2: 'Good', 1: 'Poor' };
  const GRADE_ODDS = {
    modern: { 10: 0.12, 9: 0.25, 8: 0.24, 7: 0.15, 6: 0.09, 5: 0.06, 4: 0.04, 3: 0.025, 2: 0.015, 1: 0.01 },
    classic: { 10: 0.06, 9: 0.17, 8: 0.24, 7: 0.18, 6: 0.12, 5: 0.08, 4: 0.06, 3: 0.045, 2: 0.03, 1: 0.015 },
    vintage: { 10: 0.02, 9: 0.08, 8: 0.18, 7: 0.2, 6: 0.16, 5: 0.12, 4: 0.09, 3: 0.07, 2: 0.05, 1: 0.03 },
  };
  const GRADE_MULT = {
    modern: { 10: 3.5, 9: 1.3, 8: 0.85, 7: 0.75, 6: 0.65, 5: 0.55, 4: 0.45, 3: 0.4, 2: 0.35, 1: 0.3 },
    classic: { 10: 7, 9: 2, 8: 1.1, 7: 0.85, 6: 0.75, 5: 0.6, 4: 0.5, 3: 0.42, 2: 0.36, 1: 0.3 },
    vintage: { 10: 15, 9: 3.5, 8: 1.5, 7: 1.1, 6: 0.85, 5: 0.8, 4: 0.65, 3: 0.55, 2: 0.45, 1: 0.35 },
  };
  const SLAB_FLOOR = { 10: 18, 9: 9, 8: 6, 7: 5, 6: 4, 5: 4, 4: 3, 3: 3, 2: 3, 1: 3 };
  const ERA_LABEL = { modern: 'Modern (2017+)', classic: 'Classic (2003–2016)', vintage: 'Vintage (1999–2002)' };
  const GRADING = {
    standard: { label: 'Standard', ms: PP.HOUR, mult: 1 },
    express: { label: 'Express', ms: 5 * 60 * 1000, mult: 3 },
  };

  function gradeEra(date) {
    if (!date) return 'modern';
    const y = U.yearOf(date);
    return y < 2003 ? 'vintage' : y < 2017 ? 'classic' : 'modern';
  }

  // Priced by declared value, like real grading tiers.
  function gradingFee(rawValue, speed = 'standard') {
    const base = rawValue < 100 ? 15 : rawValue < 500 ? 30 : rawValue < 1500 ? 75 : rawValue < 5000 ? 150 : 300;
    return base * (GRADING[speed] || GRADING.standard).mult;
  }

  function rollGrade(era, rng = Math.random) {
    return Number(U.pickWeighted(rng, Object.entries(GRADE_ODDS[era] || GRADE_ODDS.modern).map(([g, w]) => [g, w])));
  }

  // Real graded sale prices (Scrydex, then PokemonPriceTracker) win over the estimate.
  // Grades without sales are scaled from the nearest grade that has them, so the ladder
  // stays consistent; with no sales at all, they're the raw price times the grade multiplier.
  function realGraded(card) {
    const out = {};
    for (const src of [card.pg, card.g]) if (src) for (const [k, v] of Object.entries(src)) if (v > 0) out[k] = v;
    return out;
  }

  function gradedPrice(card, variant, grade, era) {
    const mults = GRADE_MULT[era] || GRADE_MULT.modern;
    const real = realGraded(card);
    if (real[grade]) return U.round2(real[grade]);
    const known = Object.keys(real).map(Number);
    if (known.length) {
      const near = known.sort((a, b) => Math.abs(a - grade) - Math.abs(b - grade) || b - a)[0];
      return U.round2(Math.max(SLAB_FLOOR[grade], (real[near] * mults[grade]) / mults[near]));
    }
    return U.round2(Math.max(SLAB_FLOOR[grade], priceOf(card, variant) * mults[grade]));
  }

  function gradeOdds(card, variant, era) {
    return Object.entries(GRADE_ODDS[era] || GRADE_ODDS.modern)
      .map(([g, p]) => ({ grade: Number(g), p, value: gradedPrice(card, variant, Number(g), era) }))
      .sort((a, b) => b.grade - a.grade);
  }

  function gradedEV(card, variant, era) {
    return U.round2(gradeOdds(card, variant, era).reduce((s, o) => s + o.p * o.value, 0));
  }

  // ---- earning: daily missions, collector requests, set rewards -------------

  const DAY_MS = 24 * PP.HOUR;
  const dayIndex = (now) => Math.floor(now / DAY_MS);

  // Each template makes one mission; three different ones are drawn per (UTC) day.
  const MISSIONS = [
    (r) => { const t = [3, 5, 8][Math.floor(r() * 3)]; return { type: 'packs', target: t, reward: t * 4, label: `Open ${t} packs` }; },
    () => ({ type: 'pull', tier: 'RH', target: 1, reward: 10, label: 'Pull a Holo Rare or better' }),
    () => ({ type: 'pull', tier: 'DR', target: 1, reward: 25, label: 'Pull a Double Rare or better' }),
    () => ({ type: 'pull', tier: 'UR', target: 1, reward: 60, label: 'Pull an Ultra Rare or better' }),
    () => ({ type: 'oldpack', target: 1, reward: 20, label: 'Open a pack from before 2011' }),
    (r) => { const t = [5, 10, 20][Math.floor(r() * 3)]; return { type: 'new', target: t, reward: Math.round(t * 1.5), label: `Add ${t} new cards to your binder` }; },
    (r) => { const t = [5, 15, 40][Math.floor(r() * 3)]; return { type: 'sell', target: t, reward: { 5: 8, 15: 15, 40: 25 }[t], label: `Sell $${t} worth of cards`, money: true }; },
    () => ({ type: 'grade', target: 1, reward: 15, label: 'Send a card for grading' }),
    () => ({ type: 'bundle', target: 1, reward: 30, label: 'Open a 6-pack bundle' }),
    () => ({ type: 'mystery', target: 1, reward: 12, label: 'Open a mystery pack' }),
    () => ({ type: 'request', target: 1, reward: 15, label: 'Fill a collector request' }),
  ];
  const DAILY_BONUS = 25;

  function dailyMissions(day) {
    const rng = U.mulberry32(U.hashStr('packrush-day-' + day));
    const picks = U.shuffle(MISSIONS.map((_, i) => i), rng);
    const out = [];
    const seen = new Set();
    for (const i of picks) {
      const m = MISSIONS[i](rng);
      const kind = m.type === 'pull' ? 'pull' : m.type;
      if (seen.has(kind)) continue; // at most one "pull" mission a day
      seen.add(kind);
      out.push({ id: `${day}-${out.length}`, ...m, progress: 0, claimed: false });
      if (out.length === 3) break;
    }
    return out;
  }

  // One-time rewards for collecting 25/50/75/100% of a set, scaled by its size.
  const MILESTONES = [
    [0.25, 0.1],
    [0.5, 0.25],
    [0.75, 0.5],
    [1, 1.5],
  ];
  function setMilestones(total) {
    return MILESTONES.map(([share, perCard], i) => ({ level: i + 1, share, need: Math.max(1, Math.ceil(total * share)), reward: Math.max(2, Math.round(total * perCard)) }));
  }

  // Collectors want specific cards: some from this rotation's packs (premium 1.4–2x),
  // some you already own (1.2–1.5x). Same rotation, same requests.
  function requestOffer(card, mult) {
    return U.round2(Math.max(0.25, mult * priceOf(card, variantFor(card, 'rare', tierOf(card)))));
  }

  function collectorRequests(rotation, models, ownedCards) {
    const rng = U.mulberry32(U.hashStr('packrush-requests-' + rotation));
    const out = [];
    const used = new Set();
    const shopPool = [];
    for (const m of models.slice().sort((a, b) => (a.set.id < b.set.id ? -1 : 1))) {
      for (const c of m.pools.ALL) {
        const v = cardValue(c);
        if (tierRank(tierOf(c)) >= tierRank('RH') && v >= 1 && v <= 250) shopPool.push({ card: c, set: m.set });
      }
    }
    for (const { card, set } of U.shuffle(shopPool, rng)) {
      if (out.length >= 3) break;
      if (used.has(card.id)) continue;
      used.add(card.id);
      const mult = U.round2(1.4 + rng() * 0.6);
      out.push({ id: card.id, kind: 'shop', setName: set.name, card: { id: card.id, s: card.s, n: card.n, no: card.no, r: card.r, img: card.img, big: card.big, p: card.p }, mult });
    }
    const owned = ownedCards.filter((c) => !used.has(c.id) && priceOf(c, variantFor(c, 'rare', tierOf(c))) >= 1).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const card of U.shuffle(owned, rng).slice(0, 2)) {
      used.add(card.id);
      const mult = U.round2(1.2 + rng() * 0.3);
      out.push({ id: card.id, kind: 'owned', card: { id: card.id, s: card.s, n: card.n, no: card.no, r: card.r, img: card.img, big: card.big, p: card.p }, mult });
    }
    return out;
  }

  // "Higher or lower" minigame: guess which of two real cards is worth more.
  // Small payouts that grow with a streak, capped per day.
  const GUESS_CAP = 15;
  const guessReward = (streak) => U.round2(Math.min(2, 0.25 * streak));

  // Two cards worth at least 25¢ whose prices differ by 20% or more.
  function guessPair(cards, rng = Math.random) {
    const pool = cards.filter((c) => cardValue(c) >= 0.25);
    for (let tries = 0; tries < 60 && pool.length > 1; tries++) {
      const a = pool[Math.floor(rng() * pool.length)];
      const b = pool[Math.floor(rng() * pool.length)];
      if (a.id === b.id || a.n === b.n) continue;
      const va = cardValue(a);
      const vb = cardValue(b);
      if (Math.max(va, vb) >= Math.min(va, vb) * 1.2) return [a, b];
    }
    return null;
  }

  // ---- shop --------------------------------------------------------------

  const EXCLUDE = /trainer gallery|galarian gallery|shiny vault|futsal|trainer kit|energies|classic collection/i;

  function isEligible(set, now) {
    if (EXCLUDE.test(set.name) || SUBSET_IDS.has(set.id)) return false;
    if (U.parseDate(set.date) > now) return false;
    if (isPromo(set) || /mcdonald/i.test(set.name)) return set.total >= 6;
    return set.total >= 10;
  }

  const SHOP_PLAN = [
    ['vintage', 2],
    ['classic', 3],
    ['modern', 3],
    ['current', 3],
    ['promo', 1],
    ['wild', 1],
  ];

  function rotationIndex(now) {
    return Math.floor(now / ROTATION_MS);
  }

  function rotationEndsAt(now) {
    return (rotationIndex(now) + 1) * ROTATION_MS;
  }

  // The newest full-size set is always on the shelf.
  function featuredSet(sets, now = Date.now()) {
    return sets.filter((s) => isEligible(s, now) && !isMini(s) && !isPromo(s)).sort((a, b) => U.parseDate(b.date) - U.parseDate(a.date))[0] || null;
  }

  // Same rotation index -> same packs for everyone. Only sets released before the
  // rotation began are eligible, so a new set release can't reshuffle a live rotation.
  function shopSets(sets, now = Date.now()) {
    const idx = rotationIndex(now);
    const start = idx * ROTATION_MS;
    const featured = featuredSet(sets, now);
    const rng = U.mulberry32(U.hashStr('packrush-shop-' + idx));
    const eligible = sets.filter((s) => isEligible(s, start) && (!featured || s.id !== featured.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
    const buckets = { vintage: [], classic: [], modern: [], current: [], special: [], promo: [] };
    for (const s of eligible) buckets[bucketOf(s)].push(s);

    const rotation = [];
    for (const [bucket, n] of SHOP_PLAN) {
      let pool;
      if (bucket === 'wild') pool = rng() < 0.5 && buckets.special.length ? buckets.special : eligible;
      else pool = buckets[bucket];
      const picks = U.shuffle(pool.filter((s) => !rotation.includes(s)), rng).slice(0, n);
      rotation.push(...picks);
    }
    return { featured, rotation };
  }

  // A random pack from the current rotation, priced at the rotation's average.
  function mysteryPrice(models) {
    if (!models.length) return null;
    return charm(models.reduce((s, m) => s + m.price, 0) / models.length);
  }

  PP.economy = {
    TIERS,
    TIER_LABEL,
    BUCKET_LABEL,
    ROTATION_MS,
    SUBSETS,
    BUNDLE_SIZE,
    BUNDLE_DISCOUNT,
    MARKUP,
    BASE_COST,
    tierOf,
    tierRank,
    variantFor,
    priceOf,
    cardValue,
    variantLabel,
    eraOf,
    bucketOf,
    isMini,
    isPromo,
    agePremium,
    charm,
    bundlePrice,
    packModel,
    packOdds,
    openPack,
    isEligible,
    featuredSet,
    shopSets,
    mysteryPrice,
    dayIndex,
    dailyMissions,
    DAILY_BONUS,
    setMilestones,
    collectorRequests,
    requestOffer,
    GUESS_CAP,
    guessReward,
    guessPair,
    GRADE_NAMES,
    GRADE_ODDS,
    ERA_LABEL,
    GRADING,
    gradeEra,
    gradingFee,
    rollGrade,
    gradedPrice,
    gradeOdds,
    gradedEV,
    rotationIndex,
    rotationEndsAt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
