// Renders the web game's adaptive score (src/audio/audio.ts tickMusic) as
// four seamless-looping STEMS at a fixed tempo, using the same voice synths
// (at/hat/kick + env). The Roblox client (Music.luau) plays all four in sync
// and cross-fades their volume by heat (round progress) and tension (draining
// patience), reproducing the adaptivity without runtime synthesis.
//
//   base    bass + comp chords + shaker   (the always-on bed)
//   groove  swing hats                    (fades in with heat)
//   melody  the sine lead                 (fades in with heat, out at high tension)
//   tension low drone + heartbeat kick    (fades in as patience drains)
//
//   node render-music.mjs   ->   audio-out/music/*.wav + manifest.json
import { chromium } from '../node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(DIR, 'audio-out', 'music');
const SR = 44100;
const TEMPO = 128; // fixed: stems must stay beat-aligned to layer
const STEP = 60 / TEMPO / 2; // seconds per step
const LOOP_STEPS = 32; // full pattern period (bass 16, melody 32)
const LOOP = LOOP_STEPS * STEP; // 7.5s
const TAIL = 0.4; // extra render captured then wrapped onto the head

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// The scheduling + synthesis, faithful to tickMusic/at/hat/kick/env. `stem`
// selects which layers emit; heat/tension are the representative values the
// stem is rendered at (runtime fades its VOLUME around these).
const page$ = `
const ROOT = 130.81;
const BASS = [0,0,7,0,5,5,0,7];
const MEL = [12,16,19,16,21,19,16,12];

function env(ctx, g, t, peak, attack, hold, decay) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(Math.max(1e-4, peak * 0.0008), t + attack + hold + decay);
  g.gain.linearRampToValueAtTime(0, t + attack + hold + decay + 0.004);
}
function at(ctx, out, t, freq, dur, type, gain, lp) {
  const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
  const f = ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = lp;
  const g = ctx.createGain(); env(ctx, g, t, gain, 0.008, 0, Math.max(0.02, dur - 0.008));
  osc.connect(f); f.connect(g); g.connect(out); osc.start(t); osc.stop(t + dur + 0.05);
}
function hat(ctx, out, noise, t, gain) {
  const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value = 7000;
  const g = ctx.createGain(); env(ctx, g, t, gain, 0.001, 0, 0.035);
  src.connect(f); f.connect(g); g.connect(out); src.start(t, 0.31 + (t % 1)); src.stop(t + 0.08);
}
function kick(ctx, out, t, gain) {
  const osc = ctx.createOscillator(); osc.type='sine';
  osc.frequency.setValueAtTime(170, t); osc.frequency.exponentialRampToValueAtTime(75, t + 0.11);
  const g = ctx.createGain(); env(ctx, g, t, gain, 0.003, 0, 0.12);
  osc.connect(g); g.connect(out); osc.start(t); osc.stop(t + 0.2);
}

window.renderStem = async (stem, heat, tension) => {
  const seconds = ${LOOP} + ${TAIL};
  const ctx = new OfflineAudioContext(1, Math.ceil(${SR} * seconds), ${SR});
  // shared noise buffer (1.5s), like the engine
  const noise = ctx.createBuffer(1, ${SR} * 1.5, ${SR});
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const step = ${STEP};
  for (let beat = 0; beat < ${LOOP_STEPS}; beat++) {
    const t = 0.02 + beat * step;
    const b = beat % 16;
    const n = BASS[((beat / 2) | 0) % 8];
    if (stem === 'base') {
      if (b % 2 === 0) at(ctx, ctx.destination, t, ROOT * Math.pow(2, n/12), 0.2, 'triangle', 0.075 + heat*0.015, 700);
      if (b % 4 === 3 || b % 8 === 5) {
        at(ctx, ctx.destination, t, ROOT*2*Math.pow(2,(n+7)/12), 0.13, 'triangle', 0.06, 900);
        at(ctx, ctx.destination, t, ROOT*2*Math.pow(2,(n+12)/12), 0.13, 'sine', 0.045, 900);
      }
      if (b % 2 === 1) hat(ctx, ctx.destination, noise, t, 0.026 + heat*0.016);
    } else if (stem === 'groove') {
      if (b % 4 === 2) hat(ctx, ctx.destination, noise, t, 0.062 + heat*0.025);
      if (b % 8 === 6) hat(ctx, ctx.destination, noise, t, 0.105 + heat*0.025);
    } else if (stem === 'melody') {
      // both gate positions so the stem is the full melody; runtime fades it
      if (b % 8 === 0 || b % 8 === 4) at(ctx, ctx.destination, t, ROOT*Math.pow(2, MEL[((beat/4)|0)%8]/12), 0.16, 'sine', 0.10 + heat*0.04, 2000);
    } else if (stem === 'tension') {
      if (b === 2) at(ctx, ctx.destination, t, ROOT, step*8, 'sine', 0.022 + tension*0.022, 500);
      if (b === 0 || b === 8) kick(ctx, ctx.destination, t, 0.07 + tension*0.04);
    }
  }
  const buf = await ctx.startRendering();
  const ch = buf.getChannelData(0);
  const loopN = Math.round(${LOOP} * ${SR});
  // overlap-add wrap: fold the post-loop tail onto the head -> seamless loop
  const out = new Float32Array(loopN);
  for (let i = 0; i < loopN; i++) {
    let v = ch[i];
    const tailIdx = loopN + i;
    if (tailIdx < ch.length) v += ch[tailIdx];
    out[i] = v;
  }
  // to int16
  const pcm = new Int16Array(loopN);
  for (let i = 0; i < loopN; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767)));
  const bytes = new Uint8Array(pcm.buffer);
  // chunk size MUST be a multiple of 3 (base64 packs 3 bytes -> 4 chars);
  // otherwise each chunk gets '=' padding and concatenation corrupts/truncates
  let b64 = '';
  const CH = 32763; // 32763 % 3 === 0
  for (let i = 0; i < bytes.length; i += CH) b64 += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + CH)));
  return { b64, frames: loopN };
};
window.ready = true;
`;

