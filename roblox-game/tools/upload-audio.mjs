#!/usr/bin/env node
// RE-UPLOAD THE GAME'S AUDIO UNDER THE EXPERIENCE OWNER'S ACCOUNT.
//
// Roblox audio is private to whoever uploaded it. The original 55 SFX and 4
// music stems were uploaded by a DIFFERENT account (Catsofhavens, 7880886259)
// to the one that owns Sizzle Squad (jhurliman, 4262376699), and audio owned
// by another account does not play in your experience -- it fails SILENTLY,
// which is why the first multiplayer playtest was completely mute.
//
// This re-uploads every .wav in roblox/audio-out (and audio-out/music) through
// Open Cloud, under the owner's own account, and writes a fresh asset-ids.csv.
//
//   node tools/upload-audio.mjs --check      # verify creds + scope, upload one
//   node tools/upload-audio.mjs              # upload everything missing
//   node tools/upload-audio.mjs --force      # re-upload even if already done
//
// Credentials come from the same place as tools/opencloud.mjs and MUST NEVER
// reach stdout, a log, or an error message.
//
// Roblox does not accept .wav through this API, so each file is transcoded to
// mp3 with ffmpeg first. Uploads are moderated: an asset can come back
// approved immediately or sit pending for a while. Ids are usable either way.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CONFIG = path.join(os.homedir(), ".config", "sizzle", "opencloud.json");
const OWNER_USER_ID = process.env.ROBLOX_CREATOR_ID || "4262376699";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const AUDIO_DIR = path.resolve(HERE, "../../roblox/audio-out");
const OUT_CSV = path.join(AUDIO_DIR, "asset-ids.csv");
const TMP = path.join(os.tmpdir(), "sizzle-audio-mp3");

function creds() {
  let file = {};
  if (fs.existsSync(CONFIG)) file = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const apiKey =
    process.env.ROBLOX_SIZZLE_SQUAD_API_KEY ||
    process.env.ROBLOX_API_KEY ||
    file.apiKey;
  if (!apiKey) {
    console.error(
      `missing API key. Export ROBLOX_SIZZLE_SQUAD_API_KEY or create ${CONFIG}.`,
    );
    process.exit(1);
  }
  return { apiKey };
}

/** Never let the key surface, whatever the failure mode. */
function scrub(text, key) {
  return String(text).split(key).join("<redacted>");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadOne(apiKey, mp3Path, name) {
  const form = new FormData();
  form.append(
    "request",
    JSON.stringify({
      assetType: "Audio",
      displayName: name,
      description: "Sizzle Squad game audio",
      creationContext: {
        creator: { userId: OWNER_USER_ID },
        expectedPrice: 0,
      },
    }),
  );
  form.append(
    "fileContent",
    new Blob([fs.readFileSync(mp3Path)], { type: "audio/mpeg" }),
    path.basename(mp3Path),
  );

  const res = await fetch("https://apis.roblox.com/assets/v1/assets", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upload ${name}: HTTP ${res.status} ${scrub(text, apiKey)}`);
  }
  const op = JSON.parse(text);

  // The upload returns an Operation; the asset id only exists once it resolves.
  const opId = String(op.path || op.operationId || "").replace(/^operations\//, "");
  if (!opId) throw new Error(`upload ${name}: no operation id in response`);
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const r = await fetch(
      `https://apis.roblox.com/assets/v1/operations/${opId}`,
      { headers: { "x-api-key": apiKey } },
    );
    const t = await r.text();
    if (!r.ok) throw new Error(`poll ${name}: HTTP ${r.status} ${scrub(t, apiKey)}`);
    const o = JSON.parse(t);
    if (o.done) {
      const id = o.response?.assetId ?? o.response?.path?.split("/").pop();
      if (!id) throw new Error(`poll ${name}: done but no assetId`);
      return String(id);
    }
  }
  throw new Error(`poll ${name}: still pending after 60s`);
}

async function main() {
  const { apiKey } = creds();
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");

  const files = [];
  for (const f of fs.readdirSync(AUDIO_DIR)) {
    if (f.endsWith(".wav")) files.push({ name: f.replace(/\.wav$/, ""), src: path.join(AUDIO_DIR, f) });
  }
  const musicDir = path.join(AUDIO_DIR, "music");
  if (fs.existsSync(musicDir)) {
    for (const f of fs.readdirSync(musicDir)) {
      if (f.endsWith(".wav")) files.push({ name: f.replace(/\.wav$/, ""), src: path.join(musicDir, f) });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) {
    console.error(`no .wav files under ${AUDIO_DIR}`);
    process.exit(1);
  }

  // RESUMABLE. A single failure partway through 59 uploads should cost that
  // one file, not the whole run: names already recorded in asset-ids.csv are
  // skipped and carried straight into the rewritten file.
  const existing = new Map();
  if (fs.existsSync(OUT_CSV) && !args.includes("--force")) {
    for (const line of fs.readFileSync(OUT_CSV, "utf8").split("\n").slice(1)) {
      const [name, id, , creator] = line.split(",");
      if (name && id && creator === String(OWNER_USER_ID)) existing.set(name, id);
    }
  }

  fs.mkdirSync(TMP, { recursive: true });
  const done = [];
  for (const [name, id] of existing) done.push({ name, id });
  const pending = files.filter((f) => !existing.has(f.name));
  const todo = checkOnly ? files.slice(0, 1) : pending;
  if (!checkOnly && existing.size > 0) {
    console.log(`${existing.size} already uploaded under this account; ${pending.length} to go`);
  }
  console.log(`${files.length} files found; uploading ${todo.length} as user ${OWNER_USER_ID}`);
  if (todo.length === 0) {
    console.log("nothing to do — every file already has an id on this account");
    return;
  }

  for (const [i, f] of todo.entries()) {
    const mp3 = path.join(TMP, `${f.name}.mp3`);
    if (!fs.existsSync(mp3)) {
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", f.src, "-codec:a", "libmp3lame", "-b:a", "128k", mp3]);
    }
    try {
      const id = await uploadOne(apiKey, mp3, f.name);
      done.push({ name: f.name, id });
      console.log(`  [${i + 1}/${todo.length}] ${f.name} -> ${id}`);
    } catch (e) {
      console.error(`  [${i + 1}/${todo.length}] ${f.name} FAILED: ${scrub(e.message, apiKey)}`);
      if (checkOnly || done.length === 0) process.exit(1);
    }
    // Audio upload is rate limited; pace it rather than get throttled midway.
    await sleep(700);
  }

  if (checkOnly) {
    console.log("check passed — the key can create audio assets on this account");
    return;
  }
  done.sort((a, b) => a.name.localeCompare(b.name));
  const rows = ["Name,Asset ID,Asset Type,Creator"];
  for (const d of done) rows.push(`${d.name},${d.id},Audio,${OWNER_USER_ID}`);
  fs.writeFileSync(OUT_CSV, rows.join("\n") + "\n");
  console.log(`wrote ${OUT_CSV} (${done.length} assets)`);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
