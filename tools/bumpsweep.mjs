/**
 * BUMP SWEEP — the per-pair contact-immunity window, priced against both of
 * the things it can break.
 *
 * Too short and one encounter still machine-guns (the shipped defect: 75.7% of
 * bumps re-hit the same chef within a second). Too long and two chefs working
 * the same bench stop registering at all and the room goes quiet — so this also
 * reports how many bumps the ROOM produces, not just the player, and where the
 * re-hits actually land in time.
 *
 *   node tools/bumpsweep.mjs [--sweep 0,0.2,0.35,0.5,0.7,1.0] [--kick 4.2]
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `bs-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `bse-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/domain/sim.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/content.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/kitchen.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/bots/brain.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const { createSim, step, SIM_DT, TUNING, BotDirector, seedPans } = S;
const NO = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };

const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
const SWEEP = String(arg('--sweep', '0,0.2,0.35,0.5,0.7,1.0')).split(',').map(Number);
const KICKS = String(arg('--kick', String(TUNING.bumpKnockback))).split(',').map(Number);
const CLOSE = String(arg('--close', String(TUNING.bumpClosingSpeed))).split(',').map(Number);
const SEEDS = [11, 23, 37, 51, 67, 83, 97, 109];
const SEC = 150;

const baseImm = TUNING.bumpImmunity, baseKick = TUNING.bumpKnockback;
console.log('close imm   kick  playerBumps/min  roomBumps/min  %rehitSamePair<1s  %rehit<2s  %playerStunned  p50gap(s)');
const baseClose = TUNING.bumpClosingSpeed;
for (const cl of CLOSE) for (const imm of SWEEP) for (const kick of KICKS) {
  TUNING.bumpClosingSpeed = cl;
  TUNING.bumpImmunity = imm;
  TUNING.bumpKnockback = kick;
  let all = 0, playerB = 0, re1 = 0, re2 = 0, stunT = 0, tot = 0;
  const gaps = [];
  for (const seed of SEEDS) {
    const s = createSim({ seed, botCount: 3 });
    seedPans(s);
    const dir = new BotDirector();
    for (const c of s.chefs) c.isPlayer = false;
    const me = s.chefs[0];
    const lastWith = new Map();
    let last = 0;
    for (let i = 0; i < SEC * 60; i++) {
      const map = dir.update(s, SIM_DT);
      step(s, s.chefs.map((c) => map.get(c.id) ?? NO));
      for (const e of s.events) if (e.t === 'bump') {
        all++;
        const key = [e.a, e.b].sort().join('-');
        const p = lastWith.get(key);
        if (p !== undefined && i - p < 60) re1++;
        if (p !== undefined && i - p < 120) re2++;
        lastWith.set(key, i);
        if (e.a === me.id || e.b === me.id) { playerB++; gaps.push((i - last) / 60); last = i; }
      }
      s.events.length = 0;
      if (me.stun > 0) stunT += SIM_DT;
      tot += SIM_DT;
      if (s.over) break;
    }
  }
  const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
  const f = (v) => v.toFixed(1).padStart(6);
  console.log(`${cl.toFixed(1)}  ${imm.toFixed(2)}  ${kick}  ${f((playerB / tot) * 60)}          ${f((all / tot) * 60)}         ${f((100 * re1) / Math.max(1, all))}       ${f((100 * re2) / Math.max(1, all))}       ${f((100 * stunT) / tot)}      ${q(gaps, 0.5).toFixed(2)}`);
}
TUNING.bumpImmunity = baseImm;
TUNING.bumpKnockback = baseKick;
TUNING.bumpClosingSpeed = baseClose;
