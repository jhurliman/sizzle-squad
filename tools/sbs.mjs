import sharp from 'sharp';
const [a,b,out]=process.argv.slice(2);
const W=760;
const ia=await sharp(a).resize(W).toBuffer();
const ib=await sharp(b).resize(W).toBuffer();
const ma=await sharp(ia).metadata(), mb=await sharp(ib).metadata();
const H=Math.max(ma.height,mb.height);
await sharp({create:{width:W*2+12,height:H,channels:3,background:{r:20,g:20,b:20}}})
 .composite([{input:ia,left:0,top:0},{input:ib,left:W+12,top:0}]).toFile(out);
console.log('ok',out);
