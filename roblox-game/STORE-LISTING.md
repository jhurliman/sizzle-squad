# Store listing

The live text and art for the experience page, and the reasoning behind it, so
neither has to be reconstructed from memory or re-derived from scratch.

Everything here was decided against a measurement of the live top-12/top-19
Roblox experiences taken on **2026-08-27** through the public
`games.roblox.com` API — media slots, description lengths, server caps — plus
the actual icon images viewed at 150px, which is the size an icon is really
seen at. The numbers quoted below are from that sample.

---

## Description — LIVE

Uploaded via Creator Dashboard → Configure → Description. Reproduced verbatim:

```
Cook, chop and serve with friends! 🍳 Four chefs, three minutes, one kitchen.

🔪 Chop, fry and plate — one button does everything
🔥 Keep every order moving before the customers walk out
⭐ Hit 3 stars to earn coins, then spend them on outfits and kitchen upgrades
🎮 1-4 players — start solo, then play with friends or bots

Grab an apron. Service starts now.
```

**356 characters, first line 76.** Sample median is 434 with a range of 56–930,
and the top-12 opening hooks run 24–104 characters.

Why it is shaped this way:

- **The pitch lives in the first ~60 characters.** That is the only copy
  guaranteed to survive truncation on mobile, so "Cook … with friends" lands
  before the cut and everything after it is a bonus. "Three minutes" is doing
  real work there too: it sets the commitment before anyone has to ask.
- **No keyword dump.** 2 of 19 do it; neither is near the top.
- **No changelog block.** 15% carry one, and a stale "Latest Update" is worse
  than none. Add one when there is a beat worth naming, and then keep it fed.
- **No like/favourite or Discord CTA.** Also 15%. Worth adding once there is a
  community to point at; pointing at nothing is worse than silence.
- **One how-to line, not a controls section.** 31% include how-to. One button
  is a selling point here, not an instruction.
- **Single-codepoint emoji only.** 👨‍🍳 is a ZWJ sequence and falls back to
  boxes on some devices — the same failure class as the FredokaOne glyph
  problems in the HUD. Every emoji above is one codepoint.

## Icon — LIVE

`roblox/game-icon/d-row.png` (512×512). Four chefs spanning the full tile with
the outer two breaking frame, `SIZZLE / SQUAD` stacked at the bottom, on green.

- **The ends are cropped on purpose.** A row of four forced to fit inside the
  square renders every face too small to resolve at 150px — that is exactly how
  the first crew attempt failed. Breaking frame buys the scale, and implies
  more crew than the tile can hold.
- **Green is unclaimed.** Nothing in the live top-12 is green — they are black,
  purple, cyan, magenta and warm scenes — so the tile separates on colour
  before any detail resolves.
- **Text on an icon is normal, contrary to most written guidance.** 7 of the
  top 12 carry it. What separates the ones that work is size: one or two short
  words, huge, heavily outlined.
- Roblox exposes A/B testing for thumbnails but **not** for icons, so this one
  had to be got right by judgement rather than by experiment.

Alternates live beside it and regenerate with `cd roblox && node game-icon.mjs`:
`a-chef` (single portrait), `b-crew` (three chefs), `c-hook` (hook text),
`e-closeup` (chest-up crop), `f-huddle` (depth stagger).
`_feed-test.png` composites the current set into a grid with the real top-12 at
150px — the only test that answers "does this stand out".

## Still to do

- **Thumbnails: ship 6–8, not 10.** Filling all ten correlates *negatively*
  with CCU in the sample (top-8 average 6.6 slots, the rest 7.4). Murder
  Mystery 2 holds 304K concurrent players on two images. Priority order: four
  chefs mid-service, a completed order at the pass, the wardrobe, a full crew
  of four.
- **Take the video slot.** Only 3 of 19 have a native preview video, and all
  three sit in position one because Roblox auto-promotes an approved video
  ahead of the stills. ~30s cap, 3 uploads a month, no voice-over and no
  overlay text acting as an advertisement. It does not render on Xbox,
  PlayStation or VR, so slot two must still carry the pitch alone.
- **Update something monthly.** All 19 sampled experiences were updated inside
  30 days. Recency is table stakes, not a differentiator.

## Positioning note

The four-player cap is not a handicap and should not be apologised for. Grow a
Garden caps servers at **four** and has 35.9 billion visits and 11.4 million
favourites. Across the sample, server cap and popularity are unrelated — caps
run 4 to 50 with no relationship to concurrents in either direction.
