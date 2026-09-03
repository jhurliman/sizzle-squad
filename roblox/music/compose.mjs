// SIZZLE SQUAD — the hook, as data.
//
// Writes hook-v1.mid: an 8-bar loop at 124 BPM in C, arranged as the four
// stems Music.luau cross-fades (base / groove / melody / tension), one MIDI
// track per stem so it drops straight onto four Ableton tracks. The point of
// keeping it as a script rather than a .mid is that the composition is
// readable and tweakable here — change a note, re-run, re-import.
//
//   node compose.mjs        -> hook-v1.mid (+ a summary)
//
// See DIRECTION.md for why it sounds the way it does. In one line: bouncy
// funk-house, the kitchen is the drum kit, and the lead's opening motif is the
// name — SIZ-zle SQUAD, short-short-LONG, as a rising fourth.
//
// Beats are quarter notes. 8 bars = 32 beats. The loop point is beat 32.
import fs from 'node:fs';
import path from 'node:path';

const BPM = 124;
const BARS = 8;
const LOOP = BARS * 4;
const PPQ = 480;

// ---------------------------------------------------------------- helpers

/** A note. `start`/`dur` in beats. */
const n = (pitch, start, dur, vel = 100) => ({ pitch, start, dur, vel });

/** Repeat a one-bar (or n-bar) cell across the loop. */
function tile(cell, cellBeats, count = LOOP / cellBeats) {
  const out = [];
  for (let i = 0; i < count; i++) {
    for (const e of cell) out.push({ ...e, start: e.start + i * cellBeats });
  }
  return out;
}

/** Transpose a cell by semitones. */
const up = (cell, semis) => cell.map((e) => ({ ...e, pitch: e.pitch + semis }));

// Pitches (MIDI): C2=36 … C4=60 … C5=72
const C2 = 36, C4 = 60;

// --------------------------------------------------------------- harmony
//
// C (2 bars) -> F (2) -> Dm (2) -> G (2). Plain on purpose: the G->C
// turnaround is what makes the loop feel endless.
const CHORDS = [
  { root: 0,  beats: 8,  voicing: [64, 67, 71, 74], minor: false }, // Cmaj9
  { root: 5,  beats: 8,  voicing: [65, 69, 72, 76], minor: false }, // Fmaj9
  { root: 2,  beats: 8,  voicing: [65, 69, 72, 76], minor: true  }, // Dm9 (F A C E)
  { root: 7,  beats: 8,  voicing: [65, 67, 71, 74], minor: false }, // G7
];

// ------------------------------------------------------------------ BASE
//
// The lobby. Bass + comp + shaker; has to stand alone.

// v2. The first bass was a two-bar FUNK cell -- octave pops, a chromatic b7
// walk, thirteen notes -- and once the Rhodes and the drums were in it was
// the odd channel out; the track sounded better with it off. Same lesson as
// the lead: this has settled into something smoother than funk, and a busy
// line fights the comp instead of holding it up.
//
// So: a HOUSE bass. Sustained roots locked to the kick, the classic push on
// the "and" of 3 and 4, and one pickup (the fifth) into each chord change.
// Six notes a chord instead of thirteen. It is a floor, not a soloist.
function bassCell(R, _third) {
  return [
    n(R,     0.0, 1.5, 104),
    n(R,     2.5, 0.5,  88),
    n(R,     3.5, 0.5,  92),
    n(R,     4.0, 1.5, 104),
    n(R,     6.5, 0.5,  88),
    n(R + 7, 7.5, 0.5,  86), // the fifth, leaning into the next root
  ];
}
const bass = [];
{
  let t = 0;
  for (const ch of CHORDS) {
    for (const e of bassCell(C2 + ch.root, ch.minor ? 3 : 4)) bass.push({ ...e, start: e.start + t });
    t += ch.beats;
  }
}

// Comp: Rhodes / clav stabs on the classic funk placements — a short one on
// the downbeat, then the "and of 2", "3", and "and of 4".
const comp = [];
{
  let t = 0;
  for (const ch of CHORDS) {
    for (let bar = 0; bar < ch.beats / 4; bar++) {
      const b = t + bar * 4;
      for (const p of ch.voicing) {
        comp.push(n(p, b + 0.00, 0.20, 78));
        comp.push(n(p, b + 1.50, 0.45, 88));
        comp.push(n(p, b + 2.50, 0.30, 80));
        comp.push(n(p, b + 3.50, 0.40, 90));
      }
    }
    t += ch.beats;
  }
}

// Shaker: straight 16ths with 8th accents. THIS is the sizzle — in the
// Ableton set, this lane gets the gated bacon pan, not a shaker sample.
const shaker = tile(
  Array.from({ length: 16 }, (_, i) => n(82, i * 0.25, 0.12, i % 2 === 0 ? 72 : 50)),
  4,
);

