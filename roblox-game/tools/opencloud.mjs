#!/usr/bin/env node
// Open Cloud CLI: read/wipe live profiles and run Luau inside the real place.
//
// CREDENTIALS LIVE OUTSIDE THE REPO, at ~/.config/sizzle/opencloud.json. Env
// vars override it, which is what CI would use. See tools/OPEN-CLOUD.md for how
// to mint the key.
import fs from "node:fs";

// Universe/place ids and the key lookup are shared with publish-place.mjs so
// the two tools cannot disagree about which place is live.
import { creds, stagingPlaceId } from "./opencloud-creds.mjs";

// Same refusal as the publisher: a staging command that quietly resolves to
// live is worse than no staging command.
const STAGING = process.argv.includes("--staging");
const targetPlace = () => (STAGING ? stagingPlaceId() : creds().placeId);

// The key must never reach stdout, a log, or an error message.
async function api(url, { method = "GET", body, headers = {} } = {}) {
  const { apiKey } = creds();
  const res = await fetch(url, {
    method,
    headers: { "x-api-key": apiKey, ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} ${url.replace(/\?.*/, "")} -> ${res.status} ${text.slice(0, 400)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

const DS = "https://apis.roblox.com/datastores/v1/universes";
const ODS = "https://apis.roblox.com/ordered-data-stores/v1/universes";
const PROFILE_STORE = "SizzleProfiles_v1";
const BOARDS = ["SizzleBestRound_v1", "SizzleCareerDishes_v1"];

function weekKey() {
  const t = new Date();
  const start = Date.UTC(t.getUTCFullYear(), 0, 1);
  const yday =
    Math.floor(
      (Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - start) /
        86400000,
    ) + 1;
  return `${t.getUTCFullYear()}-${String(Math.floor(yday / 7) + 1).padStart(2, "0")}`;
}

function entryUrl(universeId, store, key) {
  const q = new URLSearchParams({ datastoreName: store, entryKey: key });
  return `${DS}/${universeId}/standard-datastores/datastore/entries/entry?${q}`;
}

async function cmdCheck() {
  const { universeId } = creds();
  const out = await api(`${DS}/${universeId}/standard-datastores?limit=50`);
  console.log("credentials OK. datastores in this universe:");
  for (const d of out.datastores || []) console.log(`  ${d.name}`);
  if (!(out.datastores || []).some((d) => d.name === PROFILE_STORE)) {
    console.log(
      `  (note: ${PROFILE_STORE} not listed -- nothing has saved yet, or wrong universe)`,
    );
  }
}

async function cmdList() {
  const { universeId } = creds();
  const q = new URLSearchParams({ datastoreName: PROFILE_STORE, limit: "100" });
  const out = await api(
    `${DS}/${universeId}/standard-datastores/datastore/entries?${q}`,
  );
  const keys = (out.keys || []).map((k) => k.key);
  console.log(keys.length ? keys.join("\n") : "(no profiles stored)");
}

async function cmdProfile(userId) {
  const { universeId } = creds();
  const p = await api(entryUrl(universeId, PROFILE_STORE, `p${userId}`));
  const fields = [
    "rounds",
    "totalDishes",
    "bestRound",
    "coins",
    "xp",
    "level",
    "sessions",
  ];
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
    console.log(
      `  implied hours at 180s a shift: ${((rounds * 180) / 3600).toFixed(0)}`,
    );
  }
  if (process.argv.includes("--raw")) console.log(JSON.stringify(p, null, 2));
}

async function cmdWipe(userId) {
  const { universeId } = creds();
  try {
    await api(entryUrl(universeId, PROFILE_STORE, `p${userId}`), {
      method: "DELETE",
    });
    console.log(`profile p${userId} deleted`);
  } catch (e) {
    // Already gone is a success for a repair tool, and must not abort the
    // board cleanup that follows -- that is how a half-done wipe happens.
    if (/404|NOT_FOUND/.test(String(e.message)))
      console.log(`profile p${userId}: already absent`);
    else throw e;
  }
  await wipeBoards(universeId, userId);
}

function boardUrl(universeId, board, userId) {
  return `${ODS}/${universeId}/orderedDataStores/${board}/scopes/global/entries/u${userId}`;
}

// Read-then-delete, so the output distinguishes "removed a row worth N" from
// "there was nothing here" -- the earlier version could not tell those apart
// and reported success either way.
async function wipeBoards(universeId, userId) {
  // Boards are keyed `u{UserId}` (Progression writes `u{player.UserId}`), NOT
  // the bare id -- deleting the bare id silently removes nothing.
  //
  // They must be deleted rather than left to correct themselves: allTime and
  // weekly are written with math.max, so an inflated best sticks forever, and
  // dishes is an IncrementAsync, so a wiped profile carries on adding to the
  // old total.
  for (const board of [...BOARDS, `SizzleWeekly_${weekKey()}`]) {
    const url = boardUrl(universeId, board, userId);
    let had = null;
    try {
      const row = await api(url);
      had = row.value;
    } catch (e) {
      if (!/404|NOT_FOUND/.test(String(e.message))) {
        const m = String(e.message);
        console.log(
          `  ${board}: ${
            /ordered-data-store/.test(m)
              ? 'key lacks the Ordered Data Stores permission (API System "Ordered Data Stores" -> read + write)'
              : m
          }`,
        );
        continue;
      }
    }
    if (had === null) {
      console.log(`  ${board}: no row`);
      continue;
    }
    try {
      await api(url, { method: "DELETE" });
      console.log(`  ${board}: removed row worth ${had}`);
    } catch (e) {
      console.log(
        `  ${board}: read ${had} but DELETE failed -- ${String(e.message)}`,
      );
    }
  }
}

// Runs a Luau script INSIDE the published place, in the real engine, and
// prints whatever it logs. This is the piece that makes headless validation of
// Roblox-only behaviour possible at all.
async function cmdLuau(file) {
  const { universeId } = creds();
  const placeId = targetPlace();
  const script = fs.readFileSync(file, "utf8");
  const base = `https://apis.roblox.com/cloud/v2/universes/${universeId}/places/${placeId}`;
  const task = await api(`${base}/luau-execution-session-tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script }),
  });
  process.stderr.write("running");
  let done = task;
  for (
    let i = 0;
    i < 120 && !["COMPLETE", "FAILED", "CANCELLED"].includes(done.state);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    process.stderr.write(".");
    done = await api(`https://apis.roblox.com/cloud/v2/${task.path}`);
  }
  process.stderr.write("\n");
  const logs = await api(
    `https://apis.roblox.com/cloud/v2/${task.path}/logs?maxPageSize=1000`,
  );
  for (const m of logs.luauExecutionSessionTaskLogs?.[0]?.messages || [])
    console.log(m);
  if (done.state !== "COMPLETE") {
    console.error(
      `state: ${done.state}`,
      JSON.stringify(done.error || {}, null, 2),
    );
    process.exit(1);
  }
}

const [cmd, arg] = process.argv.slice(2).filter((a) => a !== "--staging");
// Which places does this universe have, and which one is which?
//
// NOT on apis.roblox.com. Open Cloud v2 exposes a place by id but has no
// listing, and there is no create-place operation there at all -- creating one
// is AssetService:CreatePlaceAsync, a LUAU call, and the Open Cloud Luau
// sandbox is refused it (HTTP 403). So a new place is made from Studio's
// command bar and this is how you find its id afterwards without hunting
// through the dashboard.
async function cmdPlaces() {
  const { apiKey, universeId, placeId } = creds();
  const res = await fetch(
    `https://develop.roblox.com/v1/universes/${universeId}/places?limit=50`,
    { headers: { "x-api-key": apiKey } },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`places -> ${res.status} ${text.slice(0, 200)}`);
  }
  const staging = (process.env.SIZZLE_STAGING_PLACE_ID || "").trim();
  const rows = JSON.parse(text).data || [];
  console.log(`universe ${universeId}: ${rows.length} place(s)`);
  for (const p of rows) {
    const id = String(p.id);
    let tag = "";
    if (id === placeId) tag = "  <-- LIVE";
    else if (id === staging) tag = "  <-- staging (SIZZLE_STAGING_PLACE_ID)";
    else tag = "  <-- not pointed at by anything";
    console.log(`  ${id.padEnd(18)} ${p.name}${tag}`);
  }
  if (rows.length === 1) {
    console.log(
      "\nOnly the live place exists. To add a staging one, open Studio and run\n" +
        "this in the command bar (it creates a copy of live, in the same universe):\n\n" +
        `  print(game:GetService("AssetService"):CreatePlaceAsync("Sizzle Squad — Staging", ${placeId}, "Staging"))\n\n` +
        "then export SIZZLE_STAGING_PLACE_ID=<the printed id> in ~/.zshrc.",
    );
  }
}

const run = {
  check: cmdCheck,
  list: cmdList,
  profile: () => cmdProfile(arg),
  boards: () => wipeBoards(creds().universeId, arg),
  wipe: () => cmdWipe(arg),
  luau: () => cmdLuau(arg),
  places: cmdPlaces,
}[cmd];
if (!run) {
  console.error(`usage:
  node tools/opencloud.mjs check              verify the key and list datastores
  node tools/opencloud.mjs places             list the universe's places and which is which
  node tools/opencloud.mjs list               list stored profile keys
  node tools/opencloud.mjs profile <userId>   read one profile (--raw for all fields)
  node tools/opencloud.mjs boards <userId>    clear just the leaderboard rows
  node tools/opencloud.mjs wipe <userId>      delete the profile and its board rows
  node tools/opencloud.mjs luau <file.luau>   run a script inside the real place`);
  process.exit(1);
}
run().catch((e) => {
  console.error(String(e.message));
  process.exit(1);
});
