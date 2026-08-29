# Roblox export

`sizzle-squad.rbxl` is the game's kitchen environment as a Roblox place file —
open it directly in Roblox Studio. It is generated from the real TypeScript
world-builder, not hand-ported, so it stays faithful to `src/view/world.ts`.

![preview](../docs/art/kitchen-preview.png)

## Where renders go, and what is committed

**No tool writes an image beside its own source.** A batch of animation sheets
was committed by accident precisely because they did: the script wrote
`anim-walk-*.png` into `roblox/`, `git add` swept them up, and nobody decided
anything. Every render tool now writes to a dedicated directory.

| Directory | Contents | Committed? |
| --- | --- | --- |
| `badge-art/` `game-icon/` `pass-art/` `game-banner/` | Art uploaded to Roblox, or under review for upload | **Yes**, via Git LFS |
| `preview/<tool>/` | Developer instruments — hat fits, animation strips, chef sheets, raw viewer renders | No (gitignored) |
| `audio-out/` | Rendered SFX and music sources, uploaded to Roblox | **Yes**, via Git LFS |
| any `_*.png` | Contact sheets and intermediates, regenerated with the finals | No (gitignored) |

The rule for the first column is "did this go to the platform, or is it about
to" — the exact bytes Roblox received are worth keeping. Everything else is
reproducible by re-running the script that made it, and a repo is not a cache.

Binary assets are stored with **Git LFS** (`.gitattributes`): images, `.rbxm`
/ `.rbxl`, and audio sources. They never diff usefully and every revision is a
full copy in the pack. Note that LFS applies from the commit that introduced it
onward; history was deliberately NOT rewritten, since that would force every
clone to re-fetch for no benefit.

## What's in the place

```
Workspace
└─ SizzleSquadKitchen (Model)
   ├─ Floor (Model)                     flagstone slab (runs past the front row, like the game)
   ├─ Walls (Folder) ─ BackWall, SideWalls (stucco, timber framing, cobble wainscot, door)
   ├─ Oven (Model)                      chimney breast, stone arch, cavity, hearth, burners
   ├─ Benches (Folder)                  Bench_<x>_<z> models, one per prep table
   ├─ Stations (Folder)                 <Kind>_<cellX>_<cellY> models: Stove/Sink/Board/
   │                                    Crate/Plates/Serve/Counter/Bin (from KITCHEN_MAP)
   ├─ Dressing (Model)                  decorative props
   ├─ Spawns (Folder)                   4 invisible SpawnLocations on the kitchen floor
   └─ Colliders (Folder)                invisible perimeter walls around the floor slab
```

All parts are anchored. Colors come from the game's own runtime materials
(`PALETTE` + the value-capped `C` table), part names from a nearest-color match
against the authored palette names. **Scale: 5 studs per world unit** — one
kitchen grid cell = 5 studs, so lanes are 10 studs wide (comfortable for four
R15 avatars) and wall-counter tops land at ~4.3 studs.

## How it works

The generation pipeline runs the actual game code headless and records what it
builds — zero transcription:

1. `build.mjs` + `capture.mjs` — esbuild-bundles `WorldView` with an
   instrumented `three` module (`three-wrapped.mjs`) and a stubbed DOM/canvas
   (`stub-dom.mjs`). Every primitive geometry records its constructor args,
   accumulated transform, and creating builder (via stack trace). Merged
   color-bucket meshes are expanded back into primitives via a wrapped
   `mergeGeometries`. Output: `primdump.json`.
2. `prepare.mjs` — filters out UI/effect quads (transparent MeshBasic
   materials: glyphs, glows, fake shadows, baked AO), maps primitives to Roblox
   shapes (boxes/cylinders/balls 1:1; cones and lathe profiles become stacked
   cylinder slices; planes become thin slabs sunk behind their visible face),
   blends texture-carrying surfaces to representative flat colors, assigns
   Roblox materials (Slate/Concrete/WoodPlanks/Metal), and groups everything
   into the model tree. Output: `parts.json`.
3. `convert.luau` ([Lune](https://github.com/lune-org/lune)) — instantiates the
   DataModel and serializes `sizzle-squad.rbxl`.

## Regenerating

```sh
npm ci            # in the repo root (three.js, playwright)
cd roblox
npm i             # esbuild
npm run generate  # needs lune on PATH (brew install lune / cargo install lune / GitHub releases)
npm run verify    # structural audit of the .rbxl
npm run render    # headless three.js preview renders (render-persp.png / render-top.png)
npm run anim      # animation review sheets (see below)
```

## Reviewing the chef animator

`chef-sheet.mjs` and `hats-on-chefs.mjs` render the CAPTURED rigs — bind pose,
fit and palette. They cannot show a gait, because a gait is not in a still.

`npm run anim` covers the other half. `pose-dump.luau` loads
`game-src/client/ChefVisuals.luau` itself into a Lune sandbox (stubbed
`game`/`require`, Roblox datatypes from `@lune/roblox`, and the module's own
injectable `commit` hook handing back the posed CFrames), drives it against the
real `chef-rigs.rbxm`, and writes `anim-dump.json`. `anim-sheet.mjs` then
renders, under a level orthographic camera so the floor is a single line you
can read foot contact against:

- `anim-walk-<species>.png` / `-front.png` — one stride in eight frames
- `anim-idle.png` — the cast standing, side and front
- `anim-face-<species>.png` — eyes open / mid-blink / jaw open on effort
- `anim-bank.png` — turning left, straight, turning right

It is the shipping animator being rendered, not a re-implementation of it, so
the sheets cannot drift from the game.

## Known approximations

- Procedural canvas textures (flagstone grout, brick courses, plank grain,
  stucco mottle) become flat colors + Roblox surface materials.
- Toon/cel shading and baked lighting tricks don't translate; colors include a
  fraction of each material's baked "bounce" emissive so the room reads close
  to the game's lit values.
- Cones (3) and lathe profiles (pots, 20) are stacked-cylinder approximations.
- Squashed spheres (cobbles etc.) use `SpecialMesh` ellipsoids, which are
  visual-only (collision stays blocky) — fine for anchored scenery.
