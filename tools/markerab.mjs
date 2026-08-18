/**
 * MARKER A/B — what the focus marker is actually worth, in pixels.
 *
 * The only honest way to measure a marker is to build the game twice, once with
 * it and once without, drive the SAME closed-loop route through both, and
 * difference the two frames. Everything else measures the room.
 *
 * (The A/B baked into focusshot.mjs — walk up, then turn away — is not usable
 * for this any more: with focus coyote the turn no longer drops the focus, and
 * the body has moved 0.6u by the time it does, so the diff contains a chef.)
 *
 * Run from the repo root. Restores src/view/world.ts and rebuilds on the way
 * out, including if it throws.
 *
 *   node tools/markerab.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORLD = path.join(ROOT, 'src/view/world.ts');
const orig = fs.readFileSync(WORLD, 'utf8');
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

// The two lines that make the marker exist at all: the wash's target opacity
// and the glyph's visibility. Nothing else in the frame changes.
const OFF = orig
  .replace(
    'const want = focusId === st.id ? 0.62 + Math.sin(time * 2.6) * 0.08 : 0;',
    'const want = 0; void focusId;',
  )
  .replace('this.glyphRoot.visible = this.glyphScale > 0.02 && !!v;', 'this.glyphRoot.visible = false;');
if (OFF === orig) throw new Error('marker anchors not found — update tools/markerab.mjs');

try {
  sh('npx', ['vite', 'build']);
  sh('node', ['tools/focusshot.mjs', '--out', 'shots/ab-marker-on', '--profiles', 'desktop', '--seed', '7']);
  fs.writeFileSync(WORLD, OFF);
  sh('npx', ['vite', 'build']);
  sh('node', ['tools/focusshot.mjs', '--out', 'shots/ab-marker-off', '--profiles', 'desktop', '--seed', '7']);
} finally {
  fs.writeFileSync(WORLD, orig);
  sh('npx', ['vite', 'build']);
}

// The play field only. The top strip is the DOM HUD and the order balloons are
// CSS-animated on the wall clock, so both carry run-to-run noise that has
// nothing to do with the marker; below y=380 two captures of the same build
// differ by exactly zero pixels (verified with shots/ab-ctrl vs ab-ctrl2).
for (const shot of ['a-at-the-crate', 'b-mid-chop', 'd-put-it-back', 'e-plate-in-hand']) {
  console.log(`\n--- ${shot}   (play field, y 380-900)`);
  sh('node', [
    'tools/_marker.mjs',
    `shots/ab-marker-on/desktop/${shot}.jpg`,
    `shots/ab-marker-off/desktop/${shot}.jpg`,
    '0', '380', '1440', '520',
  ]);
}
