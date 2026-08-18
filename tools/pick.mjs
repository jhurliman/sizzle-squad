import sharp from 'sharp';
const f=process.argv[2];
const {data,info}=await sharp(f).raw().toBuffer({resolveWithObject:true});
const W=info.width,ch=info.channels;
function rgb2hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
let h=0; if(d>1e-6){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if(h<0)h+=360;}
return [h, mx<1e-6?0:d/mx, mx];}
const pts=process.argv.slice(3);
for(const p of pts){
  const [label,xs,ys]=p.split(',');const x=+xs,y=+ys;
  let r=0,g=0,b=0,n=0;
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const i=((y+dy)*W+(x+dx))*ch;r+=data[i];g+=data[i+1];b+=data[i+2];n++;}
  r/=n;g/=n;b/=n;const [h,s,v]=rgb2hsv(r,g,b);
  console.log(`${label.padEnd(18)} rgb(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})  H${h.toFixed(0)} S${s.toFixed(2)} V${v.toFixed(2)}`);
}
