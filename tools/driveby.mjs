/**
 * DRIVE-BY DIAGNOSTIC — why a grab taken on the run misses.
 *
 * critic_station.mjs rig 7 reports a pass/fail rate and nothing else, which is
 * enough to know the feature is broken and not enough to fix it. This replays
 * the same manoeuvre and prints, for every failure, the state of each gate term
 * at the moment the press was made: box distance against `reach`, angle to the
 * station centre against the cone the chef had earned at that speed, and
 * whether the bench was occluded. A miss for being 3 degrees outside the cone
 * and a miss for being out of reach want opposite fixes.
 *
 *   node tools/driveby.mjs             # per-stand-off rates + failure census
 *   node tools/driveby.mjs sweep       # sweep reachConeMoving
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(os.tmpdir(), `db-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `db-entry-${process.pid}.ts`);
fs.writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/domain/sim.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/content.ts'))};
export * from ${JSON.stringify(path.join(ROOT, 'src/domain/kitchen.ts'))};
`,
);
await build({ input: ENTRY, output: { file: OUT, format: 'esm' }, logLevel: 'silent' });
const S = await import(OUT);
fs.rmSync(ENTRY, { force: true });
fs.rmSync(OUT, { force: true });
const { createSim, step, TUNING, seedPans, buildKitchen, stationCenter, isWalkable } = S;

const NO = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false, dashPressed: false };
const R = TUNING.chefRadius;
const K0 = buildKitchen();
const DEG = 180 / Math.PI;

function collides(K, x, y) {
  for (let cy = Math.floor(y - R); cy <= Math.floor(y + R); cy++)
    for (let cx = Math.floor(x - R); cx <= Math.floor(x + R); cx++) {
      if (isWalkable(K, cx, cy)) continue;
      const px = Math.max(cx, Math.min(x, cx + 1));
      const py = Math.max(cy, Math.min(y, cy + 1));
      if ((x - px) ** 2 + (y - py) ** 2 < R * R) return true;
    }
  return false;
}
const boxDist = (st, x, y) =>
  Math.hypot(Math.max(st.cell.x - x, 0, x - (st.cell.x + 1)), Math.max(st.cell.y - y, 0, y - (st.cell.y + 1)));

function run(verbose) {
  const out = [];
  for (const off of [0.7, 0.9, 1.1, 1.3, 1.5]) {
    let hit = 0, tot = 0;
    const why = { reach: 0, cone: 0, other: 0 };
    const bestAng = [], bestBd = [];
    for (const st of K0.stations.filter((x) => x.kind === 'crate' || x.kind === 'plates')) {
      const c = stationCenter(st);
      const f = st.facing;
      const perp = { x: -f.y, y: f.x };
      for (let dir = -1; dir <= 1; dir += 2) {
        const stand = { x: c.x + f.x * off, y: c.y + f.y * off };
        if (collides(K0, stand.x, stand.y)) continue;
        let start = null;
        for (let d = 3.0; d >= 1.2; d -= 0.2) {
          const x = stand.x - perp.x * dir * d, y = stand.y - perp.y * dir * d;
          if (x > R && y > R && x < K0.width - R && y < K0.height - R && !collides(K0, x, y)) { start = { x, y, d }; break; }
        }
        if (!start || start.d < 1.8) continue;
        const s = createSim({ seed: 4, botCount: 0 });
        seedPans(s);
        const ch = s.chefs[0];
        ch.pos.x = start.x; ch.pos.y = start.y; ch.carrying = null;
        ch.heading = Math.atan2(perp.y * dir, perp.x * dir);
        let got = false; const presses = [];
        // The state at the tick with the SMALLEST |along| — the press the rig
        // treats as the drive-by grab.
        let closest = null, closestAlong = 9;
        for (let t = 0; t < 200; t++) {
          const dx = stand.x - ch.pos.x, dy = stand.y - ch.pos.y;
          const along = dx * perp.x * dir + dy * perp.y * dir;
          if (Math.abs(along) < closestAlong) {
            closestAlong = Math.abs(along);
            const vx = c.x - ch.pos.x, vy = c.y - ch.pos.y;
            const dist = Math.hypot(vx, vy) || 1;
            const ang = Math.acos(Math.max(-1, Math.min(1, (vx * Math.cos(ch.heading) + vy * Math.sin(ch.heading)) / dist)));
            const speed = Math.hypot(ch.vel.x, ch.vel.y);
            closest = {
              bd: boxDist(st, ch.pos.x, ch.pos.y),
              ang,
              cone: Math.min(TUNING.reachConeMax, TUNING.reachCone + TUNING.reachConeMoving * Math.min(1, speed / TUNING.moveSpeed)),
              speed,
            };
          }
          const press = Math.abs(along) < 0.12;
          if (press) {
            const vx = c.x - ch.pos.x, vy = c.y - ch.pos.y;
            const dist = Math.hypot(vx, vy) || 1;
            const a2 = Math.acos(Math.max(-1, Math.min(1, (vx * Math.cos(ch.heading) + vy * Math.sin(ch.heading)) / dist)));
            presses.push({ along, a2, bd: boxDist(st, ch.pos.x, ch.pos.y) });
          }
          step(s, [{ ...NO, move: { x: perp.x * dir, y: perp.y * dir }, grabPressed: press }]);
          if (press) {
            const q = presses[presses.length - 1];
            const cand = [];
            for (const o of K0.stations) {
              const bd2 = boxDist(o, ch.pos.x, ch.pos.y);
              if (bd2 > TUNING.reach + TUNING.focusKeepReach) continue;
              const ox = stationCenter(o).x - ch.pos.x, oy = stationCenter(o).y - ch.pos.y;
              const dd = Math.hypot(ox, oy) || 1;
              const aa = Math.acos(Math.max(-1, Math.min(1, (ox * Math.cos(ch.heading) + oy * Math.sin(ch.heading)) / dd)));
              cand.push(`${o.kind}#${o.id}@${o.cell.x},${o.cell.y} ang ${(aa * DEG).toFixed(0)} bd ${bd2.toFixed(2)} raw ${(aa * 0.8 + bd2 * 0.9).toFixed(2)}`);
            }
            q.s = `along ${q.along.toFixed(3)} ang ${(q.a2 * DEG).toFixed(1)} bd ${q.bd.toFixed(2)} -> focus ${ch.focus} action ${ch.focusAction}\n         cands: ${cand.join(' ; ')}`;
          }
          if (ch.carrying) { got = true; break; }
          if (along < -1.8) break;
        }
        tot++;
        if (got) hit++;
        else if (closest) {
          bestAng.push(closest.ang * DEG); bestBd.push(closest.bd);
          if (verbose && why.cone + why.reach < 3) console.log(`      MISS st${st.id} presses: ${presses.map((q) => q.s).join(' | ') || 'none'}`);
          if (closest.bd > TUNING.reach) why.reach++;
          else if (closest.ang > closest.cone) why.cone++;
          else why.other++;
        }
      }
    }
    if (!tot) continue;
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    out.push({ off, hit, tot, why, ang: mean(bestAng), bd: mean(bestBd) });
    if (verbose)
      console.log(
        `   stand-off ${off.toFixed(1)}u: ${hit}/${tot} (${((hit / tot) * 100).toFixed(0)}%) landed` +
          `   misses: out of reach ${why.reach}, outside cone ${why.cone}, other ${why.other}` +
          `   mean at closest approach: angle ${mean(bestAng).toFixed(1)} deg, boxDist ${mean(bestBd).toFixed(2)}u (reach ${TUNING.reach})`,
      );
  }
  return out;
}

if (process.argv[2] === 'sweep') {
  console.log('== TWO LEVERS AGAINST THE DRIVE-BY GRAB');
  console.log('   rows: extra cone earned at cruise.  cols: aim point wound back by N ticks.');
  console.log('   cell: % of drive-by presses that produced a pickup (all stand-offs inside reach).');
  let head = '           ';
  for (const t of [0, 1, 2, 3]) head += `  lead ${t}tk`;
  console.log(head);
  for (const deg of [0, 4, 8.8, 14]) {
    TUNING.reachConeMoving = deg / DEG;
    let line = `   +${deg.toFixed(1).padStart(4)} deg`;
    for (const t of [0, 1, 2, 3]) {
      TUNING.focusLead = t / 60;
      const rows = run(false).filter((r) => r.off <= 1.3);
      const tot = rows.reduce((a, r) => a + r.tot, 0), hit = rows.reduce((a, r) => a + r.hit, 0);
      line += `   ${((hit / tot) * 100).toFixed(0).padStart(6)}%`;
    }
    console.log(line);
  }
} else if (process.argv[2] === 'behind') {
  /**
   * MOVING-BEHIND CENSUS. tools/focusprobe.mjs sweeps behind-the-shoulder picks
   * with a STATIONARY chef, where `focusLead` is identically zero and therefore
   * unmeasurable. This asks the same question of a chef at speed: of every focus
   * the gate hands a moving body, what fraction sit more than 90 degrees off
   * heading measured from where that body is NOW?
   */
  console.log('== BEHIND-THE-SHOULDER PICKS WHILE MOVING  (findFocus with a real velocity)');
  for (const ticks of [0, 1, 2, 3, 6]) {
    TUNING.focusLead = ticks / 60;
    let picks = 0, behind = 0, worst = 0;
    const s = createSim({ seed: 2, botCount: 0 });
    const ch = s.chefs[0];
    for (let gy = 0.5; gy < K0.height; gy += 0.25)
      for (let gx = 0.5; gx < K0.width; gx += 0.25) {
        if (collides(K0, gx, gy)) continue;
        for (let h = 0; h < 24; h++) {
          const a = (h / 24) * Math.PI * 2;
          // Travelling flat out along the heading, which is what a chef in a
          // lane is doing and the only state in which the lead term is live.
          ch.pos.x = gx; ch.pos.y = gy; ch.heading = a;
          ch.vel.x = Math.cos(a) * TUNING.moveSpeed; ch.vel.y = Math.sin(a) * TUNING.moveSpeed;
          ch.focus = null; ch.focusHold = 0; ch.carrying = null;
          const got = S.findFocus(s, ch);
          if (!got) continue;
          picks++;
          const c = stationCenter(got);
          const off = Math.abs(Math.atan2(Math.sin(Math.atan2(c.y - gy, c.x - gx) - a), Math.cos(Math.atan2(c.y - gy, c.x - gx) - a)));
          if (off > Math.PI / 2) behind++;
          worst = Math.max(worst, off * DEG);
        }
      }
    console.log(`   lead ${ticks} tick(s) (${((ticks / 60) * TUNING.moveSpeed).toFixed(3)}u): ${behind}/${picks} picks behind the shoulder = ${((behind / picks) * 100).toFixed(2)}%   worst ${worst.toFixed(1)} deg`);
  }
} else {
  console.log('== DRIVE-BY (run past a bench at cruise, press at closest approach)');
  run(true);
}
