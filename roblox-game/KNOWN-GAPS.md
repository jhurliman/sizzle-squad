# Known gaps, stubs, and simplifications

The canonical ledger of everything that is placeholder, simplified relative to
the port plan, or not yet built. If it's not shippable-quality, it should be
on this list; if you find something missing from it, that's a bug in the list.
(User-gated items that need the account owner are in README.md → "Remaining
launch steps"; they're cross-referenced here but not duplicated.)

Legend: 🔴 blocks a good first impression · 🟡 noticeable, playable around ·
🟢 fit and finish / debt.

## A. Built but invisible — systems that persist state with no presentation

- 🟢 **All four cosmetic tracks now render.** Hats + palettes as before (12
  hats x 4 species hand-tuned in hat-fits.json via FitLab; verify new hats in
  hats-on-<species>.png; palette retint uses dominant-color matching). Emotes
  drive the ping bar. Kitchen cosmetics: plates/pans tint via ItemViz with a
  server-side election (one item per slot across the crew, lowest UserId wins
  ties), serve bells retune the serve chime locally. **Untested with two real
  clients** — the election needs a Studio local-server check.
- 🟢 **Ticket icons render via runtime EditableImage** (no upload needed) with a colored-chip fallback if the API is unavailable on some platform — verify on device.
- 🟢 **Dailies live in the Career tab** ("Today's Goals" + completion toasts);
  rewards still auto-claim rather than a claim ceremony.
- 🟢 **Species picking moved into the Wardrobe**, alongside hats and palettes
  against a live 3D preview — duplicates allowed by design; nametags
  differentiate.
- 🟡 **Monetization is live but no purchase has ever been made.** Both passes
  exist and their ids are wired (Supporter 1959138315, Chef's Trunk
  1958262313); ownership is checked on join and on
  PromptGamePassPurchaseFinished, granting the catalog items tagged
  `exclusive`. **The buy flow, the grant-on-purchase path and the +10%
  multipliers have never run against a real Robux transaction.** Icons are in
  roblox/pass-art/.

## B. Placeholder presentation

- 🟢 **Limb articulation is procedural, and now articulated below the group**
  (gait swings around captured joints, carry/chop poses, torso lean, tail/ear
  secondary motion, stun flail via BulkMoveTo). The four gaps that stood here
  are ported: a hip/knee/ankle chain that keeps the planted foot on the floor,
  blink + jaw-on-effort, bank-into-turn, and a per-species GAIT table
  (cadence, stride, airtime, static knee/ankle rest, bank). All of it is
  derived from the rig geometry at `:ensure` time rather than hardcoded per
  species, so a re-captured rig keeps working. **Verified headlessly, not yet
  in Studio**: `lune run roblox/pose-dump.luau` runs the shipping animator
  against chef-rigs.rbxm and `node roblox/anim-sheet.mjs` renders
  anim-walk-&lt;species&gt;.png (one stride in eight frames), plus
  anim-idle/-face/-bank.png. Still not ported from the web rig: the stride
  warp (legs cross fast and hold near full separation), gaze, idle fidget
  beats, and the mouth CAVITY behind the lip line — the jaw hinges, but there
  is no dark interior to open onto.
- 🟢 **Food art is the web game's captured meshes** (tomatoes with stalks,
  leafy lettuce, bacon rashers, lathed plates/pans) with a primitive-sphere
  fallback; plate/pan content stacking offsets are hand-tuned, not captured —
  verify the composed look in Studio.
- 🟢 **SFX wired**: 50 uploaded sounds (3 variants/event, rotated at random;
  serve combo-tiered) live in Sfx.luau; asset ids recorded in
  roblox/audio-out/asset-ids.csv. Only washDone lacks a dedicated upload
  (falls back to the chopDone chime).
- 🟢 **Adaptive music live**: four uploaded stems (base/groove/melody/
  tension, 7.5s @ 128bpm) cross-faded by heat + tension in Music.luau, with
  sidechain ducking and 1Hz phase-lock. Ids in roblox/audio-out/asset-ids.csv.
  Mix levels (MASTER, fade curves) are first-pass — tune by ear.
