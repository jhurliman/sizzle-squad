# Known gaps

**What is still open.** Not a changelog — when something is done it comes OUT of
this file, and git and HANDOFF.md keep the history. A ledger that only grows
stops being read, and an entry describing behaviour the game no longer has is
worse than no entry: three of them in here still described the old species
rules, the old tutorial script and a missing audio upload that shipped weeks ago.

User-gated items live in README.md → "Remaining launch steps". The dated
calendar these feed into is LAUNCH.md.

Legend: 🔴 blocks a good first impression · 🟡 noticeable, playable around ·
🟢 fit and finish / debt.

**Nothing is 🔴 right now.** Audio on device was the last one and is verified
fixed. What remains is either unverifiable without live traffic, or fit and
finish — which is worth knowing before deciding whether the next work goes into
the game or into getting people into it.

## Waiting on traffic

Not gaps — questions only players can answer. Nothing here is a reason to hold
a release.

- 🟢 **Analytics has produced no dashboard data yet**, which is expected with
  almost no users: the events are pcall'd and degrade to a no-op, so silence is
  indistinguishable from working until there is volume. Covered by
  `tools/analytics-harness.luau` against a fake service. Check once the soft
  launch has run a week; the onboarding funnel is the one to read first.
- 🟢 **Localized text fit is unchecked.** All 133 strings are translated into
  seven languages and wired, but German and Japanese routinely overrun controls
  sized for English. The CTA labels auto-scale; the fixed-width chips do not.
  One Studio pass per language, whenever.

## Pacing and balance

- 🟡 **Four-human throughput is unknown.** Measured with
  `tools/station-probe.luau`, four BOTS leave boards and stoves at 3%
  utilisation — nothing in the kitchen is contended, and forcing a faster order
  rate bought +0.3 dishes for +5.8 missed tickets. The ~10 dish ceiling tracks
  a brain limitation (it parks a working plate on the nearest free counter then
  goes looking for it; counter occupancy climbs 19% → 32% as chefs are added).
  **Humans do not have that failure mode, so their real ceiling cannot be
  measured with this harness.** The pacing table stays bot-safe and
  `PRESSURE_BAND_MUL` is widened to 0.5 so the invisible director can find the
  level from live play. Duo pacing now has real data behind it; trio and quad
  do not.
- 🟢 **Washing up has never been validated with a human.** It costs ~15% of
  round throughput (a wash is a walk plus 2.2s standing still) and `STARS` was
  re-cut from the resulting distribution, all bot-measured.
- 🟢 **Assist mode is unlabeled** anywhere in the UI.

## Presentation

- 🟢 **Limb articulation** is procedural and derived from rig geometry, but
  four things from the web rig are unported: the stride warp (legs cross fast
  and hold near full separation), gaze, idle fidget beats, and the mouth
  CAVITY behind the lip line — the jaw hinges onto nothing.
- 🟢 **Photo moment is a camera push-in** — no team pose at the pass, no
  confetti, no framed score layout.
- 🟢 **Leaderboards scalability** Each server reads OrderedDataStores directly —
  fine at launch scale; the MemoryStore/MessagingService cache from plan §2.4 is
  unbuilt.
- 🟢 **Wardrobe has no search or sort.** At 42 items the flat rails still read,
  but they will not survive a content cadence.
- 🟢 **Dailies auto-claim** rather than offering a claim ceremony.

## Systems

- 🟢 **AFK stage 2 missing.** 20s → bot/park coverage works — *now*; it did
  not until the touch gate landed, and this entry claimed otherwise for weeks.
  The client streams a move packet 30 times a second whether or not anyone is
  playing, the server counted every one as input, and the threshold was
  arithmetically unreachable. What is still missing is stage 2: "two idle
  rounds → non-ready spectator" is not implemented, and Roblox's 20-minute
  kick remains the only backstop for that.
- 🟢 **No per-player ready pips** on the shift panel.
- 🟢 **First Shift does not own its own trigger** — `Menu:maybeAutoStart` still
  starts a first-ever player's round.
- 🟡 **The extra load screen on a first-ever join needs more measurement.**
  First Shift teleports into a reserved server; that lands at the worst moment
  in the funnel and should be timed on multiple real devices.
- 🟢 **ReadyUp is not rate limited** (it re-broadcasts phase on every call).
  Emote is allowlisted by id; GrabEdge is capped at 3 queued.
- 🟢 **No packet-loss extrapolation** beyond hold-last-sample for remote chefs.
- 🟢 **No `--!native`** on the hot sim modules — perf headroom is ~6× budget.

## Device

- 🟡 **Wardrobe preview frame rate on a low-end Android is unmeasured**, as is
  the touch drag-to-spin path.
- 🟡 **Ticket icons use runtime `EditableImage`** with a coloured-chip fallback
  if the API is unavailable on some platform. The fallback has never been seen
  to trigger, which means it has also never been seen to work.

## Traps worth knowing

Kept because each one cost real time and would bite again.

- **Roblox's font stack drops three classes of glyph**, all of which shipped as
  empty boxes: ZWJ sequences (👨‍🍳), variation-selector glyphs (🪙 🍽️ ▫️), and
  typographic dingbats with no emoji presentation (✕ U+2715, ✗ U+2717 — those
  depend on the TEXT font, and FredokaOne has neither). Plain
  emoji-presentation codepoints (⭐ ✅ ✨ 🔥 🏆 🛒) are fine. The rule is written
  at the top of `shared/BadgeDefs.luau`.
