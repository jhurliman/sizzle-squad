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

| From | Phase | Purpose | Gate to advance |
|---|---|---|---|
| **Thu 27 Aug** | **Close the blockers** | The unshipped work below | Two-client test green; device pass green |
| **Sat 12 Sep** | **Friends & family** | Funnel diagnosis, not reach | First-round completion ≥ 90% |
| **Sat 26 Sep** | **Soft launch** — public, no spend | Earn the 250; prove retention | D1 ≥ 25%, session ≥ 12 min, rounds/session ≥ 3, like ratio ≥ 90% |
| **Sat 17 Oct** | **Paid push** — sponsored spend begins | Buy volume into a funnel now known to hold | Cost per retained player is sane |
| **Sat 31 Oct** | **Halloween beat** — "Spooky Shift" | The event, at full audience reach | — |

### 27 Aug – 12 Sep · Close the blockers (2.2 weeks)

Everything here is already tracked; this phase just puts a date on it.

1. ~~**Two real clients.**~~ **DONE.** Several multiplayer sessions run: the
   First Shift teleport out and back, drop-in seating, nametags, the wardrobe
   and the shared kitchen all behave. This was the single largest unknown in
   the project and it is no longer open.
2. **Device pass** at 896×414 and at 375px height — the wardrobe preview and
   the full menu. Most Roblox play is mobile; this is a first-impression gate.
   Localized text fit (German, Japanese) belongs in the same pass.
3. **Thumbnails: 6–8 total.** One is uploaded, and three 1920×1080 detail-page
   variants are rendered in `roblox/game-banner/`. Priority order is in
   `STORE-LISTING.md`. Do not fill all ten — that correlates *negatively* with
   CCU in the sampled top-19.
4. **Gameplay video** (~30s, no voice-over, no overlay text reading as an ad).
   Only 3 of 19 top experiences have one, and all three sit in slot one because
   Roblox auto-promotes an approved video ahead of the stills. This is the
   cheapest available differentiator on the whole store page.
5. **Confirm "Publishing tier at risk" clears** after the fee and the next
   publish. That reading was inference, not documentation — if it persists, it
   needs re-investigating before anything else ships.
6. ~~**Set `Config.FOUNDING_CHEF_UNTIL`.**~~ **DONE** — `2026-11-08`.

### 12 Sep – 26 Sep · Friends & family (2 weeks)

20–50 players via private links. **This phase cannot move the 250 counter and
should not be judged on reach.** Its only job is to find the biggest drop in
join → first round → second round, while the audience is small enough to
actually talk to.

### 26 Sep – 17 Oct · Soft launch (3 weeks)

Public, listed, **no paid spend**. Two jobs at once:

- **Earn the 250.** Five weeks of organic traffic before Halloween is the
  entire reason this date is where it is.
- **Prove the funnel holds** before any money goes into it, against the metric
  gates in the table.

Watch the highly-engaged counter weekly. If it is tracking far below the
5,000–12,500 estimate implied above, that is the signal to pull the paid push
earlier rather than later — paid traffic feeds the same counter.

### 17 Oct – 31 Oct · Paid push (2 weeks)

Sponsored spend starts **only after the retention gates pass**. The gates are
not bureaucracy; they are the leak detector. Paying to pour traffic into a
funnel with a 40% first-round completion rate converts Robux into nothing at a
very reliable rate, and the D1 number is what tells you the difference.

Start small, measure cost per *retained* player rather than per click, and
scale only that.

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
