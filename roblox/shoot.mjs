// Headless render of the converted parts via the repo's Playwright.
import fs from 'node:fs';
import { chromium } from '../node_modules/playwright/index.mjs';

const DIR = new URL('.', import.meta.url).pathname;
const parts = fs.readFileSync(DIR + 'parts.json', 'utf8');
const bundle = fs.readFileSync(DIR + 'viewer.bundle.js', 'utf8');

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script>window.__PARTS__ = ${parts};</script>
<script>${bundle}</script>
</body>`;
fs.writeFileSync(DIR + 'viewer.html', html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('file://' + DIR + 'viewer.html');
await page.waitForFunction('window.__ready === true', { timeout: 15000 });
for (const mode of ['persp', 'top']) {
  const dataUrl = await page.evaluate((m) => window.__shoot(m), mode);
  fs.writeFileSync(DIR + `render-${mode}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.error('wrote render-' + mode + '.png');
}
await browser.close();
