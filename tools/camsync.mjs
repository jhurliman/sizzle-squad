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
const R = makeReport();

/**
 * BOTH SWEEPS, NOT ONE.
 *
 * camprobe and camlost each carry their own hand-copied `K`/`CL` blocks.
 * Checking only camlost leaves the other free to drift and keep printing
 * confident measurements of a camera that no longer exists — which is the
 * exact failure this file was written to prevent, just relocated.
 */
const SWEEPS = ['tools/camlost.mjs', 'tools/camprobe.mjs'];

/**
 * A NAMED CONSTANT IS NOT ALWAYS A BARE NUMBER, AND THE UNITS DIFFER.
 *
 * The first cut matched `const NAME = 1.23;` only, so `HALF_FOV_H_MAX`, whose
 * rig declaration is `31.5 * DEG`, fell out of the comparison entirely and was
 * then reported as having "no named counterpart in the rig" — which was simply
 * false. Retuning it would have sailed through the gate.
 *
 * The wrinkle worth naming: the rig stores angles in RADIANS (`31.5 * DEG`)
 * while both sweeps store the same constants in DEGREES (`31.5`). Comparing
 * the resolved values would report every angle as drifted. So the authored
 * number is what gets compared — the literal the human typed — and the `* DEG`
 * is recorded as the unit rather than folded into the value.
 */
function rigConstants(src) {
  const out = new Map();
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]*) = ([^;]+);/gm)) {
    const [, name, rawExpr] = m;
    const expr = rawExpr.trim();
    let lit = /^(-?[0-9.]+)$/.exec(expr);
    if (lit) {
      out.set(name, { value: Number(lit[1]), unit: '' });
      continue;
    }
    lit = /^(-?[0-9.]+)\s*\*\s*DEG$/.exec(expr);
    if (lit) {
      out.set(name, { value: Number(lit[1]), unit: ' deg' });
      continue;
    }
    // Anything else (a computed constant, a lerp, a call) is not comparable
    // by inspection. Recorded so it can be REPORTED rather than dropped.
    out.set(name, { value: null, unit: '', expr });
  }
  return out;
}

/** `NAME: 1.23,` inside a sweep's K and CL blocks. */
function sweepConstants(src) {
  const out = new Map();
  for (const block of ['K', 'CL']) {
    const start = src.indexOf(`const ${block} = {`);
    if (start < 0) continue;
    const body = src.slice(start, src.indexOf('\n};', start));
    for (const m of body.matchAll(/^\s{2}([A-Z][A-Z0-9_]*): (-?[0-9.]+),/gm)) {
      out.set(m[1], Number(m[2]));
    }
  }
  return out;
}

const rigConsts = rigConstants(rig);

for (const rel of SWEEPS) {
  const sweepConsts = sweepConstants(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const shared = [...sweepConsts.keys()].filter((k) => rigConsts.get(k)?.value !== null && rigConsts.has(k)).sort();
  const drifted = shared.filter((k) => rigConsts.get(k).value !== sweepConsts.get(k));
  // Split the leftovers honestly: a name the rig does not declare at all is a
  // different problem from one it declares as an expression this cannot read.
  const absent = [...sweepConsts.keys()].filter((k) => !rigConsts.has(k)).sort();
  const opaque = [...sweepConsts.keys()].filter((k) => rigConsts.get(k)?.value === null).sort();

  R.section(`${rel} still describes the real rig (${shared.length} constants compared)`);
  R.check(
    'every shared constant matches',
    drifted.length === 0,
    drifted.length
      ? `\n       ${drifted
          .map((k) => `${k}: rig ${rigConsts.get(k).value}${rigConsts.get(k).unit} vs sweep ${sweepConsts.get(k)}`)
          .join('\n       ')}`
      : '',
  );
  R.check(
    'nothing the rig declares is silently unreadable',
    opaque.length === 0,
    opaque.length ? ` (${opaque.join(', ')} — declared as an expression this cannot parse)` : '',
  );
  if (absent.length) {
    console.log(`  note  ${absent.length} sweep constant(s) are not top-level rig constants and cannot be`);
    console.log(`        auto-checked: ${absent.join(', ')}`);
  }
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

/**
 * THE EXACT PROFILE SET, NOT WHATEVER TURNED UP.
 *
 * Checking only that SOME rows parsed lets a renamed or dropped profile vanish
 * from the gate while everything left behind still passes. Portrait is the
 * first-class layout in this project; it disappearing quietly is precisely the
 * regression nobody would notice.
 */
const EXPECTED_PROFILES = ['portrait', 'iph-land', 'ipad', 'desktop'];

for (const widen of [0, 1]) {
  const rows = offPicture(widen);
  const label = widen ? 'at full widen' : 'at rest';
  R.section(`nobody loses the player ${label}`);
  const seen = rows.map((r) => r.profile);
  const missing = EXPECTED_PROFILES.filter((p) => !seen.includes(p));
  R.check(
    'every expected profile was measured',
    missing.length === 0,
    missing.length ? ` (missing: ${missing.join(', ')}; got ${seen.join(', ') || 'nothing'})` : '',
  );
  for (const r of rows) {
    R.check(`${r.profile.padEnd(9)} keeps the player in frame`, r.lost === 0, ` (${r.lost}/${r.total} cells lost)`);
  }
}

process.exit(R.finish('the camera sweeps are honest and the frame holds'));
