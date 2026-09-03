# Sizzle Squad — adaptive music stems

Four seamless-looping stereo WAVs (48 kHz / 24-bit), one loop each: 8 bars
at 124 BPM = 15.483871 s = 743,226 samples. Rendered from the Ableton set
described in `roblox/music/DIRECTION.md` — the stem block at bars 113-120,
"Render as Loop" so bar-8 decays are baked into the head — with the returns
(reverb, delay) included and the master Glue/Limiter bypassed, because the
stems are summed in-game and a limiter applied per-stem breaks that balance.

The composition is `roblox/music/compose.mjs`; the song these were cut from
is `roblox/music/arrange.mjs`. Verify a re-render with
`node roblox/music/check-stems.mjs <base> <groove> <melody> <tension>`.

Upload with `node roblox-game/tools/upload-audio.mjs --force music_` (they go
up as OGG — mp3's encoder padding would gap the loop seam), then fill the ids
into `roblox-game/game-src/client/Music.luau` STEM_IDS.

The client plays all four in sync and cross-fades volume:
- base    : bass, Rhodes, shaker — always on (the bed; the lobby)
- groove  : drums — fades in with heat (round progress)
- melody  : vibes lead — fades in with heat, ducks out at high tension
- tension : clock ride + riser — fades in as patience drains

Music.luau does not sum them at unity. In a round the per-stem gains are
base 0.85, groove 1.2, melody 1.15, tension 1.0 (the drums and lead were
inaudible under the bed at 1.0); in the lobby the base plays alone at 1.0.
At those gains the worst case (all four) peaks at +2.2 dBFS, so MASTER is
0.69 and it lands at -1.0 dBFS, with the lobby bed at -22 dB RMS. Set it by
LOUDNESS, never by peak alone: `node roblox/music/gain-staging.mjs` measures
the real combinations and prints the value. 0.38, matched on peak, made the
lobby bed inaudible.
