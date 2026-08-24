# Known gaps, stubs, and simplifications

The canonical ledger of everything that is placeholder, simplified relative to
the port plan, or not yet built. If it's not shippable-quality, it should be
on this list; if you find something missing from it, that's a bug in the list.
(User-gated items that need the account owner are in README.md → "Remaining
launch steps"; they're cross-referenced here but not duplicated.)

Legend: 🔴 blocks a good first impression · 🟡 noticeable, playable around ·
🟢 fit and finish / debt.

## A. Built but invisible — systems that persist state with no presentation

- 🟡 **Hats + palettes render; kitchen cosmetics still don't** (plate/pan/
  bell swaps unbuilt). All 12 hats x 4 species are hand-tuned in
  hat-fits.json via FitLab (offset/tilt/scale/hideEars); verify new hats in
  hats-on-<species>.png. Palette retint uses dominant-color matching.
- 🟢 **Ticket icons render via runtime EditableImage** (no upload needed) with a colored-chip fallback if the API is unavailable on some platform — verify on device.
- 🟢 **Dailies panel live** (intermission "Today's Goals" + completion
  toasts); rewards still auto-claim rather than a claim ceremony.
- 🟢 **Species picker live** (countdown + intermission row, persisted to the
  profile) — duplicates allowed by design; nametags differentiate.
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
- 🟡 **TODO — adaptive background music unbuilt.** The web game's
  `src/audio/audio.ts` has an adaptive score (`tickMusic(heat, tension)`):
  a base bed plus intensity layers keyed to the round's heat ramp and the
  patience meter. Port: offline-render the score as time-aligned looped
  stems (base + N intensity layers), upload, start all Sounds together and
  cross-fade their `Volume` by heat/patience. Sim already replicates
  heat+patience to the client.
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
- 🟢 **Emote row, not wheel**: four fixed ping buttons; owned emote cosmetics
  from the catalog never appear anywhere.

## C. Systems simplified relative to the plan

- 🟡 **First Shift** is a generic contextual tip strip (one rule-picked line),
  not the plan's scripted first-three-tickets with a demonstrating sous-chef.
  (The demonstration concept needs rethinking anyway now that bots are off by
  default.)
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
- 🟢 **Ready-up shows no per-player state** (no "2/3 ready" indicator).
- 🟢 **Results ceremony is instant text** — no staged reveal, no XP/coin
  tickers.
- 🟢 **Leaderboard "wall" is an intermission text panel**, not the physical
  in-world board; each server reads OrderedDataStores directly (fine at
  launch scale; the MemoryStore/MessagingService cache from plan §2.4 is
  unbuilt).
- 🟢 **Assist mode is unlabeled anywhere** (plan wanted "Heat 1: Breakfast
  Shift" style naming of the visible ramp).

## D. Robustness / tech debt

- 🟢 **Corrections glide** (snap absorbed into a decaying visual offset).
- 🟢 No packet-loss extrapolation beyond hold-last-sample for remote chefs.
- 🟢 No DataStore retry/backoff beyond pcall, no session locking (same-player
  two-server race), no autosave on server shutdown (BindToClose).
- 🟢 No rate limiting on Emote/ReadyUp remotes (spam possible; GrabEdge is
  capped at 3 queued).
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
1. 🔴 batch: limb articulation pass, cosmetics rendering, dailies panel,
   species picker.
2. 🟡 batch: shaped food, VFX pass, corrections smoothing, late-join hold,
   pacing feel-tune from playtests.
3. 🟢 batch: ceremony polish, wheel, wall, analytics, hardening.
