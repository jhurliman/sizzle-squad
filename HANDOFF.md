# HANDOFF — Sizzle Squad

*This file is the brief for whoever takes over. Read it top to bottom before
running anything. Then read `REFERENCE.md`, then `AGENTS.md`, then open
`refs/dash-and-dine-01.jpeg` and `refs/dash-and-dine-02.jpeg` with the Read tool
and actually look at them. Everything below assumes you have seen those images.*

---

## 1. What you have inherited

A single-player, endless score-attack cooking game in Three.js that runs in a
browser on iPad, iPhone and desktop, published to GitHub Pages on every push to
`main`. You play one original mascot chef against three bot teammates in one
kitchen; the pressure escalates until you fail. No Nintendo IP anywhere — the
cast is four chunky big-headed originals (bramble bear, pip frog, nori cat,
mochi bird), and every mesh, texture, sound and animation is generated at
runtime. There are no asset files.

The user's standing instruction, verbatim, is that this be **"utterly perfect,
playful and gorgeous, with every single thing done at Nintendo-quality — from
touch controls to bot behavior to the feel of rushing through a kitchen."**

It is not there yet. Section 5 is the honest list of what is wrong.

## 2. The method — this is the important part

This project has two working methods and they are the reason anything here is
good. Do not quietly drop either.

### 2a. Real play beats every critic

**The single highest-value input to this project is the user playing it on a
phone and telling you what confused them.** Every wave since the game shipped to
Pages has come from that, and it has found things no amount of instrumentation
did: a mechanic nobody could explain, a grey object that read as cookware, a
plate stack that implied a rule the game does not have, a button that mostly did
nothing.

Two things characterise good responses to this feedback, and both are worth
copying:

1. **Take the note as a symptom, then find the cause.** "The portrait camera is
   too zoomed in" and "the follow feels too loose" were reported as two
   complaints and were one number (`HALF_WIDTH_MIN`, whose rest solve and widened
   solve were 25% apart).
2. **Prefer deleting a concept to tuning one.** The dash, the plate tower, the
   liftable pan and the carried burnt rasher were all removed rather than
   adjusted, and every one of those removals made the game easier to explain.

### 2b. Builders build, critics judge, critics never read the builder's summary

For anything visual, a fresh-context critic gets the reference images and
instructions to run the real game in real Chromium at four device profiles and
open the actual pixels. It puts ours and the reference side by side, says
**which is better and why in pixels**, names **the single biggest gap in one
sentence**, and scores 0–100. If it loses, the builder goes back in with that
one gap.

Three rules learned the hard way:

1. **A verdict citing no numbers is not a verdict.** "The lighting feels flat"
   is worthless. "Bench planks read luma 133 / S 0.64 on a 158 / S 0.55 floor,
   so the lower two thirds is one field of pale decking" is a work order.
2. **The critic's first duty is to check which of the previous round's demands
   are genuinely visible in the pixels, versus claimed but not delivered.**
   Builders are sincere and still wrong about this constantly.
3. **Every brief must carry both bounds and a measured target.** The most
   reliable failure mode here is one-directional briefs causing overshoot.
   "Tickets are too small" produced tickets that were too loud. "The room is too
   empty" produced 41% honey wood in the lower 45% of frame against a reference
   18–23%. Write briefs as ranges, never as directions.

**Instrumentation beats inspection.** Nearly every real defect here was found by
measuring, not looking: the character springs diverging, the clamp whose floor
sat above its ceiling, the sine dead-zone welding legs together, the game being
arithmetically unwinnable, the bots not reacting to the player at all. When you
suspect something, write a probe into `tools/` and get a number.

**And what a probe cannot judge, photograph deliberately.** `tools/scene.mjs`
stages a named state — a burning pan, ruined food in hand, a chef pressed into a
wall — freezes the simulation there and crops to it by projecting a world point
through the live camera. `--strip N` tiles frames 200ms apart, because one still
cannot tell a flame that moves from a flame that wobbles. The skillet fire
shipped unphotographed before this existed, because bots clear a burnt pan
within two seconds of it happening.

