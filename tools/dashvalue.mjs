/**
 * DASH VALUE — is mashing the button still strictly optimal IN THE REAL ROOM?
 *
 * movprobe's spamAdvantagePct races 20 units down an infinite empty arena,
 * which is the one situation the kitchen never contains. This runs the same
 * race over 60 real station-to-station errands in KITCHEN_MAP, steered by the
 * same flow field the bots use, and reports:
 *
 *   walkTime   errand times with the button never pressed
 *   spamTime   errand times with it pressed the instant the cooldown clears
 *   timedTime  errand times with it pressed only when there is >= 2u of
 *              unobstructed lane straight ahead — i.e. used as a tool
 *
 * A dash worth having is one where timed beats walk clearly and spam does not.
 *
 *   node tools/dashvalue.mjs [--sweep 0,0.15,0.22,0.3,0.45] [--mul 0.7]
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `dv-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `dve-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/domain/sim.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/content.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/kitchen.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/nav.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const { createSim, step, TUNING, isWalkable, buildFlow, flowDir } = S;
const IN = (m, dash) => ({ move: m, grabPressed: false, useHeld: false, dashPressed: !!dash });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const SWEEP = String(arg('--sweep', String(TUNING.dashRecoverySeconds))).split(',').map(Number);
const MULS = String(arg('--mul', String(TUNING.dashRecoveryMul))).split(',').map(Number);
const CDS = String(arg('--cd', String(TUNING.dashCooldown))).split(',').map(Number);

const base = createSim({ seed: 5, botCount: 0 });
const k = base.kitchen;
const spots = [];
for (let y = 0; y < k.height; y++) for (let x = 0; x < k.width; x++) if (isWalkable(k, x, y)) spots.push({ x: x + 0.5, y: y + 0.5 });

// 60 deterministic errands: every 7th walkable cell to the cell 31 further on
const errands = [];
for (let i = 0; i < 60; i++) {
  const a = spots[(i * 7) % spots.length];
  const b = spots[(i * 7 + 31) % spots.length];
  if (Math.hypot(a.x - b.x, a.y - b.y) < 3) continue;
  errands.push([a, b]);
}

/** clear cells straight ahead along the dominant axis of `dir` */
function runway(pos, dir) {
  const dx = Math.abs(dir.x) >= Math.abs(dir.y) ? Math.sign(dir.x) : 0;
  const dy = dx === 0 ? Math.sign(dir.y) : 0;
  let n = 0, cx = Math.floor(pos.x) + dx, cy = Math.floor(pos.y) + dy;
  while (isWalkable(k, cx, cy) && n < 14) { n++; cx += dx; cy += dy; }
  return n + 0.14;
}

function errandTime([from, to], mode) {
  const s = createSim({ seed: 5, botCount: 0 });
  const c = s.chefs[0];
  c.pos = { ...from }; c.vel = { x: 0, y: 0 };
  const flow = buildFlow(s.kitchen, [to]);
  for (let i = 0; i < 900; i++) {
    const dir = flowDir(flow, s.kitchen, c.pos);
    let dash = false;
    if (mode === 'spam') dash = true;
    else if (mode === 'timed') dash = runway(c.pos, dir) >= 2.0;
    step(s, [IN(dir, dash)]);
    s.events.length = 0;
    if (Math.hypot(c.pos.x - to.x, c.pos.y - to.y) < 1.0) return i / 60;
  }
  return null;
}

const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log(`errands ${errands.length}   map ${k.width}x${k.height}`);
console.log('cd    recov  mul   walk(s)  spam(s)  spamAdv%   timed(s)  timedAdv%');
const baseRec = TUNING.dashRecoverySeconds, baseMul = TUNING.dashRecoveryMul;
const baseCd = TUNING.dashCooldown;
for (const cd of CDS) for (const rec of SWEEP) for (const mul of MULS) {
  TUNING.dashCooldown = cd;
  TUNING.dashRecoverySeconds = rec;
  TUNING.dashRecoveryMul = mul;
  const w = [], sp = [], ti = [];
  for (const e of errands) {
    const a = errandTime(e, 'walk'), b = errandTime(e, 'spam'), c2 = errandTime(e, 'timed');
    if (a === null || b === null || c2 === null) continue;
    w.push(a); sp.push(b); ti.push(c2);
  }
  const W = sum(w), SP = sum(sp), TI = sum(ti);
  console.log(`n=${w.length} ${cd.toFixed(2)}  ${rec.toFixed(2)}   ${mul}   ${W.toFixed(2)}   ${SP.toFixed(2)}    ${((W / SP - 1) * 100).toFixed(1).padStart(5)}     ${TI.toFixed(2)}    ${((W / TI - 1) * 100).toFixed(1).padStart(5)}`);
}
TUNING.dashRecoverySeconds = baseRec;
TUNING.dashRecoveryMul = baseMul;
TUNING.dashCooldown = baseCd;
