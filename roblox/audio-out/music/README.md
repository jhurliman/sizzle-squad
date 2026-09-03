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

Summed at full gain they peak at +1.6 dBFS, so Music.luau's MASTER is 0.38.
