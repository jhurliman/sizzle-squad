/**
 * FOCUS SHOT — captures the interaction states, which the standard harness
 * cannot reach.
 *
 * tools/shoot.mjs drives a fixed open-loop plan of stick directions and button
 * presses, and that plan was authored against an older KITCHEN_MAP. Replayed
 * against the shipped map (tools/focusprobe.mjs --only harness) it lands 8
 * presses in 16 seconds of which exactly ONE does anything, never focuses a
 * station it then acts on, and serves nothing — identical before and after this
 * pass, so it is the script and not the sim. Every screenshot this project
 * takes therefore shows a player who is not playing, and the one system that
 * only exists at the moment of contact never appears in a single frame.
 *
 * So this drives CLOSED LOOP through the page's own snapshot: read where the
 * chef is, steer at the station we want, face it, press. Same build, same
 * bots, same insets, same CDP capture path. It is a diagnostic camera for the
 * interaction layer, not a replacement for the harness.
 *
 *   node tools/focusshot.mjs --out shots/k-interact --profiles desktop
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? true]);
    return acc;
  }, []),
);
const OUT = path.resolve(ROOT, argv.out ?? 'shots/focus');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILES = [
  {
    id: 'iphone-portrait',
    label: 'iPhone 15 Pro — portrait',
    viewport: { width: 393, height: 852 },
    insets: { t: 59, b: 34, l: 0, r: 0 },
    touch: true,
  },
  {
    id: 'ipad-landscape',
    label: 'iPad Pro 11" — landscape',
    viewport: { width: 1194, height: 834 },
    insets: { t: 24, b: 20, l: 0, r: 0 },
    touch: true,
  },
  { id: 'desktop', label: 'Desktop 1440×900', viewport: { width: 1440, height: 900 }, touch: false },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let file = path.join(dir, decodeURIComponent(url.pathname));
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * The route. Each leg names a station by kind (and optionally what it
 * dispenses) and what to do there, and the driver walks to whichever instance
 * of it is nearest. Nothing here hard-codes a cell, so the route survives the
 * next edit of KITCHEN_MAP.
 */
const ROUTE = [
  { kind: 'crate', dispenses: 'tomato', act: 'grab', shot: 'a-at-the-crate', glow: true },
  { kind: 'board', act: 'grab' },
  { kind: 'board', act: 'use', hold: 0.7, shot: 'b-mid-chop' },
  { kind: 'board', act: 'use', hold: 0.7 },
  { kind: 'board', act: 'grab', shot: 'c-chopped-in-hand' },
  { kind: 'crate', dispenses: 'lettuce', act: 'grab', shot: 'd-put-it-back' },
  { kind: 'plates', act: 'grab', shot: 'e-plate-in-hand' },
];

