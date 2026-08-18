/**
 * The region map, made visible.
 *
 *   node tools/touchmap.mjs <touchprobe.json> <profile> <background.jpg> <out.png>
 *
 * tools/touchprobe.mjs already answers "which control owns this pixel" for the
 * whole screen off the shipped predicate (InputManager.regionAt) plus real hit
 * testing. That answer is a percentage in a log line, and a percentage does not
 * tell you WHERE the holes are. This paints it over a real frame:
 *
 *   green   a press here spawns the thumbstick
 *   blue    a press here works one of the three action discs (halo included)
 *   red     a press here does nothing at all
 *
 * Red is the number to watch. It was 46.8% of an iPhone portrait frame.
 */
import sharp from 'sharp';
import fs from 'node:fs';

const [, , jsonPath, profile, bg, out] = process.argv;
if (!jsonPath || !profile || !bg || !out) {
  console.error('usage: node tools/touchmap.mjs <probe.json> <profile> <background.jpg> <out.png>');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))[profile];
if (!data) {
  console.error(`no profile ${profile} in ${jsonPath}`);
  process.exit(1);
}
const [w, h] = data.viewport;
const grid = data.region.grid;
const S = 8; // must match the probe's grid step

const px = Buffer.alloc(w * h * 4, 0);
const COL = { s: [64, 210, 110, 78], b: [70, 160, 255, 120], d: [255, 60, 60, 130] };
for (let gy = 0; gy < grid.length; gy++) {
  for (let gx = 0; gx < grid[gy].length; gx++) {
    const c = COL[grid[gy][gx]];
    if (!c) continue;
    for (let y = gy * S; y < (gy + 1) * S && y < h; y++) {
      for (let x = gx * S; x < (gx + 1) * S && x < w; x++) {
        // Leave a 1px gutter so the sample grid itself stays legible.
        if (x % S === 0 || y % S === 0) continue;
        const i = (y * w + x) * 4;
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
        px[i + 3] = c[3];
      }
    }
  }
}

const overlay = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
await sharp(bg).resize(w, h).composite([{ input: overlay, blend: 'over' }]).png().toFile(out);
console.log(
  `${out}  stick ${data.region.pctStick}%  button ${data.region.pctButton}%  dead ${data.region.pctDead}%`,
);
