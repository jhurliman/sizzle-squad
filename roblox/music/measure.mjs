// MEASURE A MASTER: LUFS, true peak, loudness range — and what to do about it.
//
// A VU meter cannot show any of this, and a limiter's gain knob does not know
// what it is aiming at. This runs ffmpeg's EBU R128 analysis and turns the
// numbers into a sentence: how many dB to move the limiter gain, and whether
// the true-peak ceiling is safe for a lossy transcode.
//
//   node measure.mjs <file.wav> [--target -10] [--ceiling -1]
//
// Targets default to the SoundCloud brief: -10 LUFS integrated, -1 dBTP.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const TARGET = opt('--target', -10);
const CEILING = opt('--ceiling', -1);

if (!file || !fs.existsSync(file)) {
  console.error('usage: node measure.mjs <file.wav> [--target -10] [--ceiling -1]');
  process.exit(2);
}

// ffmpeg prints the R128 summary to stderr at the end of the run.
let err = '';
try {
  execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  err = e.stderr?.toString() ?? '';
  if (!/Integrated loudness/.test(err)) { console.error(err.slice(-800)); process.exit(1); }
}
if (!err) err = ''; // success path: need stderr, rerun capturing it
if (!/Integrated loudness/.test(err)) {
  err = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1`]).toString();
}

const num = (re) => { const m = err.match(re); return m ? Number(m[1]) : NaN; };
const I = num(/Integrated loudness:\s*\n?\s*I:\s*(-?[\d.]+) LUFS/);
const LRA = num(/Loudness range:\s*\n?\s*LRA:\s*(-?[\d.]+) LU/);
const TP = num(/True peak:\s*\n?\s*Peak:\s*(-?[\d.]+) dBFS/);
const dur = (() => { const m = err.match(/Duration: (\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN; })();

const fmt = (x, u = '') => (Number.isFinite(x) ? `${x.toFixed(1)}${u}` : 'n/a');
console.log(`${file}`);
console.log(`  duration        ${Number.isFinite(dur) ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}` : 'n/a'}`);
console.log(`  integrated      ${fmt(I, ' LUFS')}     target ${TARGET}`);
console.log(`  true peak       ${fmt(TP, ' dBTP')}     ceiling ${CEILING}`);
console.log(`  loudness range  ${fmt(LRA, ' LU')}`);
console.log();

const dGain = TARGET - I;
if (!Number.isFinite(I)) { console.log('could not read loudness'); process.exit(1); }

if (Math.abs(dGain) <= 0.5) {
  console.log(`✓ loudness is on target (within 0.5 dB).`);
} else {
  console.log(`→ limiter gain: ${dGain > 0 ? 'raise' : 'lower'} by ${Math.abs(dGain).toFixed(1)} dB  (${I.toFixed(1)} → ${TARGET})`);
}
if (TP > CEILING + 0.05) {
  console.log(`✗ true peak ${TP.toFixed(1)} exceeds the ${CEILING} dBTP ceiling — lossy transcodes will clip. Lower the limiter ceiling (not the gain).`);
} else {
  console.log(`✓ true peak is under the ceiling.`);
}
if (Number.isFinite(LRA)) {
  if (LRA < 4) console.log(`  LRA ${LRA.toFixed(1)} is tight — the limiter may be flattening the dynamics; check the quiet sections still feel quieter.`);
  else if (LRA > 12) console.log(`  LRA ${LRA.toFixed(1)} is wide for club-adjacent music; the intro/outro may feel far from the hook. Fine if intended.`);
  else console.log(`  LRA ${LRA.toFixed(1)} is a healthy range for this genre.`);
}