async function drive(page, shoot) {
  const set = (i) => page.evaluate((v) => window.__game.setInput(v), i);
  const snap = () => page.evaluate(() => window.__game.snapshot());
  const adv = (sec) => page.evaluate((v) => window.__game.advance(v), sec);
  await page.evaluate(() => window.__game.setCapture(true));
  await set({ enabled: true });

  let t = 0;
  for (const leg of ROUTE) {
    // pick the nearest matching station to the player right now
    const s0 = await snap();
    const me = s0.chefs.find((c) => c.isPlayer);
    const cand = s0.stations.filter((st) => st.kind === leg.kind && (!leg.dispenses || st.dispenses === leg.dispenses));
    if (!cand.length) continue;
    let target = cand[0];
    let best = Infinity;
    for (const st of cand) {
      const d = Math.hypot(st.cell.x + 0.5 - me.x, st.cell.y + 0.5 - me.y);
      if (d < best) {
        best = d;
        target = st;
      }
    }
    const cx = target.cell.x + 0.5;
    const cy = target.cell.y + 0.5;
    // walk until focused on it, then face it and act
    for (let i = 0; i < 150; i++) {
      const s = await snap();
      const c = s.chefs.find((x) => x.isPlayer);
      if (c.focus === target.id && Math.hypot(cx - c.x, cy - c.y) < 1.35) break;
      const dx = cx - c.x;
      const dy = cy - c.y;
      const d = Math.hypot(dx, dy) || 1;
      // step around blocked geometry the crude way: if we stopped moving, jink
      const mv = d < 1.5 ? { x: (dx / d) * 0.5, y: (dy / d) * 0.5 } : { x: dx / d, y: dy / d };
      if (c.speed < 0.3 && i > 6) {
        mv.x += (-dy / d) * (i % 20 < 10 ? 0.8 : -0.8);
        mv.y += (dx / d) * (i % 20 < 10 ? 0.8 : -0.8);
      }
      await set({ move: mv, grabPressed: false, useHeld: false, enabled: true });
      await adv(4 / 60);
      t += 4 / 60;
    }
    // settle facing, then act
    const s = await snap();
    const c = s.chefs.find((x) => x.isPlayer);
    const dx = cx - c.x;
    const dy = cy - c.y;
    const d = Math.hypot(dx, dy) || 1;
    await set({ move: { x: (dx / d) * 0.25, y: (dy / d) * 0.25 }, enabled: true });
    await adv(0.25);
    t += 0.25;
    if (leg.shot) await shoot(leg.shot, t);
    // GLOW A/B. The same bench, the same camera, one frame with the focus on it
    // and one without — the only way to measure what the pre-press marker is
    // actually worth in pixels. Backing off turns the heading away without
    // moving the body more than ~0.2u, so the delta is the marker.
    if (leg.glow) {
      await set({ move: { x: (-dx / d) * 0.7, y: (-dy / d) * 0.7 }, enabled: true });
      await adv(0.22);
      t += 0.22;
      const off = await snap();
      const oc = off.chefs.find((x) => x.isPlayer);
      await shoot(`${leg.shot}-unfocused`, t);
      console.log(`      [glow a/b] focused ${target.id} -> now ${oc.focus} (${oc.focusAction})`);
      await set({ move: { x: (dx / d) * 0.7, y: (dy / d) * 0.7 }, enabled: true });
      await adv(0.3);
      t += 0.3;
    }
    if (leg.act === 'grab') {
      await set({ move: { x: 0, y: 0 }, grabPressed: true, enabled: true });
      await adv(1 / 60);
      await set({ grabPressed: false, enabled: true });
      await adv(0.25);
      t += 0.27;
      const after = await snap();
      const ac = after.chefs.find((x) => x.isPlayer);
      console.log(`      [act grab @${leg.kind}${leg.dispenses ? ':' + leg.dispenses : ''}] focus ${ac.focus} action ${ac.focusAction} carrying ${ac.carrying ?? '-'}`);
    } else {
      await set({ move: { x: 0, y: 0 }, useHeld: true, enabled: true });
      await adv(leg.hold ?? 0.6);
      await set({ useHeld: false, enabled: true });
      t += (leg.hold ?? 0.6) + 0.02;
    }
  }
  await set({ move: { x: 0, y: 0 }, enabled: false });
  const renderCostMs = await page.evaluate(() => window.__game.renderCostMs());
  await page.evaluate(() => window.__game.setCapture(false));
  return { gameSeconds: t, renderCostMs, final: await snap() };
}

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ missing — run `npx vite build` first.');
    process.exit(1);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await serve(DIST);
  const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-lcd-text',
      '--force-device-scale-factor=1',
    ],
  });
  const only = argv.profiles && argv.profiles !== true ? String(argv.profiles).split(',') : null;
  const report = { generatedAt: new Date().toISOString(), profiles: [] };
  for (const prof of PROFILES.filter((p) => !only || only.includes(p.id))) {
    const ctx = await browser.newContext({
      viewport: prof.viewport,
      deviceScaleFactor: 1,
      isMobile: prof.touch,
      hasTouch: prof.touch,
    });
    const page = await ctx.newPage();
    if (prof.insets) {
      await page.addInitScript((v) => {
        const css = `:root{--safe-t:${v.t}px !important;--safe-b:${v.b}px !important;--safe-l:${v.l}px !important;--safe-r:${v.r}px !important}`;
        const put = () => {
          const el = document.createElement('style');
          el.textContent = css;
          document.head.appendChild(el);
        };
        if (document.head) put();
        else document.addEventListener('DOMContentLoaded', put);
      }, prof.insets);
    }
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    const dir = path.join(OUT, prof.id);
    fs.mkdirSync(dir, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const shots = [];
    const notes = [];
    const shoot = async (name, t) => {
      const s = await page.evaluate(() => window.__game.snapshot());
      const c = s.chefs.find((x) => x.isPlayer);
      notes.push(
        `${name}: t=${t.toFixed(1)}s pos ${c.x.toFixed(2)},${c.y.toFixed(2)} focus ${c.focus} action ${c.focusAction} carrying ${c.carrying ?? '-'}`,
      );
      const file = path.join(dir, `${name}.jpg`);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: false });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(path.relative(ROOT, file));
    };
    await page.goto(`http://127.0.0.1:${port}/?capture=1${argv.seed ? `&seed=${argv.seed}` : ''}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).catch(() => {});
    await sleep(600);
    await page.evaluate(() => window.__game.start());
    await sleep(300);
    const stats = await drive(page, shoot);
    await shoot('z-end', stats.gameSeconds);
    await ctx.close();
    report.profiles.push({ id: prof.id, shots, notes, errors: errors.slice(0, 40) });
    console.log(`${errors.length ? '✗' : '✓'} ${prof.label}  ${stats.gameSeconds.toFixed(1)}s  render=${stats.renderCostMs}ms  errors=${errors.length}`);
    for (const n of notes) console.log(`    ${n}`);
    for (const e of errors.slice(0, 6)) console.log(`    ! ${e}`);
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${OUT}/report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
