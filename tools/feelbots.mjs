/**
 * FEELBOTS — the bot piece measured as a TEAMMATE, not as a solver.
 *
 * Offline (rolldown-bundled domain + brain, no browser, no rendering) so a
 * paired-seed A/B over eight full 180s services costs seconds. Everything the
 * wave-2 critic measured is reproduced here in one pass, plus the things their
 * separate one-off scripts could not cross-reference:
 *
 *   THROUGHPUT     served / missed / close rate / reached-the-clock, per policy.
 *   LEGIBILITY     plan starts per bot per minute, plan LIFE distribution,
 *                  completion, and re-takes (a plan a bot drops and re-picks).
 *                  Polled from `jobsDebug()` every tick, so it needs nothing
 *                  from the telemetry and cannot be gamed by it.
 *   BUMPS          real `bump` sim-events, contacts, and the escalation ratio
 *                  (what fraction of near-misses become a stun).
 *   PLACEMENT      world-space spread, clot, one-sided casts, and the desktop
 *                  camera projection (fixed rig: centreOffset < 0.01 all run).
 *   AWARENESS      plans voided by another chef taking the item, yields,
 *                  hesitation — under a FROZEN player and under a THIEF player,
 *                  which is the only pair that can tell "notices you" from
 *                  "notices anybody".
 *
 *   node tools/feelbots.mjs [--runs 8] [--seconds 180]
 *                           [--mode idle,bot,chaos,thief] [--why]
 */
import { build } from 'rolldown';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = '/home/claude/kitchen';
const OUT = path.join(os.tmpdir(), `feelbots-${process.pid}.mjs`);
const ENTRY = path.join(os.tmpdir(), `feelbots-entry-${process.pid}.ts`);
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
const { createSim, step, SIM_DT, BotDirector, isWalkable, seedPans } = S;

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const RUNS = Number(arg('--runs', 8));
const SECONDS = Number(arg('--seconds', 180));
// idle  = bots alone, the floor.   bot = chef 0 driven by the same brain, the
// competent-partner ceiling.        chaos = a player wandering and mashing grab.
// thief = a player deliberately taking what a bot is walking toward.
const MODES = String(arg('--mode', 'idle,bot,chaos,thief')).split(',');
const WHY = process.argv.includes('--why');
// halfWidthAtChef, from cameraRig.describe(): portrait 2.10, iPad 4.49,
// desktop 4.99, iPhone landscape 6.70. This is the one number the brain is
// told about the shot; see OFFSTAGE_COST in brain.ts.
const SHOT = Number(arg('--shot', 4.99));
const NOIN = { move: { x: 0, y: 0 }, grabPressed: false, useHeld: false };
const mul = (a) => () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Desktop rig, from cameraRig.describe() on the shipped build: pitch 22.5deg,
// vfov 38.9deg, eye 6.33, camZ 15.55, aspect 1.6, and centreOffset never leaves
// 0.004 of room centre on desktop, so a fixed camera is the honest model here.
const CAM = { pitch: (22.5 * Math.PI) / 180, vfov: (38.9 * Math.PI) / 180, h: 6.33, z: 15.55, aspect: 1.6, cx: 7.5 };
const TANV = Math.tan(CAM.vfov / 2);
const TANH = TANV * CAM.aspect;
const project = (x, hgt, depth) => {
  const dx = x - CAM.cx;
  const dy = hgt - CAM.h;
  const dz = depth - CAM.z;
  const fy = -Math.sin(CAM.pitch);
  const fz = -Math.cos(CAM.pitch);
  const uy = Math.cos(CAM.pitch);
  const uz = -Math.sin(CAM.pitch);
  const d = dy * fy + dz * fz;
  return { x: dx / (d * TANH), y: (dy * uy + dz * uz) / (d * TANV), d };
};
const CHEF_H = 1.09;

