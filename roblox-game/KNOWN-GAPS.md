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
- 🟡 **Supporter Pass / monetization not implemented at all** (no gamepass
  check, no +10% XP hook, no bundles). Plan §2.5; deliberately last.

## B. Placeholder presentation

- 🟡 **Limb articulation is first-pass procedural** (gait swings around
  captured joints, carry/chop poses, torso lean, tail/ear secondary motion,
  stun flail via BulkMoveTo). Not yet ported: knee/foot two-segment bend,
  blink/mouth, bank-into-turn, per-species gait personality.
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

- 🟡 **First Shift** is a generic contextual tip strip (one rule-picked line),
  not the plan's scripted first-three-tickets with a demonstrating sous-chef.
  (The demonstration concept needs rethinking anyway now that bots are off by
  default.) **It also owns a trigger it has not claimed yet**: a round never
  starts on a timer, so everyone presses Start Shift — except a brand-new
  player, who is auto-started into their first round by a placeholder in
  Menu:maybeAutoStart. When First Shift lands it should take that over.
- 🟢 **Late-join hold live**: joiners with <15s left spectate with a notice
  and seat at the next phase change.
- 🟡 **Solo/duo pacing is machine-validated only** (bot proxy survives
  comfortably) — needs human feel validation; expect to retune
  `Config.PACING[1..2]`.
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
- 🟢 **Results ceremony is instant text** — no staged reveal, no XP/coin
  tickers.
- 🟢 **Leaderboards are a Ranks tab with resolved display names** (batched
  UserService lookup, cached, one call per 90s poll) and the local player's
  row pinned — they used to print raw `u123456` keys. Still not the physical
  in-world board; each server reads OrderedDataStores directly (fine at launch
  scale; the MemoryStore/MessagingService cache from plan §2.4 is unbuilt).
- 🟢 **Assist mode is unlabeled anywhere** (plan wanted "Heat 1: Breakfast
  Shift" style naming of the visible ramp).

## C2. Front-end (new — see plan Part 4)

- 🟡 **The wardrobe's 3D preview has never rendered on a real device.** It
  drives ChefVisuals inside a ViewportFrame via an injected `commit` (BulkMoveTo
  silently no-ops outside Workspace) and `pose.speedOverride` (gait is derived
  from rendered displacement, which is zero for a stationary rig). Verify: the
  rig is lit and framed, hats sit right, palettes apply, drag-to-spin works,
  and the frame rate holds on a low-end Android.
- 🟢 **Menu is an overlay; walk-up stations are a later pass** (shop board,
  wardrobe mirror, leaderboard wall in the kitchen opening the same panels).
- 🟢 **Kitchen Card auto-dismisses after 12s**; it has no entrance animation
  and no "don't show again".
- 🟢 **Badges have no client surface at all**, and award state is not
  persisted in the profile, so the Career tab shows the milestone track
  instead. Badge ids are still 0 (user-gated).
- 🟢 **Wardrobe has no search/sort**; at 30 items the flat rails are fine, but
  they will not scale to a content cadence.

## C3. Fixed in the front-end pass (kept here as regression bait)

- Between-rounds walking rubber-banded because human move validation timed
  packets against `sim.time`, which is **frozen** while `tickMovementOnly`
  runs — the distance budget collapsed to one tick. SimService now keeps a
  monotonic `self.clock` advanced by both tick paths. If chefs ever start
  snapping between rounds again, look here first.
- The round timer chip and the order queue used to survive into results and
  the lobby; both are now gated to `phase == "round"`.
- 🪙 has no glyph in Roblox's font stack (Unicode 13) and rendered as a hollow
  box. Coin amounts are spelled out or use the `c` suffix. Every other emoji
  in the UI predates 2016 and renders fine.

## D. Robustness / tech debt

- 🟢 **Corrections glide** (snap absorbed into a decaying visual offset).
- 🟢 No packet-loss extrapolation beyond hold-last-sample for remote chefs.
- 🟢 No DataStore retry/backoff beyond pcall, no session locking (same-player
  two-server race), no autosave on server shutdown (BindToClose).
- 🟢 Rate limiting: Emote is allowlisted by id, but ReadyUp is unlimited
  (spam possible; it re-broadcasts phase on every call). GrabEdge is capped at
  3 queued.
- 🟢 No analytics/funnel events (join → first round → second round — the P6
  playtest metrics have nothing instrumenting them yet).
- 🟢 No `--!native` annotations on the hot sim modules (perf headroom is
  currently ~6× budget, so deferred).
- 🟢 Multi-client behavior validated only via harness emulation + Studio
  local server, not under real internet latency (latency-injection flag from
  the plan is unbuilt).

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
