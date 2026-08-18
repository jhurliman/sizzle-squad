import { build } from 'rolldown';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ROOT='/home/claude/kitchen';
const OUT=path.join(os.tmpdir(),`d2-${process.pid}.mjs`), ENTRY=path.join(os.tmpdir(),`d2e-${process.pid}.ts`);
fs.writeFileSync(ENTRY,`export * from ${JSON.stringify(ROOT+'/src/domain/sim.ts')};
export * from ${JSON.stringify(ROOT+'/src/domain/content.ts')};
export * from ${JSON.stringify(ROOT+'/src/domain/kitchen.ts')};`);
await build({input:ENTRY,output:{file:OUT,format:'esm'},logLevel:'silent'});
const S=await import(OUT); fs.rmSync(ENTRY,{force:true}); fs.rmSync(OUT,{force:true});
const {createSim,step,TUNING,isWalkable}=S;
const IN=(m={x:0,y:0},o={})=>({move:m,grabPressed:!!o.grab,useHeld:!!o.use,dashPressed:!!o.dash});
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(p*b.length))];};
const r3=n=>Math.round(n*1000)/1000;
const s0=createSim({seed:5,botCount:0}); const k=s0.kitchen;
const spots=[]; for(let y=0;y<k.height;y++)for(let x=0;x<k.width;x++)if(isWalkable(k,x,y))spots.push({x:x+0.5,y:y+0.5});
const CARD=[[1,0],[-1,0],[0,1],[0,-1]];
for (const [label,dirs] of [['cardinal (lane-aligned)',CARD]]){
 let g=[],dead=0,n=0;
 for(const sp of spots) for(const [dx,dy] of dirs){
  const run=(dash)=>{const s=createSim({seed:5,botCount:0});const c=s.chefs[0];
   c.pos={...sp};c.vel={x:dx*TUNING.moveSpeed,y:dy*TUNING.moveSpeed};c.heading=Math.atan2(dy,dx);
   const p0={...c.pos};
   for(let i=0;i<30;i++){step(s,[IN({x:dx,y:dy},{dash:dash&&i===0})]);s.events.length=0;}
   return Math.hypot(c.pos.x-p0.x,c.pos.y-p0.y);};
  const w=run(false),d=run(true); n++; g.push(d-w); if(d-w<0.4)dead++;
 }
 console.log(`DASH ${label}: n=${n} median=${r3(q(g,0.5))} p25=${r3(q(g,0.25))} p75=${r3(q(g,0.75))} deadDashes=${Math.round(1000*dead/n)/10}%`);
}
// how far can you actually run before geometry stops you? open-lane audit
let runs=[];
for(const sp of spots) for(const [dx,dy] of CARD){
 const s=createSim({seed:5,botCount:0});const c=s.chefs[0];c.pos={...sp};c.vel={x:0,y:0};
 const p0={...c.pos}; let d=0;
 for(let i=0;i<180;i++){step(s,[IN({x:dx,y:dy})]);s.events.length=0;
  const nd=Math.hypot(c.pos.x-p0.x,c.pos.y-p0.y);
  if(Math.hypot(c.vel.x,c.vel.y)<0.3&&i>20){d=nd;break;} d=nd;}
 runs.push(d);
}
console.log(`OPEN RUN LENGTH before geometry stops you (cardinal, 3s cap): median=${r3(q(runs,0.5))}u  p25=${r3(q(runs,0.25))}u  p75=${r3(q(runs,0.75))}u  (accel to 90% needs 0.68u, dash needs 1.92u)`);
// distance to reach top speed vs typical lane run
console.log(`room ${k.width}x${k.height}, walkable cells ${spots.length}`);
