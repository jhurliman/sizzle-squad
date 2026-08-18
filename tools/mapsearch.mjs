/**
 * MAP SEARCH — lane topology solver for KITCHEN_MAP.
 *
 * The movement model needs 0.684u to reach 90% of cruise and 1.92u to spend a
 * dash. The shipped map's median unobstructed cardinal run was 1.137u, so
 * neither fits. This tool searches layouts that DO fit, under the constraints
 * the room actually has:
 *
 *   - benches are horizontal runs of 2 or 3 cells, never stacked vertically
 *     (the reference's floor tables are one cell deep and 2-3 long; stacking
 *     them is what produced the "one raft" verdict in wave 1)
 *   - every maximal walkable gap in every row AND every column is >= 2 cells,
 *     so two 0.72u bodies can always pass (width 1 leaves 0.14u a side)
 *   - row 2 is a clear service corridor across the whole back wall
 *   - the walkable region is one connected component and every bench cell has
 *     at least one walkable orthogonal neighbour to work from
 *
 * Objective: the same median-cardinal-run statistic tools/feelcrit-lanes.mjs
 * reports, computed geometrically (run = n + 0.14u for n clear cells ahead,
 * which matches the sim to 3 decimals because chefRadius 0.36 < 0.5).
 *
 * Usage: node tools/mapsearch.mjs [--cells 18] [--iters 60000] [--top 5]
 */
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? d : process.argv[i + 1];
};
const CELLS = Number(arg('--cells', 18));
const ITERS = Number(arg('--iters', 60000));
const TOP = Number(arg('--top', 5));

const X0 = 1, X1 = 13, Y0 = 2, Y1 = 9; // inclusive play field, 13 x 8
const W = X1 - X0 + 1, H = Y1 - Y0 + 1;
const idx = (x, y) => (y - Y0) * W + (x - X0);

// deterministic RNG so a reported layout can be reproduced
let seed = 0x9e3779b9;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};

function gaps(blocked) {
  // maximal walkable runs bounded by blocked cells or the room wall
  const out = [];
  for (let y = Y0; y <= Y1; y++) {
    let n = 0;
    for (let x = X0; x <= X1; x++) {
      if (blocked[idx(x, y)]) { if (n) out.push(n); n = 0; } else n++;
    }
    if (n) out.push(n);
  }
  for (let x = X0; x <= X1; x++) {
    let n = 0;
    for (let y = Y0; y <= Y1; y++) {
      if (blocked[idx(x, y)]) { if (n) out.push(n); n = 0; } else n++;
    }
    if (n) out.push(n);
  }
  return out;
}

function runs(blocked) {
  const out = [];
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    if (blocked[idx(x, y)]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let n = 0, cx = x + dx, cy = y + dy;
      while (cx >= X0 && cx <= X1 && cy >= Y0 && cy <= Y1 && !blocked[idx(cx, cy)]) { n++; cx += dx; cy += dy; }
      out.push(n + 0.14);
    }
  }
  return out;
}

const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

function connected(blocked) {
  const start = [];
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (!blocked[idx(x, y)]) { start.push([x, y]); break; }
  if (!start.length) return false;
  const seen = new Set();
  const st = [start[0]];
  let free = 0;
  for (let i = 0; i < W * H; i++) if (!blocked[i]) free++;
  while (st.length) {
    const [x, y] = st.pop();
    const k = idx(x, y);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < X0 || nx > X1 || ny < Y0 || ny > Y1) continue;
      if (!blocked[idx(nx, ny)] && !seen.has(idx(nx, ny))) st.push([nx, ny]);
    }
  }
  return seen.size === free;
}

/** every walkable cell has a walkable orthogonal neighbour (no isolated pocket) */
function noPockets(blocked) {
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    if (blocked[idx(x, y)]) continue;
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < X0 || nx > X1 || ny < Y0 || ny > Y1) continue;
      if (!blocked[idx(nx, ny)]) n++;
    }
    if (n === 0) return false;
  }
  return true;
}

/** every bench cell must be workable from an adjacent floor cell */
function reachableBenches(blocked) {
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    if (!blocked[idx(x, y)]) continue;
    let ok = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < X0 || nx > X1 || ny < Y0 || ny > Y1) continue;
      if (!blocked[idx(nx, ny)]) ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

/** no bench cell directly above/below another: keeps every table one cell deep */
function oneDeep(blocked) {
  for (let y = Y0; y < Y1; y++) for (let x = X0; x <= X1; x++) {
    if (blocked[idx(x, y)] && blocked[idx(x, y + 1)]) return false;
  }
  return true;
}

function benchRuns(blocked) {
  const out = [];
  for (let y = Y0; y <= Y1; y++) {
    let n = 0;
    for (let x = X0; x <= X1 + 1; x++) {
      const b = x <= X1 && blocked[idx(x, y)];
      if (b) n++; else { if (n) out.push({ y, len: n, x0: x - n }); n = 0; }
    }
  }
  return out;
}

function evaluate(blocked) {
  if (!oneDeep(blocked)) return null;
  const g = gaps(blocked);
  if (g.some((v) => v === 1)) return null;
  for (const r of benchRuns(blocked)) if (r.len < 2 || r.len > 3) return null;
  if (!reachableBenches(blocked)) return null;
  if (!noPockets(blocked)) return null;
  if (!connected(blocked)) return null;
  const r = runs(blocked);
  // spread: how far a floor cell can be from the nearest bench. The reference
  // never leaves a floor region without a table in it; wave 1 lost points for
  // "horizontal grey stripes running edge-to-edge".
  let worstD = 0, sumD = 0, n = 0;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    if (blocked[idx(x, y)]) continue;
    let best = 99;
    for (let by = Y0; by <= Y1; by++) for (let bx = X0; bx <= X1; bx++) {
      if (!blocked[idx(bx, by)]) continue;
      best = Math.min(best, Math.abs(bx - x) + Math.abs(by - y));
    }
    worstD = Math.max(worstD, best); sumD += best; n++;
  }
  const long = r.filter((v) => v >= 3).length / r.length;
  return {
    median: q(r, 0.5), p25: q(r, 0.25), p75: q(r, 0.75), longFrac: long,
    worstD, meanD: sumD / n, gaps: g, benches: benchRuns(blocked),
  };
}

