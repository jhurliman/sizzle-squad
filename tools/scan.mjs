import sharp from 'sharp';
const [f,axis,at,a,b,n]=process.argv.slice(2);
const {data,info}=await sharp(f).raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height,ch=info.channels;
function hsv(r,g,bb){r/=255;g/=255;bb/=255;const mx=Math.max(r,g,bb),mn=Math.min(r,g,bb),d=mx-mn;
let h=0;if(d>1e-6){if(mx===r)h=((g-bb)/d)%6;else if(mx===g)h=(bb-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}
return [h,mx<1e-6?0:d/mx,mx];}
const N=+(n||16);
let out=[];
for(let i=0;i<N;i++){
  const t=+a+(+b-+a)*i/(N-1);
  const x=axis==='h'?Math.round(t):+at, y=axis==='h'?+at:Math.round(t);
  let r=0,g=0,bl=0,c=0;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const ix=((y+dy)*W+(x+dx))*ch;r+=data[ix];g+=data[ix+1];bl+=data[ix+2];c++;}
  r/=c;g/=c;bl/=c;const[hh,s,v]=hsv(r,g,bl);
  out.push(`${axis==='h'?x:y}:H${hh.toFixed(0)}/S${s.toFixed(2)}/V${v.toFixed(2)}`);
}
console.log(out.join('  '));