- 🟢 **VFX pass done** (Vfx.luau): the web game's full effect map ported —
  chop confetti/sparks, cook bursts, burn smoke, fire puffs, serve confetti
  (3 hues), grab-miss/place puffs, wash sparkles, bump/wall sparks — pooled
  ParticleEmitters driven by SimEvents, plus screenshake (serve/bump/fire/
  order-expiry) in CameraRig and floating +value/combo/Burnt! labels.
  Particle textures use built-in rbxasset (no uploads). Remaining: no
  HAPTICS (Roblox has no reliable phone-vibration API; gamepad-only via
  HapticService is possible later), and particle art is built-in textures
  rather than custom sprites.
- 🟢 **Photo moment is just a camera push-in** — no team pose at the pass, no
  confetti, no framed score layout.
- 🟢 **Emote row, not wheel**: four built-in pings plus every owned emote
  cosmetic. Still a row rather than the planned radial wheel. Emotes now
  travel as IDS (server allowlists pings + owned cosmetics) instead of
  arbitrary client text — that old path was an unmoderated free-text channel.

## C. Systems simplified relative to the plan

- 🟢 **First Shift POINTS AT THE STATION.** Each tip resolves to a specific
  station id that gets its own pulsing glow (distinct from the focus
  highlight), derived from the live ticket: a component wanting `prepped`
  routes to a board, `cooked` to a stove, `raw` straight to a plate — so it
  keeps working if an ingredient is added. Brand-new chefs also start wearing
  the Paper Hat they already own.
  **The first three tickets are now scripted** — salad (chop → plate → serve),
  then Bacon Roll (the pan), then Chopped Salad — via
  `DirectorKnobs.scriptedRecipes`, passed at sim CONSTRUCTION because createSim
  seeds two tickets immediately. This bypasses the heat-0 recipe unlock on
  purpose: only the first two recipes are unlocked at heat 0, so the pan (the
  least discoverable station) could otherwise never appear in a first shift.
  Holding a dirty plate now points at the sink, which was the other step
  nobody discovers alone.
  Not done: the demonstrating sous-chef (moot with bots off). Still auto-starts
  a first-ever player's round from `Menu:maybeAutoStart` rather than owning
  that trigger itself.
- 🟢 **Late-join hold live**: joiners with <15s left spectate with a notice
  and seat at the next phase change.
- 🟢 **Solo pacing is human-validated** in live Roblox. Duo/trio/quad pacing
  is still bot-proxy only; expect to retune `Config.PACING[2..4]` and
  `PRESSURE_BAND_MUL` after a real multi-human session.
- 🟢 **Superlatives**: "Firefighter" DROPPED by design decision (the
  fire-scrape mechanic stays simple); set is serves/chops/cooks/washes/trashes.
- 🟢 **AFK stage 2 missing**: 20s → bot/park coverage works, but "two idle
  rounds → non-ready spectator" isn't implemented (Roblox's 20-min kick is
  the only backstop).
- 🟢 **Start Shift is the only way into a round.** countdown and intermission
  are open-ended lobbies; the centred ShiftPanel shows a Start button, the four
  menu buttons and your career line, and reports "WAITING FOR CREW n/total"
  from the server's readyIds (the old button latched to "WAITING…" forever).
  AFK seats cannot block or trigger a start, and un-ready works. No per-player
  ready pips yet. The intermission-pause machinery (MenuGate/MenuState) was
  **removed** rather than kept: with no auto-start there is no clock to pause.
- 🟢 **Results ceremony is staged** (client/Results.luau): score lands, stars
  punch in one at a time with a chime, coins and XP count up to the real
  per-player award (recorded by awardRound, not re-derived on the client), then
  superlative cards deal out. No photo-moment staging yet.