const sc = (e) => e.median * 1000 + e.longFrac * 200 - e.worstD * 4 - e.meanD * 2;

// ---- search: hill-climb over sets of 2/3-long horizontal runs in rows 3..9
function paint(benches) {
  const b = new Uint8Array(W * H);
  for (const bench of benches) for (let i = 0; i < bench.len; i++) b[idx(bench.x + i, bench.y)] = 1;
  return b;
}
function randomBenches() {
  const target = CELLS;
  const list = [];
  let placed = 0, guard = 0;
  while (placed < target && guard++ < 400) {
    const len = rnd() < 0.5 ? 2 : 3;
    if (placed + len > target) continue;
    const y = Y0 + 1 + Math.floor(rnd() * (H - 1)); // never the row-2 service corridor
    const x = X0 + Math.floor(rnd() * (W - len + 1));
    const b = paint(list);
    let ok = true;
    for (let i = -1; i <= len; i++) {
      const cx = x + i;
      if (cx < X0 || cx > X1) continue;
      if (b[idx(cx, y)]) ok = false; // separate runs within a row
    }
    if (!ok) continue;
    list.push({ x, y, len });
    placed += len;
  }
  return placed === CELLS ? list : null;
}
const found = [];
const seenKeys = new Set();
for (let it = 0; it < ITERS / 200; it++) {
  let cur = randomBenches();
  if (!cur) continue;
  let curEv = evaluate(paint(cur));
  let curScore = curEv ? sc(curEv) : -1e6 + scorePenalty(paint(cur));
  for (let step = 0; step < 200; step++) {
    const next = cur.map((b) => ({ ...b }));
    const j = Math.floor(rnd() * next.length);
    const mode = rnd();
    if (mode < 0.5) next[j].x = X0 + Math.floor(rnd() * (W - next[j].len + 1));
    else if (mode < 0.9) next[j].y = Y0 + 1 + Math.floor(rnd() * (H - 1));
    else { const k = Math.floor(rnd() * next.length); const t = next[j].x; next[j].x = next[k].x; next[k].x = t; }
    const nb = paint(next);
    let cells = 0; for (let i = 0; i < nb.length; i++) cells += nb[i];
    if (cells !== CELLS) continue; // runs merged or overlapped
    const ev = evaluate(nb);
    const score = ev ? sc(ev) : -1e6 + scorePenalty(nb);
    if (score >= curScore) { cur = next; curScore = score; curEv = ev; }
  }
  if (!curEv) continue;
  const key = paint(cur).join('');
  if (seenKeys.has(key)) continue;
  seenKeys.add(key);
  found.push({ ev: curEv, blocked: paint(cur) });
}
/** soft gradient toward legality so the climber can cross illegal ground */
function scorePenalty(b) {
  let p = 0;
  for (const g of gaps(b)) if (g === 1) p -= 10;
  if (!oneDeep(b)) p -= 40;
  if (!connected(b)) p -= 40;
  return p;
}

found.sort((a, b) => sc(b.ev) - sc(a.ev));
console.log(`cells=${CELLS} iters=${ITERS} legal=${found.length}`);
for (const f of found.slice(0, TOP)) {
  const hist = {};
  for (const v of f.ev.gaps) hist[v] = (hist[v] || 0) + 1;
  console.log(`\nmedian=${f.ev.median.toFixed(3)}u p25=${f.ev.p25.toFixed(3)} p75=${f.ev.p75.toFixed(3)} %runs>=3u=${(100*f.ev.longFrac).toFixed(1)} worstDistToBench=${f.ev.worstD} meanDist=${f.ev.meanD.toFixed(2)} gapHist=${JSON.stringify(hist)} benches=${f.ev.benches.length}`);
  console.log("  '###############',");
  console.log("  '#DSS#=====#SOO#',");
  for (let y = Y0; y <= Y1; y++) {
    let row = '#';
    for (let x = X0; x <= X1; x++) row += f.blocked[idx(x, y)] ? 'X' : '.';
    console.log(`  '${row}#',`);
  }
  console.log("  '###############',");
}

// ---- --check "row,row,row,..." : evaluate a literal 13-wide play field
const ci = process.argv.indexOf('--check');
if (ci > 0) {
  const rows = process.argv[ci + 1].split(',');
  const b = new Uint8Array(W * H);
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const ch = rows[y - Y0][x - X0];
    if (ch !== '.') b[idx(x, y)] = 1;
  }
  const g = gaps(b);
  const hist = {};
  for (const v of g) hist[v] = (hist[v] || 0) + 1;
  const r = runs(b);
  let cells = 0; for (let i = 0; i < b.length; i++) cells += b[i];
  console.log(`CHECK cells=${cells} median=${q(r, 0.5).toFixed(3)} p25=${q(r, 0.25).toFixed(3)} p75=${q(r, 0.75).toFixed(3)} %>=3u=${(100 * r.filter((v) => v >= 3).length / r.length).toFixed(1)} gapHist=${JSON.stringify(hist)}`);
  console.log(`  oneDeep=${oneDeep(b)} connected=${connected(b)} noPockets=${noPockets(b)} benchesReachable=${reachableBenches(b)} benches=${benchRuns(b).length} runLens=${benchRuns(b).map((z) => z.len).join(',')}`);
}
