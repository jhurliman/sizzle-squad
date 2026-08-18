/**
 * Regenerates the live progress page from progress/status.json + the newest
 * screenshots. Self-contained HTML with inlined thumbnails so it can be sent
 * straight to the user and opened anywhere.
 *
 *   node tools/progress.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statusPath = path.join(ROOT, 'progress/status.json');
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

/** Newest run that actually captured all four profiles — not just any folder. */
function newestShotDir() {
  const base = path.join(ROOT, 'shots');
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .map((d) => path.join(base, d))
    .filter((d) => fs.statSync(d).isDirectory())
    .filter((d) => ['desktop', 'ipad-landscape', 'iphone-portrait'].every((p) => fs.existsSync(path.join(d, p))))
    .map((d) => ({ d, t: fs.statSync(d).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return dirs[0]?.d ?? null;
}

/** Screenshots are 2-3MB at device DPR; downscale before inlining. */
function thumb(file) {
  const out = path.join(os.tmpdir(), `pg-${path.basename(path.dirname(file))}-${path.basename(file)}`);
  try {
    execFileSync('convert', [file, '-resize', '900x900>', '-quality', '82', out.replace(/\.png$/, '.jpg')], {
      stdio: 'ignore',
    });
    return out.replace(/\.png$/, '.jpg');
  } catch {
    return file;
  }
}

function inline(file) {
  try {
    const small = thumb(file);
    const buf = fs.readFileSync(small);
    const mime = small.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const shotDir = newestShotDir();
const PROFILES = [
  ['iphone-portrait', 'iPhone · portrait'],
  ['iphone-landscape', 'iPhone · landscape'],
  ['ipad-landscape', 'iPad · landscape'],
  ['desktop', 'Desktop'],
];

const shots = [];
if (shotDir) {
  for (const [id, label] of PROFILES) {
    const dir = path.join(shotDir, id);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png') || f.endsWith('.jpg')).sort();
    const pick = files.find((f) => f.includes('90-late')) ?? files[files.length - 1];
    if (!pick) continue;
    const data = inline(path.join(dir, pick));
    if (data) shots.push({ id, label, data, file: pick });
  }
}

const stateOrder = { critic: 0, building: 1, queued: 2, passed: 3 };
const pieces = [...status.pieces].sort(
  (a, b) => (stateOrder[a.state] ?? 9) - (stateOrder[b.state] ?? 9) || a.id.localeCompare(b.id),
);
const passed = pieces.filter((p) => p.state === 'passed').length;

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sizzle Squad — build progress</title>
<style>
:root{--bg:#151016;--card:#211a23;--line:#332a36;--ink:#f6ecdd;--dim:#a99bab;
--gold:#ffd166;--green:#7bd88f;--blue:#8fd0d8;--red:#ff8a7a;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.55 ui-rounded,'SF Pro Rounded',Nunito,system-ui,-apple-system,sans-serif;
padding:24px 18px 70px;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto}
h1{font-size:30px;margin:0 0 2px;letter-spacing:-.02em}
h1 span{color:var(--gold)}
.sub{color:var(--dim);font-size:13px;margin-bottom:22px}
.bar{height:10px;border-radius:99px;background:#2c2430;overflow:hidden;margin:14px 0 6px}
.bar>div{height:100%;background:linear-gradient(90deg,var(--gold),var(--green));border-radius:99px;transition:width .4s}
h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:34px 0 12px;font-weight:800}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(268px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 14px}
.card h3{margin:0 0 4px;font-size:14.5px;display:flex;align-items:center;gap:8px}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.s-passed .dot{background:var(--green);box-shadow:0 0 10px var(--green)}
.s-critic .dot{background:var(--gold);animation:pulse 1.3s infinite}
.s-building .dot{background:var(--blue);animation:pulse 1.3s infinite}
.s-queued .dot{background:#5b4f5f}
@keyframes pulse{50%{opacity:.35}}
.card p{margin:0;color:var(--dim);font-size:12.5px}
.round{float:right;font-size:11px;color:var(--dim);font-weight:700}
.verdict{margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);font-size:12px}
.verdict b{color:var(--red)}
.shots{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.shot{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.shot img{width:100%;display:block;background:#0d0a0e}
.shot .cap{padding:8px 12px;font-size:12px;color:var(--dim)}
.log{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 0;max-height:330px;overflow:auto}
.log div{padding:6px 14px;font-size:12.5px;border-bottom:1px solid var(--line)}
.log div:last-child{border:0}
.log .t{color:var(--dim);margin-right:8px;font-variant-numeric:tabular-nums}
.foot{color:var(--dim);font-size:11.5px;margin-top:30px;text-align:center}
</style></head><body><div class="wrap">
<h1>Sizzle<span>Squad</span></h1>
<div class="sub">${esc(status.headline ?? '')}</div>
<div class="bar"><div style="width:${Math.round((passed / Math.max(1, pieces.length)) * 100)}%"></div></div>
<div class="sub">${passed} of ${pieces.length} pieces cleared the critic · wave ${status.wave ?? 1} · updated ${new Date(status.updatedAt ?? Date.now()).toLocaleString()}</div>

<h2>Pieces</h2>
<div class="grid">
${pieces
  .map(
    (p) => `<div class="card s-${esc(p.state)}">
  <h3><span class="dot"></span>${esc(p.name)}<span class="round">r${p.round ?? 0}</span></h3>
  <p>${esc(p.note ?? '')}</p>
  ${p.gap ? `<div class="verdict"><b>Biggest gap:</b> ${esc(p.gap)}</div>` : ''}
</div>`,
  )
  .join('\n')}
</div>

${
  shots.length
    ? `<h2>Latest build, real pixels</h2><div class="shots">${shots
        .map((s) => `<div class="shot"><img src="${s.data}" alt="${esc(s.label)}"/><div class="cap">${esc(s.label)} · ${esc(s.file)}</div></div>`)
        .join('')}</div>`
    : ''
}

<h2>Log</h2>
<div class="log">${(status.log ?? [])
  .slice(-60)
  .reverse()
  .map((l) => `<div><span class="t">${esc(l.t)}</span>${esc(l.m)}</div>`)
  .join('')}</div>

<div class="foot">Regenerated by tools/progress.mjs — screenshots are captured from the real running build in Chromium at each device profile.</div>
</div></body></html>`;

fs.writeFileSync(path.join(ROOT, 'progress/index.html'), html);
console.log('wrote progress/index.html', (html.length / 1024).toFixed(0) + 'kb');
