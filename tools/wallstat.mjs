// Masked statistics: pull every pixel in a rect matching a hue/sat window and
// report value/luma percentiles. Used to compare our ochre wall band and our
// oven cavity against the reference without hand-picking a flattering pixel.
// Usage: node tools/wallstat.mjs <img> <name,lx,ty,w,h,hmin,hmax,smin,smax> ...
import sharp from 'sharp';

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx <= 1e-6 ? 0 : d / mx, mx];
}
const pct = (a, p) => a.length ? a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.round(p / 100 * (a.length - 1)))] : 0;

const [, , src, ...specs] = process.argv;
const meta = await sharp(src).metadata();
console.log(src, meta.width + 'x' + meta.height);
for (const s of specs) {
  const [name, lx, ty, w, h, hmin, hmax, smin, smax] = s.split(',');
  const { data, info } = await sharp(src)
    .extract((() => {
      const left = Math.round(+lx * meta.width), top = Math.round(+ty * meta.height);
      return { left, top, width: Math.min(Math.round(+w * meta.width), meta.width - left), height: Math.min(Math.round(+h * meta.height), meta.height - top) };
    })())
    .raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const V = [], L = [], S = [], H = [];
  for (let i = 0; i < data.length; i += ch) {
    const [hh, ss, vv] = hsv(data[i], data[i + 1], data[i + 2]);
    if (hmin !== undefined) {
      const inH = +hmin <= +hmax ? (hh >= +hmin && hh <= +hmax) : (hh >= +hmin || hh <= +hmax);
      if (!inH) continue;
      if (ss < +smin || ss > +smax) continue;
    }
    V.push(vv); S.push(ss); H.push(hh);
    L.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  const n = V.length;
  const tot = (info.width * info.height);
  console.log(`  ${name.padEnd(11)} n=${n} (${(100 * n / tot).toFixed(0)}%)  V p50=${pct(V, 50).toFixed(2)} p90=${pct(V, 90).toFixed(2)} p99=${pct(V, 99).toFixed(2)}  S p50=${pct(S, 50).toFixed(2)}  H p50=${pct(H, 50).toFixed(0)}  luma p50=${pct(L, 50).toFixed(0)} p90=${pct(L, 90).toFixed(0)}`);
}
