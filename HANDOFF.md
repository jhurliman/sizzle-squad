# HANDOFF — Sizzle Squad

*This file is the prompt for the agent taking over. Read it top to bottom before
running anything. Then read `REFERENCE.md`, then `AGENTS.md`, then open
`refs/dash-and-dine-01.jpeg` and `refs/dash-and-dine-02.jpeg` with the Read tool
and actually look at them. Everything below assumes you have seen those images.*

---

## 1. What you have inherited

A single-player, endless score-attack cooking game in Three.js that runs in a
browser on iPad, iPhone and desktop. You play one original mascot chef against
three bot teammates in one kitchen; the pressure escalates until you fail. No
Nintendo IP anywhere — the cast is four chunky big-headed originals (bramble
bear, pip frog, nori cat, mochi bird).

The user's standing instruction, verbatim, is that this be **"utterly perfect,
playful and gorgeous, with every single thing done at Nintendo-quality — from
touch controls to bot behavior to the feel of rushing through a kitchen."**
There is **no fixed number of rounds**. The loop ends when a harsh fresh-context
critic, comparing our real pixels blind against the reference, stops being able
to name a gap.

It is not there yet. Section 5 is the honest list of what is wrong, with the
measured number attached to each item.

## 2. The method — this is the important part

This project has one working method and it is the reason anything here is good.
Do not quietly drop it.

**Builders build. Critics judge. Critics never read the builder's summary.**

A critic gets: a fresh context, the reference images, and instructions to run
the real game in real Chromium at four device profiles and open the actual
pixels. It then puts ours and the reference side by side, says **which is
better and why in pixels**, names **the single biggest gap in one sentence**,
and scores 0–100. If it loses, the builder goes back in with that one gap.

Three rules learned the hard way:

1. **A verdict citing no numbers is not a verdict.** "The lighting feels flat"
   is worthless. "Bench planks read luma 133 / S 0.64 on a 158 / S 0.55 floor,
   so the lower two thirds is one field of pale decking" is a work order.
2. **The critic's first duty is to check which of the previous round's demands
   are genuinely visible in the pixels, versus claimed but not delivered.**
   Builders are sincere and still wrong about this constantly.
3. **Every brief must carry both bounds and a measured target.** The single
   most reliable failure mode in this project is one-directional briefs causing
   overshoot. "Tickets are too small" produced tickets that were too loud.
   "The room is too empty" produced 41% honey wood in the lower 45% of frame
   against a reference 18–23%. Write briefs as ranges, never as directions.

**Instrumentation beats inspection.** Nearly every real defect here was found by
measuring, not looking: the character springs diverging, the clamp whose floor
sat above its ceiling, the sine dead-zone welding legs together, the game being
arithmetically unwinnable, the bots not reacting to the player at all. When you
suspect something, write a probe into `tools/` and get a number. That is what
the forty scripts in there are.

Between major waves, **spawn one fresh agent to play the whole game end to end
and smooth everything into one coherent thing.** Piece-wise polish drifts.

## 3. Where things stand

Scores are the last fresh-critic verdict for each piece, 0–100, where 90+ means
the critic would believe it shipped on a Nintendo platform.

**Look (wave 1.5 finals)**

| Piece | Score | The gap the critic named |
|---|---|---|
| p03 Kitchen set & readability | 80 | Overcorrected: 41% honey wood in the lower 45% of landscape frames vs reference 18–23%. The near half fused into a raft of plank. |
| p01 Camera & framing | 76 | `cameraRig.ts:1993` substitutes `LOST_MAX = 0.9` for `rescueMax` on exactly the tall aspect that `RESCUE_MAX_TALL = 0.68` and `CENTRE_MAX_TALL = 0.33` exist to protect. iPhone portrait loses its anchor. |
| p07 Orders & HUD | 76 | With three live orders the third is `display:none`, and no ticket ever shows time pressure — the two states that end a run are the two the HUD does not draw. |
| p02 Art direction & lighting | 74 | Bench planks no longer separate from the floor they stand on. |
| p04 Mascot chefs & animation | 68 | Legs animate but nothing above the hips rotates — rigid torso, both arms abducted at every speed. Tightrope walkers, not runners. |

**Feel (wave 2A finals — first time this axis was ever judged: build → judge →
rework → judge, 17 agents, 3.6M tokens)**

