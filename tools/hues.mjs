import sharp from 'sharp';
function hsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
let h=0;if(d>1e-6){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360;}
return [h,mx<1e-6?0:d/mx,mx];}
for(const f of process.argv.slice(2)){
  const {data,info}=await sharp(f).resize(640,null,{fit:'inside'}).raw().toBuffer({resolveWithObject:true});
  const W=info.width,H=info.height;const bins=new Array(24).fill(0);let n=0;
  for(let y=Math.round(H*0.14);y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*3;const[h,s,v]=hsv(data[i],data[i+1],data[i+2]);
   if(s>0.5&&v>0.25){bins[Math.floor(h/15)%24]++;n++;}}
  console.log(f.split('/').slice(-2).join('/'));
  console.log('  '+bins.map((c,i)=>c/n>0.02?`${i*15}-${i*15+15}:${(100*c/n).toFixed(0)}%`:null).filter(Boolean).join('  '));
}
