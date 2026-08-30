// Offline-renders the web game's WebAudio-synthesized SFX into upload-ready
// WAV files for Roblox. The REAL AudioEngine (src/audio/audio.ts) runs
// through an OfflineAudioContext inside Chromium — the engine's own injection
// hook, same one tools/audioprobe.mjs uses — so these are the shipping
// sounds, not recreations. Three variants per event (the synth is
// randomized), serve rendered at combo 1/4/8 for the sweetener ladder.
//
//   node render-audio.mjs        -> audio-out/*.wav + manifest.json
//
// Upload the WAVs (Creator Dashboard or Open Cloud), then fill the asset ids
// into roblox-game/game-src/client/Sfx.luau MANIFEST.
import { chromium } from '../node_modules/playwright/index.mjs';
import { build } from 'vite';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(DIR, '..');
const TMP = path.join(DIR, '.audio-render');
const OUT = path.join(DIR, 'audio-out');
const SR = 48000;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
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

fs.writeFileSync(
  path.join(TMP, 'index.html'),
  `<!doctype html><meta charset="utf-8"><body><script type="module">
import { AudioEngine } from '/audio.js';
window.renderEvent = async (ev, seconds) => {
  const ctx = new OfflineAudioContext(2, Math.ceil(${SR} * seconds), ${SR});
  const engine = new AudioEngine();
  engine.start(ctx);
  engine.handle(ev);
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  // trim trailing silence (< -60 dB), keep 60ms tail
  let end = buf.length - 1;
  while (end > ${SR} * 0.05 && Math.max(Math.abs(L[end]), Math.abs(R[end])) < 0.001) end--;
  end = Math.min(buf.length - 1, end + ${SR} * 0.06 | 0);
  const n = end + 1;
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    pcm[i * 2] = Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767)));
    pcm[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767)));
  }
  const bytes = new Uint8Array(pcm.buffer);
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    b64 += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  return { b64, frames: n };
};
window.ready = true;
</script></body>`,
);

const server = http.createServer((req, res) => {
  const file = path.join(TMP, req.url === '/' ? 'index.html' : req.url);
  try {
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(fs.readFileSync(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const AT = { x: 7.5, y: 5 };
const EVENTS = {
  pickup: { t: 'pickup', chef: 0, at: AT },
  place: { t: 'place', chef: 0, at: AT },
  grabMiss: { t: 'grabMiss', chef: 0, at: AT },
  chopTick: { t: 'chopTick', at: AT, progress: 0.5 },
  chopDone: { t: 'chopDone', at: AT, kind: 'tomato' },
  cookDone: { t: 'cookDone', at: AT, kind: 'bacon' },
  burn: { t: 'burn', at: AT },
  fireStart: { t: 'fireStart', at: AT },
  serveWrong: { t: 'serveWrong', at: AT },
  orderNew: { t: 'orderNew', orderId: 1 },
  orderExpired: { t: 'orderExpired', orderId: 1 },
  trash: { t: 'trash', at: AT },
  washDone: { t: 'washDone', at: AT },
  bump: { t: 'bump', a: 0, b: 1, at: AT },
  wallHit: { t: 'wallHit', chef: 0, at: AT, speed: 6 },
  footstep: { t: 'footstep', chef: 0, at: AT },
  gameOver: { t: 'gameOver', score: 900 },
};

function wavHeader(frames) {
  const dataLen = frames * 4;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(2, 22); // stereo
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLen, 40);
  return h;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction('window.ready === true', { timeout: 20000 });

const manifest = {};
async function renderTo(fileBase, ev, seconds, variants) {
  const files = [];
  for (let v = 1; v <= variants; v++) {
    const { b64, frames } = await page.evaluate(
      ({ ev, seconds }) => window.renderEvent(ev, seconds),
      { ev, seconds },
    );
    const name = `${fileBase}_${v}.wav`;
    fs.writeFileSync(path.join(OUT, name), Buffer.concat([wavHeader(frames), Buffer.from(b64, 'base64')]));
    files.push(name);
  }
  manifest[fileBase] = files;
  console.error(`rendered ${fileBase} x${variants}`);
}

for (const [key, ev] of Object.entries(EVENTS)) {
  await renderTo(key, ev, key === 'gameOver' ? 3.5 : 2.0, 3);
}
// the serve sweetener ladder: variants are the combo tiers
await renderTo('serve', { t: 'serve', at: AT, value: 40, combo: 1, orderId: 1 }, 2.0, 1);
manifest.serve = [];
for (const combo of [1, 4, 8]) {
  const { b64, frames } = await page.evaluate(
    ({ ev, seconds }) => window.renderEvent(ev, seconds),
    { ev: { t: 'serve', at: AT, value: 40, combo, orderId: 1 }, seconds: 2.0 },
  );
  const name = `serve_combo${combo}.wav`;
  fs.writeFileSync(path.join(OUT, name), Buffer.concat([wavHeader(frames), Buffer.from(b64, 'base64')]));
  manifest.serve.push(name);
  console.error(`rendered ${name}`);
}

await browser.close();
server.close();
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(OUT, 'README.md'),
  `# Sizzle Squad SFX — upload pack

Rendered from the web game's own WebAudio synth (src/audio/audio.ts) via
OfflineAudioContext in Chromium. 48kHz 16-bit stereo WAV, silence-trimmed.

Upload each file (Creator Dashboard -> Development Items -> Audio, or Open
Cloud), then fill the asset ids into
roblox-game/game-src/client/Sfx.luau MANIFEST — the key is the filename
without the variant suffix (e.g. chopTick_2.wav -> chopTick). Multiple
variants per key: pick one, or extend Sfx.luau to rotate them (runtime
PlaybackSpeed jitter already varies repeats). serve_combo{1,4,8}.wav are the
combo sweetener tiers.
`,
);
console.error(`wrote ${Object.keys(manifest).length} manifest keys -> ${OUT}`);
