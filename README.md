# Sizzle Squad

An endless score-attack cooking game for phone, tablet and desktop browsers.
Three.js + TypeScript, no art assets — every mesh, texture, sound and animation
is generated at runtime. You play one of four original mascot chefs against
three bot teammates in a single kitchen while the pressure escalates until you
fail.

The visual and gameplay bar is *Dash and Dine* (Super Mario Party); the
moment-to-moment feel bar is *Overcooked!*. See `REFERENCE.md` — the images in
`refs/` are authoritative and every critic pass judges against them.

## Play it

**[jhurliman.github.io/sizzle-squad](https://jhurliman.github.io/sizzle-squad/)** — open it on a phone.

Every push to `main` builds and publishes to GitHub Pages
(`.github/workflows/deploy.yml`); the typecheck and `npm test` are both gates
on that deploy. There is nothing to install and no assets to download — the
whole game is about 215kB gzipped, because every mesh, texture and sound is
generated at runtime.

On iOS, Share → *Add to Home Screen* launches it fullscreen with the notch and
home-indicator insets already handled. Sound needs one tap to start, which is
the browser's rule, not ours.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # tsc --noEmit, must be clean
npm test           # rule + soak + camera probes, ~6s, pure Node, no browser
npm run build      # vite build → dist/
npm run preview    # serve dist/ on 0.0.0.0
```

Requires Node 20+. Chromium is only needed for the screenshot harness.

## Controls

- **Touch** — floating thumbstick anywhere on the left half; one action button
  bottom-right, which does everything (tap to grab, drop or serve; hold to chop
  or wash).
- **Keyboard** — WASD/arrows to move, Space to grab/drop (hold to chop).
- **Gamepad** — left stick, A to grab/drop.

All four input paths (including the bots) converge on a single `InputSnapshot`
struct, so nothing that plays the game can do anything the player cannot.

## Architecture

```
src/domain/**   pure simulation — no three.js, no DOM, no wall clock, no
                unseeded randomness. Same seed + same inputs ⇒ same run.
                Emits SimEvents; everything else subscribes.
src/view/**     three.js. Reads domain state, never mutates it.
src/ui/**       DOM HUD + CSS, so text stays crisp at every DPR.
src/input/**    touch / keyboard / gamepad → InputSnapshot.
src/bots/**     bots emit InputSnapshot too. Bots never cheat.
src/audio/**    runtime-synthesised SFX and adaptive music. No asset files.
```

The simulation runs at a fixed 60Hz (`SIM_DT = 1/60`) with an accumulator; the
view interpolates. Rendering is decoupled from simulation entirely, which is
what makes the capture harness below possible.

`AGENTS.md` holds the binding working rules for anyone (human or agent)
changing this code. Read it before editing.

## The screenshot harness

The game exposes a control surface on `window` for tooling:

```js
window.__game = {
  phase, snapshot(), start(), warp(seconds), setInput(i),
  setScene(spec), project(worldPoint),
  setCapture(on), advance(seconds), renderCostMs(), resetPerf()
}
window.__input = InputManager   // for tools/touchprobe.mjs
```

`setScene` puts the kitchen into a named state on demand — a burning pan, a
chef pressed into a wall — and freezes the simulation there so it can be
photographed; `project` converts a world point to screen pixels through the
live camera, so a crop can follow its subject instead of being a hand-typed
rectangle that goes stale the next time the lens is retuned. Both exist for
`tools/scene.mjs`; see AGENTS.md.

Load the page with `?capture=1` to hand the harness the page's clock.
`advance(n)` then steps sim + view at a fixed 1/60s with rendering suppressed,
drawing exactly one frame per screenshot. This is the difference between a
capture run taking minutes and taking hours.

```bash
node tools/shoot.mjs --out shots/mine --seconds 14
node tools/shoot.mjs --out shots/mine --insets --marks 4,9,15
```

```bash
node tools/scene.mjs --strip 5
```

Stages the rare states — the skillet fire, ruined food, wall clearance — and
tiles five frames 200ms apart, because one still cannot tell a flame that moves
from a flame that wobbles.

```bash
node tools/pagescheck.mjs
```

Serves `dist/` under `/sizzle-squad/` the way GitHub Pages serves a project
site and boots the real game there. Every other harness server mounts `dist/`
at the root, so none of them can catch an asset URL that only resolves from `/`
— which is a blank page on Pages and a clean report everywhere else. Exits
non-zero, so it can gate the deploy.

`shoot.mjs` captures four device profiles — iPhone portrait (393×852), iPhone
landscape (852×393), iPad Pro (1194×834) and desktop (1440×900) — and writes
JPEGs plus a `report.json` with perf numbers and camera-framing assertions.
`--insets` injects real notch and home-indicator safe areas, because headless
Chromium reports zero.

`tools/` holds ~40 other probes: bot behaviour traces, camera solvers, touch
region maps, audio offline renders, colour/luma measurement, throughput
counters. They exist because almost every real defect in this project was found
by measuring, not by looking.

## Progress page

```bash
node tools/progress.mjs
```

Regenerates `progress/index.html` from `progress/status.json` plus the newest
complete shot directory.

## Handoff

`HANDOFF.md` is the continuation brief: the working method, every open gap with
its measured number, and the traps that will otherwise cost you an afternoon.