- **Back-wall posts sit at x1, ovenSpan.x0-0.5, ovenSpan.x1+0.5 and W-1.**
  A sink placed at (4,1) came down through a timber post. Check any future
  back-wall station against those four.
- **`sim.time` is frozen while `tickMovementOnly` runs.** Human move validation
  timed packets against it and the distance budget collapsed to one tick, which
  rubber-banded everyone between rounds. SimService keeps a monotonic
  `self.clock` advanced by both paths. If chefs snap between rounds again, look
  here first.
- **A wrong `require(script.Parent.X)` compiles fine and kills the client.**
  It is a runtime instance lookup, so every static check passes. Five menu
  modules asked `Menu` for a sibling that lives one level up; the client died on
  its first require, and because the SERVER was untouched it kept writing
  DataStore profiles and looked perfectly healthy while players got an empty
  blue sky and Roblox's default controls. Two guards now: check-luau resolves
  these paths against the directory tree, and `npm run smoke:live` requires
  every module inside a real server of the published place. Note the shape —
  `script.Parent` is the file's own container, so the FIRST `.Parent` costs
  nothing and each one after goes up.
- **A silent publish failure looks exactly like a broken build.** Studio's
  uploader retried forever on "Server is busy" and never landed, so the live
  place was empty while every local check was green. `npm run publish` goes
  through Open Cloud instead: same 409 when Roblox is busy, but it says so,
  backs off, and prints the version number it published.
- **`Highlight` does not render on a part nobody can see** — 0.99 transparency
  no better than 1. Three attempts at highlighting an invisible proxy failed
  before the cell pads were drawn as real geometry.
- **Station item heights are GENERATED** from the capture
  (`tools/gen-surfaces.luau` → `client/SurfaceH.luau`). Regenerate after any
  change to the kitchen capture; the old per-kind table floated plates ~1.2
  studs above floor benches.

## Tried and reverted — do not re-attempt without reading this

- 🟢 **Blurring the kitchen behind the crew on the lobby shot (depth of field,
  then atmospheric haze).** Wanted: the four chefs sharp, the room behind them
  pushed back. Three attempts, all reverted, and the blocker is the renderer
  rather than the code.

  Roblox has **no programmable shaders**. The whole toolkit is a fixed set of
  effects on `Lighting`, and exactly one of them is depth-aware:
  `DepthOfFieldEffect`. It **does not render in this project**. That is a
  measured result, not an inference — a DOF at physically impossible settings
  (`FocusDistance 1`, `InFocusRadius 0`, both intensities `1`, which should
  reduce the entire viewport to mush) changed nothing on screen, while a
  greyscale `ColorCorrectionEffect` planted beside it as a control worked
  perfectly. So post-processing reaches the screen and DOF specifically does
  not.

  `Atmosphere` was the fallback, on the theory that it is base-render rather
  than post-processing and attenuates with distance. It **also does not
  appear**, at the shipping values or after the author tuned the knobs by hand
  in Edit mode.

  Two effects failing, one of them on a code path that should be immune to
  quality settings, points at something environmental in this setup rather than
  at any tuning. That was not chased further because the feature is a garnish.
  **If anyone revisits this, start by finding out why `Atmosphere` does not
  draw** — do not start by writing camera code.

  What made this expensive was not the dead end, it was shipping into it
  blind. `screen_capture` through the Studio MCP returns a flat magenta frame
  here, so nothing visual is verifiable from the agent side; "verified" twice
  meant the effect was *configured* correctly — instance present, enabled,
  sensible numbers — which says nothing about a pixel changing. The bisect that
  actually answered it (absurd settings + an unrelated post effect as a
  control) takes about a minute and should have come first.

  Two real defects surfaced on the way and are worth knowing even though the
  feature is gone. A `Lighting` effect is **not per-instance state** — Lighting
  takes one `Atmosphere`, and a per-rig one stacks a second copy on every Rojo
  hot-sync. And `tools/camera-harness.luau`'s `Instance` fake stored properties
  with `rawset`, so `__newindex` fired only for *absent* keys: the first
  `Parent = x` worked and every assignment after it bypassed the hook, making
  "detached during a round" pass while the object stayed attached. That is the
  third test double in this repo to answer an easier question than the one
  asked. Both were fixed in the reverted commits (`c6ea878`..`a45e484`) if the
  code is ever wanted back.

- 🟡 **Bot "thinking beat" (periodic pauses at task boundaries).** Bots pausing
  ~0.4s when picking up a new task, to look less relentless. Shipped once
  (00dc6d6) on a 24-seed *average dishes* measurement showing no cost, and
  reverted when `tools/soak.mjs` showed the average was the wrong statistic: at
  **every** non-zero pause rate tried (0.05 → 0.35), between 1 and 6 of 12
  seeds finished a full 180s service having **never once used a stove**, and the
  worst seed fell under the served floor. Holding the replan clock open for the
  length of the pause did not fix it; the failures move around with the rate,
  which reads as chaotic sensitivity rather than a mechanism with a knob.

  If attempted again the acceptance test is `npm test` — the soak floor and the
  burner invariant — **not** mean dishes. A change can leave the mean flat while
  making one service in six a dud, and it is the dud a player remembers. A pause
  that never applies to a plan whose route includes a stove is untried.
