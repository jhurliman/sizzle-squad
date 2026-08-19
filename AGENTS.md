# Working rules

Project root: `/home/claude/kitchen`. Read `REFERENCE.md` before touching anything.

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
cd /home/claude/kitchen
npx tsc --noEmit          # must be clean
npm test                  # must be green — ~3s, pure Node, no browser
npx vite build            # must succeed
node tools/shoot.mjs --out shots/<your-piece>-<round> --seconds 14
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

## Non-negotiables

- 60fps target. Watch `report.json` → `perf.worstFrameMs`. Headless runs use a
  software rasteriser, so absolute fps is not meaningful; **relative** regressions
  and `worstFrameMs` spikes are.
- Zero console errors. Warnings should be fixed, not ignored.
- Portrait iPhone (393×852) is a first-class layout, not an afterthought.
- Nothing may sit under the notch, the home indicator, or off a safe-area edge.
- No text smaller than 12px. No tap target smaller than 44×44 CSS px.
- No `localStorage`/`sessionStorage`.

## Reporting

Return a terse report: what you changed, what you saw in the screenshots after,
what you know is still weak, and any cross-file change you had to make.
Do not pad. Do not claim quality you did not visually verify.
