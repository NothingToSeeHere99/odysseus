# Pack Rush

A browser game for opening real Pokémon TCG booster packs. It has a rotating shop, real market prices, hourly income and a collection binder.

## Playing

Open `index.html` in a browser. There's nothing to build or install. To serve it over HTTP instead (Node 18+):

```sh
npm start   # serves on http://localhost:8787
```

To get a single file you can download, share or keep anywhere, run `npm run build`. It writes `dist/pack-rush.html` with everything inlined; double-click it to play.

Progress is saved in the browser's local storage. To move it to another device, use **Profile → Export save**.

## How it works

- **Income:** you start with $50 and earn $10 every hour. Income keeps building while the game is closed, up to 48 hours' worth.
- **Shop:**
  - **Featured:** the newest set is always in stock.
  - **Rotating packs:** 13 packs from across the TCG's history (2 vintage, 3 classic, 3 modern, 3 current, 1 Black Star promo pack and 1 wildcard, often a small special set like Celebrations or a McDonald's collection). They restock every 12 hours at 00:00 and 12:00 UTC. The rotation is seeded from the clock, so everyone sees the same lineup.
  - **Mystery pack:** a random pack from the current rotation, priced at the rotation's average.
  - **Bundles:** any pack can be bought as a 6-pack bundle for 5% off.
  - **Odds & cards:** every pack has a details screen with its top 8 chase cards, pull rates ("1 in 27 packs") and how its price was calculated.
