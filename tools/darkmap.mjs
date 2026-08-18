import sharp from 'sharp';
const [f,out,thr]=process.argv.slice(2);
const T=+(thr||0.45);
const {data,info}=await sharp(f).resize(640,null,{fit:'inside'}).raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height;const o=Buffer.alloc(W*H*3);
for(let i=0;i<W*H;i++){const r=data[i*3],g=data[i*3+1],b=data[i*3+2];const v=Math.max(r,g,b)/255;
 if(v<T){o[i*3]=255;o[i*3+1]=0;o[i*3+2]=0;}else{const k=Math.round(v*200);o[i*3]=k;o[i*3+1]=k;o[i*3+2]=k;}}
await sharp(o,{raw:{width:W,height:H,channels:3}}).toFile(out);console.log('ok',out);
