#!/usr/bin/env node
// PUBLISH THE BUILT PLACE THROUGH OPEN CLOUD, NOT STUDIO.
//
// Studio's uploader failed repeatedly with "Server is busy and unable to
// process your request right now. Retrying…", which leaves the live experience
// running whatever was there before — in our case an empty place, which is why
// joining gave a blue sky, no kitchen, and Roblox's default controls. Nothing
// was wrong with the build; it had simply never arrived.
//
// This posts SizzleSquad.rbxl straight to the place's version endpoint. Same
// bytes the freshness guard checks, no Studio in the path, and it either
// returns a version number or a real error instead of retrying forever.
//
//   node tools/publish-place.mjs            # publish (live)
//   node tools/publish-place.mjs --saved    # save a version without publishing
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG = path.join(os.homedir(), '.config', 'sizzle', 'opencloud.json');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PLACE_FILE = path.join(ROOT, 'SizzleSquad.rbxl');

let file = {};
if (fs.existsSync(CONFIG)) file = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const apiKey = process.env.ROBLOX_SIZZLE_SQUAD_API_KEY || process.env.ROBLOX_API_KEY || file.apiKey;
const universeId = process.env.ROBLOX_UNIVERSE_ID || file.universeId || '10761465304';
const placeId = process.env.ROBLOX_PLACE_ID || file.placeId || '113028832194057';
if (!apiKey) {
  console.error('missing API key — export ROBLOX_SIZZLE_SQUAD_API_KEY');
  process.exit(1);
}
if (!fs.existsSync(PLACE_FILE)) {
  console.error(`no ${PLACE_FILE} — run \`npm run build\` first`);
  process.exit(1);
}

const versionType = process.argv.includes('--saved') ? 'Saved' : 'Published';
const bytes = fs.readFileSync(PLACE_FILE);
console.log(`uploading ${(bytes.length / 1048576).toFixed(1)} MB to place ${placeId} as ${versionType}…`);

const scrub = (t) => String(t).split(apiKey).join('<redacted>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RETRY, BECAUSE THE FAILURE IS ROBLOX'S AND IT IS TRANSIENT.
//
// A 409 "Server is busy and unable to process your upload request" comes back
// from both Studio and Open Cloud, so it is not a client problem and there is
// nothing to fix locally — it just has to be waited out. Retrying by hand is
// how you end up believing the build is broken.
const MAX = Number(process.env.PUBLISH_ATTEMPTS || 12);
for (let attempt = 1; attempt <= MAX; attempt++) {
  const res = await fetch(
    `https://apis.roblox.com/universes/v1/${universeId}/places/${placeId}/versions?versionType=${versionType}`,
    {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    },
  );
  const text = await res.text();
  if (res.ok) {
    console.log(`OK on attempt ${attempt} — ${scrub(text)}`);
    process.exit(0);
  }
  const retryable = res.status === 409 || res.status === 429 || res.status >= 500;
  console.error(`attempt ${attempt}/${MAX}: ${res.status} ${scrub(text).slice(0, 140)}`);
  if (!retryable) process.exit(1);
  if (attempt < MAX) {
    const wait = Math.min(60000, 5000 * 2 ** Math.min(attempt - 1, 4));
    console.error(`  retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
}
console.error('gave up — Roblox is still refusing the upload. Try again later.');
process.exit(1);