| Piece | r1 → r2 | The gap the critic named at r2 |
|---|---|---|
| p14 Station interaction | 62 → **79** | The sim's targeting is world-class but the sign that communicates it thrashes: the verb changes 3.21 times a second and each glyph pop costs 258ms, so the indicator is mid-animation 83% of the time it is on screen. |
| p05 Movement feel | 68 → **74** | The chefs' feet never touch the floor. The weight-bearing foot travels through world space at a median **1.05× the body's own speed**, so a superbly-tuned sim is presented as two pendulums dragged across stone rather than a character that grips and pushes. |
| p10 Bot teammates | 58 → **68** | Three bots close **98% of tickets on their own**. A competently-played fourth chef — you — is worth +0.8% to +6.3% of dishes, statistically indistinguishable from zero. The kitchen does not need you. |
| p06 Touch controls | 78 → **62** | **Regressed.** Once the thumb passes the ring's own radius — every sustained run — the stick stops being an absolute control: steering gain climbs to 1.4–2.1×, the chef ends up running **up to 62° away from where the thumb points**, permanently, with zero self-correction, while the drawn knob that would expose the lie is parked up to 238px from the finger. |
| p09 Audio | — | **Never judged.** The wave 2A audio builder died on an API 529 before finishing. This piece has had no pass at all. |

### Read the touch regression before you do anything else

p06 is the one number in this project that went **down**. The r1 critic asked
for the floating stick's unbounded origin drag to be clamped. The rework agent
decided to close the gap "differently than asked" and shipped a different
model, which traded a visible-but-honest control for an invisible-and-lying
one. Two lessons, both worth more than the fix:

- When a critic names a gap and a builder substitutes its own solution, the
  next critic must be told exactly what was asked for, so it can judge the
  substitution rather than only the result.
- **Re-judge after every rework, always.** Wave 2A only caught this because it
  ran judge → rework → judge. A wave that stops at rework ships regressions.

The correct fix for p06 is almost certainly the one originally asked for:
bound the origin drag so the stick stays under the thumb and remains absolute.
`tools/touchprobe.mjs` (real CDP `Input.dispatchTouchEvent`, not the
`__game.setInput` hook — it exercises `src/input` for real) and
`tools/stickprobe.mjs` are your regression suite. Use them.

`progress/status.json` is the live board; `node tools/progress.mjs` regenerates
the HTML page from it. **Keep it updated as you work** — the user watches it.

## 4. How the code is shaped

`AGENTS.md` is binding. The short version:

- `src/domain/**` is **pure**: no three.js, no DOM, no `Date.now()`, no
  unseeded `Math.random()`. Same seed + same inputs ⇒ same run (mulberry32).
  The sim emits `SimEvent`s and the view, audio and haptics subscribe — which
  is why juice can never disagree with sim truth. Preserve this. It is what
  makes the whole harness possible.
- `src/view/**` reads domain state and never mutates it.
- `src/ui/**` is DOM, so text stays crisp at every DPR.
- Touch, keyboard, gamepad and **bots** all produce the same `InputSnapshot`.
  Bots cannot teleport, turn instantly or reach through walls, and must never
  be given a shortcut that the player does not have.
- Audio is entirely synthesised at runtime. There are no asset files in this
  project, by design.
- `src/domain/types.ts`, `src/domain/content.ts` and `src/main.ts` are shared
  high-traffic surfaces: **additive changes only**, never reorganise them.

Sizes, so you know what you are opening: `view/world.ts` 5575 lines,
`view/characters.ts` 4057, `bots/brain.ts` 2501, `view/cameraRig.ts` 2128,
`view/materials.ts` 1875, `ui/hud.ts` 1611, `domain/sim.ts` 1428, `main.ts`
1062. About 25k lines of TypeScript across 17 files.

### Things that will bite you

- **`main.ts` clamps the render delta at `Math.min(0.5, realDt)`** so game time
  tracks wall time. That is deliberate. The view must tolerate it. This is
  exactly what broke the character springs once already, so every spring in
  `characters.ts` is sub-stepped at a fixed 1/120s via `springStep()`. If you
  add a spring anywhere, sub-step it. Do not raise or lower the 0.5.
- **`ovenSpan()` is exported from `kitchen.ts`** so the view's architecture can
  never drift from what the sim treats as solid. Use it; do not re-derive.
- **`Plate.stack` is cosmetic only** — the armful count for the reference's
  comedy plate tower. It collapses to 1 when set down. Do not let logic depend
  on it.
- **Three.js `vertexColors` multiplies the geometry `color` attribute**, and an
  absent attribute reads (0,0,0). Particles rendered as black squares for a
  while because of this. Seed white plus a real per-instance alpha.
- **An offline sim rig that calls `createSim()` without `seedPans()` is
  measuring a broken kitchen.** `main.ts` calls `seedPans()` immediately after
  `createSim()`. Several throwaway critic probes did not, so with no pan on
  either burner `planIngredient`'s cook rung could never match and whole
  recipes were unreachable — and the resulting numbers were quoted in a verdict.
  If you write a headless rig, mirror `main.ts`'s boot sequence exactly.
