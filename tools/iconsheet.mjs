/**
 * Look at the ticket icons on their own, at the size they actually ship at.
 *
 *   node tools/iconsheet.mjs --out shots/icons.png [--px 46]
 *
 * The full harness renders one ticket, in one state, over a busy room. When the
 * job is "does a prepped tomato read as the tomato on the bench", you need the
 * whole set side by side on the balloon's own white, at 46px, with the bench
 * hexes printed underneath as swatches. That is what this does: bundles
 * src/ui/icons.ts, lays every kind x state on a page, shoots it.
 */
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);
const OUT = path.resolve(ROOT, argv.out ?? 'shots/icons.png');
const PX = Number(argv.px ?? 46);

const PAIRS = [
  ['tomato', 'raw'],
  ['tomato', 'prepped'],
  ['lettuce', 'raw'],
  ['lettuce', 'prepped'],
  ['bacon', 'raw'],
  ['bacon', 'cooked'],
  ['bun', 'raw'],
  ['cheese', 'raw'],
  ['cheese', 'prepped'],
  ['onion', 'raw'],
  ['onion', 'prepped'],
  ['potato', 'raw'],
  ['potato', 'prepped'],
  ['potato', 'cooked'],
  ['egg', 'raw'],
  ['egg', 'cooked'],
  ['rice', 'raw'],
  ['rice', 'cooked'],
  ['fish', 'raw'],
  ['fish', 'cooked'],
];

// Hexes taken straight out of src/domain/content.ts + src/view/world.ts, so the
// swatch row is literally what the mesh on the bench is painted with.
const BENCH = [
  ['tomato', '#e61c0a'],
  ['lettuce', '#6fd112'],
  ['bacon', '#ff8496'],
  ['bun', '#d88f3f'],
  ['cheese', '#ffcb14'],
  ['onion', '#a85fd6'],
  ['potato', '#dcae63'],
  ['egg', '#ffa522'],
  ['rice', '#cfe2f2'],
  ['fish', '#4fbdda'],
];

// Bundle the one module with the same rolldown vite already ships.
const bundle = await rolldown({ input: path.join(ROOT, 'src/ui/icons.ts') });
const { output } = await bundle.generate({ format: 'esm' });
const mod = output[0].code;

const css = fs.readFileSync(path.join(ROOT, 'src/ui/styles.css'), 'utf8');

const html = `<!doctype html><meta charset="utf-8"><style>
${css}
body{background:#daa94e;margin:0;padding:18px;font-family:system-ui}
.sheet{display:flex;flex-wrap:wrap;gap:10px;max-width:1180px}
.cell{background:#fffdf7;border-radius:14px;padding:10px 10px 4px;text-align:center;
  box-shadow:0 4px 0 rgba(58,42,30,.2)}
.cell .item{--icon:${PX}px;position:relative;left:0;top:0}
.cap{font-size:10px;font-weight:800;color:#7a5c44;margin-top:2px}
.sw{display:flex;gap:0;margin:16px 0 0;border-radius:10px;overflow:hidden;max-width:1180px}
.sw div{flex:1;height:56px;display:grid;place-items:end center;font-size:9px;font-weight:800;
  color:rgba(0,0,0,.5);padding-bottom:3px}
h3{color:#fff8ec;font-size:12px;margin:14px 0 6px;text-shadow:0 1px 0 rgba(0,0,0,.3)}
</style>
<div class="sheet" id="s"></div>
<h3>TICKED OFF — the plate already carries it</h3>
<div class="sheet" id="s2"></div>
<h3>BENCH PROP HEXES — the ticket must not be paler than this row</h3>
<div class="sw" id="w"></div>
<script type="module">
${mod}
const PAIRS=${JSON.stringify(PAIRS)};
document.getElementById('s').innerHTML=PAIRS.map(([k,st])=>
  '<div class="cell">'+ingredientItem(k,st,k+' '+st)+'<div class="cap">'+k+'<br>'+st+'</div></div>').join('');
// Second sheet: the same tiles in the .ok state the HUD flips on once the
// plate already carries that component.
document.getElementById('s2').innerHTML=PAIRS.slice(0,10).map(([k,st])=>
  '<div class="cell">'+ingredientItem(k,st,k+' '+st).replace('class="item','class="item ok ')+
  '<div class="cap">'+k+'<br>'+st+' OK</div></div>').join('');
document.getElementById('w').innerHTML=${JSON.stringify(BENCH)}.map(([k,c])=>
  '<div style="background:'+c+'">'+k+' '+c+'</div>').join('');
</script>`;

const file = path.join(ROOT, '.iconsheet.html');
fs.writeFileSync(file, html);

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: fs.existsSync(PINNED) ? PINNED : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
});
const page = await browser.newPage({ viewport: { width: 1220, height: 700 }, deviceScaleFactor: 2 });
await page.goto('file://' + file);
await page.waitForTimeout(300);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
fs.unlinkSync(file);
console.log('wrote', OUT);
