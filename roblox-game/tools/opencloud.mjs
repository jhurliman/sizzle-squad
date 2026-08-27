#!/usr/bin/env node
// Open Cloud CLI: read/wipe live profiles and run Luau inside the real place.
//
// CREDENTIALS LIVE OUTSIDE THE REPO, at ~/.config/sizzle/opencloud.json, so
// there is no path by which a key reaches git. Env vars override it, which is
// what CI would use. See tools/OPEN-CLOUD.md for how to mint the key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG = path.join(os.homedir(), '.config', 'sizzle', 'opencloud.json');

// Not a secret: universe ids are public -- they appear in Open Cloud URLs and
// in the creator dashboard. Baking it in means every command works with only
// the API key in the environment. Override with ROBLOX_UNIVERSE_ID.
const DEFAULT_UNIVERSE_ID = '10761465304';

function creds() {
  let file = {};
  if (fs.existsSync(CONFIG)) file = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const c = {
    // ROBLOX_SIZZLE_SQUAD_API_KEY is where this project's key actually lives
    // (exported from ~/.zshrc); the generic name stays supported for CI.
    apiKey: process.env.ROBLOX_SIZZLE_SQUAD_API_KEY || process.env.ROBLOX_API_KEY || file.apiKey,
    universeId: process.env.ROBLOX_UNIVERSE_ID || file.universeId || DEFAULT_UNIVERSE_ID,
    placeId: process.env.ROBLOX_PLACE_ID || file.placeId,
  };
  if (!c.apiKey) {
    console.error(`missing API key. Export ROBLOX_SIZZLE_SQUAD_API_KEY, or create ${CONFIG}:\n` +
      `{ "apiKey": "...", "universeId": "...", "placeId": "..." }\n` +
      `See roblox-game/tools/OPEN-CLOUD.md.`);
    process.exit(1);
  }
  return c;
}

