// "SERVICE STARTS NOW" — the loop, arranged into a song.
//
// compose.mjs is the 8-bar loop the GAME plays: four stems it cross-fades by
// heat and tension. This takes those same parts and deploys them over ~3:25
// with intent — an intro that is the lobby, a hook, a turn to the relative
// minor, a percussion break that is the track's signature moment, a final
// chorus, an outro. The only genuinely new material is the B section; the
// rest is the loop's own parts, placed.
//
//   node arrange.mjs        -> song-v1.mid (+ a section map)
//
// Sections are 8-bar phrases. Bars are 1-based; beats are 0-based quarter
// notes, so bar b starts at beat (b - 1) * 4.
//
//   bars   1-16   Intro       Rhodes + shaker, then bass. The lobby.
//   bars  17-24   Lift        drums enter; fill into the hook
//   bars  25-40   A  Hook     everything, twice; clock joins the second pass
//   bars  41-56   B  Turn     Am-F-C-G. Kick drops for 8, returns; riser
//   bars  57-72   A' Hook     everything + clock throughout
//   bars  73-80   Kitchen     drums, shaker, bass; knife-chops and pot lids
//   bars  81-96   A'' Final   everything; lead doubled an octave up, 2nd pass
//   bars  97-104  Outro       drums out; thins to Rhodes; final hit + ring
import fs from 'node:fs';
import path from 'node:path';
import {
  STEMS, BPM, PPQ, n, tile, bassCell, CHORDS, drumBar,
  KICK, SNARE, CLAP, RIM, CHAT, OHAT, CRASH, trackChunk, tempoMeta, str, u32, u16,
} from './compose.mjs';

const bar = (b) => (b - 1) * 4;
const SONG_BARS = 104;
const END_BAR = 105; // the final hit lands on the downbeat after the last phrase
const SONG_BEATS = bar(END_BAR) + 8; // ring-out room

// ---------------------------------------------------------------- helpers

/** Shift a list of notes so it starts at `atBar`. */
const place = (notes, atBar) => notes.map((e) => ({ ...e, start: e.start + bar(atBar) }));
/** Lay the 32-beat loop down `times` times from `atBar`. */
const loopAt = (notes, atBar, times = 1) => {
  const out = [];
  for (let i = 0; i < times; i++) out.push(...place(notes, atBar + i * 8));
  return out;
};
const up = (notes, semis) => notes.map((e) => ({ ...e, pitch: e.pitch + semis }));
const only = (notes, pitches) => notes.filter((e) => pitches.includes(e.pitch));
const without = (notes, pitches) => notes.filter((e) => !pitches.includes(e.pitch));

// The loop's own parts, as 32-beat cells.
const L = {
  bass: STEMS.base[0].notes,
  comp: STEMS.base[1].notes,
  shaker: STEMS.base[2].notes,
  drums: STEMS.groove[0].notes,
  lead: STEMS.melody[0].notes,
  clock: STEMS.tension[0].notes,
  riser: STEMS.tension[1].notes,
};

// ---------------------------------------------------------- B: the turn
//
// vi - IV - I - V. The relative minor is the classic lift: same notes, darker
// door. The bass drops to A1 so the section opens with weight, and the lead's
// first two bars are new before it folds back into the hook's own phrases —
// familiar with a twist, which is what a B section is for.
const CHORDS_B = [
  { root: -3, beats: 8, voicing: [64, 67, 69, 72], minor: true },  // Am7 (E G A C), bass A1
  { root: 5,  beats: 8, voicing: [65, 69, 72, 76], minor: false }, // Fmaj9
  { root: 0,  beats: 8, voicing: [64, 67, 71, 74], minor: false }, // Cmaj9
  { root: 7,  beats: 8, voicing: [65, 67, 71, 74], minor: false }, // G7
];

function bassFor(chords) {
  const out = [];
  let t = 0;
  for (const ch of chords) {
    for (const e of bassCell(36 + ch.root, ch.minor ? 3 : 4)) out.push({ ...e, start: e.start + t });
    t += ch.beats;
  }
  return out;
}
function compFor(chords) {
  const out = [];
  let t = 0;
  for (const ch of chords) {
    for (let b = 0; b < ch.beats / 4; b++) {
      const at = t + b * 4;
      for (const p of ch.voicing) {
        out.push(n(p, at + 0.0, 0.2, 78), n(p, at + 1.5, 0.45, 88), n(p, at + 2.5, 0.3, 80), n(p, at + 3.5, 0.4, 90));
      }
    }
    t += ch.beats;
  }
  return out;
}
const bassB = bassFor(CHORDS_B);
const compB = compFor(CHORDS_B);