- **Tone mapping** is a custom highlight-shoulder applied to the *max channel*
  (`TONE_KNEE = 0.62`, `TONE_CEIL = 0.9` in `main.ts`), which preserves hue and
  saturation exactly. Lighting is budgeted as fractions of albedo, `LUX = π`.
  If you change lighting, change the budget, not individual lights.

## 5. Open gaps, with numbers

Everything here is measured. Do not re-derive; do verify.

**Closed by wave 2A — do not re-open, but do verify:**

- The focus indicator (0.16% of frame, +10 luma, hidden under a bench) and the
  silently-refused press (36% of presses emitted zero events) were both fixed;
  station interaction went 62 → 79. There is now a grab input buffer
  (`grabBufferSeconds: 0.15`, which deliberately does **not** decay while
  stunned, because a bump is 160ms and a decaying 150ms buffer would eat every
  post-bump press).
- Lane length: the map was re-solved with `tools/mapsearch.mjs` and the median
  open run went **1.137u → 3.129u**, against 0.68u to reach 90% of top speed.
  That constraint is satisfied.

**Still open, with numbers measured today:**

- **Dead dashes — RESOLVED by deletion.** `tools/feelcrit-lanes.mjs` used to
  report lane-aligned cardinal dashes with a median gain of 0.036u and 57.3%
  dead. The dash button mostly did nothing; it and the whole mechanic are now
  gone, on request, along with the two tools that existed to tune it.
- **The bots still barely need you.** Wave 2A improved them a lot (58 → 68) but
  three bots close 98% of tickets alone. Keep using the diagnostic that found
  this: *change the player's policy and see whether the kitchen's output
  moves.* If a competent player is worth statistically zero dishes, the bots
  are a solo script running next to you. Note also that `brain.ts`'s own header
  claims +9.8% for the player and that no longer reproduces — fix the comment
  when you fix the number.
- **Audio has never been judged at all** (see the table above).

**RECOMPOSE pass — two remaining measured constraints, to be satisfied
together.** One pass, not two tickets, because fixing either alone breaks the
other:

1. **Bench raft.** 41% honey wood in the lower 45% of frame; reference is
   18–23%. Also `p02`: benches at luma 133 / S 0.64 must separate from a floor
   at 158 / S 0.55.
2. **Back wall and portrait framing.** Ours spans 1.00 of frame width; the
   reference spans 0.84, which is what gives it the angled side-wall wedges at
   the extreme left and right. We lose them entirely. `shoot.mjs` emits this as
   a camera assertion and populates `cameraFailures` in `report.json` — the
   final run in `shots/handoff-final/` has **13 camera failures on iPhone
   portrait and 0 on all three other profiles**, including `visibleDepthRatio
   2.04–2.49 outside 1.75–1.81` and one frame where `room centre 0.71 past the
   composition stop 0.68 — player would be off the picture`. Portrait is the
   whole job here. Open
   `shots/handoff-final/iphone-portrait/t0013s.jpg` next to
   `shots/handoff-final/desktop/t0013s.jpg` and the difference is not subtle:
   desktop is close to the bar, portrait wastes its entire lower half on empty
   floor.

**Wave 2B, not yet started:**

- **p08 VFX & juice** — steam, fire, confetti, hitstop, screen shake. Subscribe
  to `SimEvent`s; never drive juice off view state.
- **p11 Order flow & difficulty** — score-attack pacing and the escalation
  curve. Note the balance history: the game was once arithmetically unwinnable
  (3 misses × 0.34 patience against a 1.0 meter over a 180s round; measured
  across 14 bot-only runs that died at 118–164s and scripted-player runs that
  died at 54–87s; not one reached the clock). It is now `patiencePerMiss: 0.16`.
  **Re-verify with runs, not with reasoning, after any change to this.**
- **p12 Onboarding & screens** — title, the first 30 seconds, results.
- **p13 Performance** — was flagged urgent (under 2fps in the software
  rasteriser, distorting the critic loop itself). **This is now stale**: the
  final run measures 4.7ms/frame portrait, 5.5ms landscape, 6.2ms iPad,
  6.9ms desktop, with zero console errors on all four profiles. Absolute fps
  headless is not meaningful, but *relative* regression and
  `report.json → perf.worstFrameMs` are, and there is no fire here any more.
  Re-scope p13 to real-device testing and the 772kB (215kB gzipped) bundle.

## 6. Running the loop

Before you finish anything, always:

```bash
cd /home/claude/kitchen
npx tsc --noEmit                                    # must be clean
npx vite build                                      # must succeed
node tools/shoot.mjs --out shots/<piece>-<round> --seconds 14
```

Then **open the JPEGs with the Read tool and look at them.** A change you have
not seen rendered is a change you have not made.

### Harness facts you would otherwise rediscover painfully

