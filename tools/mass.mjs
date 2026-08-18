import sharp from 'sharp';
function hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
let h=0;if(d>1e-6){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}
return [h,mx<1e-6?0:d/mx,mx];}
const masses=[
 ['wood  H25-42 S.60-.92 low', 25,42,0.60,0.92, 0.55,1.0],
 ['floor H30-50 S.20-.50 low', 30,50,0.20,0.50, 0.55,1.0],
 ['stone H40-70 S.05-.32 top', 40,70,0.05,0.32, 0.14,0.55],
 ['ochre H28-45 S.65-.95 top', 28,45,0.65,0.95, 0.14,0.55],
];
for(const f of process.argv.slice(2)){
  const {data,info}=await sharp(f).resize(640,null,{fit:'inside'}).raw().toBuffer({resolveWithObject:true});
  const W=info.width,H=info.height;
  console.log(f.split('/').slice(-2).join('/'));
  for(const [name,h0,h1,s0,s1,y0,y1] of masses){
    const vs=[],ss=[],hh=[];
    for(let y=Math.round(H*y0);y<Math.round(H*y1);y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*3;const[hu,s,v]=hsv(data[i],data[i+1],data[i+2]);
      if(hu>=h0&&hu<=h1&&s>=s0&&s<=s1){vs.push(v);ss.push(s);hh.push(hu);}}
    vs.sort((a,b)=>a-b);ss.sort((a,b)=>a-b);hh.sort((a,b)=>a-b);
    const p=(a,q)=>a.length?a[Math.floor(a.length*q)]:NaN;
    console.log(`  ${name}: n=${(100*vs.length/(W*H)).toFixed(1)}%  V p25 ${p(vs,.25).toFixed(2)} p50 ${p(vs,.5).toFixed(2)} p75 ${p(vs,.75).toFixed(2)} | S ${p(ss,.5).toFixed(2)} | H ${p(hh,.5).toFixed(0)}`);
  }
}
