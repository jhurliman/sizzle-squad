// GAIN STAGING FOR MUSIC.LUAU — from measurement, not from a guess.
//
// Music.luau multiplies each stem by (target gain) x MASTER. The stems are
// real music now, with ~13 dB more crest factor than the sine stems the old
// constants were tuned for, so matching PEAK made the bed inaudible while
// matching LOUDNESS would clip. This measures the actual combinations the
// game plays and prints the MASTER and lobby gain that satisfy both.
//
//   node gain-staging.mjs   (run from roblox/music)
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../audio-out/music');
const f = (n) => path.join(DIR, `music_${n}.wav`);

function mix(names, gains) {
  const inputs = names.flatMap((n) => ['-i', f(n)]);
  const chain = names.map((_, i) => `[${i}:a]volume=${gains[i]}[g${i}]`).join(';');
  const maps = names.map((_, i) => `[g${i}]`).join('');
  const fc = `${chain};${maps}amix=inputs=${names.length}:normalize=0,astats=measure_overall=Peak_level+RMS_level:measure_perchannel=none`;
  // astats reports on stderr; capture that.
  const out = execFileSync('sh', ['-c', `ffmpeg -hide_banner ${inputs.map((a) => `'${a}'`).join(' ')} -filter_complex "${fc}" -f null - 2>&1`]).toString();
  const g = (re) => Number((out.match(re) || [])[1]);
  return { peak: g(/Peak level dB: (-?[\d.]+)/), rms: g(/RMS level dB: (-?[\d.]+)/) };
}
const lin = (db) => 10 ** (db / 20);

// Per-stem target gains as Music.luau will apply them at full heat. These are
// the mix decision; MASTER is derived from them.
const G = { base: 0.85, groove: 1.2, melody: 1.15, tension: 1.0 };

// The mixes Music.luau actually produces at those gains.
const cases = {
  'lobby (base only)':                 [['base'], [G.base]],
  'round start (base+groove)':         [['base', 'groove'], [G.base, G.groove]],
  'hook (base+groove+melody)':         [['base', 'groove', 'melody'], [G.base, G.groove, G.melody]],
  'desperate (base+groove+tension)':   [['base', 'groove', 'tension'], [G.base, G.groove, G.tension]],
  'worst case (all four)':             [['base', 'groove', 'melody', 'tension'], [G.base, G.groove, G.melody, G.tension]],
};
console.log('gains:', JSON.stringify(G));
console.log('pre-MASTER, at Music.luau target gains:');
let worstPeak = -Infinity;
const results = {};
for (const [name, [names, gains]] of Object.entries(cases)) {
  const r = mix(names, gains);
  results[name] = r;
  worstPeak = Math.max(worstPeak, r.peak);
  console.log(`  ${name.padEnd(34)} peak ${r.peak.toFixed(1).padStart(6)} dBFS   rms ${r.rms.toFixed(1).padStart(6)} dB`);
}

// The old bed, for reference: sine stems peaking 0.26 with MASTER 1.6 and
// lobby gain 0.35. Sines have ~3 dB crest, so RMS ~ peak - 3.
const oldLobbyRms = 20 * Math.log10(0.26 * 1.6 * 0.35) - 3;
console.log(`\nold sine bed in the lobby: ~${oldLobbyRms.toFixed(1)} dB RMS  (what players were used to)`);

// MASTER: the loudest realistic combination must stay under -1 dBFS.
const master = Math.min(1.0, lin(-1) / lin(worstPeak));
console.log(`\nMASTER = ${master.toFixed(2)}   (worst-case sum peaks ${worstPeak.toFixed(1)} dBFS -> ${(worstPeak + 20 * Math.log10(master)).toFixed(1)} dBFS after MASTER)`);

// Lobby gain: bring the lobby bed to the old loudness under that MASTER.
const baseRms = results['lobby (base only)'].rms;
console.log(`lobby bed  = ${(baseRms + 20 * Math.log10(master)).toFixed(1)} dB RMS after MASTER  (old sine bed ~${oldLobbyRms.toFixed(1)})`);
for (const [name, r] of Object.entries(results)) console.log(`  ${name.padEnd(34)} -> ${(r.rms + 20 * Math.log10(master)).toFixed(1)} dB RMS, peak ${(r.peak + 20 * Math.log10(master)).toFixed(1)} dBFS`);
