// PREVIEW RENDER — hear the composition without a DAW.
//
// Renders compose.mjs's STEMS to WAV with deliberately simple placeholder
// synths: enough to judge the hook, the bass line, the groove and how the
// layers stack, and nothing more. The real instruments — the Rhodes, the
// bacon-pan hi-hat, the "sizzle!" vocal chop — happen in Ableton. Do not ship
// these; they are the sketch.
//
//   node preview.mjs   -> preview/{base,groove,melody,tension}.wav
//                         preview/mix.wav     (all four, mid-round balance)
//                         preview/lobby.wav   (base only: what the lobby hears)
//
// Every file is exactly one loop, tail-wrapped so it repeats seamlessly —
// the same trick render-music.mjs uses for the shipping stems.
import fs from 'node:fs';
import path from 'node:path';
import { STEMS, BPM, LOOP } from './compose.mjs';

const SR = 44100;
const SPB = 60 / BPM; // seconds per beat
const LOOP_S = LOOP * SPB; // 15.484
const LOOP_N = Math.round(LOOP_S * SR);
const TAIL_N = Math.round(0.6 * SR);
const TOTAL_N = LOOP_N + TAIL_N;

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const TAU = Math.PI * 2;

// Deterministic noise so re-renders are byte-identical.
let seed = 0x5eed;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

// A one-pole lowpass, returned as a stateful function.
const lowpass = (cutoffHz) => {
  let y = 0;
  const a = 1 - Math.exp((-TAU * cutoffHz) / SR);
  return (x) => (y += a * (x - y));
};

// ------------------------------------------------------------- voices
//
// Each voice writes one note into `buf` starting at sample `s0`. `dur` and
// `vel` come from the composition. They are additive, so overlapping notes
// simply sum.

function bass(buf, s0, midi, dur, vel) {
  const f = hz(midi);
  const g = (vel / 127) * 0.55;
  const N = Math.min(buf.length - s0, Math.round((dur * SPB + 0.08) * SR));
  const lp = lowpass(520);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 6) * (t < dur * SPB ? 1 : Math.exp(-(t - dur * SPB) * 60));
    const saw = 2 * ((t * f) % 1) - 1;
    const sub = Math.sin(TAU * f * 0.5 * t);
    buf[s0 + i] += g * env * (lp(saw) * 0.7 + sub * 0.5);
  }
}

function ep(buf, s0, midi, dur, vel) {
  const f = hz(midi);
  const g = (vel / 127) * 0.22;
  const N = Math.min(buf.length - s0, Math.round((dur * SPB + 0.35) * SR));
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t * 4.5);
    const tine = Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2 * t) * Math.exp(-t * 9) + 0.12 * Math.sin(TAU * f * 3.01 * t) * Math.exp(-t * 14);
    const trem = 1 - 0.08 * (0.5 + 0.5 * Math.sin(TAU * 5.5 * t));
    buf[s0 + i] += g * env * trem * tine;
  }
}

function lead(buf, s0, midi, dur, vel) {
  const f = hz(midi);
  const g = (vel / 127) * 0.34;
  const N = Math.min(buf.length - s0, Math.round((dur * SPB + 0.12) * SR));
  const lp = lowpass(2600);
  const hold = dur * SPB;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const vib = 1 + 0.006 * Math.sin(TAU * 5.8 * t) * Math.min(1, t / 0.15);
    const ph = (t * f * vib) % 1;
    const pulse = ph < 0.27 ? 1 : -1; // brassy pulse
    const env = Math.min(1, t / 0.012) * (t < hold ? 1 : Math.exp(-(t - hold) * 28));
    buf[s0 + i] += g * env * lp(pulse * 0.8 + Math.sin(TAU * f * t) * 0.3);
  }
}

function stab(buf, s0, midi, dur, vel) {
  // "SIZZLE!" placeholder: a pitched-up saw chord with a snap of noise.
  const g = (vel / 127) * 0.4;
  const N = Math.min(buf.length - s0, Math.round(0.28 * SR));
  const lp = lowpass(3200);
  const fs = [midi + 12, midi + 16, midi + 19].map(hz);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 11);
    let v = 0;
    for (const f of fs) v += 2 * ((t * f * (1 + 0.15 * Math.exp(-t * 40))) % 1) - 1;
    const snap = rand() * Math.exp(-t * 90) * 0.6;
    buf[s0 + i] += g * env * (lp(v / 3) + snap);
  }
}

function drone(buf, s0, midi, dur, vel) {
  const f = hz(midi);
  const g = (vel / 127) * 0.3;
  const N = Math.min(buf.length - s0, Math.round(dur * SPB * SR));
  const lp = lowpass(140);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.5);
    const v = Math.sin(TAU * f * t) * 0.7 + lp(2 * ((t * f * 2) % 1) - 1) * 0.5;
    buf[s0 + i] += g * env * v * (1 + 0.15 * Math.sin(TAU * 0.25 * t));
  }
}

function riser(buf, s0, midi, dur, vel) {
  const f = hz(midi);
  const g = (vel / 127) * 0.16;
  const N = Math.min(buf.length - s0, Math.round(dur * SPB * SR));
  let y = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const p = i / N;
    const cut = 300 + p * 2200;
    const a = 1 - Math.exp((-TAU * cut) / SR);
    const saw = 2 * ((t * f) % 1) - 1;
    y += a * (saw - y);
    const env = Math.min(1, t / 0.02) * (p < 0.9 ? 1 : 1 - (p - 0.9) / 0.1);
    buf[s0 + i] += g * env * y;
  }
}

