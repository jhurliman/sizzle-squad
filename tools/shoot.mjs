/**
 * The critic's instrument.
 *
 *   node tools/shoot.mjs --out shots/round1 [--script scripts/play.mjs] [--seconds 25]
 *
 * Boots the built game in real Chromium at four device profiles, drives it with
 * the same input path a human uses, and writes PNGs + a machine-readable
 * report.json (console errors, FPS, sim snapshots). Never trust a summary of
 * the game — run this and look at the pixels.
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
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const OUT = path.resolve(ROOT, argv.out ?? 'shots/latest');
const SECONDS = Number(argv.seconds ?? 22);

/**
 * DEVICE SCALE FACTOR — the single biggest cost in this harness.
 *
 * Measured on this box: a single render costs 3.8ms and advancing a second of
 * game time costs 71ms. Capturing the frame costs 8,600ms. The capture is a
 * buffer readback plus encode of the whole surface through a software
 * rasteriser, so its cost is linear in PIXELS and nothing else.
 *
 * At device DPR the iPhone-portrait surface is 1179x2556 — 3.0 megapixels, NINE
 * times the 0.33MP the layout actually occupies. Nothing a critic judges
 * (composition, colour, silhouette, occlusion, safe areas) is a function of
 * device pixel density; CSS layout is identical at any DPR, and the Read tool
 * downsamples to ~2000px on the long edge regardless.
 *
 * So iterate at 1x and pass --dpr 2 for a final fidelity pass.
 */
const DPR = Number(argv.dpr ?? 1);

/**
 * --warp <gameSeconds>  fast-forward the sim before the drive begins.
 * --marks <a,b,c>       game-seconds at which to take a screenshot.
 *
 * Without these the harness can only ever photograph the first few seconds of
 * a service. Everything the HUD says late — the amber ticket, the red ticket,
 * the countdown ring, the wobble, the served and lost animations, the mood
 * chip — lives past a minute in and was therefore never once seen rendered.
 */
const WARP = Number(argv.warp ?? 0);
const MARKS = argv.marks
  ? String(argv.marks)
      .split(',')
      .map(Number)
      .filter((n) => Number.isFinite(n))
  : [2, 6, 12, Number(argv.seconds ?? 22) - 1];

/**
 * --insets  simulate the real device safe-area insets.
 *
 * Headless Chromium reports env(safe-area-inset-*) as 0 on every profile, so
 * NOTHING the harness has ever photographed was checked against a notch, a
 * Dynamic Island or a home indicator — the one non-negotiable in AGENTS.md that
 * no screenshot could confirm. The insets below are the real ones an iPhone 15
 * Pro and an iPad Pro report; injecting them as an author-level override of the
 * four :root custom properties makes both the CSS and hud.ts readInsets() see
 * them, because that is the only channel either of them reads.
 */
const INSETS = argv.insets !== undefined && argv.insets !== 'false';

