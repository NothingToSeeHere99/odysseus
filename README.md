# Pack Rush

A browser game for opening real Pokémon TCG booster packs. It has a rotating shop, real market prices, hourly income and a collection binder.

## Playing

Open `index.html` in a browser. There's nothing to build or install. To serve it over HTTP instead:

```sh
npm start   # serves on http://localhost:8080
```

Progress is saved in the browser's local storage. To move it to another device, use **Profile → Export save**.

## How it works

- **Income:** you start with $50 and earn $10 every hour. Income keeps building while the game is closed, up to 48 hours' worth.
- **Shop:**
  - **Featured:** the newest set is always in stock.
  - **Rotating packs:** 12 packs from across the TCG's history (2 vintage, 3 classic, 3 modern, 3 current and 1 wildcard, often a small special set like Celebrations or a McDonald's collection). They restock every 12 hours at 00:00 and 12:00 UTC. The rotation is seeded from the clock, so everyone sees the same lineup.
  - **Mystery pack:** a random pack from the current rotation, priced at the rotation's average.
  - **Bundles:** any pack can be bought as a 6-pack bundle for 5% off.
  - **Odds & cards:** every pack has a details screen with its top 8 chase cards, pull rates ("1 in 27 packs") and how its price was calculated.
- **Cards:** cards, images and prices come from the free [pokemontcg.io](https://pokemontcg.io) API. Card values use TCGplayer market prices for the exact printing you pulled (normal, holo or reverse holo). If a card has no TCGplayer price, the game uses Cardmarket's trend price instead. Sub-sets that came out of the same packs (Trainer Gallery, Galarian Gallery, Shiny Vault) are mixed into their parent set's packs.
- **Opening:** swipe across the top of a pack to tear it open, then tap or fling cards off the stack. Double Rare and better cards arrive face-down with a coloured glow and flip over with particles, light rays and a fanfare. Sound effects are generated in the browser (no audio files) and can be muted from the top bar.
- **Holo cards:** cards tilt toward your cursor (or your phone's tilt) and shine according to rarity. Holo rares shimmer only in the art window and reverse holos only outside it. Double Rares have a light sweep, Illustration Rares glitter, Ultra Rares get an etched foil and Secret Rares a full rainbow.
- **Selling:** you can sell any card for its current market price from the pack results, the binder or the collection. You can also bulk-sell duplicates or every card under a price you choose.
- **Binder:** a page-by-page binder for every set you own cards from. It shows the empty slots you still need and how complete each set is.

### Pack contents

| Era | Cards | Slots |
| --- | --- | --- |
| WOTC (1999–2002) | 11 | 7 common, 3 uncommon, 1 rare (about 1 in 3 are holo) |
| e-Card → Sword & Shield | 10 | 5 common, 3 uncommon, 1 reverse holo, 1 rare/holo/ultra/secret |
| Scarlet & Violet onward | 10 | 4 common, 3 uncommon, 1 reverse holo, 1 reverse-or-illustration-rare, 1 rare/double/ultra/hyper |
| Small special sets (under 30 cards) and McDonald's | 4 | 3 cards from anywhere in the set, 1 rare slot |

The API has about 50 different rarity names. The game groups them into 8 tiers (Common → Secret Rare) and uses approximate real pull rates for each era. If a set doesn't have a tier, that tier's share is spread across the tiers it does have. The best card in a pack is always revealed last.

### Pack pricing ($1–$500)

```
expected value = sum over every slot of (chance of each tier × average market price of that tier)
age premium    = 1 + 0.004 × years_since_release^2.6
price          = (expected value × 1.2 + $1) × age premium   → rounded to $x.49 / $x.99, kept between $1 and $500
```

The age premium is meant to match sealed-pack prices in real life: about ×1.0 for a new set, about ×3.6 at 10 years, about ×10 at 20 years, and ×17+ for 25-year-old WOTC packs. Some examples: new Scarlet & Violet packs come out around $4–8, XY-era packs around $15–25, and Base Set era packs hit the $500 cap. Each shop tile has a **Why this price?** section that shows this calculation for that pack.

## API key

You don't need a key, but anonymous requests have a lower rate limit. You can get a free key at <https://dev.pokemontcg.io> and paste it in **Profile → Card data**. Card data is cached in the browser for 24 hours.

## Development

```
index.html
css/styles.css
js/util.js         helpers, seeded RNG, storage
js/api.js          pokemontcg.io client + cache
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

Run the tests with `npm test`. They need Node 18 or newer.

Pokémon and all card names, images and trademarks belong to Nintendo, Creatures Inc. and GAME FREAK inc. This is a private fan project and isn't affiliated with or endorsed by them.
