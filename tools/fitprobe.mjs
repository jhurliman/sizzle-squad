/**
 * DOES THE WHOLE LEVEL FIT ON A PORTRAIT SCREEN?
 *
 *   node tools/fitprobe.mjs
 *
 * Asked directly: "the entire playable game visible on screen in portrait with
 * no horizontal scrolling at all". That is a question about PIXELS, not about
 * camera constants, so this answers it in pixels: it projects the corners of
 * the level's floor through the live camera (`__game.project`) and reports
 * where each lands relative to the frame.
 *
 * WHY ALL FOUR CORNERS AND NOT THE BACK WALL. A pitched perspective camera
 * projects a rectangular floor as a TRAPEZOID. The far edge is further from the
 * lens, so the frame covers more world there; the NEAR edge is the narrow end
 * and is what actually gets cut. Every portrait measurement in this project has
 * used `backWallFrac`, which is the WIDE end, so the edge that binds has been
 * invisible the whole time.
 *
 * MEASURED ON THE SHIPPED CAMERA (iPhone portrait, 393x852, real insets, at the
 * settled pose — see SETTLE below):
 *
 *                     far edge      near edge     trapezoid
 *   room shell        593px 151%    3126px 795%     5.27x
 *   walkable floor    555px 141%    1525px 388%     2.75x
 *
 * Reproducible to the pixel across runs; if these drift, the camera moved.
 *
 * The binding edge is nearly EIGHT times too wide, not 1.1x. That is why
 * raising HALF_WIDTH_MIN to 8.2 solved to 5.1 and did nothing, why raising the
 * room's wall height stopped helping at halfWidth 6.62, and why HALF_WIDTH_MAX
 * at 8.95 was never reached: all three buy width at the FAR end.
 *
 * What does address it is PITCH, because steepening collapses the trapezoid and
 * a steeper camera fits the same floor from closer. Swept with the rig bypassed
 * and the camera pulled back until every corner is inside the frame, 22.5 / 35
 * / 50 / 65 / 90 degrees all fit; 50-65 uses the frame best, 22.5 leaves the
 * room a wedge in the top third, and 90 is a flat floor plan with no wall art
 * at all. The cost at every one of them is character size — the chef lands near
 * 3% of frame height against the reference's 15-19.5%.
 *
 * REPORTS, DOES NOT GATE. The shipped camera deliberately does not fit the whole
 * level on a phone — it frames the play, and the level is bigger than the frame
 * by design. So "part of the level is off screen" is the correct answer for the
 * game as it stands, and exiting non-zero on it would wire a permanent red light
 * into the tree for a decision nobody has made. Exit 0 and print the numbers.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const W = 393;
const H = 852;

/**
 * THE LEVEL'S OWN BOUNDS, READ OFF THE AUTHORITATIVE MAP.
 *
 * The first cut asked `snapshot()` for `kitchen.width/height` and fell back to
 * a hardcoded 15x10 when that came back undefined — which it always did, since
 * the snapshot has no `kitchen` key at all. So every number this printed was
 * measured against a guess, and the guess was WRONG: KITCHEN_MAP is 11 rows,
 * not 10, so the "front" corner was projected one row short of the level and
 * the trapezoid was understated (5.27x, not the 3.81x first reported). A probe
 * whose headline measurement is taken against a fallback constant is worse than
 * no probe. tools/camsync.mjs already parses this file for the same reason.
 */
function kitchenBounds() {
  const rows = fs
    .readFileSync(path.join(ROOT, 'src/domain/kitchen.ts'), 'utf8')
    .match(/export const KITCHEN_MAP = \[([\s\S]*?)\];/)[1]
    .split('\n')
    .map((l) => l.trim().replace(/^'|',?$/g, ''))
    .filter((l) => l.length > 0 && !l.startsWith('//'));
  const width = rows[0].length;
  const height = rows.length;
  // ...and the WALKABLE extent as well as the shell. "The entire playable game"
  // is a claim about where a chef can go and what they can reach, which is the
  // interior, not the wall ring around it. Both are reported because they are
  // different questions and the answer differs by a third.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') return;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + 1);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + 1);
    });
  });
  return { width, height, play: { minX, maxX, minY, maxY } };
}