- **Capture mode is the whole ballgame.** Measured on this box: render 3.8ms,
  advancing one second of game time 71ms, capturing one frame **8,600ms**. Before
  capture mode, 51% of all agent wall-clock in this project was screenshots
  (159 runs, 606 of 1194 minutes). `?capture=1` + `advance()` + DPR 1 + raw CDP
  `Page.captureScreenshot` (JPEG, `fromSurface: false`) fixed it. Never go back
  to `page.screenshot()` — the wrapper waits on font loading and routes through
  the surface compositor, and stalls past a 120s timeout.
- Playwright 1.62.1 expects `chromium-1234`; this sandbox has **`chromium-1194`**.
  Launch with an explicit
  `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` plus
  `--no-sandbox --disable-dev-shm-usage`. Never run `playwright install`.
- **Headless Chromium reports zero safe-area insets**, so nothing was ever
  checked against a notch until `--insets` was written. Use it.
- The Bash tool's default timeout is 2 minutes and will kill harness runs. Pass
  an explicit `timeout` (up to 600000ms).
- **Reap orphaned Chromium, but check process age first.** Eleven accumulated
  once, ~4GB on a 2-core box. A *young* process tree is a live run — killing it
  destroys work. `shoot.mjs` now tears the browser down on exit, SIGINT,
  SIGTERM, `uncaughtException` and watchdog.
- Use absolute paths, or `cd /home/claude/kitchen` explicitly, in every command.
  Working-directory drift produced bogus `tsc`/`vite build` failures more than
  once.

### Workflow mechanics

Fan-out is done with the `Workflow` tool, `pipeline()` by default so critics
start on a finished piece while other pieces are still building. Structured
output schemas on every agent, so verdicts come back as data.

**Workflows stall roughly every two hours.** This happened three times in wave 1
and once in wave 1.5. It is not fatal and it is not your fault. The recovery is:
verify `npx tsc --noEmit` and `npx vite build` are clean, then relaunch with
`Workflow({ scriptPath, resumeFromRunId })` — completed agents replay from
cache and only the interrupted one re-runs. Scripts are persisted automatically
under the session directory and the path comes back in the tool result.

**Test liveness in this order** (I got this wrong three separate times):

1. `TaskOutput` status.
2. `find src tools -newermt "-25 minutes" -type f`
3. journal entries.

`shots/` mtime goes stale for an hour while work continues, because critics
reuse directories. Journal age goes stale for 80+ minutes while an agent edits
files continuously. Neither alone means anything.

For long unattended stretches, schedule heartbeats back into your own session
with `mcp__claude-code-remote__send_later`.

## 7. What the user asked for, in their words

Keep these visible while you work:

- "Break the game into the smallest pieces that can be improved and judged on
  their own — you decide what the pieces are, not me."
- "Fan out sub-agents and have sub-agents tackle each one individually."
- A separate fresh-context sub-agent must "inspect the actual running game on
  iPad, iPhone, and desktop — **never the builder's summary**."
- The critic must be "a really harsh critic, and if it doesn't feel
  Nintendo-quality, it should keep going."
- "It should literally compare them side by side blind and say which one is
  better, and when ours loses, name the single biggest gap and send the builder
  back in. **No fixed number of rounds.**"
- "Between major waves, spawn one fresh agent to play the whole game and smooth
  everything into one coherent thing."
- "Keep a simple live progress page updated as you work so I can watch it
  evolve."
- Cast: original mascot critters, no Nintendo IP. Structure: endless score
  attack, one kitchen, escalating pressure until you fail.

## 8. Suggested first moves

1. `npm install`, then `npx tsc --noEmit && npx vite build` to confirm the
   inherited tree is clean.
2. `node tools/shoot.mjs --out shots/inherit --insets --seconds 14` and open
   every JPEG, all four profiles. Form your own opinion before trusting mine.
3. **Fix p06 touch first.** It is the lowest score, it is a regression rather
   than an absence, the fix is already specified, and it is the piece the user
   physically holds. Bound the origin drag. Re-judge with a fresh critic that
   has been told what r1 originally asked for.
4. **Then RECOMPOSE** — one brief carrying both constraints in section 5 with
   both bounds on each, aimed squarely at iPhone portrait. It unblocks p01,
   p02 and p03 together, and the `cameraFailures` count in `report.json` is a
   hard, automatic acceptance test: it must reach 0 on all four profiles.
5. **Then p09 audio**, which has never had a pass.
6. Then wave 2B: p08 VFX, p11 order flow, p12 onboarding, p13 re-scoped.
7. Then a fresh coherence agent playing the whole game end to end.
8. Then critics again on everything. Keep going until a harsh critic with fresh
   context, looking at real pixels beside the reference, cannot name a gap.
