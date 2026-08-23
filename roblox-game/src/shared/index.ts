// Barrel: the shared simulation API surface compiled (via TypeScriptToLua)
// into a single self-contained Luau module the Roblox shell requires.
export {
  SIM_DT,
  SIM_HZ,
  createSim,
  mulberry32,
  seedPans,
  step,
  movePhase,
  collidePhase,
  interactPhase,
  stationPhase,
  planGrab,
  findFocus,
  safeSpawn,
} from './domain/sim';
export type { SimState, SimOptions } from './domain/sim';
export { buildKitchen, isWalkable, KITCHEN_MAP, stationCenter } from './domain/kitchen';
export { TUNING, RECIPES, INGREDIENT_DEFS } from './domain/content';
export { NO_INPUT } from './domain/types';
export type { Chef, InputSnapshot, Kitchen, SimEvent, Station } from './domain/types';
export { buildFlow, flowDir } from './domain/nav';
export { BotDirector } from './bots/brain';

import { BotDirector } from './bots/brain';
/** Factory for the Luau shell: TSTL class construction isn't reachable from plain Luau. */
export function makeBotDirector(): BotDirector {
  return new BotDirector();
}
