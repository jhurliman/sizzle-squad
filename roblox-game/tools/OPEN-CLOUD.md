# Open Cloud setup

Lets the toolchain read and repair live profiles, and run Luau **inside the
published place** — the real engine, headless. That last part is the one thing
Lune harnesses cannot do: they run the shared sim faithfully but know nothing
about DataStores, BadgeService, MarketplaceService or GuiService.

## 1. Mint the key

<https://create.roblox.com/dashboard/credentials> → **CREATE API KEY**.

- **Name**: `sizzle-dev`
- **Access Permissions** → *Add API System* twice:
  - **Universe Datastores** → select the Sizzle Squad experience → tick
    `read`, `write`, `list`, `delete`.
    `delete` is what lets a corrupt profile be removed; without it the tool can
    read but not repair.
  - **Universe Places / Luau Execution** → select the same experience → tick
    `luau-execution-session:write` (may be listed as *Luau Execution
    Sessions*). Skip this one if you only want profile access.
- **Security → Accepted IP Addresses**: your public IP with `/32`
  (`curl -s ifconfig.me`). `0.0.0.0/0` works and is what to use if your IP is
  dynamic, but it means a leaked key is usable from anywhere — prefer the /32
  and re-edit it when your IP moves.
- **Expiration**: 30–90 days. Keys are cheap to re-mint.

Save, then **copy the secret — it is shown exactly once**.

## 2. Find the ids

Creator Dashboard → the experience → **⋯** → *Copy Universe ID*.
The place id is in the place's URL (`.../games/<placeId>/...`), or **⋯** →
*Copy Place ID* on the place itself. They are different numbers; the tool
needs the universe id always and the place id only for `luau`.

## 3. Store it

**Outside the repo**, so there is no path by which it reaches git:

```sh
mkdir -p ~/.config/sizzle
cat > ~/.config/sizzle/opencloud.json <<'EOF'
{
  "apiKey": "PASTE_THE_SECRET",
  "universeId": "0000000000",
  "placeId": "0000000000"
}
EOF
chmod 600 ~/.config/sizzle/opencloud.json
```

`ROBLOX_API_KEY` / `ROBLOX_UNIVERSE_ID` / `ROBLOX_PLACE_ID` override the file
if set, which is what CI would use.

## 4. Check it

```sh
cd roblox-game
node tools/opencloud.mjs check
```

Expect `SizzleProfiles_v1` in the list. If the list is empty the key is valid
but pointed at a universe nothing has saved into yet — check the universe id.

## Commands

```sh
node tools/opencloud.mjs check              # verify the key, list datastores
node tools/opencloud.mjs list               # stored profile keys
node tools/opencloud.mjs profile 4262376699 # read one profile (--raw for everything)
node tools/opencloud.mjs wipe 4262376699    # delete the profile and its board rows
node tools/opencloud.mjs luau some.luau     # run a script in the real place
```

`profile` also prints dishes-per-shift and the play time the shift count
implies at 180 seconds a round — the two derived figures that exposed the
inflated career profile.

## If the key leaks

Revoke it on the credentials page immediately; it grants delete on live player
data. Nothing in this repo ever prints the key, including in error messages.