// PORTRAIT 393x852, from the same describe(): pitch 23, vfov 52.5, eye 6.71,
// camZ 15.78, aspect 0.461, halfWidth 3.69, halfWidthAtChef 2.10. The rig pans
// x with the player and is hard-stopped at 0.84 of halfWidth from room centre,
// so camera x = 7.5 + clamp(player.x - 7.5, +-3.10). Verified against the live
// rig with tools/_critport.mjs, which reads describe() per tick in a browser.
const PCAM = { pitch: (23 * Math.PI) / 180, vfov: (52.5 * Math.PI) / 180, h: 6.71, z: 15.78, aspect: 0.461 };
const PTANV = Math.tan(PCAM.vfov / 2);
const PTANH = PTANV * PCAM.aspect;
const pproject = (x, hgt, depth, camx) => {
  const dx = x - camx, dy = hgt - PCAM.h, dz = depth - PCAM.z;
  const fy = -Math.sin(PCAM.pitch), fz = -Math.cos(PCAM.pitch);
  const uy = Math.cos(PCAM.pitch), uz = -Math.sin(PCAM.pitch);
  const d = dy * fy + dz * fz;
  return { x: dx / (d * PTANH), y: (dy * uy + dz * uz) / (d * PTANV), d };
};

const pct = (n, d) => ((100 * n) / Math.max(1, d)).toFixed(1) + '%';
const quant = (v, q) => (v.length ? v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, (v.length * q) | 0)] : 0);