- 🟢 **Leaderboards are a Ranks tab with resolved display names** (batched
  UserService lookup, cached, one call per 90s poll) and the local player's
  row pinned — they used to print raw `u123456` keys. Still not the physical
  in-world board; each server reads OrderedDataStores directly (fine at launch
  scale; the MemoryStore/MessagingService cache from plan §2.4 is unbuilt).
- 🟢 **Assist mode is unlabeled anywhere** (plan wanted "Heat 1: Breakfast
  Shift" style naming of the visible ramp).

## C2. Front-end (new — see plan Part 4)

- 🟢 **The wardrobe's 3D preview is confirmed working in live Roblox**
  (single-player). It drives ChefVisuals inside a ViewportFrame via an injected
  `commit` (BulkMoveTo silently no-ops outside Workspace) and
  `pose.speedOverride` (gait is derived from rendered displacement, which is
  zero for a stationary rig). Still unverified: frame rate on a low-end
  Android, and the touch drag-to-spin path.
- 🟢 **Menu is an overlay; walk-up stations are a later pass** (shop board,
  wardrobe mirror, leaderboard wall in the kitchen opening the same panels).
- 🟢 **Kitchen Card auto-dismisses after 12s**; it has no entrance animation
  and no "don't show again".
- 🟢 **All 8 badges are live and wired**, covered by tools/badges-harness.luau
  (31 checks: ids present and unique, every award condition, session de-dup and
  the Founding Chef window). Conditions are de-duped per session, and
  "Founding Chef" is now gated behind `Config.FOUNDING_CHEF_UNTIL` — without
  that it was granted to everyone at the end of every shift forever, which
  made it a participation trophy — `Config.FOUNDING_CHEF_UNTIL` is still a
  placeholder date and needs setting to the real launch window. Award state is
  not persisted in the profile, so there is still no IN-GAME badge surface;
  Roblox's own profile page is the only place they show, and the Career tab
  shows the milestone track instead. **No badge has been observed granting
  against the live service yet.**
- 🟢 **Wardrobe has no search/sort**; at 42 items the flat rails still read,
  but they will not survive a content cadence.

## C2a. Washing up (now real)

- 🟢 **Plates are finite and washing up works.** Nothing used to set
  `plate.dirty` and the racks were bottomless, so the sink, its verb, its 2.2s
  timer, the washDone event, the dirty-plate mesh and the bot brain's wash rule
  were all unreachable — reported from play as "I had no clue there were dirty
  plates and washing in this game."
  Serving now sends the plate to a wash-up **count** (never objects on benches:
  every surface here is load-bearing, and dirty crockery parked on one breaks
  whatever that surface was for — measured, throughput FELL as stock rose). An
  empty rack hands out a DIRTY plate rather than nothing, which is what stops
  it deadlocking a chef already holding food. Setting a dirty plate in a sink
  starts the wash without a second press.
  A new **scullery sink at cell (12,1)** gives the pile a home — the empty
  counter past the right serve window. It replaces a counter rather than adding
  a cell, so **not one walkable cell changed**, which is what the "+11 cells"
  experiments in kitchen.ts warn about; the kitchen goes 5 counters to 4, and
  the same notes say fewer counters is the safer direction (working plates
  converge instead of scattering).
  It was first tried at (4,1), the plaster beside the oven arch, which is
  **dead centre of a buildBackWall timber post** — the post came down through
  the basin, and stepping the basin forward to dodge it only left it hanging
  off the counter front. Posts sit at x1, ovenSpan.x0-0.5, ovenSpan.x1+0.5 and
  W-1: check any future back-wall station against those four.
  Costs ~15% of round throughput (a wash is a walk plus 2.2s standing still),
  so `Config.STARS` was re-cut from the new distribution (median 166 → 130).
  **Never validated with a human** — bot-measured only.
- 🟢 Dirty plates now read as dirty: the captured mesh was only ~9% darker than
  a clean one, which at plate scale is invisible.

## C2b. Economy (rebalanced from measured data — tools/economy-probe.luau)

- 🟡 **4-player throughput is capped by the BOT BRAIN, not the kitchen.**
  Measured with tools/station-probe.luau: with four chefs on the line, boards
  sit at **3%** utilisation and stoves at **3%** — nothing in the kitchen is
  contended, so adding a bench or more stations would change nothing. Hard-
  coding a faster order rate for big crews does not help either: at four chefs
  it bought +0.3 dishes for +5.8 missed tickets and a wipe.
  The ~10 dish/round ceiling tracks a known brain limitation recorded in
  `src/domain/kitchen.ts` — it parks a working plate on the nearest free
  counter then goes looking for it, and counter occupancy climbs 19% → 32% as
  chefs are added. **Four humans do not have that failure mode, so their real
  ceiling is unknown and cannot be measured with this harness.** The base
  pacing table therefore stays bot-safe and `PRESSURE_BAND_MUL` was widened
  0.2 → 0.5 so the invisible director can find the right level from live play:
  a crew clearing tickets fast gets up to 50% quicker orders. **Needs a real
  4-human playtest** — that is the only instrument that can answer it.
- 🟢 Payout no longer divides the team pot per head (it paid 172 solo vs 27
  each at four players — an anti-social incentive in a co-op game). Everyone
  banks the full team value plus a per-crewmate bonus, so a full kitchen pays
  ~+32% per player.
- 🟢 Star thresholds re-set from the measured distribution; 150/320/500 made
  3 stars unreachable, which quietly killed the photo moment, the star coin
  bonus and two badges.
- 🟢 Station item heights are GENERATED from the capture
  (tools/gen-surfaces.luau → client/SurfaceH.luau), not a per-kind table. The
  old table read `counter` as one height when the floor benches top out at
  ~0.37 cells and the back-wall run at ~0.86, so a plate put down on a floor
  bench floated ~1.2 studs and looked sunk into the plate stack beside it
  (reported as "a cooking pot" — there is no pot; it is Plates_11_4).
  Regenerate after any change to the kitchen capture.
- 🟢 Prices set against ~140 coins/round (was ~177 before washing up took its
  cut); first buy lands at ~1.8 rounds. Re-run the probe after touching
  PACING, STARS, MOVE_SPEED_MUL, plateStock or any price: first buy at ~1.4 rounds, the
  25-item coin catalog ~8.2 hours solo, with 16 more items behind the two
  passes. Re-run the probe after touching PACING, STARS, MOVE_SPEED_MUL or any
  price -- the 8% speed reduction alone moved the whole curve ~6% and pushed
  3 stars back out of reach until the thresholds were re-cut.

## C2c. Equip slots

- 🟢 Kitchen cosmetics were keyed by KIND, so plates, pans and the bell shared
  one slot and buying a pan silently took your plates off. They are keyed by
  slot now (`kitchen_plate` / `kitchen_pan` / `kitchen_bell`), equipSet takes
  slot keys where `false` clears and an absent key is left alone, and 11
  harness checks cover it.
- 🟢 Wardrobe has no Apply step: tapping something you own wears it. Unowned
  items preview and offer BUY; buying wears them automatically.

## C3. Fixed in the front-end pass (kept here as regression bait)

- Between-rounds walking rubber-banded because human move validation timed
  packets against `sim.time`, which is **frozen** while `tickMovementOnly`
  runs — the distance budget collapsed to one tick. SimService now keeps a
  monotonic `self.clock` advanced by both tick paths. If chefs ever start
  snapping between rounds again, look here first.
- The round timer chip and the order queue used to survive into results and
  the lobby; both are now gated to `phase == "round"`.
- 🪙 (Unicode 13) and ✕ (U+2715) have no glyph in Roblox's font stack and
  rendered as hollow boxes. Coin amounts are spelled out or use the `c` suffix
  and the close icon is a plain "X". Every other glyph in the UI predates 2016.
- Palette retint picked the single most common EXACT colour, which on a shaded
  rig is not the coat: pip's green is authored as two tones that each lose to
  his cream belly, so "Axolotl Pip" turned his belly pink and left him green.
  Coat detection now clusters by hue weighted by part volume and remaps
  hue/saturation while preserving each part's relative shade (pip 13% -> 64% of
  visual mass retinted, bramble 92%).
