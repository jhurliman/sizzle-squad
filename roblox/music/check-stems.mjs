// CHECK THE FOUR GAME STEMS: length, format, level, and the loop seam.
//
// Music.luau plays these four files in lockstep and wraps each one at
// LOOP_SECONDS. So every stem must be EXACTLY one loop long, and the seam —
// the last few ms against the first few — must be continuous, or there is a
// click every 15 seconds for the rest of the player's life.
//
//   node check-stems.mjs <base.wav> <groove.wav> <melody.wav> <tension.wav>
import { execFileSync } from 'node:child_process';

const BPM = 124, BARS = 8, SR = 48000;
const LOOP_S = (BARS * 4 * 60) / BPM; // 15.483871

const files = process.argv.slice(2);
if (files.length !== 4) { console.error('need four files: base groove melody tension'); process.exit(2); }

const probe = (f) => {
  const out = execFileSync('ffprobe', ['-hide_banner', '-v', 'error', '-show_entries', 'stream=sample_rate,channels,bits_per_raw_sample:format=duration', '-of', 'json', f]).toString();
  const j = JSON.parse(out);
  return { sr: +j.streams[0].sample_rate, ch: +j.streams[0].channels, bits: +j.streams[0].bits_per_raw_sample, dur: +j.format.duration };
};
const pcm = (f) => {
  const buf = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', f, '-ac', '1', '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
};
const rms = (a, s, e) => { let acc = 0; for (let i = s; i < e; i++) acc += a[i] * a[i]; return Math.sqrt(acc / Math.max(1, e - s)); };
const peak = (a) => { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; };
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');

let ok = true;
const names = ['base', 'groove', 'melody', 'tension'];
files.forEach((f, i) => {
  const p = probe(f);
  const x = pcm(f);
  const expectN = Math.round(LOOP_S * p.sr);
  const lenOk = Math.abs(x.length - expectN) <= 2;
  // seam: does the signal at the very end line up with the very start?
  // Compare the last 5 ms to the first 5 ms in level, and look for a step
  // discontinuity across the wrap point.
  const W = Math.round(0.005 * p.sr);
  const endRms = rms(x, x.length - W, x.length), startRms = rms(x, 0, W);
  const step = Math.abs(x[x.length - 1] - x[0]);
  const bodyRms = rms(x, 0, x.length);
  const seamOk = step < 0.05 || step < bodyRms * 2;
  ok = ok && lenOk && seamOk;
  console.log(`${names[i].padEnd(8)} ${p.sr}Hz ${p.ch}ch ${p.bits}bit  ${p.dur.toFixed(6)}s (${x.length} samples, want ${expectN}) ${lenOk ? '✓' : '✗ LENGTH'}`);
  console.log(`         peak ${db(peak(x))} dBFS  rms ${db(bodyRms)} dB   seam: end ${db(endRms)} / start ${db(startRms)}, step ${step.toFixed(4)} ${seamOk ? '✓' : '✗ CLICK'}`);
});
console.log(ok ? '\nALL STEMS OK' : '\nPROBLEMS — see ✗ above');
process.exit(ok ? 0 : 1);
