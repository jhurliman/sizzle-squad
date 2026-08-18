// Layout audit for KITCHEN_MAP: connectivity, station reachability, lane widths,
// dressing density and run lengths. Pure text in, numbers out — no renderer.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/domain/kitchen.ts', import.meta.url), 'utf8');
const m = src.match(/export const KITCHEN_MAP = \[([\s\S]*?)\];/);
const MAP = [...m[1].matchAll(/'([^']*)'/g)].map((r) => r[1]);

const H = MAP.length;
const W = MAP[0].length;
const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && MAP[y][x] === '.';

// 1. floor connectivity
let seed = null;
for (let y = 0; y < H && !seed; y++) for (let x = 0; x < W; x++) if (free(x, y)) { seed = [x, y]; break; }
const seen = new Set([seed[1] * W + seed[0]]);
const q = [seed];
while (q.length) {
  const [x, y] = q.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!free(nx, ny) || seen.has(ny * W + nx)) continue;
    seen.add(ny * W + nx);
    q.push([nx, ny]);
  }
}
let total = 0;
const orphans = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (free(x, y)) {
  total++;
  if (!seen.has(y * W + x)) orphans.push(`${x},${y}`);
}
console.log(`floor cells ${total}, largest component ${seen.size}, orphaned ${orphans.length}${orphans.length ? ' @ ' + orphans.join(' ') : ''}`);

// 2. every station touches reachable floor
const bad = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ch = MAP[y][x];
  if (ch === '.' || ch === '#' || ch === '=') continue;
  const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => free(x + dx, y + dy) && seen.has((y + dy) * W + (x + dx)));
  if (!ok) bad.push(`${ch}@${x},${y}`);
}
console.log(`stations unreachable: ${bad.length}${bad.length ? ' ' + bad.join(' ') : ''}`);

// 3. dressing density + runs, over the play rows (2..H-2)
let dressed = 0, cells = 0;
const CENTRE = [6, 7, 8];
let centreDressed = 0, centreCells = 0;
let deepest = 1;
for (let y = 2; y < H - 1; y++) {
  const runs = [];
  let run = 0;
  for (let x = 1; x < W - 1; x++) {
    const ch = MAP[y][x];
    const isSt = ch !== '.' && ch !== '#';
    cells++;
    if (isSt) { dressed++; run++; deepest = Math.max(deepest, y); } else if (run) { runs.push(run); run = 0; }
    if (CENTRE.includes(x)) { centreCells++; if (isSt) centreDressed++; }
  }
  if (run) runs.push(run);
  // widest unbroken empty span in this row
  let gap = 0, worst = 0;
  for (let x = 1; x < W - 1; x++) {
    if (MAP[y][x] === '.') { gap++; worst = Math.max(worst, gap); } else gap = 0;
  }
  console.log(`row ${y}  ${MAP[y]}  dressed ${runs.reduce((a, b) => a + b, 0)}  runs [${runs.join(',')}]  widest empty run ${worst}`);
}
console.log(`dressed ${dressed}/${cells} = ${(100 * dressed / cells).toFixed(0)}%   centre x6-8 ${centreDressed}/${centreCells}   deepest dressed row ${deepest}`);

// 4. crate census
const census = {};
for (const row of MAP) for (const ch of row) if ('TLBU'.includes(ch)) census[ch] = (census[ch] ?? 0) + 1;
console.log('crates', census);

// 5. lane check: every free cell should have a free orthogonal neighbour (no 1x1 pockets)
const tight = [];
for (let y = 2; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (!free(x, y)) continue;
  const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => free(x + dx, y + dy)).length;
  if (n <= 1) tight.push(`${x},${y}(${n})`);
}
console.log(`dead-end floor cells: ${tight.length}${tight.length ? ' ' + tight.join(' ') : ''}`);