const C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81, B5 = 83, C6 = 84, B4 = 71;
const leadB = [
  // bars 1-2 (Am): new — the same pickup shape, landing on the minor's own notes
  n(E5, 0.75, 0.25, 96), n(A5, 1.0, 0.5, 108),                n(C6, 2.75, 0.25, 94), n(A5, 3.0, 0.75, 100),
  n(G5, 4.75, 0.25, 92), n(E5, 5.0, 0.5, 96),  n(C5, 6.0, 1.0, 100),
  // bars 3-4 (F): the hook's own F phrase
  n(F5, 8.75, 0.25, 96), n(A5, 9.0, 0.5, 108),                n(C6, 10.75, 0.25, 94), n(A5, 11.0, 0.75, 100),
  n(G5, 12.75, 0.25, 92), n(F5, 13.0, 0.5, 96), n(E5, 14.0, 0.5, 98), n(D5, 14.5, 0.5, 92),
  // bars 5-6 (C): the hook comes home
  n(E5, 16.75, 0.25, 98), n(G5, 17.0, 0.5, 110),               n(A5, 18.75, 0.25, 94), n(G5, 19.0, 0.75, 102),
  n(E5, 20.75, 0.25, 92), n(D5, 21.0, 0.5, 96), n(C5, 22.0, 1.0, 100),
  // bars 7-8 (G): the hook's own turnaround
  n(D5, 24.75, 0.25, 98), n(G5, 25.0, 0.5, 110),               n(B5, 26.75, 0.25, 96), n(A5, 27.0, 0.75, 102),
  n(G5, 28.75, 0.25, 96), n(F5, 29.0, 0.5, 96), n(E5, 29.5, 0.25, 92), n(D5, 29.75, 0.25, 92), n(B4, 30.0, 1.5, 104),
];

// --------------------------------------------------------------- drums
//
// Variants of the one bar. Names say what they are for.
const drumsFull = L.drums;
const drumsLite = tile(only(drumBar, [KICK, CHAT]), 4);       // the lift: kick and closed hats
const drumsNoKick = tile(without(drumBar, [KICK]), 4);         // the breakdown: everything but the floor

/** A fill on the last bar before `atBar`: a snare build over beats 3-4, a pair of rims. */
function fill(atBar) {
  const b = bar(atBar) - 4;
  const out = [];
  for (let i = 0; i < 8; i++) out.push(n(SNARE, b + 2 + i * 0.25, 0.12, 62 + i * 7));
  out.push(n(RIM, b + 1.5, 0.15, 96), n(RIM, b + 1.75, 0.15, 100));
  return out;
}

/** The kitchen: knife-chops and pot lids over the last four bars of the break. */
function kitchen(atBar) {
  const b = bar(atBar);
  const out = [];
  // bars 5-6 of the phrase: rims on every 16th, alternating
  for (let i = 0; i < 32; i++) out.push(n(RIM, b + 16 + i * 0.25, 0.1, i % 2 === 0 ? 78 : 54));
  // bars 7-8: rims keep going louder, pot-lid claps on every beat
  for (let i = 0; i < 32; i++) out.push(n(RIM, b + 24 + i * 0.25, 0.1, i % 2 === 0 ? 92 : 64));
  for (let i = 0; i < 8; i++) out.push(n(CLAP, b + 24 + i, 0.2, 96));
  return out;
}

// ----------------------------------------------------------- the song

const T = { bass: [], comp: [], shaker: [], drums: [], lead: [], clock: [], riser: [] };

// Intro 1-16
T.comp.push(...loopAt(L.comp, 1, 2));
T.shaker.push(...loopAt(L.shaker, 1, 2));
T.bass.push(...loopAt(L.bass, 9, 1));

