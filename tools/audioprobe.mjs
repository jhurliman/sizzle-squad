/**
 * THE EAR WE DO NOT HAVE.
 *
 *   node tools/audioprobe.mjs [--json shots/audio/base.json] [--quiet]
 *
 * Audio is the one piece nobody can look at. This renders the real AudioEngine
 * through an OfflineAudioContext inside real Chromium — same Web Audio
 * implementation that ships on the device — and turns every sound into numbers:
 *
 *   peak / rms / true duration / onset latency / spectral centroid /
 *   8-band energy / clipped samples / stereo balance
 *
 * Then it asserts things a listener would notice:
 *   - every SimEvent makes a sound, and no two sounds are the same sound
 *   - a footstep is not as loud as a serve (the mix ladder)
 *   - nothing clips, ever, even with the whole kitchen firing at once
 *   - the first audible sample lands inside two frames of the event (33.3ms)
 *   - the combo ladder actually rises in pitch
 *   - music does not sit on top of the SFX in the bands the SFX lives in
 *   - the music scheduler survives a backgrounded tab
 *   - mute is silent, and nothing makes a sound before the user gesture
 *
 * The engine is bundled straight from src/audio/audio.ts by vite, so this
 * measures the shipping code and not a copy of it.
 */
import { chromium } from 'playwright';
import { build } from 'vite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.audioprobe');

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

// ------------------------------------------------------------------ bundle

fs.rmSync(TMP, { recursive: true, force: true });
await build({
  root: ROOT,
  logLevel: 'error',
  build: {
    outDir: TMP,
    emptyOutDir: true,
    lib: { entry: path.join(ROOT, 'src/audio/audio.ts'), formats: ['es'], fileName: 'audio' },
    minify: false,
  },
});

const page$ = fs.readFileSync(path.join(__dirname, 'audioprobe.page.js'), 'utf8');
fs.writeFileSync(path.join(TMP, 'probe.js'), page$);
fs.writeFileSync(
  path.join(TMP, 'index.html'),
  `<!doctype html><meta charset=utf8><title>audioprobe</title><link rel=icon href="data:,"><script type=module src=./probe.js></script>`,
);

