# Launch campaign

Target: **Halloween, Saturday 31 October 2026.** Written 2026-08-27, which is
**65 days / 9.3 weeks** out.

This is the campaign calendar and the reasoning behind the dates. Asset
decisions (description, icon, thumbnails) live in `STORE-LISTING.md`;
engineering gaps live in `KNOWN-GAPS.md`; the user-gated publish checklist is
in `README.md` → "Remaining launch steps". None of those are duplicated here.

---

## The scheduling conflict, and how it resolves

The original plan treated Halloween as a **content beat ~10 weeks after
launch** ("Spooky Shift"). Naming it as the *launch date* instead collapses
those two things into one day, and that collision is worse than it looks —
because of the audience gate.

**The game cannot reach under-16 players on 31 October if it launches on
31 October.** Under-16 reach requires **250 highly engaged players**, and that
counter only accumulates *after* the experience is publicly playable. Roblox
defines a highly engaged player via play history, account age and *platform
expenditure* — accounts that have spent money somewhere on Roblox in the last
60 days. So the gate is not "250 people liked it", it is "250 recent spenders
played it".

Order-of-magnitude, that is the biggest number in this document:

> **250 unique plays by highly engaged, AGE-CHECKED users inside a rolling
> 60-day window.** "Highly engaged" is Roblox's own term and combines account
> tenure, playtime *in your experience*, and platform spend. Age-checked means
> the player has completed Roblox's age verification.

Three things in that sentence decide the whole plan, and I had two of them
wrong from reading the dashboard alone:

- **The window ROLLS.** This is not a lifetime counter. A trickle of three or
  four a week never arrives, because the early ones age out before the late
  ones land. It has to be concentrated traffic, not sustained dribble.
- **Only age-checked users count.** Not every 16+ player is age-checked, so the
  qualifying pool is narrower than "everyone who can currently see the game".
- **Under-16s cannot play at all until it is met.** There is no partial
  unlock — which is exactly why launching *on* Halloween would have wasted it.

Everyone the account owner personally knows on Roblox — partner and two kids —
was played through in one evening and moved the counter to **0**, because none
of them clear tenure-plus-spend-plus-playtime as age-checked accounts. Personal
network is not a strategy here; it is not even a rounding error. The gate is not something a friends-and-family round can touch.

**Therefore: launch publicly in late September, and make Halloween the content
beat it was always designed to be.** That is not a retreat from the Halloween
target — it is the only version of the plan where Halloween traffic arrives at
a game that can actually accept it. Launch day at 16+-only reach would put the
single biggest day of the Roblox seasonal calendar in front of a locked door.

Two supporting reasons the earlier date is better anyway:

- **Seasonal discovery favours the already-live.** Roblox recommendation
  surfaces reward engagement signal that has had time to accumulate. An
  experience that has been live for five weeks with a rising retention curve is
  a far better candidate for Halloween-window recommendation than one published
  that morning with no history.
- **31 October is a Saturday.** Weekend peak is the right day to spend the beat
  on, and the wrong day to discover a launch-blocking bug.

## Campaign log

Kept because "did the spend do anything" is answerable only against what was
running at the time, and three campaigns from now nobody will remember.

| Started | Campaign | Length | Notes |
|---|---|---|---|
| 29 Aug 2026 | `8c4e27a0-5b6f-40f2-9ee9-ad8ce04d4879` | 3 days | First ever. Queued the day the store page completed — thumbnails, 1920×1080 detail image and the 30s video all in place. Pending review at submission. |

**What to read off the first one**, in priority order. It is a small test, not
the push; its job is to tell you whether to scale or to fix.

1. **Did the Highly Engaged counter move at all?** This is the only number that
   matters for reach. If a three-day campaign moves it from 0 to something, the
   channel works and the question becomes budget. If it stays at 0, paid traffic
   is not reaching age-checked spenders and more of it will not help.
2. **First-round completion.** If people arrive and do not finish one shift, the
   funnel leaks before retention is even measurable, and that is a game problem,
   not a marketing one. The onboarding analytics were built for exactly this
   question — it is the first dashboard to open.
3. **D1 retention and rounds/session.** These decide whether Roblox's own
   recommendation surfaces will carry traffic for free. They matter more than
   raw installs.
4. **Cost per *retained* player**, not per click. A cheap click into a leaky
   funnel is the most expensive thing on this list.

## Getting to 250 — the only part of this that is not automatic

Nothing in the build moves this number. It is bought or earned with traffic
from age-checked 16+ accounts, and there are exactly four sources:

1. **Sponsored ads targeting 17+.** The only lever that is fully under control,
   and the only one that delivers precisely the population that counts. Run it
   CONCENTRATED rather than spread thin — the rolling window punishes a drip.
   Spend against a finished store page or it converts badly; that is why the
   thumbnail and the video come first.
2. **Short-form video off-platform.** TikTok and YouTube Shorts drive a large
   share of Roblox discovery now, cost time rather than Robux, and the ~30s
   gameplay capture is the same footage. Highest unpaid ROI on this list, and
   four-chef co-op chaos is natively watchable.
3. **Roblox's own recommendation surfaces.** These reward retention, not
   novelty, which is what the metric gates below are really protecting. A game
   that holds people gets shown to more people for free.