const html = `<!doctype html><meta charset="utf-8"><body><script>${page$}</script></body>`;
const tmp = path.join(OUT, 'render.html');
fs.writeFileSync(tmp, html);

function wavHeaderMono(frames) {
  const dataLen = frames * 2;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + tmp);
await page.waitForFunction('window.ready === true', { timeout: 20000 });

const STEMS = [
  ['base', 0.4, 0],
  ['groove', 1.0, 0],
  ['melody', 1.0, 0],
  ['tension', 0.0, 1.0],
];
const manifest = {};
for (const [stem, heat, tension] of STEMS) {
  const { b64, frames } = await page.evaluate(({ stem, heat, tension }) => window.renderStem(stem, heat, tension), { stem, heat, tension });
  fs.writeFileSync(path.join(OUT, `music_${stem}.wav`), Buffer.concat([wavHeaderMono(frames), Buffer.from(b64, 'base64')]));
  manifest[stem] = `music_${stem}.wav`;
  console.error(`rendered music_${stem}.wav (${(frames / SR).toFixed(2)}s loop)`);
}
await browser.close();
fs.rmSync(tmp);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ tempo: TEMPO, loopSeconds: LOOP, stems: manifest }, null, 2));
fs.writeFileSync(
  path.join(OUT, 'README.md'),
  `# Sizzle Squad — adaptive music stems

Four seamless-looping mono WAVs (44.1kHz) rendered from the web game's
tickMusic score (src/audio/audio.ts) at a fixed tempo of ${TEMPO}, loop
length ${LOOP.toFixed(2)}s. Upload each, then fill the ids into
roblox-game/game-src/client/Music.luau STEM_IDS.

The client plays all four in sync and cross-fades volume:
- base    : always on (the bed)
- groove  : fades in with heat (round progress)
- melody  : fades in with heat, ducks out at high tension
- tension : fades in as patience drains

They are beat-aligned (same tempo/length) so they layer without phasing.
`,
);
console.error(`wrote ${STEMS.length} stems -> ${OUT}`);
