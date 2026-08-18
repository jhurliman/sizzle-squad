import sharp from 'sharp';
const [,, file, ...regions] = process.argv;
const img = sharp(file); const { width: W, height: H } = await img.metadata();
const { data } = await img.raw().toBuffer({ resolveWithObject: true });
for (const r of regions) {
  const [fx, fy, fw, fh, label] = r.split(',');
  const x0 = Math.round(+fx * W), y0 = Math.round(+fy * H), w = Math.round(+fw * W), h = Math.round(+fh * H);
  let R = 0, G = 0, B = 0, n = 0; const sat = [], lum = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * W + x) * 3, rr = data[i], gg = data[i + 1], bb = data[i + 2];
    R += rr; G += gg; B += bb; n++;
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
    sat.push(mx === 0 ? 0 : (mx - mn) / mx); lum.push(0.299 * rr + 0.587 * gg + 0.114 * bb);
  }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  console.log(`${label ?? r}  rgb(${(R/n)|0},${(G/n)|0},${(B/n)|0})  luma ${med(lum).toFixed(0)}  S ${med(sat).toFixed(2)}`);
}
