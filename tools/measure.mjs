// Region statistics for A/B against the reference: median luma + median HSV
// saturation below the HUD, plus a 3x3 Sobel edge-density grid and an
// empty-cell fraction over the lower 70% of frame.
import sharp from 'sharp';
const files = process.argv.slice(2);
for (const f of files) {
  const img = sharp(f);
  const { width: W, height: H } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const y0 = Math.round(H * 0.16);
  const lum = [], sat = [];
  for (let y = y0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
    lum.push(0.299 * r + 0.587 * g + 0.114 * b);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat.push(mx === 0 ? 0 : (mx - mn) / mx);
  }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  // edge density grid over the lower 70%
  const ly = Math.round(H * 0.3);
  const cellW = Math.floor(W / 3), cellH = Math.floor((H - ly) / 3);
  const grid = [];
  for (let gy = 0; gy < 3; gy++) { const row = [];
    for (let gx = 0; gx < 3; gx++) {
      let s = 0, n = 0;
      for (let y = ly + gy * cellH + 1; y < ly + (gy + 1) * cellH - 1; y++)
        for (let x = gx * cellW + 1; x < (gx + 1) * cellW - 1; x++) {
          const at = (xx, yy) => { const i = (yy * W + xx) * 3; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
          s += Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1)); n++;
        }
      row.push((s / n).toFixed(1));
    } grid.push(row.join('/')); }
  // 24-column empty-cell fraction over the lower 70%
  const cw = Math.floor(W / 24), ch = Math.floor((H - ly) / 12);
  let empty = 0, tot = 0;
  for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 24; gx++) {
    let s = 0, n = 0;
    for (let y = ly + gy * ch + 1; y < ly + (gy + 1) * ch - 1; y += 2)
      for (let x = gx * cw + 1; x < (gx + 1) * cw - 1; x += 2) {
        const at = (xx, yy) => { const i = (yy * W + xx) * 3; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
        s += Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1)); n++;
      }
    tot++; if (s / n < 3.0) empty++;
  }
  console.log(`${f}\n  ${W}x${H}  luma med ${med(lum).toFixed(0)}  sat med ${med(sat).toFixed(3)}  empty ${(100 * empty / tot).toFixed(0)}%\n  sobel ${grid.join('  |  ')}`);
}
