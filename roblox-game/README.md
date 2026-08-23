# Sizzle Squad — Roblox port

The web game's simulation is the server: `src/domain` + `src/bots` (the
deterministic 60 Hz sim and the bot AI) compile to a single Luau module via
[TypeScriptToLua](https://typescripttolua.github.io/), so the Roblox game runs
**literally the same code** the web game ships, and the two builds are proven
tick-identical (see Parity below).

```
roblox-game/
  sync-shared.mjs        copies ../src/domain + ../src/bots into src/shared/ (CI: --check)
  src/shared/index.ts    barrel: the API surface compiled for Roblox
  tstl-bit32.cjs         TSTL plugin: JS bitwise ops -> Luau bit32.* calls
  out/shared-bundle.lua  compiled, self-contained (generated)
  game-src/server        Luau shell: runs the sim on Heartbeat (P1: bots-only smoke)
  game-src/client        Luau shell: fixed camera (P1 stub)
  assets/kitchen.rbxm    environment, emitted by ../roblox/ capture pipeline
  tools/                 smoke + parity harness (Lune + Node)
  default.project.json   Rojo tree -> SizzleSquad.rbxl
```

## Build

```sh
npm ci                                   # in this directory
rokit install                            # rojo 7.7.0 + lune 0.10.5 (or install manually)
npm run build                            # sync -> tstl -> rojo build -> SizzleSquad.rbxl
```

Open `SizzleSquad.rbxl` in Studio and press Play: the kitchen runs a full
bot-only service on the server (watch the output log), framed by the game's
fixed camera. Regenerate `assets/kitchen.rbxm` any time the web environment
changes: `cd ../roblox && npm run generate`.

## Why TSTL (and not roblox-ts or a hand port)

- A hand port of ~5.9k LOC of tuned, comment-load-bearing sim code would drift
  from the web game. Sharing the source verbatim keeps one truth.
- roblox-ts was spiked first and rejected: it replaces the JS standard library
  (`.length` → `.size()`, boolean sort comparators, no `Math`), and its `Map`
  does not preserve insertion order — which the bot planner and replay
  determinism depend on. TSTL implements real JS semantics (ordered maps,
  JS sorts, `Math.*`) on stock Lua.
- TSTL's Lua 5.1 target is Luau-compatible (no `goto`, no bitwise operator
  syntax); the one gap — bitwise operators in the PRNG — is closed by the
  ~50-line `tstl-bit32.cjs` plugin, which emits `bit32.*` calls (operands are
  integer by construction; see the plugin header for the exact contract).

A handful of upstream changes made the domain compile cleanly for both
runtimes (portable `imul`/`hypot`/`filled` in `src/domain/portable.ts`, plain
arrays instead of `Int32Array`, explicit `> 0` where a `0` would be truthy in
Lua, `this: void` on `SimState.rand`). The web build is unchanged in behavior:
`npm run check` + `node tools/planprobe.mjs` + `node tools/soak.mjs` all pass,
including the bit-exact same-seed determinism suite.

## Parity

`npm run parity` runs 3 seeded bot-only rounds (10,800 ticks each) under Node
and under Lune (compiled bundle) and compares per-tick digests:

- discrete state (coins/served/missed/combo, order count, every station's
  contents) matches **exactly, every tick**;
- chef positions/velocities agree within `8e-11` (Luau vs V8 `exp` ulp noise —
  it has never flipped a decision in the corpus).

Perf under Lune: ~6,200 ticks/s single-threaded (~0.16 ms per tick with 4
chefs + full bot AI) — comfortably inside the 60 Hz server budget.

## Next (P2 — see the port plan)

Server `simService`/`botService`/`replicator`, client-authoritative own-chef
movement via the exported `movePhase`, packed transform replication, captured
chef rigs + procedural animator, HUD/tickets, audio events.