4. **Communities** — co-op and Overcooked-like Discords, subreddits. Small,
   but free and honest.

**Watch it in the Audience Reach dashboard**, which updates in real time. If the
counter is not moving after a week of a paid push, the problem is the store page
or retention, not the budget — increasing spend against a leaky funnel converts
Robux into nothing at a very reliable rate.

**If 250 does not land before 31 October, run the Halloween beat anyway.** It
still works for the 16+ audience the game can already reach; it simply does not
unlock the under-16 one. That is a smaller Halloween, not a failed one, and it
is a much better outcome than delaying into November to chase a gate.

---

## Calendar

Five phases, each with a gate that must pass before the next begins. Dates are
the *start* of each phase.

**PULLED FORWARD — the 60-day window ending at Halloween opens 1 September.**

Anything earned before 1 Sep does not count toward being eligible on 31 Oct.
Phase 1 finished about two weeks early (store page complete, first ad campaign
queued), and the original 26 Sep soft launch would have used only 35 of the 60
available days. Every day public before Halloween is a day the counter can
move, so the public date moves up.

| From | Phase | Purpose | Gate to advance |
|---|---|---|---|
| ~~Thu 27 Aug~~ | ~~Close the blockers~~ | **DONE** — build, store page, video, first campaign queued | — |
| **Sat 29 Aug** | **Friends & family** | Funnel diagnosis, not reach | First-round completion ≥ 90% |
| **Sat 5 Sep** | **Soft launch** — public | Earn the 250; prove retention | D1 ≥ 25%, session ≥ 12 min, rounds/session ≥ 3, like ratio ≥ 90% |
| **rolling** | **Paid pushes** | Concentrated, against a page that converts | Cost per *retained* player is sane |
| **Sat 31 Oct** | **Halloween beat** — "Spooky Shift" | The event, at whatever reach has been earned | — |

A 5 Sep public date puts **56 of the 60 window days** to work instead of 35.
That is the single largest lever left, it costs nothing, and it is available
only because the build finished early.

### Now · Friends & family (about a week)

20–50 players via private links. **This cannot move the 250** — the owner's
entire personal Roblox network was played through and left the counter at 0 —
and should not be judged on reach. Its only job is to find the biggest drop in
join → first round → second round while the audience is small enough to talk to.

### From 5 Sep · Soft launch (public)

Two jobs at once:

- **Earn the 250.** This is why the date moved up: 56 window days instead of 35.
- **Prove the funnel holds** against the metric gates before scaling spend.

Paid pushes run against this rather than waiting for a separate phase — the
rolling window punishes saving budget for later, and the store page is already
finished, which was the actual reason to wait.

Watch the Audience Reach dashboard weekly. If the counter is not moving after a
funded week, the problem is the page or retention, not the budget.

### 31 Oct · Halloween beat

**"Spooky Shift" is entirely unbuilt** — there is no event, seasonal or
cosmetic content in `Config.luau` today. It needs to be scoped and built during
the soft-launch phase, not discovered in late October. The cheap version that
fits the existing systems: a seasonal recipe or two, a small set of themed
cosmetics on the existing hat pipeline, and a kitchen re-dress. Every one of
those recombines machinery that already ships.

---

## Founding Chef window

`Config.FOUNDING_CHEF_UNTIL` is **set to `"2026-11-08"`** — the Sunday after
Halloween. That covers everyone
from the soft launch through the Halloween weekend and closes a week later,
which keeps the badge scarce — scarcity is the only thing that makes it worth
having. `2026-11-30` stretches the "founding" window to nine weeks, at which
point it stops meaning anything.

The badge is awarded at the end of any shift while the date has not passed, so
soft-launch players earn it simply by being early. That is the intended reward.

---

## What this campaign deliberately does not do

- **No launch-day publicity push.** The store page is the campaign. Across the
  sampled top-19, the description, icon and thumbnails carry discovery; nothing
  in that sample suggests an external announcement moves Roblox traffic.
- **No Discord or like/favourite CTA yet.** Only 15% of the sample carry one,
  and pointing at a community that does not exist is worse than silence. Add it
  during soft launch *if* there is somewhere to point.
- **No changelog block in the description** until there is a beat worth naming
  and a commitment to keep feeding it. A stale "Latest Update" is worse than
  none.
- **No expedited review.** 100,000 Robux buys nothing but a shorter wait on the
  engagement evaluation, and this calendar has the time.
- **Monthly updates are table stakes, not a beat.** All 19 sampled experiences
  were updated inside 30 days. That is the floor, not the campaign.

---

## The one thing that can break this calendar

Not multiplayer, and no longer audio — both have run and held. What is left is
the thing this whole calendar was built around: **the 250 highly engaged
players**. Nothing in the build affects it, no harness can measure it, and it is
the only gate between the game and the audience where Roblox's volume actually
is. Five weeks of organic soft launch is the plan's entire answer, and if the
counter tracks well below the 5,000–12,500 unique players that gate implies,
the response is to pull the paid push earlier rather than to add features.

There is roughly **two weeks of slack** in this plan against the 31 October
beat. Spend it on the device pass and the video, not on scope.