- **Cards:** cards, images and prices come from the free [pokemontcg.io](https://pokemontcg.io) API. Card values use TCGplayer market prices for the exact printing you pulled (normal, holo or reverse holo). If a card has no TCGplayer price, the game uses Cardmarket's trend price instead. Sub-sets that came out of the same packs (Trainer Gallery, Galarian Gallery, Shiny Vault) are mixed into their parent set's packs.
- **Opening:** swipe across the top of a pack to tear it open, then tap or fling cards off the stack. Double Rare and better cards arrive face-down with a coloured glow and flip over with particles, light rays and a fanfare. Sound effects are generated in the browser (no audio files) and can be muted from the top bar.
- **Holo cards:** cards tilt toward your cursor (or your phone's tilt) and shine according to rarity. Holo rares shimmer only in the art window and reverse holos only outside it. Double Rares have a light sweep, Illustration Rares glitter, Ultra Rares get an etched foil and Secret Rares a full rainbow.
- **Selling:** you can sell any card for its current market price from the pack results, the binder or the collection. You can also bulk-sell duplicates or every card under a price you choose.
- **Binder:** a page-by-page binder for every set you own cards from. It shows the empty slots you still need and how complete each set is.

### Earn tab

Ways to make money besides selling cards and hourly income:

- **Daily missions:** three missions a day (UTC), the same for every player. Examples: open 5 packs, pull a Double Rare or better, open a pack from before 2011, sell $15 of cards, send a card for grading. Each pays $8–$60. Claim all three for a **$25 bonus**.
- **Collector requests:** up to five collectors per shop rotation want specific cards. Three are in this rotation's packs and pay 1.4–2× market price. Two are cards you already own (worth $1 or more) and pay 1.2–1.5×. Filling a request hands over your cheapest raw copy; slabs are never taken.
- **Set rewards:** one-time payouts for collecting 25%, 50%, 75% and 100% of a set. They scale with set size: a 200-card set pays $20 / $50 / $100 / $300.
- **Higher or Lower (minigame):** two real cards; pick the one that sells for more. A right answer pays $0.25, plus $0.25 per answer in a streak, up to $2. A wrong answer resets the streak. Prizes are capped at $15 a day, and you can keep playing for fun after that.

The Earn tab shows a badge when something is ready to claim, and a toast pops up when you finish a mission.

### Grading

Open any card in your collection and press **Grade** to send one copy to Pack Rush Grading (PRG), the game's stand-in for a real grading company:

- **Fee** by the card's value, like real tiers: under $100 → $15, under $500 → $30, under $1,500 → $75, under $5,000 → $150, otherwise $300. **Standard** takes 1 hour; **Express** costs 3× and takes 5 minutes.
- **Grades 1–10.** Odds depend on the card's age, modeled on real population reports: about 30% of modern cards (2017+) get a 10, about 12% of 2003–2016 cards, and about 3% of vintage (1999–2002). The grade is decided when you send the card, so reloading can't change it.
- **Value** is the raw price × a multiplier for the grade (for example ×2.5 for a modern 10, ×12 for a vintage 10, about ×0.85 for an 8), with a small minimum because even a common in a slab has some value. Real PSA sale prices replace the estimate when available: from Scrydex, or from PokemonPriceTracker (see [Real graded prices](#real-graded-prices)). Grades with no recorded sales are scaled from the nearest grade that has them.
- When it's back, the Collection tab shows a badge; reveal the grade from the **At the grader** panel.
- Graded cards sit in slabs and are never touched by bulk selling. **Crack** a slab to get the raw card back, for example to try for a better grade.

Grading cheap cards loses money on average. Grading a valuable modern card expects a modest profit, and vintage cards are a long shot at a big payoff.

### Pack contents

| Era | Cards | Slots |
| --- | --- | --- |
| WOTC (1999–2002) | 11 | 7 common, 3 uncommon, 1 rare (about 1 in 3 are holo) |
| e-Card → Sword & Shield | 10 | 5 common, 3 uncommon, 1 reverse holo, 1 rare/holo/ultra/secret |
| Scarlet & Violet onward | 10 | 4 common, 3 uncommon, 1 reverse holo, 1 reverse-or-illustration-rare, 1 rare/double/ultra/hyper |
| Small special sets (under 30 cards) and McDonald's | 4 | 3 cards from anywhere in the set, 1 rare slot |
| Black Star promos | 3 | any 3 different promos from that era's promo set |

Promo cards all share the rarity "Promo", so the game ranks them by market value: $3+ counts as Holo Rare, $10+ Double Rare, $30+ Ultra Rare and $100+ Secret Rare. A valuable promo gets the same face-down reveal as any other big pull.

What isn't sold as a pack: trainer kits, energy sets, Pokémon Futsal and sets under 10 cards. Japanese-exclusive sets aren't in the card database.

The API has about 50 different rarity names. The game groups them into 8 tiers (Common → Secret Rare) and uses approximate real pull rates for each era. If a set doesn't have a tier, that tier's share is spread across the tiers it does have. The best card in a pack is always revealed last.

### Pack pricing ($1–$500)

```
expected value = sum over every slot of (chance of each tier × average market price of that tier)
age premium    = 1 + 0.004 × years_since_release^2.6
price          = (expected value × 1.2 + $1) × age premium   → rounded to $x.49 / $x.99, kept between $1 and $500
```

The age premium is meant to match sealed-pack prices in real life: about ×1.0 for a new set, about ×3.6 at 10 years, about ×10 at 20 years, and ×17+ for 25-year-old WOTC packs. Some examples: new Scarlet & Violet packs come out around $4–8, XY-era packs around $15–25, and Base Set era packs hit the $500 cap. Each shop tile has a **Why this price?** section that shows this calculation for that pack.

## Card data sources

Cards, images and prices come from one of three places. They all use the same card IDs, so your collection carries over between them.

| Source | Cost | Notes |
| --- | --- | --- |
| [Pokémon TCG API](https://pokemontcg.io) | Free (an optional free key from dev.pokemontcg.io raises the rate limit) | The default. **Goes offline on March 1, 2027** |
| [TCGdex](https://tcgdex.dev) | Free, no key | Open source. Prices come from a separate request per card, so a set takes a few seconds to load the first time; after that it's cached |
| [Scrydex](https://scrydex.com) | Paid, from $29/month for 5,000 credits | The official successor to the Pokémon TCG API |

**Profile → Card data → Automatic** (the default):
- **Until March 1, 2027:** the Pokémon TCG API, then TCGdex if it's down, then Scrydex if you've set it up.
- **After March 1, 2027:** Scrydex if you've set it up, otherwise TCGdex. Nothing else to do: TCGdex needs no key.
- A source that fails is moved to the back for the rest of the session, so it doesn't slow down every request.

You can also pick a single source. **Test connections** checks all three.

TCGdex uses its own set IDs (e.g. `sv03.5` for 151). The game translates them; `tests/fixtures/tcgdex-set-ids.json` pins the mapping for all 176 sets. TCG Pocket sets, which only exist in TCGdex, aren't offered.

### How card data is cached

Card details and prices are stored separately on your device (in IndexedDB, so there's room for the whole catalog):

| What | Kept for | Then |
| --- | --- | --- |
| Set list | 1 day | refreshed in the background to pick up new releases |
| Card details (names, numbers, rarities, images) | 7 days | refreshed in the background |
| Prices of rares and up | 1 day | refreshed in the background, prices only |
| Prices of commons and uncommons | 1 day (7 days on TCGdex) | on TCGdex each price is its own request, and these barely move |

The game never waits for a refresh. It shows the last known prices right away, and new prices apply the next time a pack is shown. It only waits the first time it sees a set. A price is never replaced with "no price" if a source has a gap, and a set that comes back empty (e.g. just released) is retried after an hour. **Profile → Card data** shows what's stored and has a button to clear it.

### Setting up Scrydex

1. Get an API key and team ID from your Scrydex dashboard.
2. Start the bundled server with them:

   ```sh
   SCRYDEX_API_KEY=your-key SCRYDEX_TEAM_ID=your-team npm start
   ```

3. Open http://localhost:8787. The game finds the server automatically. **Profile → Card data** should show "connected through the Pack Rush server".

The server (`server/proxy.js`, no dependencies):
- keeps the key on your computer instead of in the browser, as Scrydex recommends
- caches Scrydex and TCGdex responses on disk for 12 hours (`CACHE_HOURS` to change), so reloading or playing on another browser doesn't spend credits or repeat TCGdex's per-card price lookups
- works without Scrydex credentials too: `npm start` alone serves the game and caches TCGdex
- only listens on 127.0.0.1 unless you set `HOST`; set `PORT` to change the port

If you host the game somewhere else, enter the server's address under **Server URL**. You can also paste a key straight into the browser instead. Scrydex advises against that, and its API may refuse requests made directly from a web page.

Each Scrydex request costs 1 credit, and a set takes 1–3 requests. Card data is cached in the browser for 24 hours, so a normal day of play costs a few dozen credits.

### Running the bundled server (easy way)

1. Install [Node.js](https://nodejs.org) (LTS).
2. Double-click **`start-windows.bat`** (Windows) or **`start-mac.command`** (Mac; the first time, right-click it and choose **Open**). On Linux, run `sh start-mac.command`.
3. The first run creates **`keys.txt`** and opens it. Paste your keys after the `=` signs, save, and double-click the launcher again.
4. The game opens at http://localhost:8787. Keep the launcher window open while you play.

`keys.txt` is read every time the server starts, so you set your keys once. It stays on your computer, is never sent to the browser, and is ignored by git. Environment variables still work and override it.

### Real graded prices

[PokemonPriceTracker](https://www.pokemonpricetracker.com) has real PSA sale prices from eBay, by grade. Its free plan (100 credits a day) is enough for this game. Its API doesn't accept requests made straight from a web page, so the key goes on a small relay that adds it for you. Pick one:

**A free Cloudflare Worker** (works with the downloaded file, including on a phone):

1. Sign up at pokemonpricetracker.com and copy your API key.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com) (free account): **Workers & Pages → Create → Create Worker**. Name it (e.g. `pack-rush-prices`), press **Deploy**, then **Edit code**. Replace the code with [`worker/ppt-proxy.mjs`](worker/ppt-proxy.mjs) and press **Deploy** again.
3. In the worker's **Settings → Variables and Secrets**, add a **Secret** named `PPT_API_KEY` with your key.
4. Copy the worker's address (like `https://pack-rush-prices.you.workers.dev`) into **Profile → Card data → Graded prices → Relay URL**, press Save, then **Test connections**. It should show a PSA 10 price for a Base Set Charizard.

The worker only forwards card price lookups, keeps the key out of the browser, and caches answers for 12 hours.

**Or the bundled server:** start it with `PPT_API_KEY=your-key npm start` and open the game from it; it's found automatically.

The game only looks up cards you open the Grade screen for, cards at the grader and slabs you own. It keeps each result for a week (a day if there were no sales), so a typical day uses a handful of lookups at about 2 credits each. If the key runs out of credits, the game falls back to estimates and tries again later.

## Development

```
index.html
css/styles.css
js/util.js         helpers, seeded RNG, storage
js/api.js          card data sources (Pokémon TCG API, TCGdex, Scrydex) + cache
server/proxy.js    optional local server: serves the game, proxies and caches Scrydex and TCGdex
js/economy.js      rarity tiers, pull rates, pricing, shop rotation
js/game.js         wallet, income, collection, buy/sell
js/components.js   icons, booster pack, card back, rarity marks
js/card.js         holographic card renderer + pointer/tilt motion
js/fx.js           canvas particles (sparks, bursts, confetti)
js/sfx.js          synthesised sound effects
js/opener.js       pack opening sequence and results screen
js/ui.js           views and routing
tests/             node unit tests for the economy
```

Run the tests with `npm test`. They need Node 18 or newer and cover the economy, all three card data sources and the server.

Pokémon and all card names, images and trademarks belong to Nintendo, Creatures Inc. and GAME FREAK inc. This is a private fan project and isn't affiliated with or endorsed by them.
