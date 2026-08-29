#!/usr/bin/env node
// EVERY STRING A PLAYER CAN READ, FOUND BY SCANNING RATHER THAN BY MEMORY.
//
// Roblox will happily auto-capture strings at runtime and machine-translate
// them, and both halves of that are bad here: capture only ever sees screens
// somebody happened to open, and machine translation of two-word UI has no idea
// that "Serve" is a verb on a button and a noun in a stat line. So the source
// table is generated from the code instead.
//
//   node tools/extract-strings.mjs            # report the inventory
//   node tools/extract-strings.mjs --json     # machine-readable
//
// Two kinds come out, and they are localized differently:
//
//   STATIC   a whole literal assigned to .Text. Roblox matches these by SOURCE
//            TEXT with no code change at all (GuiObject.AutoLocalize).
//   DYNAMIC  a template with values interpolated in. These cannot be matched by
//            source and need Translator:FormatByKey with a stable key.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'game-src');

const files = [];
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.luau')) files.push(p);
  }
})(SRC);

const statics = new Map();  // text -> [where]
const dynamics = new Map(); // template -> [where]
const content = new Map();  // name -> [where]

const add = (map, k, where) => {
  if (!k || !k.trim()) return;
  if (!map.has(k)) map.set(k, []);
  if (!map.get(k).includes(where)) map.get(k).push(where);
};

for (const f of files) {
  const rel = path.relative(ROOT, f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*--/.test(line)) return; // comments are not player-facing
    const where = `${rel}:${i + 1}`;
    // `.Text =`, but also the coach's `tip =` and Hud:toast(...) — those are
    // the most-read strings in the game and the first version of this scanner
    // walked straight past them because they never touch a .Text literal.
    for (const m of line.matchAll(/\b(?:Text|tip|caption)\s*=\s*"([^"]*)"/g)) add(statics, m[1], where);
    for (const m of line.matchAll(/:toast\("([^"]*)"\)/g)) add(statics, m[1], where);
    for (const m of line.matchAll(/:toast\(`([^`]*)`\)/g)) {
      if (m[1].includes('{')) add(dynamics, m[1], where); else add(statics, m[1], where);
    }
    // `Text = if cond then "A" else "B"` — both arms are player-facing.
    for (const m of line.matchAll(/\bText\s*=\s*if\s+.*?then\s+"([^"]*)"\s+else\s+"([^"]*)"/g)) {
      add(statics, m[1], where); add(statics, m[2], where);
    }
    for (const m of line.matchAll(/\b(?:Text|tip|caption)\s*=\s*`([^`]*)`/g)) {
      // A template with no substitution is just a static string in backticks.
      if (m[1].includes('{')) add(dynamics, m[1], where);
      else add(statics, m[1], where);
    }
    // Catalog / badge / daily display names and blurbs.
    for (const m of line.matchAll(/\b(?:name|blurb|label|title|line|why)\s*=\s*"([^"]*)"/g)) {
      if (/Catalog|Badge|Config|Monetization/.test(rel)) add(content, m[1], where);
    }
  });
}

// Recipe names live in the shared TS domain and reach the ticket rail.
const contentTs = path.resolve(ROOT, '../src/domain/content.ts');
if (fs.existsSync(contentTs)) {
  const s = fs.readFileSync(contentTs, 'utf8');
  for (const m of s.matchAll(/r\('([a-z]+)',\s*'([^']+)'/g)) {
    add(content, m[2], `src/domain/content.ts (recipe ${m[1]})`);
  }
}

const out = {
  static: [...statics.entries()].map(([text, where]) => ({ text, where })),
  dynamic: [...dynamics.entries()].map(([text, where]) => ({ text, where })),
  content: [...content.entries()].map(([text, where]) => ({ text, where })),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const [kind, list] of Object.entries(out)) {
    console.log(`\n=== ${kind.toUpperCase()} (${list.length}) ===`);
    for (const e of list.sort((a, b) => a.text.localeCompare(b.text))) {
      console.log(`  ${JSON.stringify(e.text)}`);
      console.log(`      ${e.where.slice(0, 3).join(', ')}`);
    }
  }
  console.log(`\ntotal ${out.static.length + out.dynamic.length + out.content.length} strings`);
}