// Lift 17-24
T.comp.push(...loopAt(L.comp, 17));
T.shaker.push(...loopAt(L.shaker, 17));
T.bass.push(...loopAt(L.bass, 17));
T.drums.push(...place(drumsLite, 17).filter((e) => e.start < bar(21)));
T.drums.push(...place(drumsFull, 21).filter((e) => e.start >= bar(21) && e.start < bar(25)));
T.drums.push(...fill(25));

// A — hook 25-40
for (const k of ['bass', 'comp', 'shaker', 'lead']) T[k].push(...loopAt(L[k], 25, 2));
T.drums.push(...loopAt(L.drums, 25, 2), ...fill(41));
T.clock.push(...loopAt(L.clock, 33));

// B — turn 41-56
T.bass.push(...loopAt(bassB, 41, 2));
T.comp.push(...loopAt(compB, 41, 2));
T.shaker.push(...loopAt(L.shaker, 41, 2));
T.lead.push(...loopAt(leadB, 41, 2));
T.drums.push(...loopAt(drumsNoKick, 41), ...loopAt(L.drums, 49), ...fill(57));
T.riser.push(...loopAt(L.riser, 49)); // lands on bars 55-56

// A' — hook 57-72
for (const k of ['bass', 'comp', 'shaker', 'lead', 'clock']) T[k].push(...loopAt(L[k], 57, 2));
T.drums.push(...loopAt(L.drums, 57, 2), ...fill(73));

// Kitchen 73-80
T.bass.push(...loopAt(L.bass, 73));
T.shaker.push(...loopAt(L.shaker, 73));
T.drums.push(...loopAt(L.drums, 73), ...kitchen(73));
T.riser.push(...loopAt(L.riser, 73)); // bars 79-80, under the pot lids

// A'' — final 81-96
for (const k of ['bass', 'comp', 'shaker', 'lead', 'clock']) T[k].push(...loopAt(L[k], 81, 2));
T.lead.push(...loopAt(up(L.lead, 12), 89)); // the octave, second pass only
T.drums.push(...loopAt(L.drums, 81, 2), ...fill(97));

// Outro 97-104
T.comp.push(...loopAt(L.comp, 97));
T.shaker.push(...loopAt(L.shaker, 97).filter((e) => e.start < bar(101)));
T.bass.push(...loopAt(L.bass, 97).filter((e) => e.start < bar(101)));

// The hit. Everything lands on the downbeat of 105 and rings.
const hit = bar(END_BAR);
for (const p of [64, 67, 71, 74]) T.comp.push(n(p, hit, 6, 100));
T.bass.push(n(36, hit, 6, 110));
T.drums.push(n(KICK, hit, 0.5, 118), n(CRASH, hit, 6, 110));

// ----------------------------------------------------------- MIDI out

const TRACKS = [
  ['bass',   0, T.bass],
  ['comp (Rhodes)', 1, T.comp],
  ['shaker (SIZZLE)', 9, T.shaker],
  ['drums+kitchen', 9, T.drums],
  ['lead', 2, T.lead],
  ['clock (ride)', 9, T.clock],
  ['riser', 5, T.riser],
];

export const SONG = Object.fromEntries(TRACKS.map(([name, channel, notes]) => [name, { channel, notes }]));
export { SONG_BEATS, SONG_BARS, BPM };

const SECTIONS = [
  [1, 'Intro'], [17, 'Lift'], [25, 'A — Hook'], [41, 'B — Turn'], [57, "A' — Hook"],
  [73, 'Kitchen'], [81, "A'' — Final"], [97, 'Outro'], [105, 'Hit'],
];
export { SECTIONS, bar };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const chunks = TRACKS.map(([name, ch, notes], i) => trackChunk(name, ch, notes, i === 0 ? tempoMeta : [], SONG_BEATS));
  const file = Buffer.from([...str('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ), ...chunks.flat()]);
  const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'song-v1.mid');
  fs.writeFileSync(out, file);
  const secs = (SONG_BEATS * 60) / BPM;
  console.log(`wrote ${path.basename(out)}  (${file.length} bytes)  ${SONG_BARS} bars + hit, ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')} at ${BPM}`);
  for (const [b, name] of SECTIONS) {
    const t = ((b - 1) * 4 * 60) / BPM;
    console.log(`  bar ${String(b).padStart(3)}  ${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}  ${name}`);
  }
  for (const [name, , notes] of TRACKS) console.log(`  ${name.padEnd(18)} ${notes.length} notes`);
}