## 3. Where things stand

Merged to `main`, newest first:

| # | What it did |
|---|---|
| Wave 5 | The focus glow stops promising actions that do nothing; the pan never leaves the burner; the chef can no longer clip the door, the wall stone, or walk below the bottom of the frame. |
| Test suite | `npm test`: three probes, wired into the deploy gate. See AGENTS.md. |
| Wave 4 | One-tap chop, progress dials on chop and cook, portrait camera opened up and its follow tightened. |
| Wave 3 | The arch became the real cooker, grab and chop merged into one action button, hearth fire restored. |
| p06 + RECOMPOSE | Touch stick made absolute again, portrait framing re-solved to 0 camera failures, published to Pages. |

Since then, and in flight on this branch: the staged-photography harness, the
wild skillet fire, and three simplifications (burnt food scrapes in place, one
plate, no dash).

**Current measured state**, `tools/shoot.mjs --insets`, all four profiles:
0 console errors, 0 camera failures, ~5ms/frame in the software rasteriser.
`npm test` green in about six seconds.

> ⚠️ **`progress/status.json` is stale.** It reads wave 3.0, last updated
> 2026-08-18, and several waves have shipped since. The user watches the page it
> generates (`node tools/progress.mjs`), so either bring it up to date from the
> table above or say plainly that it is behind — do not leave it quietly wrong.

## 4. How the code is shaped

`AGENTS.md` is binding. The short version:

- `src/domain/**` is **pure**: no three.js, no DOM, no `Date.now()`, no
  unseeded `Math.random()`. Same seed + same inputs ⇒ same run (mulberry32).
  The sim emits `SimEvent`s and the view, audio and haptics subscribe — which
  is why juice can never disagree with sim truth. Preserve this. It is what
  makes the whole harness possible, and `tools/soak.mjs` enforces it by
  scanning the source, because a determinism test comparing two runs inside the
  same second will happily pass a `Date.now()` that has been added to the sim.
- `src/view/**` reads domain state and never mutates it.
- `src/ui/**` is DOM, so text stays crisp at every DPR.
- Touch, keyboard, gamepad and **bots** all produce the same `InputSnapshot`.
  Bots cannot teleport, turn instantly or reach through walls, and must never
  be given a shortcut that the player does not have.
- Audio is entirely synthesised at runtime.
- `src/domain/types.ts`, `src/domain/content.ts` and `src/main.ts` are shared
  high-traffic surfaces: **additive changes only, never reorganise them**. That
  rule is about not pulling a hot file out from under a concurrent piece — it is
  *not* an API compatibility contract, and it does not mean dead fields must be
  kept alive. Nothing outside this repository consumes these types; everything
  that reads them is built from source in the same pass.

Sizes, so you know what you are opening: `view/world.ts` 6286 lines,
`view/characters.ts` 3832, `bots/brain.ts` 2507, `view/cameraRig.ts` 2351,
`view/materials.ts` 1875, `domain/sim.ts` 1727, `ui/hud.ts` 1611, `main.ts`
1248. About 26k lines of TypeScript across 17 files.

The comments carry the archaeology — most of them record a measurement and the
wrong turn it corrected. They are long on purpose. Read the one above a constant
before you retune it.

### Things that will bite you

- **`main.ts` clamps the render delta at `Math.min(0.5, realDt)`** so game time
  tracks wall time. That is deliberate. The view must tolerate it. This is
  exactly what broke the character springs once already, so every spring in
  `characters.ts` is sub-stepped at a fixed 1/120s via `springStep()`. If you
  add a spring anywhere, sub-step it. Do not raise or lower the 0.5.
