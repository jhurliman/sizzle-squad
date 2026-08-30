# Sizzle Squad SFX — upload pack

Rendered from the web game's own WebAudio synth (src/audio/audio.ts) via
OfflineAudioContext in Chromium. 48kHz 16-bit stereo WAV, silence-trimmed.

Upload each file (Creator Dashboard -> Development Items -> Audio, or Open
Cloud), then fill the asset ids into
roblox-game/game-src/client/Sfx.luau MANIFEST — the key is the filename
without the variant suffix (e.g. chopTick_2.wav -> chopTick). Multiple
variants per key: pick one, or extend Sfx.luau to rotate them (runtime
PlaybackSpeed jitter already varies repeats). serve_combo{1,4,8}.wav are the
combo sweetener tiers.