const K = kitchenBounds();

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run `npx vite build` first.');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
  ],
});

// Real notch/home-indicator insets, the same ones shoot.mjs injects. Without
// them this measures a frame no phone has.
const INSETS = ':root{--safe-t:59px !important;--safe-b:34px !important;--safe-l:0px !important;--safe-r:0px !important}';
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${port}/`);
await page.addStyleTag({ content: INSETS });
await page.waitForFunction(() => window.__game);
await page.evaluate(() => window.__game.start());

/**
 * SETTLE ON A DEFINED POSE, DO NOT SAMPLE A TRANSIENT ONE.
 *
 * Two reasons the first cut's "wait 600ms and measure" was not reproducible.
 * `beginRun()` starts a 1.1-second push-in, so 600ms lands mid-move. And the
 * requestAnimationFrame loop does not reliably drive this page headlessly at
 * all — which is the entire reason capture mode exists (see README) and is why
 * an earlier experiment here appeared to do nothing: the camera override ran
 * zero times because `frame()` was never called.
 *
 * So take the clock, warp past the push-in, and advance a FIXED number of
 * seconds. The pose is then a function of the build and nothing else.
 */
await page.evaluate(() => window.__game.setCapture(true));
await page.evaluate(() => window.__game.warp(20));
await page.evaluate(() => window.__game.advance(2));

const r = await page.evaluate((k) => {
  const P = (x, y) => window.__game.project({ x, y, z: 0 });
  const box = (minX, maxX, minY, maxY) => ({
    farL: P(minX, minY),
    farR: P(maxX, minY),
    nearL: P(minX, maxY),
    nearR: P(maxX, maxY),
  });
  return {
    shell: box(0, k.width, 0, k.height),
    play: box(k.play.minX, k.play.maxX, k.play.minY, k.play.maxY),
  };
}, K);

const side = (p) => (p.x < 0 ? `${(-p.x).toFixed(0)}px OFF left` : p.x > W ? `${(p.x - W).toFixed(0)}px OFF right` : 'inside');

console.log(`\nlevel ${K.width} x ${K.height} cells   walkable x ${K.play.minX}..${K.play.maxX}, y ${K.play.minY}..${K.play.maxY}   frame ${W}x${H}\n`);

let allIn = true;
for (const [label, b] of [
  ['room shell    ', r.shell],
  ['walkable floor', r.play],
]) {
  const far = b.farR.x - b.farL.x;
  const near = b.nearR.x - b.nearL.x;
  const fits = [b.farL, b.farR, b.nearL, b.nearR].every((p) => p.x >= -1 && p.x <= W + 1);
  allIn = allIn && fits;
  console.log(`  ${label}`);
  console.log(`    far  corners  ${b.farL.x.toFixed(0).padStart(7)} ${b.farR.x.toFixed(0).padStart(7)}   ${side(b.farL)} / ${side(b.farR)}`);
  console.log(`    near corners  ${b.nearL.x.toFixed(0).padStart(7)} ${b.nearR.x.toFixed(0).padStart(7)}   ${side(b.nearL)} / ${side(b.nearR)}`);
  console.log(
    `    far edge ${far.toFixed(0)}px (${((far / W) * 100).toFixed(0)}%)   ` +
      `near edge ${near.toFixed(0)}px (${((near / W) * 100).toFixed(0)}%)   ` +
      `trapezoid ${(near / far).toFixed(2)}x\n`,
  );
}

console.log(
  allIn
    ? '  the whole level is on screen.\n'
    : '  part of the level is off screen — which is the shipped camera working as designed.\n' +
        '  The near edge is the binding one; see the header for why pitch, not zoom, is the lever.\n',
);

await browser.close();
server.close();
