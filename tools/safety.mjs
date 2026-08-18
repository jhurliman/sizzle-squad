/**
 * THE THREE NON-NEGOTIABLES NO SCREENSHOT CAN PROVE.
 *
 *   node tools/safety.mjs
 *
 * AGENTS.md forbids three things and a picture can confirm none of them:
 * a tap target under 44x44 CSS px, text under 12px, and anything sitting under
 * a notch / home indicator / safe-area edge. Headless Chromium reports every
 * env(safe-area-inset-*) as 0, so the insets are injected as an author-level
 * override of the four :root custom properties — the same channel shoot.mjs
 * --insets uses, and the only one the CSS and hud.ts readInsets() both read.
 *
 * Reports every interactive element's hit rect, every text node's computed
 * size, and every HUD/touch element that intrudes into an inset band.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const PROFILES = [
  ['iphone-portrait', 393, 852, { t: 59, b: 34, l: 0, r: 0 }, true],
  ['iphone-landscape', 852, 393, { t: 0, b: 21, l: 59, r: 59 }, true],
  ['ipad-landscape', 1194, 834, { t: 24, b: 20, l: 0, r: 0 }, true],
  ['desktop', 1440, 900, { t: 0, b: 0, l: 0, r: 0 }, false],
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
function serve(dir) {
  return new Promise((res) => {
    const s = http.createServer((req, rq) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(dir, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html');
      rq.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream' });
      rq.end(fs.readFileSync(p));
    });
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}

const { server, port } = await serve(DIST);
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

let bad = 0;
for (const [id, w, h, ins, touch] of PROFILES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((v) => {
    const css = `:root{--safe-t:${v.t}px !important;--safe-b:${v.b}px !important;--safe-l:${v.l}px !important;--safe-r:${v.r}px !important}`;
    const put = () => {
      const el = document.createElement('style');
      el.textContent = css;
      document.head.appendChild(el);
    };
    if (document.head) put();
    else document.addEventListener('DOMContentLoaded', put);
  }, ins);
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
  // Drive into a real service with three live tickets, so the queued card and
  // every live HUD element is on screen when we measure.
  await page.evaluate(() => window.__game.start());
  await page.evaluate(() => window.__game.warp(40));
  await page.waitForTimeout(400);

  const r = await page.evaluate(
    ([ins, w, h]) => {
      const out = { small: [], tiny: [], unsafe: [] };
      // ANCESTORS COUNT. The first cut tested the element's own computed style
      // and reported #stickKnob as sitting 79px under the notch on two
      // profiles — the knob is opaque, but it lives inside .stick-ring, which
      // is opacity:0 until a thumb is down and is parked at 0,0 until one is.
      // checkVisibility walks the chain; the manual fallback is for engines
      // that lack it.
      const vis = (el) => {
        if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
        }
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      };
      const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
      // --- tap targets
      for (const el of document.querySelectorAll('button, [role=button], .btn, #btnGrab, #btnUse, #btnDash, .cta')) {
        if (!vis(el)) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 44 || b.height < 44) out.small.push({ el: name(el), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
      }
      // --- text size
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        const el = n.parentElement;
        if (!el || seen.has(el) || !vis(el)) continue;
        seen.add(el);
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) out.tiny.push({ el: name(el), px: fs, text: n.nodeValue.trim().slice(0, 32) });
      }
      // --- safe areas: anything painted must stay inside the inset box
      const box = { l: ins.l, t: ins.t, r: w - ins.r, b: h - ins.b };
      const roots = ['#hud', '#touch', '#overlay'];
      for (const sel of roots) {
        const root = document.querySelector(sel);
        if (!root) continue;
        for (const el of root.querySelectorAll('*')) {
          if (!vis(el)) continue;
          // Only leaf-ish painted things; containers legitimately span the screen.
          const s = getComputedStyle(el);
          const paints = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.backgroundImage !== 'none' || el.childElementCount === 0;
          if (!paints) continue;
          const b = el.getBoundingClientRect();
          if (b.width >= w - 1 && b.height >= h - 1) continue;
          const over = [];
          if (b.left < box.l - 0.5) over.push(`l${(box.l - b.left).toFixed(0)}`);
          if (b.top < box.t - 0.5) over.push(`t${(box.t - b.top).toFixed(0)}`);
          if (b.right > box.r + 0.5) over.push(`r${(b.right - box.r).toFixed(0)}`);
          if (b.bottom > box.b + 0.5) over.push(`b${(b.bottom - box.b).toFixed(0)}`);
          if (over.length) out.unsafe.push({ el: name(el), over: over.join(','), rect: [b.left, b.top, b.right, b.bottom].map((v) => +v.toFixed(0)) });
        }
      }
      return out;
    },
    [ins, w, h],
  );

  console.log(`\n=== ${id}  ${w}x${h}  insets t${ins.t} b${ins.b} l${ins.l} r${ins.r}`);
  if (!r.small.length && !r.tiny.length && !r.unsafe.length) console.log('  clean');
  for (const s of r.small) { console.log(`  TAP<44  ${s.el}  ${s.w}x${s.h}`); bad++; }
  for (const t of r.tiny) { console.log(`  TEXT<12 ${t.el}  ${t.px}px  "${t.text}"`); bad++; }
  for (const u of r.unsafe.slice(0, 14)) { console.log(`  UNSAFE  ${u.el}  over ${u.over}  rect ${u.rect}`); bad++; }
  if (r.unsafe.length > 14) console.log(`  ...and ${r.unsafe.length - 14} more unsafe`);
  await ctx.close();
}

console.log(`\n${bad} violation(s)`);
await browser.close();
server.close();
