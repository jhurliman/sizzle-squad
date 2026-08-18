import sharp from 'sharp';
const [,, file, l,t,w,h, out, scale] = process.argv;
await sharp(file).extract({left:+l,top:+t,width:+w,height:+h}).resize({width:Math.round(+w*(+scale||2)),kernel:'nearest'}).toFile(out);
console.log('ok');
