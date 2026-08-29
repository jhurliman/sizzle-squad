#!/usr/bin/env node
// loc/source.json  ->  the CSV Roblox imports, and a coverage report.
//
// The CSV is what goes into Creator Dashboard -> Localization -> Translations.
// Header order is Roblox's: Key, Source, Context, Example, then one column per
// locale. Anything with a Key is addressed by FormatByKey; anything without is
// matched by SOURCE TEXT, which is how the engine auto-translates a GuiObject
// with no code change at all.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'loc/source.json'), 'utf8'));

const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
// BARE LANGUAGE CODES, NOT REGION LOCALES.
//
// The first import failed with "Language(s) not supported: de-de, id-id,
// ja-jp, ko-kr" while fr-fr, pt-br and es-es went through. The experience's own
// API (gameinternationalization/v1/supported-languages) reports all eight
// languages with languageCodeType=Language and bare codes, and the importer
// checks the column against that. Bare codes are the better runtime answer too:
// Roblox falls back from a player's region locale (ja-jp) to the base language
// (ja), so one column serves every region of that language.
const header = ['Key', 'Source', 'Context', 'Example', 'en', ...src.locales];
const rows = [header.map(q).join(',')];
for (const e of src.entries) {
  rows.push([
    q(e.key), q(e.source), q(e.context), q(e.note || ''), q(e.source),
    ...src.locales.map((l) => q(e.tr[l] ?? '')),
  ].join(','));
}
const out = path.join(ROOT, 'loc/SizzleSquad-localization.csv');
fs.writeFileSync(out, rows.join('\n') + '\n');
console.log(`wrote ${path.relative(ROOT, out)} — ${src.entries.length} entries x ${src.locales.length} locales`);

// -------------------------------------------------------------- coverage
// Which player-visible strings does the table NOT cover? Silence here is the
// whole risk: an untranslated string does not error, it just shows up in
// English in the middle of a Japanese menu.
const found = JSON.parse(execFileSync('node', [path.join(HERE, 'extract-strings.mjs'), '--json']).toString());
const covered = new Set(src.entries.map((e) => e.source));
// Glyphs, digits and placeholder values that are overwritten before anyone
// sees them. Listed explicitly so the exemption is a decision, not a gap.
const IGNORE = new Set(['0', '0 coins', '3:00', 'X', '★', '☆', '🍳 ', '🔥', '🔪',
  'Level 1', 'Lv 1  ·  0 coins', 'BLT']);
const missing = [];
for (const kind of ['static', 'content']) {
  for (const e of found[kind]) {
    if (!covered.has(e.text) && !IGNORE.has(e.text)) missing.push([kind, e.text, e.where[0]]);
  }
}
if (missing.length === 0) {
  console.log('coverage: every extracted static and content string is in the table');
} else {
  console.log(`\ncoverage: ${missing.length} string(s) NOT in the table:`);
  for (const [k, t, w] of missing) console.log(`  [${k}] ${JSON.stringify(t)}  ${w}`);
}
const blanks = [];
for (const e of src.entries) {
  for (const l of src.locales) if (!e.tr[l]) blanks.push(`${e.key} (${l})`);
}
console.log(blanks.length ? `\n${blanks.length} blank translations: ${blanks.slice(0, 8).join(', ')}` : 'no blank translations');

// -------------------------------------------------- do these languages exist?
//
// `--verify` asks the experience which languages it actually has enabled and
// compares. The first import was rejected for four of seven columns and the
// message ("Language(s) not supported") did not say what WAS supported, so this
// answers that question from the source of truth instead of by trial.
// Needs ROBLOX_SIZZLE_SQUAD_API_KEY; skipped without it so the build still runs.
let langMismatch = 0;
if (process.argv.includes('--verify')) {
  const key = process.env.ROBLOX_SIZZLE_SQUAD_API_KEY;
  const universe = process.env.ROBLOX_UNIVERSE_ID || '10761465304';
  if (!key) {
    console.log('\n--verify skipped: no API key in the environment');
  } else {
    try {
      const r = await fetch(
        `https://gameinternationalization.roblox.com/v1/supported-languages/games/${universe}`,
        { headers: { 'x-api-key': key } },
      );
      const body = await r.json();
      const enabled = new Set((body.data || []).map((l) => l.languageCode));
      console.log(`\nexperience has enabled: ${[...enabled].sort().join(', ')}`);
      for (const l of src.locales) {
        if (!enabled.has(l)) {
          langMismatch += 1;
          console.log(`  MISSING on the experience: ${l} — the import will reject this column`);
        }
      }
      for (const l of enabled) {
        if (l !== 'en' && !src.locales.includes(l)) {
          console.log(`  note: ${l} is enabled but the table has no column for it`);
        }
      }
      if (!langMismatch) console.log('  every column matches an enabled language');
    } catch (e) {
      console.log(`\n--verify failed: ${String(e.message).replace(key, '<redacted>')}`);
    }
  }
}

process.exit(missing.length || blanks.length || langMismatch ? 1 : 0);
