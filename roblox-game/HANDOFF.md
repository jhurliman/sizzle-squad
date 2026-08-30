# HANDOFF — Sizzle Squad on Roblox

Written for a fresh session that has the **Roblox Studio MCP** connected, which
the previous session did not. Read this, then `KNOWN-GAPS.md` and `LAUNCH.md`.

The root `../HANDOFF.md` is the *browser* game's brief and predates this port.
Its method notes still apply; its status does not.

---

## Where things stand

**The build is v1-complete.** Nothing is 🔴. Multiplayer has been played
several times with real people, audio works on device, a real Robux purchase has
gone through, badges grant, and seven languages are imported and live.

**Live is place version 33** (published via Open Cloud, not Studio — see below).

**Five commits are pushed to `roblox-port` but NOT published to Roblox.** Two of
them are player-visible and were the last thing being worked on:

| Commit | What | Player-visible |
| --- | --- | --- |
| `9465991` | Friend CTAs (INVITE / JOIN) on the Start Shift panel | **yes** |
| `7e7757e` | `2.00/3.00` float formatting; bots stuck stunned between rounds | **yes** |
| `caf4500` | WardrobeTab reads LocalPlayer lazily | no |
| `321ae62`, `43a7888` | docs, MCP config | no |

Both fixes are built, harnessed and green. They have not been seen running.

---

## Do this first

1. **Look at it.** Studio MCP is the thing the last session did not have. Open
   `SizzleSquad.rbxl`, `start_stop_play`, then `get_console_output` and
   `screen_capture`. Specifically check:
   - the **Start Shift panel** — the new friend row sits under START SHIFT and
     above the tab row; JOIN only renders when a friend is reachable
   - **"WAITING FOR CREW 2/3"** reads as integers, not `2.00/3.00`
   - the console is clean
2. `npm run publish` (**on the user's explicit approval, every time**)
3. `npm run smoke:live` — requires every module inside a real server of the
   published place

---

## The tooling that exists, and why

Most of it was built in response to a specific failure. That context is the
difference between using it and ignoring it.

| Command | Built because |
| --- | --- |
| `npm run publish` | Studio's uploader failed silently with "Server is busy" and left the live game an **empty blue sky** while every local check was green. Open Cloud returns the same 409 but says so, backs off, and prints a version number. |
| `npm run smoke:live` | Five client modules had a wrong `require` path. Luau compiles those fine, so every static check passed while the client could not start. This requires every module inside the real published place. |
| `lune run tools/check-luau.luau` | Four guards: syntax, the `0`-is-truthy-in-Lua codegen trap, place-file staleness, audio ownership, and `script.Parent` require resolution. |
| `npm run parity` | TS vs Luau, 3 seeds x 10,800 ticks. The shared sim must stay bit-identical. |
| `npm test` (repo root) | The web soak. **This is the acceptance test for bot changes**, not mean dishes — see KNOWN-GAPS "Tried and reverted". |
| `node tools/build-loc.mjs` | Fails on an untranslated string, an unwired `fmt.*` template, or a `Loc.f` key the table lacks. |
| `npm run publish:staging` | Roblox has no blue/green; a second place in the same universe is the closest thing. Shares DataStores — fine for load checks, not for playthroughs. |

Twelve harnesses under `roblox-game/tools/`. They run in Lune, headless, in
seconds. `focus-harness` and `tutorial-harness` are the two that find real bugs
most often.

**Toolchain note:** `rojo` and `lune` are NOT on the default PATH in this
environment. The previous session ran everything with
`export PATH="$HOME/.claude/jobs/<id>/tmp/bin:$PATH"`. Check where yours live
before concluding a script is broken.

---

## Two habits worth copying

**Prove the test fails.** Every guard added here was verified by reintroducing
the bug and watching the check go red. Two of them were silently vacuous before
that: one grepped a generated file that contains every key by construction, and
one asserted a config knob rather than the behaviour the knob was supposed to
produce. A green suite that cannot fail is worse than no suite.

**Measure the asset, do not guess it.** Highlight sizes come from the shipped
`kitchen.rbxm`, station heights are generated from the capture, and the economy
was retuned from `tools/ramp-probe.luau` rather than by feel. Every time this
was skipped it cost a round trip — most memorably three attempts at highlighting
an invisible proxy before checking whether `Highlight` renders on one at all.

---

## What is actually left

Nothing in the build blocks a launch. The remaining work is audience:

- **Thumbnails, video, store page** — done.
- **Soft launch 5 Sep.** Pulled forward from 26 Sep because the 60-day
  eligibility window ending at Halloween opens **1 September**, and the old date
  wasted 25 of 60 usable days.
- **250 highly engaged, age-checked players** in a rolling 60-day window is the
  only gate between this game and the under-16 audience. Nothing in the code
  moves it. The user's entire personal Roblox network left the counter at **0**.
- **First ad campaign** `8c4e27a0-5b6f-40f2-9ee9-ad8ce04d4879`, 3 days, was
  pending review. **Check whether it served while the place was serving a blue
  sky** — if so, that spend bought nothing and the counter learned nothing.

Read LAUNCH.md's campaign log for what to read off a campaign, in priority
order: does the Highly Engaged counter move at all, then first-round completion,
then D1, then cost per *retained* player.

---

## Credentials

`ROBLOX_SIZZLE_SQUAD_API_KEY` is exported in `~/.zshrc` and is only visible to an
**interactive** zsh (`zsh -ic '...'`, not `zsh -lc`). It must never reach stdout,
a log, or an error message; every tool here scrubs it. Universe `10761465304`,
place `113028832194057` — both non-secret and baked into the tooling.
