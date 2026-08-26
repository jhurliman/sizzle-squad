# Sizzle Squad — Roblox port

The web game's simulation is the server: `src/domain` + `src/bots` (the
deterministic 60 Hz sim and the bot AI) compile to a single Luau module via
[TypeScriptToLua](https://typescripttolua.github.io/), so the Roblox game runs
**literally the same code** the web game ships, and the two builds are proven
tick-identical (see Parity below). On top of that shared core sits a full
co-op game: 1–4 players in one kitchen. (Bot backfill exists but is OPT-IN via Config.BOT_FILL — playtesting showed bots playing the game for you kills the fun of learning it.)

## Build & play

```sh
npm ci                                   # in this directory
rokit install                            # rojo 7.7.0 + lune 0.10.5 (or install manually)
npm run build                            # sync -> tstl -> rojo build -> SizzleSquad.rbxl
```

Open `SizzleSquad.rbxl` in Studio and press Play. Test multiplayer with
*Clients and Servers → Start Local Server* (2–4 players).

## What's implemented

**Round loop** — countdown → 180s round → results ceremony (stars, positive-
only superlative cards) → intermission-in-the-kitchen (ready-up, shop, ranks,
invites, emotes; chefs still walk around) → next round.

**Multiplayer** — 4-player servers; joiners drop straight in mid-round (held item and all); leavers/AFK players (20s) hand back to the bot, any
input resumes instantly. Own-chef movement runs the real `movePhase` locally
(zero latency); the server validates displacement + walkability and owns
collisions, interactions, stations, orders, and scoring. Transforms stream as
packed buffers (20 Hz down / 30 Hz up); everything else diffs on change.

**Difficulty** — human-count pacing table + an invisible pressure director
(±20% order-gap rubber band) + auto assist mode for new crews (gentler
timers, recipe depth cap), all through `DirectorKnobs` the sim exposes with
shipped-behavior defaults. Bot-plated dishes pay 60% (leaderboard integrity).

**Meta** — DataStore profiles; XP/levels with milestone cosmetic grants;
career coins; daily challenges + streaks (weekly grace token); ~30-item
cosmetics catalog (hats, species palettes, emotes, kitchen items) with shop
buy/equip; OrderedDataStore weekly/all-time/career boards; badge sweep;
First Shift contextual onboarding; emote pings + speech bubbles; 3-star
photo moment.

**Characters** — the four procedural species captured from `ChefView` in bind
pose with skeleton-group attribution (`../roblox/capture-chefs.mjs`) into
part-rigs (`assets/chef-rigs.rbxm`, ~70 parts each), animated procedurally
client-side (walk/hop/squash/stun/carry). See `../roblox/chefs-preview.png`.

## Verification (all headless, no Studio needed)

| Command | What it proves |
|---|---|
| `npm run parity` | TS and Luau builds tick-identical (3 seeds × 10,800 ticks: discrete state exact, floats ≤ 8e-11) |
| `lune run tools/server-harness.luau` | Full server stack end-to-end: round loop, drop-in/AFK, pacing, progression, shop, replication (22 checks) |
| `lune run tools/client-harness.luau` | Mirror movement + working-freeze, interpolation, verb prompt, delta mirroring |
| `lune run tools/check-luau.luau` | Syntax gate over all Luau sources |
| `lune run tools/smoke.luau` | A full bot round in Luau (~6,200 ticks/s) |
| `node tools/smoke-ts.mjs` | The same round under Node — outputs match |

Root-level `npm run check` + `node tools/planprobe.mjs` + `node tools/soak.mjs`
still guard the shared sim (including bit-exact determinism).

## Toolchain notes

- **Why TSTL, not roblox-ts**: roblox-ts replaces the JS stdlib (`.length` →
  `.size()`, boolean sort comparators, no `Math`) and its `Map` drops
  insertion order — which bot-planner determinism depends on. TSTL implements
  real JS semantics on stock Lua. Its 5.1 target is Luau-compatible except
  bitwise operators; `tstl-bit32.cjs` (~50 lines) closes that by emitting
  `bit32.*` calls (see the plugin header for the integer-operand contract).
- `sync-shared.mjs` mirrors `../src/domain` + `../src/bots` into `src/shared/`
  (CI guard: `npm run sync:check`).

## What's NOT done

**[KNOWN-GAPS.md](KNOWN-GAPS.md) is the canonical ledger** of every stub,
placeholder, and simplification — checked before trusting any feature as
"done". Highlights: cosmetics don't render yet, chef limbs don't articulate,
dailies have no UI, food is spheres, everything is silent.

## Remaining (user-gated) launch steps

1. **Publish** the place to a universe (Studio → File → Publish), enable
   **free private servers**, and enable Studio API access for DataStores.
   `MaxPlayers = 4`, `PreferredPlayers = 4` and
   `TextChatService.ChatVersion = TextChatService` are place PROPERTIES and are
   set in `default.project.json`, so they ship with every build — do not set
   them by hand in Studio, a rebuild would revert that.
2. ~~**Audio**~~ — DONE: 50 SFX (3 variants/event) and 4 adaptive music stems
   are rendered, uploaded and wired; ids recorded in
   `roblox/audio-out/asset-ids.csv`. Only `washDone` lacks a dedicated upload
   (falls back to the chop chime).
3. ~~**Badges**~~ — DONE: all 8 created on experience `10761465304` and wired
   into `Badges.IDS`. Record of ids, names, descriptions and icons is in
   `roblox-game/store/badges.md`. **One thing still open: set
   `Config.FOUNDING_CHEF_UNTIL` to your real launch-window end date** (it is a
   placeholder). Original instructions kept below for any future badge.

   Create each at **Creator Dashboard → your experience → Engagement → Badges
   → Create Badge**. Roblox charges **100 Robux per badge** (800 total), and
   the icon is a square PNG (512x512 is the safe size, same as a game pass).
   After creating one, open it and take the number out of the URL
   (`.../badges/<ID>/configure`) — that is the id.

   Icons are pre-rendered in `roblox/badge-art/` (512x512, regenerate with
   `node roblox/badge-art.mjs`). **Names, descriptions and the icon for each
   key are in `roblox-game/store/badges.md`** — copy-paste ready.

   Then paste each id into `game-src/server/Badges.luau` -> `Badges.IDS`.
   A key left at `0` is silently skipped, so you can create them one at a time.

   | `Badges.IDS` key | Suggested name | Description | Awarded when |
   |---|---|---|---|
   | `firstDish` | First Dish | Serve your very first dish. | any shift where you serve >= 1 dish |
   | `perfectRound` | Clean Service | Finish a shift without missing a single ticket. | `missed == 0` and `served > 0` |
   | `firstThreeStar` | Three Stars | Finish a shift with all three stars. | `stars >= 3` |
   | `fullHumanCrewThreeStar` | Full House | Earn three stars with a full crew of four chefs. | `stars >= 3` and 4 humans seated |
   | `levelTen` | Head Chef | Reach level 10. | `profile.level >= 10` |
   | `hundredDishes` | Century | Serve 100 dishes. | `totalDishes >= 100` |
   | `thousandDishes` | Thousand Plates | Serve 1,000 dishes. | `totalDishes >= 1000` |
   | `foundingChef` | Founding Chef | Play during the launch window. | end of any shift, **while `Config.FOUNDING_CHEF_UNTIL` has not passed** |

   Two things worth knowing before you spend the Robux:

   - **Set `Config.FOUNDING_CHEF_UNTIL`** (UTC `YYYY-MM-DD`) to the last day of
     your launch window. Past that date nobody can earn it again, which is the
     only thing that makes it worth having. Empty string disables it.
   - Award conditions are re-checked at the end of EVERY shift. Roblox treats
     re-awarding an owned badge as a no-op, and the server also de-dupes per
     session, so nothing is double-granted and no call is wasted.

   Badges are awarded on the SERVER at round end and need API access enabled on
   the published place -- the same switch DataStores need.
3b. **Game passes** (monetization is wired but inert until these exist).
   On the Creator Dashboard → your experience → Monetization → Passes, create:

   | Pass | Suggested price | Grants |
   |---|---|---|
   | Supporter Pass | 199 R$ | Top Hat + Sous-Chef Halo, +10% XP and coins, 4 Gilded coats, Sizzle! emote, Supporter Plates, star nametag |
   | Chef's Trunk | 149 R$ | Beret + Mushroom Cap, 4 Midnight coats, Boom! emote, Obsidian Pans |

   Four of the twelve hats (a third) are pass-only; the other eight stay on the
   coin ladder so there is still something to grind toward. Level milestones
   only ever grant coin-track items -- handing out pass content free would
   undercut the thing people paid for.

   **DONE** — Supporter Pass `1959138315`, Chef's Trunk `1958262313`, both
   wired in `game-src/shared/Monetization.luau`. Icons for each are in
   `roblox/pass-art/` (512x512, regenerate with `node roblox/pass-art.mjs`).
   For future passes: put the id into `PRODUCTS[n].gamePassId`. A pass whose id is still `0` is hidden from the
   shop and can never be granted, so shipping without them is safe. Ownership
   is checked on join and again on `PromptGamePassPurchaseFinished`, so a
   purchase applies without a rejoin.

   Every pass item already renders today — the four pass hats are existing,
   FitLab-tuned assets moved off the coin ladder, not new art. Nothing here
   needs an upload or a new `Hats.build` case.
4. **Icon spritesheet**: render `src/ui/icons.ts` to a PNG, upload, swap the
   ticket chips from colored circles to ImageLabels.
5. **Playtests** (plan P6–P8): friends & family via private links, then soft
   launch against the metric gates (D1 ≥ 25%, session ≥ 12 min, rounds ≥ 3).
