# Sizzle Squad — adaptive music stems

Four seamless-looping mono WAVs (44.1kHz) rendered from the web game's
tickMusic score (src/audio/audio.ts) at a fixed tempo of 128, loop
length 7.50s. Upload each, then fill the ids into
roblox-game/game-src/client/Music.luau STEM_IDS.

The client plays all four in sync and cross-fades volume:
- base    : always on (the bed)
- groove  : fades in with heat (round progress)
- melody  : fades in with heat, ducks out at high tension
- tension : fades in as patience drains

They are beat-aligned (same tempo/length) so they layer without phasing.
