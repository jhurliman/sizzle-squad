/**
 * DASH SWEEP — spamAdvantagePct against dashRecoverySeconds x dashRecoveryMul.
 *
 * Replicates movprobe's 20-unit steady-state race (pre-driven to cruise first,
 * so the launch advantage is excluded) and sweeps the recovery pair, because
 * the shipped dash was 24% faster than walking with no cost of any kind.
 *
 *   node tools/dashsweep.mjs
 */
import { build } from 'rolldown';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ROOT='/home/claude/kitchen';
const OUT=path.join(os.tmpdir(),`ds-${process.pid}.mjs`), E=path.join(os.tmpdir(),`dse-${process.pid}.ts`);
fs.writeFileSync(E,`export * from ${JSON.stringify(ROOT+'/src/domain/sim.ts')};
export * from ${JSON.stringify(ROOT+'/src/domain/content.ts')};
export * from ${JSON.stringify(ROOT+'/src/domain/kitchen.ts')};`);
await build({input:E,output:{file:OUT,format:'esm'},logLevel:'silent'});
const S=await import(OUT); fs.rmSync(E,{force:true}); fs.rmSync(OUT,{force:true});
const {createSim,step,TUNING,buildKitchen}=S;
const IN=(m,o={})=>({move:m,grabPressed:false,useHeld:false,dashPressed:!!o.dash});
const N=61, rows=[];
for(let y=0;y<N;y++) rows.push(y===0||y===N-1?'#'.repeat(N):'#'+'.'.repeat(N-2)+'#');
function race(useDash){
  const s=createSim({seed:1,botCount:0}); s.kitchen=buildKitchen(rows);
  const c=s.chefs[0]; c.pos={x:10,y:30}; c.vel={x:0,y:0};
  for(let i=0;i<90;i++){ step(s,[IN({x:1,y:0})]); s.events.length=0; }
  const start=c.pos.x; let ticks=0;
  for(let i=0;i<3000;i++){ const cd=s.dash[0].cooldown; step(s,[IN({x:1,y:0},{dash:useDash&&cd<=0})]); s.events.length=0; ticks++; if(c.pos.x-start>=20)break; }
  return ticks/60;
}
console.log('recov  mul   walk   spam   spamSpeed  advantage%');
for(const rec of [0.0,0.30,0.40,0.45,0.50,0.55,0.60,0.70]) for(const mul of [0.55,0.6,0.7]){
  TUNING.dashRecoverySeconds=rec; TUNING.dashRecoveryMul=mul;
  const w=race(false), d=race(true);
  console.log(`${rec.toFixed(2)}  ${mul}  ${w.toFixed(3)} ${d.toFixed(3)}  ${(20/d).toFixed(3)}     ${Math.round((w/d-1)*100)}`);
}