- Hud:clearOrders called :Destroy() on the ticket TABLE ({card, fill}), which
  threw out of updatePhase before the results overlay was built — that is what
  left you stuck in the kitchen at round end.
- The touch jump button could not be reliably hidden: PlayerModule re-creates
  and re-shows it on respawn, on device change, and on every
  ControlModule:Enable() — which the menu fires on every close, so every hide
  was a race against code that legitimately owns that button. Resolved by
  owning the input instead: on touch-only devices ControlModule:Disable()
  removes the entire Roblox touch UI (jump button included, supported and
  total) and client/Thumbstick.luau supplies the movement stick. Keyboard and
  gamepad devices keep PlayerModule untouched. **Unverified on a real device.**
- The menu ScreenGui ignores the GUI inset (so the shift panel and emote row
  can use the whole screen), which meant the tabbed panel sat UNDER Roblox's
  own top bar. The panel is now top-anchored below GuiService:GetGuiInset().
- Roblox has no letter-spacing property and FredokaOne sets very tight at
  display sizes, so the START SHIFT headline is spaced by hand.

## D. Robustness / tech debt

- 🟢 **Corrections glide** (snap absorbed into a decaying visual offset).
- 🟢 No packet-loss extrapolation beyond hold-last-sample for remote chefs.
- 🟢 **DataStore hardened**: exponential backoff (4 attempts, 0.6s doubling),
  session locking via an in-profile claim refreshed by the autosave and
  released on leave (a locked-out server goes session-only and never writes),
  and BindToClose flushes every profile on shutdown. Covered by
  tools/datastore-harness.luau against a store that throttles on demand.
