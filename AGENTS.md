# Working rules

Read `REFERENCE.md` before touching anything. Every command below runs from
the repository root.

## Architecture

- `src/domain/**` — **pure**. No three.js, no DOM, no `Date.now()`, no `Math.random()`
  outside the seeded `rand()`. Deterministic: same seed + same inputs → same run.
  The sim emits `SimEvent`s; view and audio subscribe. Never call the view from the sim.
- `src/view/**` — three.js. Reads domain state, never mutates it.
- `src/ui/**` — DOM HUD + CSS. Text is DOM so it stays crisp at every DPR.
- `src/input/**` — turns touch / keyboard / gamepad into one `InputSnapshot`.
- `src/bots/**` — bots emit `InputSnapshot` too. Bots must never cheat: no
  teleporting, no instant turns, no reaching through walls.
- `src/audio/**` — everything synthesised at runtime. No asset files.

## File ownership

Each piece owns specific files. **Only edit the files your brief lists.** If you
believe you need a change in someone else's file, make the smallest possible
change and say so explicitly in your report so the integration pass can review it.
Shared surfaces (`src/domain/types.ts`, `src/domain/content.ts`, `src/main.ts`)
are high-traffic: additive changes only, never reorganise them.

## Before you finish, always

```
npx tsc --noEmit          # must be clean
npm test                  # must be green — ~6s, pure Node, no browser
npx vite build            # must succeed
node tools/shoot.mjs --out shots/<your-piece>-<round> --seconds 14
node tools/scene.mjs   # if you touched anything that is hard to catch in play
```

Then **open the PNGs you just produced with the Read tool and look at them.**
A change you have not seen rendered is a change you have not made.

### What `npm test` is for

Screenshots cannot see a rule. Three rule bugs reached a real player in two
waves — a crate that deleted anything handed to it, a bun welded to a chopping
board, and a burner that could never be cleared once its pan burned. All three
typechecked, built, and photographed perfectly. The last one killed both
burners a few minutes into every service, and a review bot caught it, not us.

- `tools/planprobe.mjs` — the station rules, asked directly. Includes a sweep of
  every station against every shape of thing a chef can hold (~1400 presses),
  asserting the promise `planGrab` makes to the player: a press that offers
  something must do something, and a press that offers nothing must change
  nothing. All three bugs above broke exactly that promise.
- `tools/soak.mjs` — full services played by the real bots across many seeds.
  Outcome measures, not rule checks: dishes served, burners used, no station
  left a black hole, and the same seed twice giving the same service, which is
  what keeps the `src/domain` purity rule honest.
- `tools/camsync.mjs` — the camera sweeps reimplement the rig's solve with
  hand-copied constants, so this asserts they still match the rig, and that no
  profile loses the player at rest or at full widen.

If you change a rule, add the case. If you add a probe, prove it can fail:
re-introduce the bug and watch it go red. A test that cannot fail is worse than
no test, because it is trusted.

### Photographing something rare — `tools/scene.mjs`

`shoot.mjs` photographs whatever the game happens to be doing, which is the
right instrument for composition and the HUD and useless for anything rare.
Food reaches `burnt` about twice in twelve minutes of bot play and a bot clears
it inside two seconds, so the skillet fire shipped **unphotographed** — the only
picture ever taken of it came from editing `world.ts` to force the state and
reverting afterwards, which leaves nothing behind, cannot be re-run, and is
indistinguishable from a claim.

So ask for the state instead of waiting for it:

```
node tools/scene.mjs            # every scenario
node tools/scene.mjs --list     # what there is
node tools/scene.mjs --only fire
node tools/scene.mjs --strip 5  # a contact sheet over time, for MOTION
```

Each scenario stages the kitchen through `__game.setScene` (see `main.ts`),
parks the bots so they cannot tidy the state away before the shutter opens, and
crops by projecting a **world point** through the live camera (`__game.project`)
rather than a typed-in pixel rectangle. Every hand-typed rectangle in this
project's history went stale when the camera moved; none of these can.

`--strip N` tiles N frames of the same crop, a fifth of a second apart. One
still cannot judge an animation — it shows one instant, which is exactly how a
flame that merely wobbles passes for a flame that moves. The sim is frozen
during a strip and the view clock is not, so what changes between tiles is the
animation and nothing else.

Three things it will tell you that are easy to miss:

- **SCENE REFUSED.** A staged position is a request and the sim may refuse it.
  The first `burnt-food-in-hand` asked for a chef inside the sink cell and
  photographed one at `(7.94, 5.37)` instead. The picture looked fine and was of
  the wrong thing, so the tool now compares what it asked for against what the
  game settled on.
- **SCENE DRIFTED.** Staging is not freezing. Parking the bots left the
  simulation stepping, and a burnt pan's `fire` climbs by dt/9 every step — so
  `fire-new`, whose whole subject is the fire at zero, photographed whatever
  zero had drifted to. `freeze` (default on) stops `step()` while leaving the
  frame clock running, and this check compares the staged number against the
  one that reached the shutter.
- **Cells are addressed by their corner and drawn about their centre.** Aim a
  crop at a raw cell coordinate and half the burner falls outside the frame.
  Use `mid()`.

**A pitched camera frames a trapezoid, not a rectangle** — `tools/fitprobe.mjs`
projects the level's four floor corners and prints where each lands. On the
shipped portrait camera the near edge of the room is 5.3x the far edge (2.8x for
the walkable floor alone), so the
edge that gets cut is the one no camera measurement in this project had ever
looked at: `backWallFrac` measures the wide end. If you are ever asked how much
more of the level could be shown, run this before touching a constant.

**To see where an invisible thing goes, draw it in magenta at full opacity.**
The skillet's smoke was tuned three times against pictures that showed nothing,
on the assumption it was too faint. Painted opaque, it turned out to be a plume
twice the size intended, in the wrong place entirely — clearing the oven mouth
and staining the stone facade. Guessing at a tuning number cannot find that;
one deliberately wrong render can.

These are pictures for a human to look at, not assertions. `npm test` covers
what a machine can judge; this covers the half that needs eyes. Adding a
scenario is cheap — if you fixed something you had to contrive by hand to see,
leave the contrivance behind as a scenario.

## Non-negotiables

- 60fps target. Watch `report.json` → `perf.worstFrameMs`. Headless runs use a
  software rasteriser, so absolute fps is not meaningful; **relative** regressions
  and `worstFrameMs` spikes are.
- Zero console errors. Warnings should be fixed, not ignored.
- Portrait iPhone (393×852) is a first-class layout, not an afterthought.
- Nothing may sit under the notch, the home indicator, or off a safe-area edge.
- No text smaller than 12px. No tap target smaller than 44×44 CSS px.
- No `localStorage`/`sessionStorage`.

## Pull requests

Open them **ready for review, never as drafts**. A draft does not get reviewed:
this repo's automated reviewer only runs when a PR is opened for review, marked
ready, or asked directly, so a draft sits there looking finished while nothing
has actually looked at it. It has found real bugs in every round it has run on.

## Reporting

Return a terse report: what you changed, what you saw in the screenshots after,
what you know is still weak, and any cross-file change you had to make.
Do not pad. Do not claim quality you did not visually verify.
