# Sizzle Squad — soundtrack direction

*The adaptive stem system (`Music.luau` + `render-music.mjs`) is good and stays.
What changes is the content: the four stems are currently a sine lead over
hat/kick primitives, which is where the "mid-80s Atari" reads from. This is the
brief for what replaces them.*

## What the music has to do

Four jobs, in priority order. They pull in different directions and the
direction below is the one that serves all four.

1. **Be a mind-worm.** A hook you can hum after one round. This is the whole
   point — a track that is merely *pleasant* fails.
2. **Work as a TikTok / Shorts sound.** A ~15s excerpt with the hook in the
   first two seconds, that loops without a seam, that someone can put over
   their own clip. The sound has to be *identifiably this game's* — otherwise
   it is just another funky loop and does nothing for acquisition.
3. **Survive the lobby.** People sit in Start Shift waiting for friends. The
   bed alone (no drums, no lead) has to be something you'd leave on.
4. **Survive ten shifts in a row.** Three-minute rounds, over and over. Nothing
   grating, nothing that peaks too hard, nothing whose hook wears out in an
   hour.

## The direction: bouncy funk-house with a kitchen in the drum kit

**Genre.** Playful disco-funk / house. Four-on-the-floor, syncopated bass,
Rhodes-and-clav comping, brass-style stabs, a whistle-able lead. Think the
register of *Splatoon* and *Jet Set Radio* pointed at a kitchen, or the energy
Fall Guys sits in — the dominant "fun multiplayer game" sound on short-form
video right now, which is not an accident.

Why this and not the alternatives:

- **Cartoon big-band swing** (Cuphead) matches the chunky animal chefs
  beautifully and is *very* distinctive, but it adaptive-layers badly — swing
  drums either play or they don't, there is no "30% swing" — and it is not a
  sound people dance to on TikTok. Runner-up; worth a stinger or the results
  screen, not the main loop.
- **Chiptune-but-good** (Shovel Knight, Undertale) keeps the retro thread but
  the retro thread is exactly what tested as grating. Not worth the risk.
- **Lo-fi jazz** is perfect for the lobby and a non-starter for the other three
  jobs.

Funk-house is the only one that scores on all four: it loops by nature, it
layers by nature (bed / drums / lead is how the genre is *built*), it is bouncy
in a way that matches the hop animations, and the hook lives in a bass line
and a lead that can both be sung.

**The signature: the kitchen is the drum kit.** This is what makes it *Sizzle
Squad's* sound rather than a funky loop:

| Kit piece | Kitchen source |
|---|---|
| hi-hat / shaker | **sizzle** — a pan of bacon, gated to the grid |
| rimshot / side-stick | **knife chop** on a board |
| snare layer | **pot lid** clap |
| crash | **pot lid** thrown, ringing |
| percussion fills | **whisk in a bowl**, **plates stacking** |
| the vocal stab | a chopped, pitched **"sizzle!"** on the downbeat |

None of these replace the real drums — they sit *on* them, so the groove stays
tight and the kitchen is the flavour. But in the 15-second excerpt, the thing
people will notice is that the hi-hat is bacon. That is the identity.

**Tempo: 124 BPM, 8-bar loop.** 8 bars at 124 is **15.48 seconds** — the
length of a TikTok sound, with room for a real call-and-response phrase
instead of the current 4-bar sine figure. `LOOP_SECONDS` in `Music.luau` goes
from 7.5 to 15.484. 124 rather than the current 128 because 128 is a hair
frantic for a lobby and the bounce sits better a touch slower.

**Key: C major, leaning Mixolydian** (the ♭7 shows up in the bass). Bright,
warm, and the brass-stab clichés all live here.

**The hook is the name.** *SIZ-zle SQUAD* is short-short-LONG, and the lead's
opening motif is exactly that rhythm as a rising fourth — **G G C** — the most
sing-able interval there is. Every four bars it comes back, once a step higher
over the Dm. The bass has its own hook underneath: a two-bar funk cell with an
octave pop and a chromatic ♭7 walk that repeats on each chord root.

**Progression: C (2 bars) → F (2) → Dm (2) → G (2).** Deliberately plain.
The turnaround G→C is what makes the loop feel like it never ends, which is
what a lobby needs and what a TikTok sound needs.

## How it maps onto the four stems

The stem roles are unchanged so `Music.luau`'s cross-fading needs no logic
change, only new asset ids and the loop length.

| Stem | Content | Alone, it is… |
|---|---|---|
| **base** | bass riff, Rhodes/clav comp, 16th shaker (the *sizzle*) | the lobby. Has to be something you'd leave on. |
| **groove** | kick, snare + pot-lid clap, offbeat open hats, knife-chop rim | the round starting |
| **melody** | the lead hook + the "sizzle!" vocal stab | the earworm |
| **tension** | sub drone, heartbeat, a filtered riser | the dread |

`melody` ducks at high tension exactly as it does today; that logic is right.

## What "done" looks like

- `roblox/music/hook-v1.mid` — the composition, regenerable from `compose.mjs`
- An Ableton set with the four stems on their own tracks and real instruments
  on them (this is the part that needs ears, not a script)
- Four WAVs, beat-locked, seamless at the 15.484s boundary, rendered with the
  same TAIL-wrap trick `render-music.mjs` already uses
- Uploaded, ids into `STEM_IDS`, `LOOP_SECONDS = 15.484`
- Then: measure. The funnel now records `playSeconds` and `reach` per player,
  so a soundtrack change can be read against session length rather than
  guessed at.

## A note on what this can and can't move

The 76% of new players who never finish a shift mostly leave inside the first
minute, and a lot of them before the music has registered. A better track is
unlikely to move *that* number much; the funnel will say where those players
actually go. What music plausibly moves is the other side — lobby dwell,
multi-round sessions, and whether anyone shares a clip — which is where the
retention that matters lives anyway.