const server = http.createServer((req, res) => {
  const p = path.join(TMP, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// The sandbox ships a pinned Chromium; never let Playwright download one.
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T0 = Date.now();
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (/\[stage\]/.test(m.text())) console.log(m.text() + '  +' + ((Date.now()-T0)/1000).toFixed(1) + 's');
  if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.__probeReady === true, null, { timeout: 30000 });
const R = await page.evaluate(() => window.__runProbe());
await browser.close();
server.close();
fs.rmSync(TMP, { recursive: true, force: true });

// ------------------------------------------------------------------ report

const dB = (x) => (x <= 1e-6 ? -120 : 20 * Math.log10(x));
const f2 = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : 'n/a');
const fails = [];
const warns = [];
const ok = (cond, msg) => (cond ? null : fails.push(msg));
const soft = (cond, msg) => (cond ? null : warns.push(msg));

const rows = R.events;
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
if (!argv.quiet) {
  console.log('\n=== PER-EVENT ==================================================================');
  console.log(
    ['event'.padEnd(14), 'peak'.padStart(6), 'dBFS'.padStart(7), 'rms'.padStart(7), 'dur ms'.padStart(7), 'onset ms'.padStart(9), 'cent Hz'.padStart(8), 'pan'.padStart(6), 'clip'.padStart(5), 'spread'.padStart(8)].join(' '),
  );
  for (const r of rows) {
    console.log(
      [
        r.name.padEnd(14),
        f2(r.peak, 3).padStart(6),
        f2(dB(r.peak), 1).padStart(7),
        f2(r.rms, 4).padStart(7),
        f2(r.durMs, 0).padStart(7),
        f2(r.onsetMs, 1).padStart(9),
        f2(r.centroid, 0).padStart(8),
        f2(r.balance, 2).padStart(6),
        String(r.clipped).padStart(5),
        (r.peakSpreadDb !== undefined ? '+/-' + f2(r.peakSpreadDb / 2, 1) : '').padStart(8),
      ].join(' '),
    );
  }
}

// --- 1. every event audible, none clipping ---------------------------------
for (const r of rows) {
  ok(r.peak > 0.02, `SILENT/too quiet: ${r.name} peak ${f2(r.peak, 4)}`);
  ok(r.clipped === 0, `CLIPS: ${r.name} ${r.clipped} samples over 1.0 (peak ${f2(r.peak, 3)})`);
  ok(r.durMs > 25, `TOO SHORT to hear: ${r.name} ${f2(r.durMs, 0)}ms`);
}

// --- 1b. THE MIX TABLE -----------------------------------------------------
// The target peak for every event, from the table at the top of audio.ts. Both
// bounds are known: under-target is what shipped (loudest sound -19 dBFS) and
// over-target is anything that eats the headroom the stress test needs. +/-3dB.
const TARGET = {
  serve: 0.5, fireStart: 0.5, gameOver: 0.5,
  chopDone: 0.28, cookDone: 0.28, serveWrong: 0.28, burn: 0.28,
  orderNew: 0.25, orderWarn: 0.25, orderExpired: 0.25, washDone: 0.22,
  pickup: 0.2, place: 0.2, trash: 0.2, bump: 0.2,
  chopTick: 0.11, footstep: 0.035,
};
if (!argv.quiet) console.log('\n=== MIX TABLE (target vs measured peak) ======================================');
for (const [name, target] of Object.entries(TARGET)) {
  const r = by[name];
  if (!r) continue;
  const miss = dB(r.peak) - dB(target);
  if (!argv.quiet) console.log(`  ${name.padEnd(14)} want ${f2(target, 3)}  got ${f2(r.peak, 3)}  ${(miss > 0 ? '+' : '') + f2(miss, 1)} dB${Math.abs(miss) > 3 ? '   <-- off target' : ''}`);
  ok(Math.abs(miss) <= 3, `LEVEL: ${name} is ${(miss > 0 ? '+' : '') + f2(miss, 1)}dB off its ${f2(target, 3)} target`);
}

// --- 2. latency: audible response inside two frames ------------------------
const FRAME2 = 33.3;
for (const r of rows) {
  ok(r.onsetMs <= FRAME2, `LATE: ${r.name} first audible sample at ${f2(r.onsetMs, 1)}ms > ${FRAME2}ms (2 frames)`);
  soft(r.onsetMs <= 16.7, `${r.name} onset ${f2(r.onsetMs, 1)}ms is over one frame`);
}

// --- 3. identity: no two events are the same sound -------------------------
// Feature vector: log-duration, log-centroid, 8 normalised log band energies,
// onset sharpness. Euclidean distance in that space; near-identical sounds
// land under ~0.9.
function feat(r) {
  const bands = r.bands.map((b) => Math.log10(b + 1e-6));
  const bmax = Math.max(...bands);
  return [Math.log10(r.durMs), Math.log10(r.centroid + 1) * 1.6, ...bands.map((b) => (b - bmax) * 0.55), r.attackMs / 40];
}
const dist = (a, b) => Math.sqrt(feat(a).reduce((s, v, i) => s + (v - feat(b)[i]) ** 2, 0));
const sfx = rows.filter((r) => r.family === 'sfx');
const pairs = [];
for (let i = 0; i < sfx.length; i++)
  for (let j = i + 1; j < sfx.length; j++) pairs.push({ a: sfx[i].name, b: sfx[j].name, d: dist(sfx[i], sfx[j]) });
pairs.sort((x, y) => x.d - y.d);
if (!argv.quiet) {
  console.log('\n=== CLOSEST PAIRS (identity; want > 0.90) ======================================');
  for (const p of pairs.slice(0, 8)) console.log(`  ${p.a.padEnd(14)} vs ${p.b.padEnd(14)} d=${f2(p.d)}`);
}
for (const p of pairs.slice(0, 12)) ok(p.d > 0.9, `CONFUSABLE: ${p.a} vs ${p.b} distance ${f2(p.d)}`);

// --- 4. the mix ladder -----------------------------------------------------
const ladder = [
  ['footstep', 'place'],
  ['place', 'serve'],
  ['chopTick', 'chopDone'],
  ['orderNew', 'serve'],
  ['footstep', 'bump'],
];
if (!argv.quiet) console.log('\n=== MIX LADDER (dB gap, quieter -> louder) ====================================');
for (const [q, l] of ladder) {
  if (!by[q] || !by[l]) continue;
  const gap = dB(by[l].peak) - dB(by[q].peak);
  if (!argv.quiet) console.log(`  ${q.padEnd(12)} -> ${l.padEnd(12)} ${f2(gap, 1).padStart(6)} dB`);
  ok(gap > 3, `MIX: ${l} is only ${f2(gap, 1)}dB over ${q} — needs > 3dB`);
}
ok(dB(by.serve.peak) - dB(by.footstep.peak) > 12, `MIX: serve is only ${f2(dB(by.serve.peak) - dB(by.footstep.peak), 1)}dB over footstep — needs > 12`);

// --- 5. combo ladder rises -------------------------------------------------
const combo = rows.filter((r) => r.family === 'combo');
if (!argv.quiet) {
  console.log('\n=== COMBO LADDER =============================================================');
  console.log('  ' + combo.map((c) => `${c.combo}:${f2(c.pitch, 0)}Hz/${f2(c.rms, 4)}`).join('  '));
}
// Rises for the first nine serves, then GROWS: past the top of the ladder the
// pitch must not fall and the sound must carry more energy, because continuing
// up the scale just makes it shrill on a phone.
const rising = combo.filter((c) => c.combo <= 9);
for (let i = 1; i < rising.length; i++) {
  ok(rising[i].pitch > rising[i - 1].pitch * 1.01, `COMBO does not rise: ${rising[i - 1].combo}=${f2(rising[i - 1].pitch, 0)}Hz -> ${rising[i].combo}=${f2(rising[i].pitch, 0)}Hz`);
}
const top = rising[rising.length - 1];
ok(top.pitch > combo[0].pitch * 2.4, `COMBO ladder spans only ${f2(top.pitch / combo[0].pitch, 2)}x — want > 2.4x`);
for (const c of combo.filter((c) => c.combo > 9)) {
  ok(c.pitch >= top.pitch * 0.99, `COMBO falls back at ${c.combo}: ${f2(c.pitch, 0)}Hz under ${f2(top.pitch, 0)}Hz`);
  ok(c.rms > top.rms * 1.04, `COMBO stops paying at ${c.combo}: rms ${f2(c.rms, 4)} vs ${f2(top.rms, 4)} at the top of the ladder`);
}

// --- 6. the sound you learn to fear ----------------------------------------
if (by.orderNew && by.orderWarn) {
  const d = dist(by.orderNew, by.orderWarn);
  if (!argv.quiet) {
    console.log('\n=== ARRIVAL vs EXPIRY WARNING ================================================');
    console.log(`  arrival    peak ${f2(by.orderNew.peak, 3)}  cent ${f2(by.orderNew.centroid, 0)}Hz  dur ${f2(by.orderNew.durMs, 0)}ms`);
    console.log(`  warn 3s    peak ${f2(by.orderWarn.peak, 3)}  cent ${f2(by.orderWarn.centroid, 0)}Hz  dur ${f2(by.orderWarn.durMs, 0)}ms   distance from arrival ${f2(d)}`);
    if (by.orderWarn1s) console.log(`  warn 1s    peak ${f2(by.orderWarn1s.peak, 3)}  cent ${f2(by.orderWarn1s.centroid, 0)}Hz  dur ${f2(by.orderWarn1s.durMs, 0)}ms`);
    console.log(`  8 tickets in the danger band for 4s -> ${R.warnSpam} ticks`);
  }
  ok(d > 1.2, `FEAR: orderNew and orderWarn are only ${f2(d)} apart — the player cannot learn to fear it`);
  ok(!!by.orderWarn1s, 'FEAR: the last-second warning is silent');
  if (by.orderWarn1s) {
    ok(by.orderWarn1s.centroid > by.orderWarn.centroid * 1.06 || by.orderWarn1s.peak > by.orderWarn.peak * 1.15, 'FEAR: the warning does not escalate as the ticket dies');
  }
  ok(R.warnSpam <= 6, `FEAR: ${R.warnSpam} warning ticks in 4s with 8 hot tickets — that is nagging, not fear`);
  ok(R.warnSpam >= 3, `FEAR: only ${R.warnSpam} ticks in 4s of danger — no heartbeat`);
} else {
  fails.push('FEAR: there is no "ticket about to expire" sound at all');
}

// --- 6b. panning -----------------------------------------------------------
if (R.pan) {
  if (!argv.quiet) console.log(`\n=== PANNING ==================================================================\n  left ${f2(R.pan.left)}   centre ${f2(R.pan.centre)}   right ${f2(R.pan.right)}`);
  ok(R.pan.left < -0.25, `PAN: an event at the left wall reads ${f2(R.pan.left)} — the kitchen is mono`);
  ok(R.pan.right > 0.25, `PAN: an event at the right wall reads ${f2(R.pan.right)}`);
  ok(Math.abs(R.pan.centre) < 0.08, `PAN: a centre event is off-centre (${f2(R.pan.centre)})`);
}

// --- 7. music ---------------------------------------------------------------
if (!argv.quiet) {
  console.log('\n=== MUSIC ====================================================================');
  for (const m of R.music) {
    console.log(
      `  heat ${f2(m.heat, 2)} tension ${f2(m.tension, 2)}  peak ${f2(m.peak, 3)}  rms ${f2(m.rms, 4)} (${f2(dB(m.rms), 1)} dBFS)  onsets ${m.onsets}  bpm~${f2(m.bpm, 0)} (bar ${f2(m.barSec, 2)}s)  cent ${f2(m.centroid, 0)}Hz  sub120 ${f2(m.bands[0] * 100, 0)}%  clip ${m.clipped}`,
    );
    console.log(`      peak at step ${f2(m.peakStep, 1)} of 16, dominant ${f2(m.peakHz, 0)}Hz;  worst 150ms band rms: ${m.bandProfile.map((v, i) => `${[40, 120, 300, 700, 1500, 3000, 6000, 11000][i]}:${f2(v, 4)}`).join(' ')}`);
  }
}
for (const m of R.music) {
  // A bed whose energy is all below 300Hz masks every low SFX in the game and
  // eats the headroom the transients need. Measured at 137Hz before the
  // rebalance, with a bump landing 11dB UNDER the bass note.
  // A phone speaker reproduces almost nothing below ~400Hz. Energy under
  // 120Hz is therefore invisible headroom: it pushes the bus limiter and
  // pumps every transient, and the player never hears the note that did it.
  ok(m.bands[0] < 0.3, `MUSIC IS A SUBWOOFER at heat ${m.heat}: ${f2(m.bands[0] * 100, 0)}% of its energy is under 120Hz, want < 30%`);
  ok(m.peak < 0.42, `MUSIC PEAKS at ${f2(m.peak, 3)} at heat ${m.heat} — louder than most of the SFX ladder`);
  ok(m.clipped === 0, `MUSIC CLIPS at heat ${m.heat}`);
  // Target: -33 dBFS RMS, both bounds known. Below about -36 the bed is
  // decoration nobody hears on a phone; above about -29 the masking margin on
  // the handling tier (pickup, place) drops under 5dB, measured. The masking
  // section below is the real check — this is the coarse bracket.
  ok(dB(m.rms) > -36, `MUSIC TOO QUIET at heat ${m.heat}: ${f2(dB(m.rms), 1)} dBFS RMS, want > -36`);
  ok(dB(m.rms) < -29, `MUSIC TOO LOUD at heat ${m.heat}: ${f2(dB(m.rms), 1)} dBFS RMS, want < -29`);
  ok(m.onsets > 4, `MUSIC EMPTY at heat ${m.heat}: ${m.onsets} onsets in ${f2(m.seconds, 1)}s`);
}
const calm = R.music[0], hot = R.music[R.music.length - 1];
ok(hot.bpm > calm.bpm * 1.08, `MUSIC does not adapt: ${f2(calm.bpm, 0)} -> ${f2(hot.bpm, 0)} bpm`);
// "Without becoming annoying" is measurable at the top end: a bed past about
// six onsets a second is a wall of notes, and a tempo that runs away past
// 1.7x is a novelty siren.
for (const m of R.music) ok(m.onsets / m.seconds < 6, `MUSIC IS A WALL at heat ${m.heat}: ${f2(m.onsets / m.seconds, 1)} onsets/s`);
soft(hot.bpm < calm.bpm * 1.7, `MUSIC tempo runs away: ${f2(calm.bpm, 0)} -> ${f2(hot.bpm, 0)} bpm (annoying)`);

// --- 8. masking: SFX over music --------------------------------------------
if (!argv.quiet) {
  console.log('\n=== MASKING (SFX peak over music bed, per event) =============================');
  for (const m of R.masking) console.log(`  ${m.name.padEnd(14)} ${f2(m.headroomDb, 1).padStart(6)} dB over the bed   (bed rms ${f2(m.bedRms, 4)})`);
}
for (const m of R.masking) ok(m.headroomDb > 8, `MASKED: ${m.name} only ${f2(m.headroomDb, 1)}dB over the music bed`);

// --- 9. the whole kitchen at once ------------------------------------------
if (!argv.quiet) {
  console.log('\n=== STRESS ===================================================================');
  console.log(`  ${R.stress.count} events + music in ${f2(R.stress.seconds, 1)}s -> peak ${f2(R.stress.peak, 3)} (${f2(dB(R.stress.peak), 1)} dBFS) clipped ${R.stress.clipped}`);
  console.log(`  voices started: ${f2(R.stress.voicesPerSec ?? 0, 1)}/s (each is 3-5 AudioNodes on the main thread)`);
}
ok(R.stress.clipped === 0, `STRESS: ${R.stress.clipped} clipped samples with the kitchen busy (peak ${f2(R.stress.peak, 3)})`);
ok(R.stress.peak < 0.999, 'STRESS: bus reaches full scale');
ok((R.stress.voicesPerSec ?? 0) < 60, `STRESS: ${f2(R.stress.voicesPerSec, 0)} voices/s is too much node churn for the main thread`);

// --- 10. gesture / mute / background ---------------------------------------
if (!argv.quiet) {
  console.log('\n=== POLICY ===================================================================');
  console.log(`  before start(): contexts created ${R.policy.contextsBeforeStart}, peak ${f2(R.policy.beforeStartPeak, 4)}`);
  console.log(`  muted peak ${f2(R.policy.mutedPeak, 5)}   unmute click peak-delta ${f2(R.policy.muteClick, 4)}   reachable by key: ${R.policy.keyboardMute && R.policy.keyboardUnmute}`);
  console.log(`  background 6s gap -> notes scheduled in the past: ${R.policy.pastNotes}, resume peak ${f2(R.policy.resumePeak, 3)} vs normal ${f2(R.policy.normalPeak, 3)}`);
  console.log(`  SFX after the gap: peak ${f2(R.policy.resumeSfxPeak ?? 0, 3)}`);
  console.log(`  suspend/resume survived: ${R.policy.survivedSuspend}`);
}
ok(R.policy.contextsBeforeStart === 0, 'GESTURE: an AudioContext exists before start()');
ok(R.policy.beforeStartPeak < 1e-4, 'GESTURE: sound before the user gesture');
ok(R.policy.mutedPeak < 1e-4, `MUTE: still audible when muted (peak ${f2(R.policy.mutedPeak, 5)})`);
ok(R.policy.keyboardMute && R.policy.keyboardUnmute, 'MUTE: no input anywhere in the build can toggle it');
ok(R.policy.muteClick < 0.05, `MUTE: unmute clicks (${f2(R.policy.muteClick, 4)} step)`);
ok(R.policy.resumePeak < R.policy.normalPeak * 1.6, `BACKGROUND: returning from a 6s gap blares (${f2(R.policy.resumePeak, 3)} vs ${f2(R.policy.normalPeak, 3)})`);
ok(R.policy.pastNotes <= 2, `BACKGROUND: ${R.policy.pastNotes} music notes scheduled in the past after a 6s gap`);
ok(R.policy.survivedSuspend, 'BACKGROUND: engine did not survive suspend/resume');

// ------------------------------------------------------------------ verdict
if (errors.length) for (const e of errors) fails.push(`CONSOLE ERROR: ${e}`);
console.log('\n=== VERDICT ==================================================================');
for (const w of warns) console.log(`  warn  ${w}`);
for (const f of fails) console.log(`  FAIL  ${f}`);
console.log(`  ${fails.length} failures, ${warns.length} warnings`);

if (argv.json) {
  fs.mkdirSync(path.dirname(path.resolve(ROOT, argv.json)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, argv.json), JSON.stringify({ ...R, fails, warns }, null, 2));
  console.log(`  wrote ${argv.json}`);
}
process.exit(fails.length ? 1 : 0);
