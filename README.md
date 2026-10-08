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
- **Shop:** 8 packs from across the whole history of the TCG: 1 vintage (1999–2002), 2 classic (2003–2010), 2 modern (2011–2019), 2 current (2020+) and 1 wildcard, which is sometimes a McDonald's promo pack. The lineup restocks every 12 hours at 00:00 and 12:00 UTC. It's seeded from the clock, so everyone sees the same packs.
- **Cards:** cards, images and prices come from the free [pokemontcg.io](https://pokemontcg.io) API. Card values use TCGplayer market prices for the exact printing you pulled (normal, holo or reverse holo). If a card has no TCGplayer price, the game uses Cardmarket's trend price instead.
- **Selling:** you can sell any card for its current market price from the pack summary, the binder or the collection. You can also bulk-sell duplicates or every card under a price you choose.
- **Binder:** a page-by-page view of every set you own cards from. It shows the empty slots you still need and how complete each set is.

### Pack contents

| Era | Cards | Slots |
| --- | --- | --- |
| WOTC (1999–2002) | 11 | 7 common, 3 uncommon, 1 rare (about 1 in 3 are holo) |
| e-Card → Sword & Shield | 10 | 5 common, 3 uncommon, 1 reverse holo, 1 rare/holo/ultra/secret |
| Scarlet & Violet onward | 10 | 4 common, 3 uncommon, 1 reverse holo, 1 reverse-or-illustration-rare, 1 rare/double/ultra/hyper |
| McDonald's | 4 | any card in the set |

The API has about 50 different rarity names. The game groups them into 8 tiers (Common → Secret Rare) and uses approximate real pull rates for each era. If a set doesn't have a tier, that tier's share is spread across the tiers it does have. The best card in a pack is always revealed last.

### Pack pricing ($1–$500)

```
expected value = sum over every slot of (chance of each tier × average market price of that tier)
age premium    = 1 + 0.004 × years_since_release^2.6
price          = (expected value × 1.2 + $1) × age premium   → rounded to $x.49 / $x.99, kept between $1 and $500
```

The age premium is meant to match sealed-pack prices in real life: about ×1.0 for a new set, about ×3.6 at 10 years, about ×10 at 20 years, and ×17+ for 25-year-old WOTC packs. Some examples: new Scarlet & Violet packs come out around $4–6, XY-era packs around $15–25, and Base Set era packs hit the $500 cap. Each shop tile has a **Why this price?** section that shows this calculation for that pack.

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
js/components.js   pack / card visuals
js/opener.js       pack opening animation and summary
js/ui.js           views and routing
tests/             node unit tests for the economy
```

Run the tests with `npm test`. They need Node 18 or newer.

Pokémon and all card names, images and trademarks belong to Nintendo, Creatures Inc. and GAME FREAK inc. This is a private fan project and isn't affiliated with or endorsed by them.
