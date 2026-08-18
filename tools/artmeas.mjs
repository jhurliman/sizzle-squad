#!/usr/bin/env node
// Art-direction delta meter. Reports the exact numbers the critic used:
// whole-frame S p50/p95, %pixels above S 0.80, band values, and local
// contrast (mean |laplacian| of luma) on a normalised patch.
// Usage: node tools/artmeas.mjs <image> [--hud 0.09] [--patch name,x0,y0,x1,y1]
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
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const hudCut = Number((args.find((a) => a.startsWith('--hud=')) || '--hud=0.10').split('=')[1]);
const patches = args.filter((a) => a.startsWith('--patch=')).map((a) => {
  const [n, ...r] = a.slice(8).split(',');
  return { n, r: r.map(Number) };
});
// Default patches, in normalised frame coords: a floor patch bottom-centre-left,
// a wall patch upper-left of the chimney.
if (!patches.length) {
  patches.push({ n: 'floor', r: [0.30, 0.80, 0.48, 0.96] });
  patches.push({ n: 'wall', r: [0.06, 0.16, 0.24, 0.34] });
}

for (const f of files) {
  const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const lum = new Float64Array(W * H);
  const S = [], V = [];
  let hot = 0, n = 0;
  const y0 = Math.round(H * hudCut);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      lum[y * W + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (y < y0) continue;
      const [, s, v] = hsv(r, g, b);
      S.push(s); V.push(v);
      if (s > 0.8) hot++;
      n++;
    }
  }
  const lc = (x0, yy0, x1, yy1) => {
    let sum = 0, c = 0;
    const ax = Math.round(x0 * W), ay = Math.round(yy0 * H);
    const bx = Math.round(x1 * W), by = Math.round(yy1 * H);
    for (let y = Math.max(1, ay); y < Math.min(H - 1, by); y++)
      for (let x = Math.max(1, ax); x < Math.min(W - 1, bx); x++) {
        const p = lum[y * W + x];
        sum += Math.abs(4 * p - lum[y * W + x - 1] - lum[y * W + x + 1] - lum[(y - 1) * W + x] - lum[(y + 1) * W + x]) / 4;
        c++;
      }
    return c ? sum / c : 0;
  };
  const patchStat = (x0, yy0, x1, yy1) => {
    const s = [], v = [], h = [];
    for (let y = Math.round(yy0 * H); y < Math.round(yy1 * H); y++)
      for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
        const i = (y * W + x) * ch;
        const [hh, ss, vv] = hsv(data[i], data[i + 1], data[i + 2]);
        h.push(hh); s.push(ss); v.push(vv);
      }
    return `H ${pct(h, 50).toFixed(0)} S ${pct(s, 50).toFixed(3)} V ${pct(v, 50).toFixed(3)}`;
  };
  console.log(`\n${f}  ${W}x${H}`);
  console.log(`  S p50 ${pct(S, 50).toFixed(3)}  p95 ${pct(S, 95).toFixed(3)}  p99 ${pct(S, 99).toFixed(3)}  >0.80 ${((hot / n) * 100).toFixed(1)}%`);
  console.log(`  V p05 ${pct(V, 5).toFixed(3)}  p50 ${pct(V, 50).toFixed(3)}  p95 ${pct(V, 95).toFixed(3)}`);
  console.log(`  localContrast whole ${lc(0, hudCut, 1, 1).toFixed(2)}`);
  for (const p of patches) {
    console.log(`  ${p.n.padEnd(8)} lc ${lc(...p.r).toFixed(2)}   ${patchStat(...p.r)}`);
  }
}
