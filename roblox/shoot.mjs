// Headless render of the converted parts via the repo's Playwright.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';

const DIR = new URL('.', import.meta.url).pathname;
// Renders land in a dedicated output directory, never beside the scripts.
// A tool that writes its PNGs into its own source folder is a tool whose
// output gets committed by accident. roblox/preview/ is gitignored.
const OUT = path.join(DIR, 'preview', 'shoot');
fs.mkdirSync(OUT, { recursive: true });
const parts = fs.readFileSync(DIR + 'parts.json', 'utf8');
const bundle = fs.readFileSync(DIR + 'viewer.bundle.js', 'utf8');

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script>window.__PARTS__ = ${parts};</script>
<script>${bundle}</script>
</body>`;
fs.writeFileSync(path.join(OUT, 'viewer.html'), html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('file://' + path.join(OUT, 'viewer.html'));
await page.waitForFunction('window.__ready === true', { timeout: 15000 });
for (const mode of ['persp', 'top']) {
  const dataUrl = await page.evaluate((m) => window.__shoot(m), mode);
  fs.writeFileSync(path.join(OUT, `render-${mode}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.error('wrote render-' + mode + '.png');
}
await browser.close();
