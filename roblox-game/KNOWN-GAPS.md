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

## Unverified against the live service

- 🟡 **No real Robux purchase has ever been made.** Both passes exist and are
  wired (Supporter 1959138315, Chef's Trunk 1958262313); ownership is checked
  on join and on `PromptGamePassPurchaseFinished`. The buy flow, the
  grant-on-purchase path and the +10% multipliers have never run against a real
  transaction.
- 🟡 **No analytics data observed on the dashboard yet.** Every event is
  pcall'd and degrades to a no-op, so silence here is indistinguishable from
  working. Covered by `tools/analytics-harness.luau` against a fake service.
- 🟢 **No badge has been observed granting against the live service.** Award
  state is not persisted in the profile, so Roblox's own profile page is the
  only place they appear; the Career tab shows the milestone track instead.
- 🟡 **`Config.FOUNDING_CHEF_UNTIL` is still `2026-11-30`**, a placeholder.
  LAUNCH.md argues for `2026-11-08` — a nine-week "founding" window stops
  meaning anything, and scarcity is the only thing that makes that badge worth
  having.
- 🟡 **Localized text fit is unchecked.** All 133 strings are translated into
  seven languages and wired, but German and Japanese routinely overrun controls
  sized for English. The CTA labels auto-scale; the fixed-width chips do not.
  Worth one Studio pass per language.

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
- 🟢 **Emote row, not a wheel.** Four pings plus owned emote cosmetics.
- 🟢 **No haptics.** Roblox has no reliable phone-vibration API; gamepad-only
  via HapticService is possible later.
- 🟢 **Kitchen Card** has no entrance animation and no "don't show again".
- 🟢 **Menu is an overlay**; the planned walk-up stations (shop board, wardrobe
  mirror, leaderboard wall) are a later pass.
- 🟢 **Leaderboards are a tab, not the physical in-world board.** Each server
  reads OrderedDataStores directly — fine at launch scale; the
  MemoryStore/MessagingService cache from plan §2.4 is unbuilt.
- 🟢 **Wardrobe has no search or sort.** At 42 items the flat rails still read,
  but they will not survive a content cadence.
- 🟢 **Dailies auto-claim** rather than offering a claim ceremony.

## Systems

- 🟢 **AFK stage 2 missing.** 20s → bot/park coverage works; "two idle rounds →
  non-ready spectator" is not implemented. Roblox's 20-minute kick is the only
  backstop.
- 🟢 **No per-player ready pips** on the shift panel.
- 🟢 **First Shift does not own its own trigger** — `Menu:maybeAutoStart` still
  starts a first-ever player's round. The planned demonstrating sous-chef is
  moot with bots off in the tutorial.
- 🟡 **A player who quits mid-tutorial keeps `rounds == 0`** and gets it again
  next session. Intended, but a tutorial that is reliably quit becomes a loop
  nobody escapes; watch the onboarding funnel once there is traffic.
- 🟡 **The extra load screen on a first-ever join is unmeasured.** First Shift
  teleports into a reserved server; that lands at the worst moment in the
  funnel and should be timed on a real device.
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
- **`Highlight` does not render on a part nobody can see** — 0.99 transparency
  no better than 1. Three attempts at highlighting an invisible proxy failed
  before the cell pads were drawn as real geometry.
- **Station item heights are GENERATED** from the capture
  (`tools/gen-surfaces.luau` → `client/SurfaceH.luau`). Regenerate after any
  change to the kitchen capture; the old per-kind table floated plates ~1.2
  studs above floor benches.

## Tried and reverted — do not re-attempt without reading this

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
