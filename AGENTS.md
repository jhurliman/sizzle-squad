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
npx vite build            # must succeed
node tools/shoot.mjs --out shots/<your-piece>-<round> --seconds 14
```

Then **open the PNGs you just produced with the Read tool and look at them.**
A change you have not seen rendered is a change you have not made.

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
