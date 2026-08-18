import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const DIST='/home/claude/kitchen/dist';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');let f=path.join(DIST,decodeURIComponent(u.pathname));
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(DIST,'index.html');
 res.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});res.end(fs.readFileSync(f));});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const br=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--force-device-scale-factor=1']});
const pg=await (await br.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1})).newPage();
pg.on('pageerror',e=>console.log('PAGEERR',e.message));
await pg.goto(`http://127.0.0.1:${port}/?capture=1`,{waitUntil:'load'});
await pg.waitForFunction(()=>!!window.__game,null,{timeout:120000});
await pg.evaluate(()=>{window.__game.start();window.__game.setCapture(true);window.__game.setInput({enabled:true});});
const rows=await pg.evaluate(async()=>{
 const out=[];
 const plan=[[{x:0,y:1},1.2],[{x:-1,y:-0.4},1.2],[{x:1,y:0},1.0],[{x:0,y:0},0.5],[{x:-1,y:0.6},1.2],[{x:1,y:-0.8},1.0],[{x:0,y:0},0.6],[{x:0,y:-1},1.0]];
 for(const [mv,sec] of plan){
  window.__game.setInput({move:mv,grabPressed:false,useHeld:false,dashPressed:false,enabled:true});
  for(let i=0;i<Math.round(sec/0.05);i++){ window.__game.advance(0.05); for(const r of window.__rig()) out.push(r); }
 }
 return out;});
await br.close(); server.close();
const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.min(b.length-1,Math.floor(p*b.length))]:NaN;};
const f=n=>Number.isFinite(n)?n.toFixed(1):'-';
const moving=rows.filter(r=>r.run>0.3), cruise=rows.filter(r=>r.run>0.6);
console.log(`rows=${rows.length} moving=${moving.length} cruise=${cruise.length}`);
console.log('keys:',Object.keys(rows[0]||{}).join(','));
for(const k of ['speed','run','gait','amp','brake','thighSplitDeg','pitchDeg','armSplitDeg','shOp','shSX']){
 const v=moving.map(r=>r[k]).filter(Number.isFinite);
 if(v.length) console.log(`  ${k.padEnd(14)} min ${f(q(v,0))} p10 ${f(q(v,0.1))} med ${f(q(v,0.5))} p90 ${f(q(v,0.9))} max ${f(q(v,0.999))}`);
}
const bad=moving.filter(r=>r.thighSplitDeg<45);
console.log(`thighSplit<45deg on ${bad.length}/${moving.length} moving frames (${(100*bad.length/Math.max(1,moving.length)).toFixed(0)}%)`);
const bp=cruise.filter(r=>r.pitchDeg<12);
console.log(`pitch<12deg on ${bp.length}/${cruise.length} cruise frames (${(100*bp.length/Math.max(1,cruise.length)).toFixed(0)}%)`);