export const PROFILES = [
  {
    id: 'iphone-portrait',
    label: 'iPhone 15 Pro — portrait',
    viewport: { width: 393, height: 852 },
    insets: { t: 59, b: 34, l: 0, r: 0 },
    dpr: DPR,
    touch: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'iphone-landscape',
    label: 'iPhone 15 Pro — landscape',
    viewport: { width: 852, height: 393 },
    insets: { t: 0, b: 21, l: 59, r: 59 },
    dpr: DPR,
    touch: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'ipad-landscape',
    label: 'iPad Pro 11" — landscape',
    viewport: { width: 1194, height: 834 },
    insets: { t: 24, b: 20, l: 0, r: 0 },
    // 1.5x, not the device's 2x. Under the software rasteriser a 2388x1668
    dpr: DPR,
    touch: true,
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'desktop',
    label: 'Desktop 1440×900',
    viewport: { width: 1440, height: 900 },
    dpr: DPR,
    touch: false,
    ua: undefined,
  },
];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = path.join(dir, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('nope');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A scripted run of play: not a bot demo, a *player* demo. Walks to a crate,
 * grabs, chops, plates, serves — so screenshots capture the real states.
 */
/**
 * CAPTURE-MODE DRIVE.
 *
 * The old version slept in wall-clock time while the page rendered every
 * intermediate frame. Measured across one wave: 159 harness runs, 606 minutes,
 * 51% of all agent time — spent almost entirely rendering frames nobody looked
 * at, through a software rasteriser at under 2fps.
 *
 * Now the page hands us its clock. We advance game time in fixed 1/60s steps
 * with rendering suppressed and draw exactly one frame per screenshot. Same
 * sim, same bots, same VFX, same camera — the frames that land are identical,
 * there are just ~8 renders in a run instead of ~200. It is also DETERMINISTIC:
 * a mark at t=8s is now exactly 8s of game time on every profile and every run,
 * instead of whatever the box happened to manage.
 */
async function driveCapture(page, seconds, shoot) {
  const set = (i) => page.evaluate((v) => window.__game.setInput(v), i);
  await page.evaluate(() => window.__game.setCapture(true));
  await set({ enabled: true });
  // --warp jumps the SIM forward before the drive starts, so a capture can
  // reach states that are only reachable minutes in: a ticket past its warn
  // tint, the countdown ring (t<0.5), the wobble, a drained patience dial. A
  // whole tier of the HUD's late-service language is otherwise
  // unshippable-because-unverifiable — no frame we can take ever sees it.
  if (WARP > 0) await page.evaluate((n) => window.__game.warp(n), WARP);

  // Same routine as the live driver, in game-seconds rather than milliseconds.
  const plan = [
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

  const marks = MARKS.filter((m) => m > 0 && m < seconds);
  let t = 0;
  let nextMark = 0;
  let p = 0;

  while (t < seconds) {
    const stepDef = plan[p % plan.length];
    p++;
    await set({
      move: stepDef.move ?? { x: 0, y: 0 },
      grabPressed: !!stepDef.grab,
      useHeld: !!stepDef.use,
      enabled: true,
    });
    let remaining = stepDef.s ?? 0.4;
    while (remaining > 1e-4) {
      // Stop exactly on a mark so screenshots land on the game-second asked for.
      const toMark = nextMark < marks.length ? marks[nextMark] - t : Infinity;
      const slice = Math.min(remaining, Math.max(1 / 60, toMark));
      await page.evaluate((sec) => window.__game.advance(sec), slice);
      t += slice;
      remaining -= slice;
      if (nextMark < marks.length && t >= marks[nextMark] - 1e-6) {
        // Label with the SIM's own clock, not the mark. Under --warp the two
        // diverge: a run whose patience hits zero freezes the sim, so a frame
        // named t0163s can be showing 87 seconds of service. Ask the page.
        const at = await page.evaluate(() => Math.round(window.__game.snapshot().time));
        await shoot(`t${String(at).padStart(4, '0')}s`);
        nextMark++;
      }
    }
  }
  await set({ enabled: false, move: { x: 0, y: 0 } });
  const renderCostMs = await page.evaluate(() => window.__game.renderCostMs());
  await page.evaluate(() => window.__game.setCapture(false));
  return { gameSeconds: t, renderCostMs };
}

async function driveLive(page, seconds, shoot) {
  const set = (i) => page.evaluate((v) => window.__game.setInput(v), i);
  await set({ enabled: true });

  const t0 = Date.now();
  let shotIdx = 0;
  const marks = [1.5, 4, 8, 13, 18, seconds - 1].filter((s) => s > 0 && s < seconds);
  let nextMark = 0;

  // Head for the nearest crate, then loop a simple fetch/chop/serve routine.
  const plan = [
    { move: { x: 0, y: 1 }, ms: 900 },
    { grab: true, ms: 120 },
    { move: { x: -0.9, y: -0.6 }, ms: 1100 },
    { move: { x: -1, y: 0 }, ms: 700 },
    { grab: true, ms: 120 },
    { use: true, ms: 1900 },
    { use: false, ms: 100 },
    { grab: true, ms: 150 },
    { move: { x: 1, y: -0.5 }, dash: true, ms: 900 },
    { move: { x: 0, y: -1 }, ms: 800 },
    { grab: true, ms: 150 },
    { move: { x: 0.6, y: 1 }, ms: 900 },
    { move: { x: 0, y: 0 }, ms: 400 },
  ];

  let p = 0;
  while ((Date.now() - t0) / 1000 < seconds) {
    const stepDef = plan[p % plan.length];
    p++;
    await set({
      move: stepDef.move ?? { x: 0, y: 0 },
      grabPressed: !!stepDef.grab,
      useHeld: !!stepDef.use,
      enabled: true,
    });
    const end = Date.now() + (stepDef.ms ?? 400);
    while (Date.now() < end) {
      await sleep(60);
      const el = (Date.now() - t0) / 1000;
      if (nextMark < marks.length && el >= marks[nextMark]) {
        await shoot(`t${String(marks[nextMark]).padStart(4, '0')}s`, shotIdx++);
        nextMark++;
      }
    }
  }
  await set({ enabled: false, move: { x: 0, y: 0 } });
}

/**
 * A killed or crashed run used to leave its Chromium behind. Eleven of them
 * accumulated over one wave and ate ~4GB, which starves every other agent on a
 * two-core box. Everything that can end the process now tears the browser down.
 */
let ACTIVE_BROWSER = null;
function reap() {
  try {
    ACTIVE_BROWSER?.close();
  } catch {
    /* already gone */
  }
  ACTIVE_BROWSER = null;
}
for (const sig of ['exit', 'SIGINT', 'SIGTERM', 'uncaughtException']) {
  process.on(sig, () => {
    reap();
    if (sig !== 'exit') process.exit(sig === 'uncaughtException' ? 1 : 130);
  });
}

/** A run that hangs is worse than a run that fails: it eats the whole wave. */
function watchdog(ms) {
  const t = setTimeout(() => {
    console.error(`shoot.mjs watchdog fired after ${ms}ms — killing run`);
    reap();
    process.exit(2);
  }, ms);
  t.unref?.();
  return t;
}

async function main() {
  watchdog(Number(argv.watchdog ?? 900_000));
  if (!fs.existsSync(DIST)) {
    console.error('dist/ missing — run `npx vite build` first.');
    process.exit(1);
  }
  // WIPE THE TARGET FIRST. Reviewers judge whatever PNGs are in the folder, and
  // a folder that mixes today's frames with a previous build's is a folder that
  // gets a build nobody shipped scored against the reference — it has already
  // happened once, with six stale frames carrying a white oven and different
  // props sitting alongside the current set.
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve(DIST);
  // The sandbox ships a pinned Chromium; never let Playwright download one.
  const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-lcd-text',
      '--force-device-scale-factor=1',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  ACTIVE_BROWSER = browser;

  const report = { generatedAt: new Date().toISOString(), profiles: [] };

  // --profiles a,b  shoot only these ids. A full four-profile run is ~10 minutes
  // under the software rasteriser, which is too slow to iterate a set against;
  // the final pass always runs all four.
  const only = argv.profiles && argv.profiles !== true ? String(argv.profiles).split(',') : null;
  const chosen = only ? PROFILES.filter((p) => only.includes(p.id)) : PROFILES;
  for (const prof of chosen) {
    const ctx = await browser.newContext({
      viewport: prof.viewport,
      deviceScaleFactor: prof.dpr,
      isMobile: prof.touch,
      hasTouch: prof.touch,
      userAgent: prof.ua,
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    if (INSETS && prof.insets) {
      const i = prof.insets;
      await page.addInitScript((v) => {
        const css = `:root{--safe-t:${v.t}px !important;--safe-b:${v.b}px !important;--safe-l:${v.l}px !important;--safe-r:${v.r}px !important}`;
        const put = () => {
          const el = document.createElement('style');
          el.id = 'harness-insets';
          el.textContent = css;
          document.head.appendChild(el);
        };
        if (document.head) put();
        else document.addEventListener('DOMContentLoaded', put);
      }, i);
    }
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

    const dir = path.join(OUT, prof.id);
    fs.mkdirSync(dir, { recursive: true });
    // Capture through raw CDP rather than page.screenshot(). Playwright's
    // wrapper waits on font loading and goes through the browser surface
    // compositor; on this box that stalled past a 120s timeout. CDP JPEG is
    // ~4s and lands a 200KB file instead of a multi-megabyte PNG, which also
    // makes the images markedly faster for an agent to open and read.
    const cdp = await page.context().newCDPSession(page);
    const shots = [];
    // EVERY FRAME THE CRITIC WILL LOOK AT IS ALSO A FRAME THE RIG IS GRADED ON.
    //
    // cameraRig.describe() returns a `warnings` array graded against the
    // numbers measured off refs/dash-and-dine-01.jpeg, and until now it was a
    // field two levels down inside a snapshot object that a critic had to go
    // digging for — so a build shipped with the recession 40% over the
    // reference and nobody read the line that said so. Every screenshot now
    // samples it, and anything non-empty is collected into `cameraFailures` at
    // the top of the profile and printed in the console summary. A failing
    // frame announces itself.
    const cameraFailures = [];
    // ...and `notes` beside them, because describe() now separates the two.
    // A note is the containment rescue spending composition to keep the player
    // in the picture — authored behaviour that is worth COUNTING and is not a
    // defect. Keeping them in the same list is what stopped cameraFailures from
    // ever reaching zero on portrait. They are still collected and still
    // printed; they just do not fail the run.
    const cameraNotes = [];
    const sampleCamera = async (name) => {
      const cam = await page.evaluate(() => window.__game.snapshot()?.camera ?? null).catch(() => null);
      for (const msg of cam?.warnings ?? []) cameraFailures.push(`${name}: ${msg}`);
      for (const msg of cam?.notes ?? []) cameraNotes.push(`${name}: ${msg}`);
    };
    const shoot = async (name) => {
      await sampleCamera(name);
      const file = path.join(dir, `${name}.jpg`);
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 82,
        fromSurface: false,
        captureBeyondViewport: false,
      });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(path.relative(ROOT, file));
    };

    await page.goto(`http://127.0.0.1:${port}/?capture=1${argv.seed ? `&seed=${argv.seed}` : ''}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).catch(() => {});
    await sleep(700);
    await shoot('00-title');

    await page.evaluate(() => window.__game.start());
    await page.evaluate(() => window.__game.resetPerf());
    await sleep(400);
    await shoot('01-opening');

    const snapshots = [];
    const grab = async () => snapshots.push(await page.evaluate(() => window.__game.snapshot()));
    await grab();

    const driveStats = argv.live ? await driveLive(page, SECONDS, shoot) : await driveCapture(page, SECONDS, shoot);
    await grab();
    await shoot('90-late');

    // Let it run headless-fast to a game over state to capture the results screen.
    const final = await page.evaluate(() => window.__game.snapshot());

    await ctx.close();
    report.profiles.push({
      id: prof.id,
      label: prof.label,
      viewport: prof.viewport,
      dpr: prof.dpr,
      shots,
      driveStats,
      errors: errors.slice(0, 40),
      cameraFailures,
      cameraNotes,
      snapshots,
      final,
    });
    console.log(
      `${cameraFailures.length ? '✗' : '✓'} ${prof.label}  render=${driveStats?.renderCostMs ?? '?'}ms/frame  served=${final.score?.served ?? 0}  errors=${errors.length}  cameraFailures=${cameraFailures.length}  cameraNotes=${cameraNotes.length}`,
    );
    for (const f of cameraFailures.slice(0, 12)) console.log(`    ! ${f}`);
  }

  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${OUT}/report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