for (const MODE of MODES) {
  const A = {
    served: [], missed: [], time: [],
    botTicks: 0, ticks: 0,
    offSide: 0, offBottom: 0, offTop: 0, inFrame: 0,
    merged: 0, clot: 0, oneSide: 0, spread: 0,
    heights: [], thirds: [0, 0, 0], deep: 0,
    bumps: 0, contacts: 0, fires: 0, burns: 0, wrong: 0,
    planStarts: 0, planLives: [], retakes: 0, retakeGaps: [],
    stolen: 0, yields: 0, hesitate: 0, voids: 0, stalls: 0, sours: 0,
    idle: 0, travel: 0, station: 0, work: 0, jobs: 0, done: 0,
    why: new Map(), nullWhy: new Map(), closed: new Map(), rotted: new Map(), perBotWhy: new Map(),
    thiefGrabs: 0, slips: 0,
    playerDx: [], carrying: 0, working: 0, movingIntent: 0, idleIntent: 0,
    pIn: 0, pSide: 0, pBottom: 0, pTop: 0, pDx: [], pMerged: 0, pVisible: [],
  };

  for (let run = 0; run < RUNS; run++) {
    const realRandom = Math.random;
    const rand = mul((run * 0x9e3779b1) >>> 0);
    Math.random = rand;
    const s = createSim({ seed: (run * 7919 + 13) >>> 0, botCount: 3 });
    // THE STOVES SHIP WITH PANS ON THEM. main.ts calls this immediately after
    // createSim; every offline critic probe in tools/ that skipped it was
    // measuring a kitchen where no bot can ever cook, so Bacon Roll and BLT
    // rotted 100% of the time and the whole 'grill' role was unreachable.
    seedPans(s);
    const bots = new BotDirector();
    bots.setShotWidth(SHOT);
    if (MODE === 'bot') bots.setDrivePlayer(true);
    const player = s.chefs.find((c) => c.isPlayer);
    const k = s.kitchen;
    let target = { ...player.pos };
    let retarget = 0;
    let grabIn = 0.5;
    let grabCd = 0;
    let t = 0;
    // plan bookkeeping, polled from jobsDebug()
    const curPlan = new Map();
    const planStart = new Map();
    const lastDrop = new Map();
    let prevServed = 0;
    let prevMissed = 0;
    let live = new Map(s.orders.map((o) => [o.id, o.recipe.name]));

    while (t < SECONDS && !s.over) {
      const bi = bots.update(s, SIM_DT);
      const inputs = [];
      for (const c of s.chefs) inputs[c.id] = bi.get(c.id) ?? NOIN;
      if (MODE === 'chaos') {
        retarget -= SIM_DT;
        if (retarget <= 0) {
          retarget = 1.4 + rand() * 2.4;
          for (let i = 0; i < 40; i++) {
            const cx = 1 + Math.floor(rand() * (k.width - 2));
            const cy = 1 + Math.floor(rand() * (k.height - 2));
            if (isWalkable(k, cx, cy)) { target = { x: cx + 0.5, y: cy + 0.5 }; break; }
          }
        }
        const vx = target.x - player.pos.x, vy = target.y - player.pos.y, d = Math.hypot(vx, vy) || 1;
        grabIn -= SIM_DT;
        const grab = grabIn <= 0;
        if (grab) grabIn = 0.7 + rand() * 1.3;
        inputs[player.id] = { move: { x: (vx / d) * 0.95, y: (vy / d) * 0.95 }, grabPressed: grab, useHeld: false };
      } else if (MODE === 'thief') {
        // Walk at whatever station a bot is currently heading for and take it.
        const jd = bots.jobsDebug();
        let tgt = null, best = 1e9;
        for (const str of Object.values(jd)) {
          const m = /@(\d+)$/.exec(str);
          if (!m) continue;
          const st = s.kitchen.stations.find((x) => x.id === +m[1]);
          if (!st || !st.holding) continue;
          const d = Math.hypot(player.pos.x - (st.cell.x + 0.5), player.pos.y - (st.cell.y + 0.5));
          if (d < best) { best = d; tgt = st; }
        }
        let mv = { x: 0, y: 0 }, grab = false;
        if (tgt) {
          const vx = tgt.cell.x + 0.5 - player.pos.x, vy = tgt.cell.y + 0.5 - player.pos.y, d = Math.hypot(vx, vy) || 1;
          mv = { x: vx / d, y: vy / d };
          grabCd -= SIM_DT;
          if (!player.carrying && player.focus === tgt.id && grabCd <= 0) { grab = true; grabCd = 0.25; A.thiefGrabs++; }
          if (player.carrying && grabCd <= 0) { grab = true; grabCd = 0.6; }
        }
        inputs[player.id] = { move: mv, grabPressed: grab, useHeld: false };
      }
      step(s, inputs);
      for (const e of s.events) {
        if (e.t === 'bump') A.bumps++;
        if (e.t === 'fire') A.fires++;
        if (e.t === 'burn') A.burns++;
        if (e.t === 'serveWrong' || e.t === 'wrongServe') A.wrong++;
      }
      s.events.length = 0;
      if (s.score.served !== prevServed || s.score.missed !== prevMissed) {
        const now = new Set(s.orders.map((o) => o.id));
        const bin = s.score.served > prevServed ? A.closed : A.rotted;
        for (const [id, name] of live) if (!now.has(id)) bin.set(name, (bin.get(name) ?? 0) + 1);
        prevServed = s.score.served;
        prevMissed = s.score.missed;
      }
      live = new Map(s.orders.map((o) => [o.id, o.recipe.name]));

      // ---- plan legibility, polled
      const jd = bots.jobsDebug();
      for (const [id, str] of Object.entries(jd)) {
        const now = str.endsWith(': idle') ? null : str;
        const was = curPlan.get(id) ?? null;
        if (now === was) continue;
        if (was) {
          A.planLives.push(t - (planStart.get(id) ?? t));
          lastDrop.set(id + '|' + was, t);
        }
        if (now) {
          A.planStarts++;
          planStart.set(id, t);
          if (now.includes('put it back where I found it')) A.slips++;
          const prev = lastDrop.get(id + '|' + now);
          if (prev !== undefined && t - prev > 0.5) { A.retakes++; A.retakeGaps.push(t - prev); }
        }
        curPlan.set(id, now);
      }

      // ---- placement
      A.ticks++;
      const boxes = [];
      const pboxes = [];
      let left = 0, right = 0, pairs = 0, sum = 0;
      for (let i = 0; i < s.chefs.length; i++) {
        for (let j = i + 1; j < s.chefs.length; j++) {
          const d = Math.hypot(s.chefs[i].pos.x - s.chefs[j].pos.x, s.chefs[i].pos.y - s.chefs[j].pos.y);
          sum += d; pairs++;
          if (d < 0.78) A.contacts++;
        }
      }
      A.spread += pairs ? sum / pairs : 0;
      for (const c of s.chefs) {
        c.pos.x < 7.5 ? left++ : right++;
        const feet = project(c.pos.x, 0, c.pos.y);
        const head = project(c.pos.x, CHEF_H, c.pos.y);
        const sx = (feet.x + 1) * 0.5 * 1440, syB = (1 - feet.y) * 0.5 * 900, syT = (1 - head.y) * 0.5 * 900;
        boxes.push({ sx, syB, h: syB - syT });
        {
          const pcx0 = 7.5 + Math.max(-3.1, Math.min(3.1, player.pos.x - 7.5));
          const pf0 = pproject(c.pos.x, 0, c.pos.y, pcx0), ph0 = pproject(c.pos.x, CHEF_H, c.pos.y, pcx0);
          if (Math.abs(pf0.x) < 1.1 && pf0.y > -1.1 && pf0.y < 1.1)
            pboxes.push({ sx: (pf0.x + 1) * 0.5 * 393, syB: (1 - pf0.y) * 0.5 * 852, h: ((1 - pf0.y) - (1 - ph0.y)) * 0.5 * 852 });
        }
        if (c.isPlayer) continue;
        A.botTicks++;
        A.heights.push(syB - syT);
        A.playerDx.push(Math.abs(c.pos.x - player.pos.x));
        const okx = Math.abs(feet.x) < 1, oky = feet.y > -1 && feet.y < 1;
        if (okx && oky) A.inFrame++;
        else { if (!okx) A.offSide++; if (feet.y <= -1) A.offBottom++; if (feet.y >= 1) A.offTop++; }
        if (c.pos.y > 8.5) A.deep++;
        if (c.carrying) A.carrying++;
        if (c.intent === 'working') A.working++;
        else if (c.intent === 'moving') A.movingIntent++;
        else A.idleIntent++;
        const pcx = 7.5 + Math.max(-3.1, Math.min(3.1, player.pos.x - 7.5));
        const pf = pproject(c.pos.x, 0, c.pos.y, pcx);
        A.pDx.push(Math.abs(c.pos.x - pcx));
        const pokx = Math.abs(pf.x) < 1, poky = pf.y > -1 && pf.y < 1;
        if (pokx && poky) A.pIn++;
        else { if (!pokx) A.pSide++; if (pf.y <= -1) A.pBottom++; if (pf.y >= 1) A.pTop++; }
        A.thirds[syB < 614.7 ? 0 : syB < 757.3 ? 1 : 2]++;
      }
      if (left === 0 || right === 0) A.oneSide++;
      for (const a of s.chefs) {
        let near = 0;
        for (const b of s.chefs) if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 2) near++;
        if (near >= 3) { A.clot++; break; }
      }
      let ov = false;
      for (let i = 0; i < boxes.length && !ov; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const w = 0.62 * Math.max(a.h, b.h);
          if (Math.abs(a.sx - b.sx) < w * 0.6 && Math.abs(a.syB - b.syB) < Math.max(a.h, b.h) * 0.8) { ov = true; break; }
        }
      if (ov) A.merged++;
      let pov = false;
      for (let i = 0; i < pboxes.length && !pov; i++)
        for (let j = i + 1; j < pboxes.length; j++) {
          const a = pboxes[i], b = pboxes[j];
          const w = 0.62 * Math.max(a.h, b.h);
          if (Math.abs(a.sx - b.sx) < w * 0.6 && Math.abs(a.syB - b.syB) < Math.max(a.h, b.h) * 0.8) { pov = true; break; }
        }
      if (pov) A.pMerged++;
      A.pVisible.push(pboxes.length);
      t += SIM_DT;
    }

    const rep = bots.tele.report();
    for (const [bid, b] of Object.entries(rep.bots)) {
      const pb = A.perBotWhy.get(bid) ?? new Map();
      for (const [key, v] of Object.entries(b.why)) pb.set(key, (pb.get(key) ?? 0) + v);
      A.perBotWhy.set(bid, pb);
    }
    for (const b of Object.values(rep.bots)) {
      A.stolen += b.stolen; A.yields += b.yields; A.hesitate += b.hesitate;
      A.voids += b.voids; A.stalls += b.stalls; A.sours += b.sours;
      A.idle += b.idle; A.travel += b.travel; A.station += b.station; A.work += b.work;
      A.jobs += b.jobs; A.done += b.done;
      for (const [key, v] of Object.entries(b.why)) A.why.set(key, (A.why.get(key) ?? 0) + v);
      for (const [key, v] of Object.entries(b.nullWhy ?? {})) A.nullWhy.set(key, (A.nullWhy.get(key) ?? 0) + v);
    }
    A.served.push(s.score.served);
    A.missed.push(s.score.missed);
    A.time.push(s.time);
    Math.random = realRandom;
    process.stderr.write(`  ${MODE} run ${run + 1}: served=${s.score.served} missed=${s.score.missed} t=${s.time.toFixed(0)}\n`);
  }

  const mean = (v) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const secs = A.ticks * SIM_DT;
  const perBotMin = (n) => (n / (secs / 60) / 3).toFixed(1);
  console.log(`\n================ MODE ${MODE}  (${RUNS} paired seeds x ${SECONDS}s) ================`);
  console.log(
    `THROUGHPUT  served ${mean(A.served).toFixed(2)}/service (${((mean(A.served) / SECONDS) * 60).toFixed(2)}/min)` +
      `  missed ${mean(A.missed).toFixed(2)}  close ${((100 * mean(A.served)) / Math.max(1, mean(A.served) + mean(A.missed))).toFixed(0)}%` +
      `  reached-the-clock ${A.time.filter((x) => x >= SECONDS - 2).length}/${RUNS}`,
  );
  console.log(
    `LEGIBILITY  plan starts ${perBotMin(A.planStarts)}/bot/min` +
      `  median life ${quant(A.planLives, 0.5).toFixed(2)}s` +
      `  <0.5s ${pct(A.planLives.filter((x) => x < 0.5).length, A.planLives.length)}` +
      `  <1.0s ${pct(A.planLives.filter((x) => x < 1.0).length, A.planLives.length)}` +
      `  completion ${((100 * A.done) / Math.max(1, A.jobs)).toFixed(0)}%` +
      `  re-takes ${(A.retakes / RUNS / 3).toFixed(1)}/bot/service`,
  );
  const life = A.idle + A.travel + A.station + A.work + A.hesitate;
  console.log(
    `TIME        idle ${pct(A.idle, life)}  hesitate ${pct(A.hesitate, life)}  travel ${pct(A.travel, life)}` +
      `  station ${pct(A.station, life)}  work ${pct(A.work, life)}` +
      `   voids ${(A.voids / RUNS).toFixed(1)} stalls ${(A.stalls / RUNS).toFixed(1)} sours ${(A.sours / RUNS).toFixed(1)}`,
  );
  console.log(
    `BUMPS       ${(A.bumps / RUNS).toFixed(1)} bump events/service = ${(A.bumps / (secs / 60)).toFixed(1)}/min` +
      `  contact-ticks ${pct(A.contacts, A.ticks)}  chef-time frozen ${(((A.bumps * 2 * 0.16) / (secs * 4)) * 100).toFixed(1)}%` +
      `   fire ${(A.fires / RUNS).toFixed(1)} burn ${(A.burns / RUNS).toFixed(1)} wrongServe ${(A.wrong / RUNS).toFixed(1)}`,
  );
  console.log(
    `PLACEMENT   desktop in-frame ${pct(A.inFrame, A.botTicks)}  offSide ${pct(A.offSide, A.botTicks)}` +
      `  offBottom ${pct(A.offBottom, A.botTicks)}  offTop ${pct(A.offTop, A.botTicks)}` +
      `  y>8.5 ${pct(A.deep, A.botTicks)}`,
  );
  console.log(
    `            merged silhouettes ${pct(A.merged, A.ticks)}  clot ${pct(A.clot, A.ticks)}` +
      `  one-sided cast ${pct(A.oneSide, A.ticks)}  spread ${(A.spread / A.ticks).toFixed(2)}u` +
      `  height p50 ${quant(A.heights, 0.5).toFixed(0)}px (${((100 * quant(A.heights, 0.5)) / 900).toFixed(1)}%)`,
  );
  console.log(
    `            floor thirds back/mid/front ${pct(A.thirds[0], A.botTicks)}/${pct(A.thirds[1], A.botTicks)}/${pct(A.thirds[2], A.botTicks)}` +
      `   |bot.x - player.x| median ${quant(A.playerDx, 0.5).toFixed(2)}u  p75 ${quant(A.playerDx, 0.75).toFixed(2)}u`,
  );
  console.log(
    `PORTRAIT    in-frame ${pct(A.pIn, A.botTicks)}  offSide ${pct(A.pSide, A.botTicks)}` +
      `  offBottom ${pct(A.pBottom, A.botTicks)}  offTop ${pct(A.pTop, A.botTicks)}` +
      `  merged ${pct(A.pMerged, A.ticks)}  chefs on screen (of 4) mean ${(A.pVisible.reduce((x, y) => x + y, 0) / Math.max(1, A.pVisible.length)).toFixed(2)}` +
      `  |bot.x - cam.x| median ${quant(A.pDx, 0.5).toFixed(2)}u (halfWidthAtChef 2.10)`,
  );
  console.log(
    `POSE        carrying ${pct(A.carrying, A.botTicks)}  intent working ${pct(A.working, A.botTicks)}` +
      `  moving ${pct(A.movingIntent, A.botTicks)}  idle ${pct(A.idleIntent, A.botTicks)}`,
  );
  console.log(
    `AWARENESS   stolen ${(A.stolen / RUNS).toFixed(1)}/service  yields ${(A.yields / RUNS).toFixed(1)}/service` +
      `  hesitation ${(A.hesitate / RUNS / 3).toFixed(2)}s/bot/service  slips ${(A.slips / RUNS).toFixed(1)}/service` +
      (MODE === 'thief' ? `   thief grabs ${(A.thiefGrabs / RUNS).toFixed(0)}/service` : ''),
  );
  if (WHY) {
    const tot = [...A.why.values()].reduce((a, b) => a + b, 0);
    console.log('  PLAN MIX:');
    for (const [key, v] of [...A.why].sort((a, b) => b[1] - a[1]).slice(0, 14))
      console.log(`    ${pct(v, tot).padStart(6)}  ${key}`);
    // HOW DIFFERENT ARE THE THREE PROGRAMS, as one number: mean pairwise L1
    // distance between the bots' plan-mix histograms. 0 = the same bot three
    // times; 2 = three bots with no plan kind in common.
    {
      const ids = [...A.perBotWhy.keys()].sort();
      const norm = ids.map((id) => {
        const pb = A.perBotWhy.get(id);
        const tot2 = [...pb.values()].reduce((a, b) => a + b, 0) || 1;
        return new Map([...pb].map(([k, v]) => [k, v / tot2]));
      });
      let sum = 0, n = 0;
      for (let i = 0; i < norm.length; i++)
        for (let j = i + 1; j < norm.length; j++) {
          let d = 0;
          for (const k of new Set([...norm[i].keys(), ...norm[j].keys()])) d += Math.abs((norm[i].get(k) ?? 0) - (norm[j].get(k) ?? 0));
          sum += d; n++;
        }
      console.log(`  ROLE SEPARATION (mean pairwise L1 of plan mixes, 0=identical 2=disjoint): ${(sum / Math.max(1, n)).toFixed(2)}`);
    }
    console.log('  PER BOT, top five:');
    for (const [bid, pb] of [...A.perBotWhy].sort()) {
      const tot2 = [...pb.values()].reduce((a, b) => a + b, 0);
      console.log(`    chef ${bid}: ` + [...pb].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${pct(v, tot2)}`).join(' | '));
    }
    const nt = [...A.nullWhy.values()].reduce((a, b) => a + b, 0);
    console.log('  IDLE, itemised:');
    for (const [key, v] of [...A.nullWhy].sort((a, b) => b[1] - a[1]).slice(0, 6))
      console.log(`    ${pct(v, nt).padStart(6)}  ${key}`);
    console.log('  TICKETS closed / rotted:');
    for (const key of new Set([...A.closed.keys(), ...A.rotted.keys()]))
      console.log(`    ${String(A.closed.get(key) ?? 0).padStart(4)} / ${String(A.rotted.get(key) ?? 0).padStart(4)}  ${key}`);
  }
}
