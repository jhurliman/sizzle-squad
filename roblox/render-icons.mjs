// Rasterizes the web game's ticket icon SVGs (src/ui/icons.ts) headlessly
// via Playwright and emits icon-data.json: 48x48 RGBA per (kind, state).
// gen-icons-luau.mjs turns that into an embedded Luau module — the Roblox
// client rebuilds the images at runtime with EditableImage, so NO asset
// upload is needed.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '../node_modules/playwright/index.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);

await build({
  entryPoints: [path.join(DIR, 'icons-entry.mjs')],
  bundle: true,
  format: 'iife',
  globalName: 'Icons',
  outfile: path.join(DIR, 'icons.bundle.js'),
  logLevel: 'warning',
});

const html = `<!doctype html><meta charset="utf-8"><body>
<div id="host"></div>
<script>${fs.readFileSync(path.join(DIR, 'icons.bundle.js'), 'utf8')}</script>
</body>`;
fs.writeFileSync(path.join(DIR, 'icons.html'), html);

const KINDS = ['tomato', 'lettuce', 'bacon', 'bun'];
const STATES = ['raw', 'prepped', 'cooked'];
const SIZE = 48;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + path.join(DIR, 'icons.html'));

const out = {};
for (const kind of KINDS) {
  for (const state of STATES) {
    const rgba = await page.evaluate(
      async ({ kind, state, SIZE }) => {
        const host = document.getElementById('host');
        host.innerHTML = Icons.ingredientItem(kind, state, '', 0, 0);
        const svg = host.querySelector('svg.ico');
        if (!svg) return null;
        svg.setAttribute('width', SIZE);
        svg.setAttribute('height', SIZE);
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        URL.revokeObjectURL(url);
        return Array.from(ctx.getImageData(0, 0, SIZE, SIZE).data);
      },
      { kind, state, SIZE },
    );
    if (rgba) {
      out[`${kind}:${state}`] = { w: SIZE, h: SIZE, rgba: Buffer.from(rgba).toString('base64') };
      console.error(`rendered ${kind}:${state}`);
    } else {
      console.error(`MISSING ${kind}:${state}`);
    }
  }
}
await browser.close();
fs.writeFileSync(path.join(DIR, 'icon-data.json'), JSON.stringify(out));
console.error(`wrote icon-data.json (${Object.keys(out).length} icons)`);
