import sharp from 'sharp';
function rgb2hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
let h=0; if(d>1e-6){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360;}
return [h, mx<1e-6?0:d/mx, mx];}
for(const f of process.argv.slice(2)){
  const {data,info}=await sharp(f).resize(640,null,{fit:'inside'}).raw().toBuffer({resolveWithObject:true});
  const W=info.width,H=info.height;
  console.log(`\n== ${f}`);
  const bands=[['top 14-38%',0.14,0.38],['mid 38-62%',0.38,0.62],['low 62-100%',0.62,1.0]];
  for(const [name,a,b] of bands){
    const vs=[],ss=[],hs=[];
    for(let y=Math.round(H*a);y<Math.round(H*b);y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*3;const[h,s,v]=rgb2hsv(data[i],data[i+1],data[i+2]);vs.push(v);ss.push(s);if(s>0.15)hs.push(h);}
    vs.sort((x,y)=>x-y);ss.sort((x,y)=>x-y);hs.sort((x,y)=>x-y);
    const p=(arr,q)=>arr.length?arr[Math.floor(arr.length*q)]:0;
    console.log(` ${name}: V p05 ${p(vs,.05).toFixed(3)} p50 ${p(vs,.5).toFixed(3)} p95 ${p(vs,.95).toFixed(3)} | S p50 ${p(ss,.5).toFixed(3)} | H p25 ${p(hs,.25).toFixed(0)} p50 ${p(hs,.5).toFixed(0)} p75 ${p(hs,.75).toFixed(0)}`);
  }
}
