// ONE DEFINITION OF WHICH PLACE IS LIVE.
//
// publish-place.mjs and opencloud.mjs each carried their own copy of this
// lookup, and the copies had already drifted: publish defaulted the place id,
// opencloud did not. So on a machine with the API key exported but no
// ROBLOX_PLACE_ID — which is the normal setup here — publishing worked and
// `npm run smoke:live` died with "placeId is required for luau execution".
// The place was never ambiguous; only the code was.
//
// Two copies of a credential lookup is two answers to "which place am I
// talking to", and the one that answers wrong is the one you find out about
// during a launch.
//
// CREDENTIALS LIVE OUTSIDE THE REPO, at ~/.config/sizzle/opencloud.json. Env
// vars override it, which is what CI would use. See tools/OPEN-CLOUD.md for
// how to mint the key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG = path.join(
  os.homedir(),
  ".config",
  "sizzle",
  "opencloud.json",
);

// Neither of these is a secret — they are in the place URL. They are defaults
// rather than constants so a staging place can be addressed with
// ROBLOX_PLACE_ID without editing the tools.
export const DEFAULT_UNIVERSE_ID = "10761465304";
export const DEFAULT_PLACE_ID = "113028832194057";

// Resolved once. `api()` calls creds() per request, and re-reading the config
// file on every poll of a 120-iteration wait loop is pure noise.
let cached = null;

/**
 * The staging place id, or a hard stop.
 *
 * THIS EXISTS BECAUSE THE STAGING COMMANDS USED TO TARGET LIVE.
 *
 * `publish:staging` was `ROBLOX_PLACE_ID=$SIZZLE_STAGING_PLACE_ID node
 * tools/publish-place.mjs`. With the variable unset -- which it was on this
 * machine -- the shell substitutes an empty string, empty string is falsy in
 * JS, and the lookup fell straight through to the live default. So the one
 * command whose entire job is to keep a build away from players published it
 * to them, silently, and printed a perfectly normal-looking version number.
 *
 * Never infer a staging target. Demand it, and refuse it if it is live.
 */
export function stagingPlaceId() {
  const id = (process.env.SIZZLE_STAGING_PLACE_ID || '').trim();
  if (!id) {
    console.error(
      'SIZZLE_STAGING_PLACE_ID is not set.\n' +
        'Create a second place in universe ' +
        DEFAULT_UNIVERSE_ID +
        ' (Creator Dashboard -> the experience -> Places -> Create Place),\n' +
        'then export SIZZLE_STAGING_PLACE_ID=<its id> in ~/.zshrc.\n' +
        'Refusing to guess: the guess would be the live place.',
    );
    process.exit(1);
  }
  if (id === DEFAULT_PLACE_ID) {
    console.error(
      `SIZZLE_STAGING_PLACE_ID is ${id}, which is the LIVE place. Refusing.`,
    );
    process.exit(1);
  }
  return id;
}

/**
 * Resolve the Open Cloud credentials: env vars first, then the config file,
 * then the non-secret defaults. Exits if there is no API key, because every
 * caller needs one and none of them can do anything useful without it.
 */
export function creds() {
  if (cached) return cached;
  let file = {};
  if (fs.existsSync(CONFIG)) file = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const c = {
    apiKey:
      process.env.ROBLOX_SIZZLE_SQUAD_API_KEY ||
      process.env.ROBLOX_API_KEY ||
      file.apiKey,
    universeId:
      process.env.ROBLOX_UNIVERSE_ID || file.universeId || DEFAULT_UNIVERSE_ID,
    placeId: process.env.ROBLOX_PLACE_ID || file.placeId || DEFAULT_PLACE_ID,
  };
  if (!c.apiKey) {
    console.error(
      `missing API key. Export ROBLOX_SIZZLE_SQUAD_API_KEY, or create ${CONFIG}:\n` +
        `{ "apiKey": "...", "universeId": "...", "placeId": "..." }\n` +
        `See roblox-game/tools/OPEN-CLOUD.md.`,
    );
    process.exit(1);
  }
  cached = c;
  return c;
}