// ---------------------------------------------------------------- GROOVE
//
// The round starting. Kick / snare / hats / the kitchen.
// GM drum map (ch 10): 36 kick, 38 snare, 39 clap, 37 rim, 42 closed hat,
// 46 open hat, 49 crash, 41 low tom.
const KICK = 36, SNARE = 38, CLAP = 39, RIM = 37, CHAT = 42, OHAT = 46, CRASH = 49;

const drumBar = [
  // four on the floor
  n(KICK, 0, 0.25, 116), n(KICK, 1, 0.25, 104), n(KICK, 2, 0.25, 112), n(KICK, 3, 0.25, 104),
  // backbeat: snare + pot-lid clap layered
  n(SNARE, 1, 0.25, 104), n(CLAP, 1, 0.25, 92),
  n(SNARE, 3, 0.25, 108), n(CLAP, 3, 0.25, 96),
  // house offbeat open hats
  n(OHAT, 0.5, 0.35, 84), n(OHAT, 1.5, 0.35, 80), n(OHAT, 2.5, 0.35, 84), n(OHAT, 3.5, 0.35, 82),
  // closed hats in the gaps
  n(CHAT, 0.25, 0.1, 48), n(CHAT, 0.75, 0.1, 56), n(CHAT, 1.25, 0.1, 48), n(CHAT, 1.75, 0.1, 56),
  n(CHAT, 2.25, 0.1, 48), n(CHAT, 2.75, 0.1, 56), n(CHAT, 3.25, 0.1, 48), n(CHAT, 3.75, 0.1, 56),
  // the knife: syncopated rim/side-stick chops
  n(RIM, 1.75, 0.15, 94), n(RIM, 3.25, 0.15, 90),
];
const drums = tile(drumBar, 4);
// crashes (pot lid) on the top of each 4-bar phrase
drums.push(n(CRASH, 0, 1.5, 100), n(CRASH, 16, 1.5, 96));
// a little fill into the loop point: two extra rims and a kick pickup
drums.push(n(RIM, 30.5, 0.15, 96), n(RIM, 30.75, 0.15, 100), n(KICK, 31.5, 0.25, 108));

// ---------------------------------------------------------------- MELODY
//
// v2. The first lead was a sung-style diatonic tune (G G C, "SIZ-zle SQUAD")
// and it read as a kids' jingle over this groove -- the set was better with it
// muted. That is the right instinct about the genre: funk hooks are not sung
// melodies, they are short riffs that poke into the gaps the comp leaves.
//
// So: pentatonic, sparse (4-5 notes a bar, plenty of rests), and placed OFF
// the Rhodes stabs -- a pickup on the "a" of beat 1 landing on beat 2, an
// answer around beat 4. The last note of the loop is B, the leading tone,
// so the loop pulls itself back round to C.
const C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81, B5 = 83, C6 = 84, B4 = 71;

const lead = [
  // bar 1 (C): pickup into beat 2, answer on 4
  n(E5, 0.75, 0.25, 96), n(G5, 1.0, 0.5, 108),                  n(A5, 2.75, 0.25, 92), n(G5, 3.0, 0.75, 100),
  // bar 2: fall home, then space
  n(E5, 4.75, 0.25, 92), n(D5, 5.0, 0.5, 96),  n(C5, 6.0, 1.0, 100),
  // bar 3 (F)
  n(F5, 8.75, 0.25, 96), n(A5, 9.0, 0.5, 108),                  n(C6, 10.75, 0.25, 94), n(A5, 11.0, 0.75, 100),
  // bar 4: the maj7 (E over F) is the colour note
  n(G5, 12.75, 0.25, 92), n(F5, 13.0, 0.5, 96), n(E5, 14.0, 0.5, 98), n(D5, 14.5, 0.5, 92),
  // bar 5 (Dm): same shape a step up -- the lift
  n(D5, 16.75, 0.25, 98), n(F5, 17.0, 0.5, 110),                n(A5, 18.75, 0.25, 94), n(G5, 19.0, 0.75, 102),
  // bar 6
  n(F5, 20.75, 0.25, 92), n(E5, 21.0, 0.5, 96), n(D5, 22.0, 1.0, 100),
  // bar 7 (G)
  n(D5, 24.75, 0.25, 98), n(G5, 25.0, 0.5, 110),                n(B5, 26.75, 0.25, 96), n(A5, 27.0, 0.75, 102),
  // bar 8: run down to the leading tone and hold it -- B wants C, and C is beat 1
  n(G5, 28.75, 0.25, 96), n(F5, 29.0, 0.5, 96), n(E5, 29.5, 0.25, 92), n(D5, 29.75, 0.25, 92), n(B4, 30.0, 1.5, 104),
];

