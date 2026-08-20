import { build } from 'rolldown';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const ROOT='/home/claude/kitchen';
const OUT=path.join(os.tmpdir(),`cw-${process.pid}.mjs`), E=path.join(os.tmpdir(),`cwe-${process.pid}.ts`);
fs.writeFileSync(E,`export * from ${JSON.stringify(ROOT+'/src/domain/sim.ts')};
export * from ${JSON.stringify(ROOT+'/src/domain/content.ts')};
export * from ${JSON.stringify(ROOT+'/src/domain/kitchen.ts')};
export * from ${JSON.stringify(ROOT+'/src/bots/brain.ts')};`);
await build({input:E,output:{file:OUT,format:'esm'},logLevel:'silent'});
const S=await import(OUT); fs.rmSync(E,{force:true}); fs.rmSync(OUT,{force:true});
const {createSim,step,SIM_DT,TUNING}=S; const DT=SIM_DT;
const IN=(m={x:0,y:0},o={})=>({move:m,grabPressed:!!o.grab,useHeld:!!o.use});
const D=2*TUNING.chefRadius;
let touching=0,near=0,tot=0, burst=0, burstLen=[], cur=0;
let bumpsWithSamePartnerWithin1s=0, allB=0;
const seeds=[11,23,37,51,67,83];
for(const seed of seeds){
 const s=createSim({seed,botCount:3}); S.seedPans(s); const dir=new S.BotDirector();
 for(const c of s.chefs)c.isPlayer=false;
 const me=s.chefs[0]; const lastWith=new Map();
 for(let i=0;i<150*60;i++){
  const map=dir.update(s,DT); step(s,s.chefs.map(c=>map.get(c.id)??IN()));
  for(const e of s.events) if(e.t==='bump'){ allB++;
    const key=[e.a,e.b].sort().join('-'); const p=lastWith.get(key);
    if(p!==undefined && (i-p)<60) bumpsWithSamePartnerWithin1s++;
    lastWith.set(key,i); }
  s.events.length=0;
  let minD=1e9;
  for(const c of s.chefs) if(c.id!==me.id) minD=Math.min(minD,Math.hypot(c.pos.x-me.pos.x,c.pos.y-me.pos.y));
  tot++; if(minD<D){touching++;cur++;} else {if(cur>0)burstLen.push(cur/60);cur=0;}
  if(minD<D*2) near++;
  if(s.over)break;
 }
}
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(p*b.length))];};
console.log(`CROWDING (6 seeds x 150s, player chef)`);
console.log(`  %timeOverlapping another chef (<${D.toFixed(2)}u apart)   ${(100*touching/tot).toFixed(1)}%`);
console.log(`  %timeWithin two body widths                     ${(100*near/tot).toFixed(1)}%`);
console.log(`  contact episodes                                ${burstLen.length}  median ${q(burstLen,0.5).toFixed(2)}s  p90 ${q(burstLen,0.9).toFixed(2)}s  max ${Math.max(...burstLen).toFixed(2)}s`);
console.log(`  %bumps that re-hit the SAME chef within 1s      ${(100*bumpsWithSamePartnerWithin1s/allB).toFixed(1)}%  <- a bump that does not separate the bodies`);
