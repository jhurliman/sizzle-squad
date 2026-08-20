/**
 * Bot survival survey. No screenshots — just runs N full services headless and
 * reports the distribution of served / missed / how long the kitchen lasted.
 *
 * A single harness profile is one seed, so "served=0" in one report.json cannot
 * tell you whether the bots are broken or that run was unlucky. This can.
 *
 *   node tools/botsurvey.mjs [--runs 12] [--seconds 190]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const RUNS = Number(argv.runs ?? 12);
const SECONDS = Number(argv.seconds ?? 190);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = path.join(dir, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const { server, port } = await serve(DIST);
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
/**
 * TINY ON PURPOSE. --drive has to render one frame per advance() call, and
 * under swiftshader that cost is linear in pixels and nothing else: at 900x560
 * a single 190-second driven run took ten minutes, essentially all of it in the
 * GPU process rasterising frames no human will ever see. Nothing this tool
 * measures — served, missed, patience, whether the kitchen deadlocks — is a
 * function of viewport size. 200x150 is 17x fewer pixels and the same numbers.
 */
const page = await browser.newPage({ viewport: { width: 200, height: 150 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });

/**
 * --drive  run the SCRIPTED PLAYER as well as the bots, i.e. exactly what
 * shoot.mjs does. This is the difference that mattered: with the player parked
 * (warp) the kitchen never once scored zero, and with the harness's player
 * loose in it two of four profiles died at 0:54 having served nothing.
 */
const DRIVE = process.argv.includes('--drive');
const PLAN = [
  { move: { x: 0, y: 1 }, s: 0.9 },
  { grab: true, s: 0.12 },
  { move: { x: -0.9, y: -0.6 }, s: 1.1 },
  { move: { x: -1, y: 0 }, s: 0.7 },
  { grab: true, s: 0.12 },
  { use: true, s: 1.9 },
  { use: false, s: 0.1 },
  { grab: true, s: 0.15 },
  { move: { x: 1, y: -0.5 }, dash: true, s: 0.9 },
  { move: { x: 0, y: -1 }, s: 0.8 },
  { grab: true, s: 0.15 },
  { move: { x: 0.6, y: 1 }, s: 0.9 },
  { move: { x: 0, y: 0 }, s: 0.4 },
];

const rows = [];
for (let i = 0; i < RUNS; i++) {
  const r = await page.evaluate(
    async ([sec, drive, plan]) => {
      window.__game.start();
      if (!drive) {
        window.__game.warp(sec);
      } else {
        window.__game.setCapture(true);
        window.__game.setInput({ enabled: true });
        let t = 0;
        let p = 0;
        while (t < sec && window.__game.phase === 'playing') {
          const st = plan[p++ % plan.length];
          window.__game.setInput({
            move: st.move ?? { x: 0, y: 0 },
            grabPressed: !!st.grab,
            useHeld: !!st.use,
            enabled: true,
          });
          window.__game.advance(st.s ?? 0.4);
          t += st.s ?? 0.4;
        }
        window.__game.setInput({ enabled: false, move: { x: 0, y: 0 } });
        window.__game.setCapture(false);
      }
      const s = window.__game.snapshot();
      return { phase: s.phase, time: +s.time.toFixed(1), served: s.score.served, missed: s.score.missed, coins: s.score.coins, patience: +s.score.patience.toFixed(2) };
    },
    [SECONDS, DRIVE, PLAN],
  );
  rows.push(r);
  console.log(`run ${String(i + 1).padStart(2)}  t=${String(r.time).padStart(6)}s  served=${String(r.served).padStart(3)}  missed=${String(r.missed).padStart(3)}  coins=${String(r.coins).padStart(4)}  patience=${r.patience}  ${r.phase}`);
}
const served = rows.map((r) => r.served).sort((a, b) => a - b);
const died = rows.filter((r) => r.phase === 'over' && r.time < SECONDS - 5).length;
console.log(`\nserved  min=${served[0]}  med=${served[(served.length / 2) | 0]}  max=${served[served.length - 1]}`);
console.log(`zero-served runs: ${rows.filter((r) => r.served === 0).length}/${RUNS}`);
console.log(`early game-overs: ${died}/${RUNS}`);
console.log(`pageerrors: ${errors.length}`);

await browser.close();
server.close();