// The vocal stab. A chopped, pitched "SIZZLE!" on the top of each phrase —
// its own track so it gets its own sampler. One note = one trigger.
const stab = [n(C4, 0, 0.5, 120), n(C4, 16, 0.5, 116)];

// --------------------------------------------------------------- TENSION
//
// The dread. A sub drone, a heartbeat, and a riser that resolves at the loop.
const drone = [n(48, 0, LOOP, 96)]; // Live's C2 (~130 Hz). 24 and 36 were both inaudible on speakers
const heartbeat = tile([n(41, 0.0, 0.3, 104), n(41, 0.5, 0.3, 84)], 4); // lub-dub, low tom
// riser: ONE note for a slow-attack pad to swell on over the last two bars.
// The chromatic climb this replaced read as "weird metallic" -- a riser is a
// filter opening, not a scale, and that is the instrument's job not MIDI's.
// Three stacked notes entering in turn over the last bar and a half: the
// octave and the fifth arriving mid-swell are what make it RISE rather than
// merely swell -- a single held note read as too slow and not high enough.
const riser = [n(55, 26, 6, 88), n(62, 28, 4, 96), n(67, 29.5, 2.5, 108)];

// ------------------------------------------------------------- MIDI out

function vlq(v) {
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}
const str = (s) => [...Buffer.from(s, 'utf8')];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v) => [(v >>> 8) & 255, v & 255];

function trackChunk(name, channel, notes, extra = []) {
  // absolute-tick events, then sort and delta-encode
  const ev = [];
  // byteLength, not .length: the em dashes in the names are 3 bytes each
  const nameBytes = str(name);
  ev.push({ t: 0, b: [0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes] });
  for (const e of extra) ev.push(e);
  for (const { pitch, start, dur, vel } of notes) {
    const on = Math.round(start * PPQ);
    const off = Math.round((start + dur) * PPQ);
    ev.push({ t: on, b: [0x90 | channel, pitch, vel], k: 1 });
    ev.push({ t: off, b: [0x80 | channel, pitch, 0], k: 0 });
  }
  // note-offs before note-ons at the same tick, so a retrigger works
  ev.sort((a, b) => a.t - b.t || (a.k ?? 0) - (b.k ?? 0));
  const body = [];
  let last = 0;
  for (const e of ev) {
    body.push(...vlq(e.t - last), ...e.b);
    last = e.t;
  }
  body.push(...vlq(Math.max(0, LOOP * PPQ - last)), 0xff, 0x2f, 0x00);
  return [...str('MTrk'), ...u32(body.length), ...body];
}

const tempoMeta = [
  { t: 0, b: [0xff, 0x51, 0x03, ...u32(Math.round(60_000_000 / BPM)).slice(1)] },
  { t: 0, b: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
];

// The composition, grouped the way Music.luau consumes it. `voice` is a hint
// for preview.mjs's placeholder synths and for whoever builds the Ableton set.
export const STEMS = {
  base: [
    { name: 'base — bass',            channel: 0, voice: 'bass',   notes: bass },
    { name: 'base — comp (Rhodes)',   channel: 1, voice: 'ep',     notes: comp },
    { name: 'base — shaker (SIZZLE)', channel: 9, voice: 'drums',  notes: shaker },
  ],
  groove: [
    { name: 'groove — drums+kitchen', channel: 9, voice: 'drums',  notes: drums },
  ],
  melody: [
    { name: 'melody — lead',          channel: 2, voice: 'lead',   notes: lead },
    { name: 'melody — "sizzle!" stab',channel: 3, voice: 'stab',   notes: stab },
  ],
  tension: [
    { name: 'tension — drone',        channel: 4, voice: 'drone',  notes: drone },
    { name: 'tension — heartbeat',    channel: 9, voice: 'drums',  notes: heartbeat },
    { name: 'tension — riser',        channel: 5, voice: 'riser',  notes: riser },
  ],
};
export { BPM, BARS, LOOP };

export function writeMidi(out) {
  const all = Object.values(STEMS).flat();
  const tracks = all.map((t, i) => trackChunk(t.name, t.channel, t.notes, i === 0 ? tempoMeta : []));
  const file = Buffer.from([
    ...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ),
    ...tracks.flat(),
  ]);
  fs.writeFileSync(out, file);
  return file.length;
}

// Run directly: write hook-v1.mid next to this file.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'hook-v1.mid');
  const bytes = writeMidi(out);
  console.log(`wrote ${path.basename(out)}  (${bytes} bytes)`);
  console.log(`  ${BPM} BPM, ${BARS} bars, loop = ${((LOOP * 60) / BPM).toFixed(3)}s`);
  for (const [stem, tracks] of Object.entries(STEMS)) {
    console.log(`  ${stem.padEnd(8)} ` + tracks.map((t) => `${t.name.split('— ')[1]} ${t.notes.length}`).join('  '));
  }
}
