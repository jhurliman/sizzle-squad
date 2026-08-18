import sharp from 'sharp';
const f = process.argv[2];
const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
const W=info.width,H=info.height,C=info.channels;
const gy=12,gx=16;
const rows=[];
for(let j=0;j<gy;j++){
  let s='';
  for(let i=0;i<gx;i++){
    let below=0,n=0;
    for(let y=Math.floor(j*H/gy);y<Math.floor((j+1)*H/gy);y+=2)
      for(let x=Math.floor(i*W/gx);x<Math.floor((i+1)*W/gx);x+=2){
        const k=(y*W+x)*C;const Y=0.2126*data[k]+0.7152*data[k+1]+0.0722*data[k+2];
        if(Y<64)below++;n++;
      }
    const p=below/n;
    s += p>0.75?'#':p>0.5?'@':p>0.25?'+':p>0.1?'.':p>0.02?',':' ';
  }
  rows.push(s);
}
console.log(f);rows.forEach(r=>console.log('  |'+r+'|'));
