/**
 * THE CAMERA SWEEPS ARE A COPY OF THE RIG — SO CHECK THEY STILL ARE.
 *
 *   node tools/camsync.mjs
 *
 * tools/camprobe.mjs and tools/camlost.mjs answer the question no screenshot
 * can: over every cell a chef can stand on, does the composition hold and does
 * the player stay in the picture? They do it by REIMPLEMENTING the rig's solve
 * in plain JS, with the constants copied across by hand.
 *
 * That is a liability dressed as a test. The day somebody tunes
 * `HALF_WIDTH_MIN` in src/view/cameraRig.ts and does not copy it here, these
 * sweeps keep printing confident numbers about a camera the game no longer has
 * — and they would keep passing. A test that can silently stop describing the
 * thing it tests is worse than no test, because it is trusted.
 *
 * So this reads both files and asserts they agree, and it says out loud which
 * numbers it CANNOT check rather than leaving the hole invisible. Then it runs
 * the containment sweep itself and asserts the property that actually matters:
 * on every profile, at rest and at full widen, the player is never off-picture.
 *
 * Exits non-zero on any mismatch, so it can gate a deploy.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeReport } from './domainkit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rig = fs.readFileSync(path.join(ROOT, 'src/view/cameraRig.ts'), 'utf8');
const sweep = fs.readFileSync(path.join(ROOT, 'tools/camlost.mjs'), 'utf8');
const R = makeReport();

/** `const NAME = 1.23;` at the top level of the rig. */
const rigConsts = new Map();
for (const m of rig.matchAll(/^const ([A-Z][A-Z0-9_]*) = (-?[0-9.]+);/gm)) {
  rigConsts.set(m[1], Number(m[2]));
}

/** `NAME: 1.23,` inside the sweep's K and CL blocks. */
const sweepConsts = new Map();
for (const block of ['K', 'CL']) {
  const start = sweep.indexOf(`const ${block} = {`);
  if (start < 0) continue;
  const body = sweep.slice(start, sweep.indexOf('\n};', start));
  for (const m of body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*): (-?[0-9.]+),/gm)) {
    sweepConsts.set(m[1], Number(m[2]));
  }
}

const shared = [...sweepConsts.keys()].filter((k) => rigConsts.has(k)).sort();
const drifted = shared.filter((k) => rigConsts.get(k) !== sweepConsts.get(k));
const unchecked = [...sweepConsts.keys()].filter((k) => !rigConsts.has(k)).sort();

R.section(`the sweep still describes the real rig (${shared.length} constants compared)`);
R.check(
  'every shared constant matches',
  drifted.length === 0,
  drifted.length
    ? `\n       ${drifted.map((k) => `${k}: rig ${rigConsts.get(k)} vs camlost ${sweepConsts.get(k)}`).join('\n       ')}`
    : '',
);

/**
 * NOT A FAILURE, BUT NOT A SECRET EITHER.
 *
 * Some of what the sweep models is not a top-level `const` in the rig — the
 * follow hold and the follow blend are written inline as `lerp(0.88, 0.84, t)`
 * inside the profile solve, and the tall-aspect crop is derived rather than
 * named. Those cannot be diffed automatically. Printing them keeps the size of
 * the blind spot honest instead of implying this file checks everything.
 */
if (unchecked.length) {
  console.log(`  note  ${unchecked.length} sweep constant(s) have no named counterpart in the rig`);
  console.log(`        and are NOT auto-checked: ${unchecked.join(', ')}`);
}

/**
 * AND THE PROPERTY ITSELF: THE PLAYER STAYS IN THE PICTURE.
 *
 * Wave 4 moved portrait's rest frame to where its widened frame already was,
 * which took the worst standing position from 16 cells off-picture to none —
 * on every profile, at rest and at full widen. That is the invariant worth
 * holding, and it is the one a future tuning pass is most likely to break.
 */
function offPicture(widen) {
  const out = execFileSync('node', [path.join(ROOT, 'tools/camlost.mjs'), `WIDEN=${widen}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const rows = [];
  for (const m of out.matchAll(/^(\S+)\s+worstOffset.*OFF-PICTURE cells (\d+)\/(\d+)/gm)) {
    rows.push({ profile: m[1], lost: Number(m[2]), total: Number(m[3]) });
  }
  return rows;
}

for (const widen of [0, 1]) {
  const rows = offPicture(widen);
  const label = widen ? 'at full widen' : 'at rest';
  R.section(`nobody loses the player ${label}`);
  if (!rows.length) {
    R.check(`camlost reported something readable ${label}`, false, ' (no profile rows parsed)');
    continue;
  }
  for (const r of rows) {
    R.check(`${r.profile.padEnd(9)} keeps the player in frame`, r.lost === 0, ` (${r.lost}/${r.total} cells lost)`);
  }
}

process.exit(R.finish('the camera sweeps are honest and the frame holds'));
