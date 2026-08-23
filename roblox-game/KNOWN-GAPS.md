# Known gaps, stubs, and simplifications

The canonical ledger of everything that is placeholder, simplified relative to
the port plan, or not yet built. If it's not shippable-quality, it should be
on this list; if you find something missing from it, that's a bug in the list.
(User-gated items that need the account owner are in README.md → "Remaining
launch steps"; they're cross-referenced here but not duplicated.)

Legend: 🔴 blocks a good first impression · 🟡 noticeable, playable around ·
🟢 fit and finish / debt.

## A. Built but invisible — systems that persist state with no presentation

- 🟡 **Hats render (procedural models for all 12); palettes and kitchen
  cosmetics still don't** — palette recolor needs coat-part tagging in the
  rig capture; plate/pan/bell swaps unbuilt. Nametags render for humans.
- 🟢 **Ticket icons render via runtime EditableImage** (no upload needed) with a colored-chip fallback if the API is unavailable on some platform — verify on device.
- 🔴 **Daily challenges have no UI.** They replicate in the `Progress` payload
  and pay out (auto-claim, no celebration), but no panel shows them — players
  can't see goals or progress. The streak number in the bottom-left strip is
  the only visible trace.
- 🟡 **Species picker missing.** Skin is assigned by chef slot; the plan's
  pick-during-countdown overlay doesn't exist. With bots off, solo players
  always get the same species.
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
- 🟡 **Silent**: all SFX ids empty (README step 2); no adaptive music at all
  (stems render + volume-mix layer unbuilt).
- 🟡 **VFX minimal**: fire + floating labels only. No chop bits, steam,
  coin burst, dust puffs, bump stars; no screenshake; no haptics.
- 🟢 **Photo moment is just a camera push-in** — no team pose at the pass, no
  confetti, no framed score layout.
- 🟢 **Emote row, not wheel**: four fixed ping buttons; owned emote cosmetics
  from the catalog never appear anywhere.

## C. Systems simplified relative to the plan

- 🟡 **First Shift** is a generic contextual tip strip (one rule-picked line),
  not the plan's scripted first-three-tickets with a demonstrating sous-chef.
  (The demonstration concept needs rethinking anyway now that bots are off by
  default.)
- 🟡 **Late-join hold is unwired**: `Config.LATE_JOIN_CUTOFF` exists but
  joiners drop in even with <15s left; no kitchen-cam hold until results.
- 🟡 **Solo/duo pacing is machine-validated only** (bot proxy survives
  comfortably) — needs human feel validation; expect to retune
  `Config.PACING[1..2]`.
- 🟢 **Superlatives**: "Firefighter" card from the plan is missing (no
  extinguish tracking); current set is serves/chops/cooks/washes/trashes.
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

- 🟡 **Corrections hard-snap the mirror** (no client-side smoothing/deadband);
  rare after the envelope rework, but visible when they happen.
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
