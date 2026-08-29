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
client-side (walk/hop/squash/stun/carry). See `../docs/art/chefs-preview.png`.

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

**[KNOWN-GAPS.md](KNOWN-GAPS.md) lists what is still open** — checked before
trusting any feature as "done", and pruned as things land rather than kept as a
changelog. The largest unknown is four-human pacing, which no harness here can
measure — bots leave the kitchen uncontended, and humans do not have the bot
brain's failure mode.

## Publishing

```sh
npm run publish        # build, then upload the place through Open Cloud
```

**Not through Studio.** Studio's uploader failed repeatedly with *"Server is
busy and unable to process your request right now. Retrying…"* and left the live
experience running an empty place — joining gave a blue sky, no kitchen and
Roblox's default controls. Nothing was wrong with the build; it had simply never
arrived, and the retry dialog gave no way to tell the difference.

Open Cloud returns the same 409 when Roblox is busy, which is how we know it is
their side and not Studio's, but it says so in one line and `publish-place.mjs`
backs off and retries — the failure above cleared on the fifth attempt after
about 75 seconds. It also prints the version number it published, so "did it
land" is answerable.

`npm run publish` builds first, so the freshness guard and the place upload
cannot disagree. `--saved` uploads a version without making it live.

**Publishing is live and outward-facing, so it happens on explicit approval —
never as a side effect of a build.**

## Remaining (user-gated) launch steps

Things only the account owner can do. Same rule as KNOWN-GAPS: **done items are
deleted, not ticked** — this section had grown into a record of finished work
with the how-to for badges nobody needs to create again. The *when* is
[LAUNCH.md](LAUNCH.md); the *what* is here.

Publish, audio, badges, game passes, the device pass and the localization import
are all done and verified live, including a real Robux purchase.

If a string ever changes, re-import: `node tools/build-loc.mjs`, then upload
`loc/chunks/*.csv` in order — the importer 504s on a whole table, which is why
they are ~50 rows each. Reference material survives them: badge names,
descriptions and ids are in `store/badges.md`, audio ids in
`../roblox/audio-out/asset-ids.csv`, pass ids in `shared/Monetization.luau`.

1. **Thumbnails — 6 to 8, not 10.** One is uploaded. Three 1920x1080
   detail-page variants are rendered in `../roblox/game-banner/` and need one
   picking. Priority order for the rest is in `STORE-LISTING.md`. Filling all
   ten correlates *negatively* with CCU in the sampled top-19.
2. **Gameplay video** (~30s, no voice-over, no overlay text that reads as an
   ad). Only 3 of 19 top experiences have one and all three sit in slot one,
   because Roblox auto-promotes an approved video ahead of the stills. It is
   the cheapest differentiator left on the store page.
3. **Confirm "Publishing tier at risk" has cleared** after the refundable fee
   and a publish. That reading was inference, not documentation — if it
   persists it needs re-investigating before anything else ships.
4. **Playtests** (plan P6-P8): friends and family via private links, then soft
   launch against the metric gates — D1 >= 25%, session >= 12 min, rounds/session
   >= 3, first-round completion >= 90%, like ratio >= 90%.