- **`ovenSpan()` is exported from `kitchen.ts`** so the view's architecture can
  never drift from what the sim treats as solid. Use it; do not re-derive.
- **Three.js `vertexColors` multiplies the geometry `color` attribute**, and an
  absent attribute reads (0,0,0). Particles rendered as black squares for a
  while because of this. Seed white plus a real per-instance alpha.
- **An offline sim rig that calls `createSim()` without `seedPans()` is
  measuring a broken kitchen.** `main.ts` calls `seedPans()` immediately after
  `createSim()`. With no pan on either burner, `planIngredient`'s cook rung can
  never match and whole recipes are unreachable — and those numbers have been
  quoted in a verdict before. Mirror `main.ts`'s boot sequence exactly. Note
  also that `createSim` takes an options object: `createSim(4242)` silently runs
  seed 1337.
- **Tone mapping** is a custom highlight-shoulder applied to the *max channel*
  (`TONE_KNEE = 0.62`, `TONE_CEIL = 0.9` in `main.ts`), which preserves hue and
  saturation exactly. Lighting is budgeted as fractions of albedo, `LUX = π`.
  If you change lighting, change the budget, not individual lights.
- **Additive layers share one clamped budget** (`FIRE_ADD_BUDGET`, `fireTint`).
  A colour authored at full strength can arrive on screen at 46% of itself
  because its declared share was set for an older, dimmer layer. If a light
  source looks weak, check the arithmetic before you redraw the geometry.
- **SwiftShader resolves depth ties consistently**, so z-fighting is
  structurally invisible to this harness. It will still flicker on a real GPU.
  The same goes for anything that depends on driver-specific blending.

## 5. Open gaps

- **The bots barely need you.** Three bots close ~98% of tickets alone; a
  competently-played fourth chef is worth statistically zero dishes. The
  diagnostic that found this is the one to keep using: *change the player's
  policy and see whether the kitchen's output moves.* `brain.ts`'s own header
  still claims +9.8% for the player and that no longer reproduces — fix the
  comment when you fix the number. This is the biggest open design problem in
  the project.
- **Audio has never been judged.** Not once, by anyone. `tools/audioprobe.mjs`
  renders offline and reports a mix table, and it passes, but passing a mix
  table is not the same as sounding good.
- **The white haze on portrait → landscape rotate.** Reported from a real
  device and explicitly parked by the user until they raise it again. Do not
  spend a wave on it unprompted; do not forget it exists.
- **iOS audio after backgrounding** was fixed against the spec and has never
  been confirmed on real hardware.
- **`tools/touchprobe.mjs` reports one ground-truth mismatch** on iPhone
  portrait, ~8px above the action button's halo: `regionAt` predicts the pixel
  steers and a real touch there does not. One sample of twelve, at a boundary.
  It became visible when the button cluster shrank to a single disc; the
  discrepancy is between the shipped predicate and the real touch path, and
  neither has been read closely yet.
- **Order flow and difficulty** have never had a dedicated pass. Balance
  history worth knowing: the game was once arithmetically unwinnable (3 misses ×
  0.34 patience against a 1.0 meter over a 180s round; measured across 14
  bot-only runs that died at 118–164s and scripted-player runs that died at
  54–87s; not one reached the clock). It is now `patiencePerMiss: 0.16`.
  **Re-verify with runs, not with reasoning, after any change to this.**
- **Onboarding** — title, the first 30 seconds, results screen.
- **Real-device performance** and the 772kB (215kB gzipped) bundle. Headless
  fps is not meaningful; relative regression is.

## 6. Running the loop

Before you finish anything, always run what `AGENTS.md` lists — typecheck,
`npm test`, build, shoot, and **open the images and look at them**. A change you
have not seen rendered is a change you have not made.

### Harness facts you would otherwise rediscover painfully

