import sharp from 'sharp';
const f = process.argv[2];
const out = process.argv[3];
const W = 640;
const { data, info } = await sharp(f).resize({ width: W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const H = info.height, ch = info.channels;
const o = Buffer.alloc(W * H * 3);
for (let i = 0, j = 0; i < W * H; i++, j += ch) {
  const r = data[j] / 255, g = data[j + 1] / 255, b = data[j + 2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const s = mx <= 1e-6 ? 0 : (mx - mn) / mx;
  const hot = s > 0.8;
  o[i * 3] = hot ? 255 : Math.round(mx * 90);
  o[i * 3 + 1] = hot ? 0 : Math.round(mx * 90);
  o[i * 3 + 2] = hot ? 0 : Math.round(mx * 90);
}
await sharp(o, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toFile(out);
console.log(out);