// GM drum map -> a small kit. Kitchen pieces are named so the intent is clear
// even though these are all noise and sines.
function drums(buf, s0, midi, _dur, vel) {
  const v = (vel / 127) * 0.62; // the kit stacks four hits on beat 1; keep it out of the clipper
  const put = (N, fn) => {
    N = Math.min(buf.length - s0, N);
    for (let i = 0; i < N; i++) buf[s0 + i] += fn(i / SR, i);
  };
  switch (midi) {
    case 36: // kick: sine pitch-drop
      return put(0.32 * SR, (t) => v * 0.9 * Math.exp(-t * 14) * Math.sin(TAU * (45 + 110 * Math.exp(-t * 55)) * t));
    case 38: // snare: tone + noise
      return put(0.22 * SR, (t) => v * (0.35 * Math.exp(-t * 30) * Math.sin(TAU * 185 * t) + 0.45 * Math.exp(-t * 18) * rand()));
    case 39: { // pot-lid clap: three bursts
      return put(0.24 * SR, (t) => {
        const b = t < 0.01 ? 1 : t < 0.02 ? 0.8 : t < 0.03 ? 0.9 : Math.exp(-(t - 0.03) * 22);
        return v * 0.32 * b * rand();
      });
    }
    case 37: { // knife chop: a bright click
      const lp = lowpass(4000);
      return put(0.06 * SR, (t) => v * 0.5 * Math.exp(-t * 90) * (lp(rand()) * 0.6 + Math.sin(TAU * 900 * t) * 0.4));
    }
    case 42: // closed hat
      return put(0.03 * SR, (t) => v * 0.22 * Math.exp(-t * 160) * hp(rand()));
    case 46: // open hat
      return put(0.16 * SR, (t) => v * 0.2 * Math.exp(-t * 22) * hp(rand()));
    case 49: // pot lid thrown (crash)
      return put(1.4 * SR, (t) => v * 0.18 * Math.exp(-t * 2.4) * hp(rand()));
    case 41: // heartbeat tom
      return put(0.3 * SR, (t) => v * 0.7 * Math.exp(-t * 12) * Math.sin(TAU * (58 + 70 * Math.exp(-t * 40)) * t));
    case 82: { // the SIZZLE (shaker slot): bandpassed noise
      const lp = lowpass(9000);
      return put(0.045 * SR, (t) => v * 0.14 * Math.exp(-t * 70) * hp(lp(rand())));
    }
    default:
      return;
  }
}
// crude highpass for the metallic bits
let hpState = 0;
function hp(x) {
  hpState += 0.35 * (x - hpState);
  return x - hpState;
}

const VOICES = { bass, ep, lead, stab, drone, riser, drums };

// ------------------------------------------------------------- render

function renderStem(tracks) {
  const buf = new Float32Array(TOTAL_N);
  for (const tr of tracks) {
    const voice = VOICES[tr.voice];
    for (const { pitch, start, dur, vel } of tr.notes) {
      voice(buf, Math.round(start * SPB * SR), pitch, dur, vel);
    }
  }
  // Tail-wrap: anything ringing past the loop point folds onto the head, so
  // the file loops seamlessly.
  const out = new Float32Array(LOOP_N);
  for (let i = 0; i < LOOP_N; i++) out[i] = buf[i];
  for (let i = 0; i < TAIL_N; i++) out[i] += buf[LOOP_N + i];
  // Tail-wrap only handles what RINGS past the seam. A voice that is still
  // sustaining at the last sample (the drone) or that starts at full swing
  // on the first (the stab) still steps at the join, and a step is a click.
  // A raised-cosine fade over the last and first few ms brings both ends to
  // zero; 5 ms is below the ear's transient resolution, so the downbeat
  // still lands.
  const XF = Math.round(0.005 * SR);
  for (let i = 0; i < XF; i++) {
    const w = 0.5 - 0.5 * Math.cos((Math.PI * (i + 1)) / (XF + 1));
    out[i] *= w;
    out[LOOP_N - 1 - i] *= w;
  }
  return out;
}

function writeWav(file, data, gain = 1) {
  const pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    // soft clip
    let x = data[i] * gain;
    x = Math.tanh(x * 1.2) / 1.2;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'preview');
fs.mkdirSync(DIR, { recursive: true });

const rendered = {};
for (const [name, tracks] of Object.entries(STEMS)) {
  rendered[name] = renderStem(tracks);
  writeWav(path.join(DIR, `${name}.wav`), rendered[name]);
}

// Mix at a mid-round balance: heat high, tension moderate — roughly what
// Music.luau produces two minutes into a shift.
const mix = new Float32Array(LOOP_N);
const bal = { base: 1.0, groove: 0.9, melody: 0.85, tension: 0.35 };
for (const [name, b] of Object.entries(rendered)) for (let i = 0; i < LOOP_N; i++) mix[i] += b[i] * bal[name];
writeWav(path.join(DIR, 'mix.wav'), mix, 0.72);
writeWav(path.join(DIR, 'lobby.wav'), rendered.base, 1.0);

const peak = (b) => {
  let m = 0;
  for (let i = 0; i < b.length; i++) if (Math.abs(b[i]) > m) m = Math.abs(b[i]);
  return m.toFixed(2);
};
console.log(`rendered ${LOOP_S.toFixed(3)}s loops at ${SR} Hz into ${path.relative(process.cwd(), DIR)}/`);
for (const [name, b] of Object.entries(rendered)) console.log(`  ${name.padEnd(8)} peak ${peak(b)}`);
console.log(`  mix      peak ${peak(mix)}   lobby = base alone`);
