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
*Clients and Servers → Start Local Server* (2–4 players) — the roster, the
ready ticks and the READY-vs-START SHIFT verb only mean anything with a second
human in the server.

### Use `rojo serve`, not rebuild-and-reopen

```sh
rojo plugin install     # once: installs the Rojo Studio plugin
rojo serve              # then: Rojo plugin -> Connect, in Studio
```

**Studio snapshots the `.rbxl` when it opens it and never re-reads it.** A
rebuild writes the file on disk and changes nothing in a session that is
already open, so the place keeps running whatever it was opened with — and the
only symptom is a change you expected not being there, which looks exactly like
a change that does not work. This cost two rounds of debugging in one day.
`check-luau`'s staleness guard cannot help: it compares the `.rbxl` against
`game-src`, and what Studio holds in memory is not something the filesystem
knows.

It is worse when the work is in a git worktree, because then the file being
rebuilt and the file being opened are genuinely different files in different
directories, and reopening does not help either.

With `rojo serve` connected, a save reaches Studio directly. No rebuild, no
reopen, no ambiguity about which file is which.

**Whatever you do, the place says which build it is.** Every run prints it,
next to the familiar startup lines:

```
[sizzle] build 0fbec49 on jhurliman/soft-launch, built 2026-08-30 01:13
[sizzle] client up
```

with `+dirty` when the tree has uncommitted changes. If that sha is not the one
you just wrote, you are not testing what you think you are testing.

### Studio does not persist anything

`game.PlaceId` is 0 for a rojo-built local file, so DataStore calls fail and no
profile is saved. The server warns about it on startup rather than leaving you
to work it out.

The visible consequence: `needsTutorial` is `rounds == 0`, so without
persistence First Shift would run on *every* playtest. `Config.STUDIO_SKIP_TUTORIAL`
defaults to skipping it in Studio; set it false when the tutorial is the thing
you are testing.

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

### Seeing it before publishing — Studio MCP

Roblox has no headless renderer, but Studio ships an **MCP server** that gives a
real one, and it is strictly better than any of it we could approximate:

| Tool | Why it matters here |
| --- | --- |
| `screen_capture` | An actual viewport screenshot — the thing "does this layout work" needs |
| `get_console_output` | Reads the client's errors. The blue-sky outage was ONE error in the client log and took an afternoon to find without this |
| `start_stop_play` | Starts a playtest without touching the mouse |
| `execute_luau` | Runs code in Edit, Client or Server context |
| `user_keyboard_input`, `character_navigation` | Drives a chef around to reach the screen you want to look at |

Turn it on once: **Studio → Assistant Settings → Manage MCP Servers → Enable
Studio as MCP server.** `.mcp.json` in the repo root already points at the macOS
binary, so any MCP client opened on this project picks it up.

**The pre-publish flow this unlocks:**

1. Open `SizzleSquad.rbxl`, `start_stop_play`
2. `get_console_output` — any red line is a bug that would have shipped
3. `screen_capture` — look at the panel rather than reasoning about UDim2 maths
4. `npm run publish`
5. `npm run smoke:live` against the published place

Steps 2 and 3 are the ones this project keeps needing: every layout bug shipped
so far (Level Rewards drawn over Friends Playing Now, the ticket rail sliding
off the right edge, a six-button row overflowing both screen edges) was visible
in a single screenshot, and the one outage was visible in a single console line.

### Staging — Roblox has no blue/green, so make one

There is no traffic-splitting deploy on Roblox. `versionType=Saved` stores a
version without serving it, but nothing can PLAY a saved version, so it is a
backup rather than a staging slot. Reverting in Studio's version history is a
rollback, not a canary.

What works is a **second place inside the same universe**, joinable by its own
id and invisible in search:

```sh
export SIZZLE_STAGING_PLACE_ID=<the staging place id>   # in ~/.zshrc
npm run publish:staging     # build + upload to staging only
npm run smoke:staging       # module load check against staging
npm run publish             # only after staging is green
```

**Creating the place, once.** Studio's publish dialog, from whatever file you
already have open:

**File → Publish to Roblox As… → click the Sizzle Squad tile → Add as a new
place → Create.**

That makes the place *and* publishes the current build into it, so staging
starts life as whatever you were just working on rather than an empty
baseplate.

> **The dangerous click is right next to the safe one.** The same dialog will
> happily publish over the EXISTING place, which is live. "Add as a new place"
> is the option; the game tile on its own is not.

**Why not the API.** The dashboard points at a "Create and Save Place API", and
it is real, but it will not do this:

- Open Cloud has no create-place operation. v2 can GET and PATCH a place by id;
  there is no POST to a places collection. `develop.roblox.com/v1/universes/
  {id}/places` lists them, which is what `npm run places` uses, and that is all.
- Creating one is `AssetService:CreatePlaceAsync`, a **Luau** call, and it is
  fenced three ways: it refuses on a file whose own `game.PlaceId` is 0 (every
  rojo build), it refuses outside a server script (the Edit-mode command bar is
  not one), and with both of those satisfied — live place open, running server,
  owner authenticated, Studio API services on — it still returns **HTTP 403**.
  The same 403 comes back through the Open Cloud Luau execution path. Two
  independent authenticated routes refusing it is a platform restriction, not a
  context mistake, so stop trying to find the right context.

`npm run places` lists the universe's places and says which is live, which is
staging, and which nothing points at — handy for reading the new id back
without going through the dashboard.

**These commands used to publish to LIVE.** `publish:staging` was
`ROBLOX_PLACE_ID=$SIZZLE_STAGING_PLACE_ID node tools/publish-place.mjs`, and
with the variable unset the shell substitutes an empty string, which is falsy
in JS, which falls straight through to the live default. The one command whose
job is to keep a build away from players shipped it to them and printed a
normal-looking version number. Both staging commands now take `--staging` and
refuse outright if the id is missing or is the live place. They never infer a
target, because the inference was live.

**Profiles are isolated automatically.** Places in the same universe share
DataStores, so a playthrough on staging would otherwise spend real coins and
write the result over a real save. `Progression` scopes its four store names by
`game.PlaceId`: live and Studio keep the names they have always had, and any
other place gets a `__p<placeId>` suffix and its own empty world. The condition
names LIVE explicitly rather than trying to detect staging — getting it the
other way round would rename live's stores and lose every profile in the game —
and `check-luau` asserts the id in `Progression.luau` still matches the one the
publisher defaults to, so the two copies cannot drift.

Badges are still shared, so a staging playthrough can grant real ones.

Given the failure this was built for was "the client could not even start",
staging plus `smoke:live` catches that class outright.

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