// The key must never reach stdout, a log, or an error message.
async function api(url, { method = 'GET', body, headers = {} } = {}) {
  const { apiKey } = creds();
  const res = await fetch(url, {
    method,
    headers: { 'x-api-key': apiKey, ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url.replace(/\?.*/, '')} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

const DS = 'https://apis.roblox.com/datastores/v1/universes';
const ODS = 'https://apis.roblox.com/ordered-data-stores/v1/universes';
const PROFILE_STORE = 'SizzleProfiles_v1';
const BOARDS = ['SizzleBestRound_v1', 'SizzleCareerDishes_v1'];

function weekKey() {
  const t = new Date();
  const start = Date.UTC(t.getUTCFullYear(), 0, 1);
  const yday = Math.floor((Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - start) / 86400000) + 1;
  return `${t.getUTCFullYear()}-${String(Math.floor(yday / 7) + 1).padStart(2, '0')}`;
}

function entryUrl(universeId, store, key) {
  const q = new URLSearchParams({ datastoreName: store, entryKey: key });
  return `${DS}/${universeId}/standard-datastores/datastore/entries/entry?${q}`;
}

async function cmdCheck() {
  const { universeId } = creds();
  const out = await api(`${DS}/${universeId}/standard-datastores?limit=50`);
  console.log('credentials OK. datastores in this universe:');
  for (const d of out.datastores || []) console.log(`  ${d.name}`);
  if (!(out.datastores || []).some((d) => d.name === PROFILE_STORE)) {
    console.log(`  (note: ${PROFILE_STORE} not listed -- nothing has saved yet, or wrong universe)`);
  }
}

async function cmdList() {
  const { universeId } = creds();
  const q = new URLSearchParams({ datastoreName: PROFILE_STORE, limit: '100' });
  const out = await api(`${DS}/${universeId}/standard-datastores/datastore/entries?${q}`);
  const keys = (out.keys || []).map((k) => k.key);
  console.log(keys.length ? keys.join('\n') : '(no profiles stored)');
}

async function cmdProfile(userId) {
  const { universeId } = creds();
  const p = await api(entryUrl(universeId, PROFILE_STORE, `p${userId}`));
  const fields = ['rounds', 'totalDishes', 'bestRound', 'coins', 'xp', 'level', 'sessions'];
  console.log(`--- p${userId} ---`);
  for (const f of fields) console.log(`  ${f}: ${JSON.stringify(p[f])}`);
  if (p.streak) console.log(`  streak: ${JSON.stringify(p.streak)}`);
  if (p.__lock) console.log(`  __lock: ${JSON.stringify(p.__lock)}`);
  const rounds = Number(p.rounds) || 0;
  const dishes = Number(p.totalDishes) || 0;
  if (rounds > 0) {
    // A real shift serves tens of dishes. Far below 1 means most of those
    // "shifts" were never played -- which is what exposed the inflated profile.
    console.log(`  dishes per shift: ${(dishes / rounds).toFixed(3)}`);
    console.log(`  implied hours at 180s a shift: ${((rounds * 180) / 3600).toFixed(0)}`);
  }
  if (process.argv.includes('--raw')) console.log(JSON.stringify(p, null, 2));
}

async function cmdWipe(userId) {
  const { universeId } = creds();
  await api(entryUrl(universeId, PROFILE_STORE, `p${userId}`), { method: 'DELETE' });
  console.log(`profile p${userId} deleted`);
  // Boards are keyed `u{UserId}` (Progression writes `u{player.UserId}`), NOT
  // the bare id -- deleting the bare id silently removes nothing.
  //
  // They must be deleted rather than left to correct themselves: allTime and
  // weekly are written with math.max, so an inflated best sticks forever, and
  // dishes is an IncrementAsync, so a wiped profile carries on adding to the
  // old total.
  for (const board of [...BOARDS, `SizzleWeekly_${weekKey()}`]) {
    try {
      await api(`${ODS}/${universeId}/orderedDataStores/${board}/scopes/global/entries/u${userId}`, { method: 'DELETE' });
      console.log(`  board ${board}: row removed`);
    } catch (e) {
      const m = String(e.message);
      if (m.includes('404') || m.includes('NOT_FOUND')) {
        console.log(`  board ${board}: no row`);
      } else if (m.includes('ordered-data-store')) {
        console.log(`  board ${board}: key lacks the Ordered Data Stores permission ` +
          `(add API System "Ordered Data Stores" -> read + write to the key)`);
      } else {
        console.log(`  board ${board}: ${m}`);
      }
    }
  }
}

// Runs a Luau script INSIDE the published place, in the real engine, and
// prints whatever it logs. This is the piece that makes headless validation of
// Roblox-only behaviour possible at all.
async function cmdLuau(file) {
  const { universeId, placeId } = creds();
  if (!placeId) throw new Error('placeId is required for luau execution');
  const script = fs.readFileSync(file, 'utf8');
  const base = `https://apis.roblox.com/cloud/v2/universes/${universeId}/places/${placeId}`;
  const task = await api(`${base}/luau-execution-session-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
  process.stderr.write('running');
  let done = task;
  for (let i = 0; i < 120 && !['COMPLETE', 'FAILED', 'CANCELLED'].includes(done.state); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    process.stderr.write('.');
    done = await api(`https://apis.roblox.com/cloud/v2/${task.path}`);
  }
  process.stderr.write('\n');
  const logs = await api(`https://apis.roblox.com/cloud/v2/${task.path}/logs?maxPageSize=1000`);
  for (const m of logs.luauExecutionSessionTaskLogs?.[0]?.messages || []) console.log(m);
  if (done.state !== 'COMPLETE') {
    console.error(`state: ${done.state}`, JSON.stringify(done.error || {}, null, 2));
    process.exit(1);
  }
}

const [cmd, arg] = process.argv.slice(2);
const run = {
  check: cmdCheck,
  list: cmdList,
  profile: () => cmdProfile(arg),
  wipe: () => cmdWipe(arg),
  luau: () => cmdLuau(arg),
}[cmd];
if (!run) {
  console.error(`usage:
  node tools/opencloud.mjs check              verify the key and list datastores
  node tools/opencloud.mjs list               list stored profile keys
  node tools/opencloud.mjs profile <userId>   read one profile (--raw for all fields)
  node tools/opencloud.mjs wipe <userId>      delete the profile and its board rows
  node tools/opencloud.mjs luau <file.luau>   run a script inside the real place`);
  process.exit(1);
}
run().catch((e) => {
  console.error(String(e.message));
  process.exit(1);
});
