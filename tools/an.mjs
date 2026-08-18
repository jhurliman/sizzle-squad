import sharp from 'sharp';
const files = process.argv.slice(2);
function rgb2hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
let h=0; if(d>1e-6){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360;}
return [h, mx<1e-6?0:d/mx, mx];}
for(const f of files){
  const {data,info}=await sharp(f).resize(640,null,{fit:'inside'}).raw().toBuffer({resolveWithObject:true});
  const W=info.width,H=info.height;
  const y0=Math.round(H*0.14); // skip HUD strip
  const vs=[],sats=[];const hueBins=new Array(12).fill(0);let satPix=0,tot=0;
  for(let y=y0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*3;const[h,s,v]=rgb2hsv(data[i],data[i+1],data[i+2]);
    vs.push(v);sats.push(s);tot++;
    if(s>0.5&&v>0.25){satPix++;hueBins[Math.floor(h/30)%12]++;}}
  vs.sort((a,b)=>a-b);sats.sort((a,b)=>a-b);
  const p=(a,q)=>a[Math.floor(a.length*q)];
  console.log(`\n== ${f}  (${W}x${H})`);
  console.log(` V p05 ${p(vs,0.05).toFixed(3)}  p25 ${p(vs,0.25).toFixed(3)}  p50 ${p(vs,0.5).toFixed(3)}  p75 ${p(vs,.75).toFixed(3)} p95 ${p(vs,0.95).toFixed(3)}  p99 ${p(vs,.99).toFixed(3)}`);
  console.log(` S p50 ${p(sats,0.5).toFixed(3)}  p75 ${p(sats,.75).toFixed(3)} p95 ${p(sats,0.95).toFixed(3)}`);
  console.log(` sat% ${(100*satPix/tot).toFixed(1)}  hue-of-sat: ` + hueBins.map((c,i)=>`${i*30}:${(100*c/Math.max(satPix,1)).toFixed(0)}`).filter((_,i)=>hueBins[i]>satPix*0.03).join(' '));
}