- 🟢 Rate limiting: Emote is allowlisted by id, but ReadyUp is unlimited
  (spam possible; it re-broadcasts phase on every call). GrabEdge is capped at
  3 queued.
- 🟢 **Analytics wired** (server/Analytics.luau, Roblox AnalyticsService so it
  lands on the Creator Dashboard with no external service): onboarding funnel
  for first-session players, a per-shift funnel, economy source/sink on round
  rewards and shop purchases, level-up progression events, and a session
  summary (minutes, rounds, left-before-first-shift). Every call is pcall'd and
  degrades to a no-op — an analytics call is never worth taking a round down
  for.
  Drop-off events carry the DURATION as their value and low-cardinality custom
  fields (time bucket, phase left during, new vs returning), and session length
  is tagged with its cohort, so the dashboard can answer "how long did the
  people who bounced actually stay" rather than only "how many bounced".
  Covered by tools/analytics-harness.luau against an injected fake service.
  **No data has been observed on the dashboard yet** — events take a while to
  surface.
- 🟢 No `--!native` annotations on the hot sim modules (perf headroom is
  currently ~6× budget, so deferred).
- 🟡 **Nothing has ever run with two real clients.** Single-player live Roblox
  is confirmed (wardrobe, leaderboards, hat equips, DataStore persistence), but
  drop-in handoff, AFK cover, the ready-up tally, the kitchen-cosmetic
  election, session locking and client-authoritative movement under real
  latency have only ever been exercised by harness emulation. The plan's
  latency-injection flag is unbuilt.

## E. User-gated (see README → "Remaining launch steps")

Publish/universe settings · SFX render + upload · badge ids · icon
spritesheet · device playtests + soft-launch gates.

---

**Suggested next batches** (roughly by first-impression impact):
1. 🔴 device pass: the wardrobe preview and the whole menu at 896x414 and at
   375px height, plus a two-client check of the kitchen-cosmetic election and
   the intermission hold.
2. 🟡 batch: limb articulation, results ceremony staging, pacing feel-tune.
3. 🟢 batch: emote wheel, physical walk-up stations, leaderboard wall,
   analytics, DataStore hardening, monetization.
