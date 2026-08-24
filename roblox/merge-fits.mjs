// Merges a FitLab export (the JSON printed by fitlab-export.lua) into
// hat-fits.json, then regenerates HatFits.luau.
//   node merge-fits.mjs <export.json>
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const file = process.argv[2];
if (!file) {
  console.error('usage: node merge-fits.mjs <export.json>');
  process.exit(1);
}
let raw = fs.readFileSync(file, 'utf8');
const m = raw.match(/FITLAB_EXPORT_BEGIN\s*([\s\S]*?)\s*FITLAB_EXPORT_END/);
if (m) raw = m[1];
const incoming = JSON.parse(raw);

const fitsPath = path.join(DIR, 'hat-fits.json');
const fits = JSON.parse(fs.readFileSync(fitsPath, 'utf8'));
let n = 0;
for (const [species, hats] of Object.entries(incoming)) {
  fits.species[species] = fits.species[species] ?? {};
  for (const [hatId, fit] of Object.entries(hats)) {
    // hideEars is a design decision, not a Studio transform — preserve it
    const prev = fits.species[species][hatId] ?? {};
    fits.species[species][hatId] = { ...prev, ...fit };
    n++;
  }
}
fs.writeFileSync(fitsPath, JSON.stringify(fits, null, 2) + '\n');
execSync(`node ${path.join(DIR, 'gen-hatfits.mjs')}`, { stdio: 'inherit' });
console.error(`merged ${n} fits into hat-fits.json + regenerated HatFits.luau`);
