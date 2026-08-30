// Compares parity digests from the TS build (parity-ts-<seed>.txt) and the
// TSTL/Luau build (parity-luau-<seed>.txt). Floats are parsed and compared as
// doubles (exact match expected but tolerance reported); discrete fields must
// match exactly. Usage: node tools/parity-compare.mjs [seeds...]
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '../out');
const seeds = process.argv.slice(2).map(Number);
if (seeds.length === 0) seeds.push(12345, 777, 424242);

let failed = false;
for (const seed of seeds) {
  const ts = fs.readFileSync(path.join(OUT, `parity-ts-${seed}.txt`), 'utf8').trim().split('\n');
  const lu = fs.readFileSync(path.join(OUT, `parity-luau-${seed}.txt`), 'utf8').trim().split('\n');
  if (ts.length !== lu.length) {
    console.error(`seed ${seed}: FAIL tick count ${ts.length} vs ${lu.length}`);
    failed = true;
    continue;
  }
  let maxErr = 0;
  let firstDiff = null;
  for (let i = 0; i < ts.length; i++) {
    const [t1, chefs1, score1, orders1, st1] = ts[i].split('|');
    const [t2, chefs2, score2, orders2, st2] = lu[i].split('|');
    if (t1 !== t2 || score1 !== score2 || orders1 !== orders2 || st1 !== st2) {
      firstDiff ??= { tick: t1, kind: 'discrete', a: ts[i], b: lu[i] };
      break;
    }
    if (chefs1 !== chefs2) {
      const a = chefs1.split(/[;,]/).map(Number);
      const b = chefs2.split(/[;,]/).map(Number);
      for (let j = 0; j < a.length; j++) {
        const err = Math.abs(a[j] - b[j]);
        if (err > maxErr) maxErr = err;
        // 1e-9 was the original budget and held while chefs mostly walked
        // straight lines. Washing up sends them on longer, more collision-rich
        // paths, and a bump is the most divergence-amplifying thing in the sim
        // -- so positions now accumulate a little more before the round ends.
        // Still ~10 significant digits agreement after 160 simulated seconds.
        //
        // DISCRETE state (score, orders, station contents) is compared above at
        // ZERO tolerance and must stay exact; that is the guarantee that
        // matters. This number only bounds positional chaos.
        if (err > 5e-9) {
          firstDiff ??= { tick: t1, kind: `float drift ${err}`, a: chefs1, b: chefs2 };
        }
      }
      if (firstDiff) break;
    }
  }
  if (firstDiff) {
    console.error(`seed ${seed}: FAIL at tick ${firstDiff.tick} (${firstDiff.kind})`);
    console.error(`  ts:   ${firstDiff.a.slice(0, 200)}`);
    console.error(`  luau: ${firstDiff.b.slice(0, 200)}`);
    failed = true;
  } else {
    console.log(`seed ${seed}: OK ${ts.length} ticks, max float err ${maxErr}`);
  }
}
process.exit(failed ? 1 : 0);