- **Capture mode is the whole ballgame.** Measured on this box: render 3.8ms,
  advancing one second of game time 71ms, capturing one frame **8,600ms**.
  Before capture mode, 51% of all agent wall-clock in this project was
  screenshots (159 runs, 606 of 1194 minutes). `?capture=1` + `advance()` +
  DPR 1 + raw CDP `Page.captureScreenshot` (JPEG, `fromSurface: false`) fixed
  it. Never go back to `page.screenshot()` — the wrapper waits on font loading
  and routes through the surface compositor, and stalls past a 120s timeout.
- Playwright expects a `chromium-1234` build; this sandbox has
  **`chromium-1194`**. Launch with an explicit
  `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` plus
  `--no-sandbox --disable-dev-shm-usage`. Never run `playwright install`.
- **Headless Chromium reports zero safe-area insets**, so nothing was ever
  checked against a notch until `--insets` was written. Use it.
- The Bash tool's default timeout is 2 minutes and will kill harness runs. Pass
  an explicit `timeout` (up to 600000ms).
- **Reap orphaned Chromium, but check process age first.** Eleven accumulated
  once, ~4GB on a 2-core box. A *young* process tree is a live run — killing it
  destroys work. `shoot.mjs` tears the browser down on exit, SIGINT, SIGTERM,
  `uncaughtException` and watchdog.
- **To see where an invisible thing goes, draw it in magenta at full opacity.**
  The skillet's smoke was tuned three times against pictures that showed
  nothing, on the assumption it was too faint. Painted opaque, it turned out to
  be a plume twice the intended size, in the wrong place entirely. One
  deliberately wrong render beats three rounds of guessing at a number.
- **A sweeping regex across many files needs its diff read, not its exit code.**
  Removing one key from 21 tool files silently glued a condition onto the line
  above in one of them, turning a held button into a one-tick press inside the
  rig whose entire job is replaying the screenshot driver's plan. It still ran,
  still printed, still passed. A review bot caught it.

## 7. What the user asked for, in their words

- "Utterly perfect, playful and gorgeous, with every single thing done at
  Nintendo-quality — from touch controls to bot behavior to the feel of rushing
  through a kitchen."
- "Break the game into the smallest pieces that can be improved and judged on
  their own — you decide what the pieces are, not me."
- A fresh-context critic must "inspect the actual running game on iPad, iPhone,
  and desktop — **never the builder's summary**", be "a really harsh critic",
  compare "side by side blind", name the single biggest gap, and keep going with
  **no fixed number of rounds**.
- "Keep a simple live progress page updated as you work so I can watch it
  evolve."
- "I want a gitlab actions setup that publishes the game to github pages and
  link from README so I can play on my phone." — done; it is how every wave
  since has been driven.
- "We want to keep this game as simple as possible." Said of the dash, and
  applied since to the pan mechanic, the plate stack and the burnt rasher.
- "Write tests to catch future regressions." — `npm test`, and it gates the
  deploy.
- "You can't improve what you can't see." — `tools/scene.mjs`.
- Cast: original mascot critters, no Nintendo IP. Structure: endless score
  attack, one kitchen, escalating pressure until you fail.
- Pull requests: open them **ready for review, never as drafts**.

## 8. Suggested first moves

1. `npm install`, then `npx tsc --noEmit && npm test && npx vite build` to
   confirm the tree is clean.
2. `node tools/shoot.mjs --out shots/inherit --insets --seconds 14` and open
   every JPEG, all four profiles. Then `node tools/scene.mjs --strip 5` and open
   those. Form your own opinion before trusting mine.
3. **Play it on a phone**, or get the user to. It is the highest-yield thing in
   this document and it is not close.
4. **Then the bots.** They are the biggest open design problem: a kitchen that
   does not need its player is not a game, and no amount of art fixes it.
5. **Then audio**, which has never had a pass at all.
6. Then order flow and onboarding.
7. Then critics again on everything. Keep going until a harsh critic with fresh
   context, looking at real pixels beside the reference, cannot name a gap.
