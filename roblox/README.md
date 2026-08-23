# Roblox export

`sizzle-squad.rbxl` is the game's kitchen environment as a Roblox place file —
open it directly in Roblox Studio. It is generated from the real TypeScript
world-builder, not hand-ported, so it stays faithful to `src/view/world.ts`.

![preview](preview.png)

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
```

## Known approximations

- Procedural canvas textures (flagstone grout, brick courses, plank grain,
  stucco mottle) become flat colors + Roblox surface materials.
- Toon/cel shading and baked lighting tricks don't translate; colors include a
  fraction of each material's baked "bounce" emissive so the room reads close
  to the game's lit values.
- Cones (3) and lathe profiles (pots, 20) are stacked-cylinder approximations.
- Squashed spheres (cobbles etc.) use `SpecialMesh` ellipsoids, which are
  visual-only (collision stays blocky) — fine for anchored scenery.
