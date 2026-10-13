// Tile size in pixels
export const TILE_SIZE = 32;
export const MAP_WIDTH = 60;
export const MAP_HEIGHT = 40;

// Tile type IDs for the ground layer
export const TILE_GRASS = 0;
export const TILE_DIRT = 1;
export const TILE_WATER = 2;
export const TILE_STONE = 3;
export const TILE_GRASS_DARK = 4;

// Object type IDs
export const OBJ_NONE = 0;
export const OBJ_TREE = 1;
export const OBJ_FENCE_H = 2;
export const OBJ_FENCE_V = 3;
export const OBJ_BENCH = 4;
export const OBJ_FLOWER = 5;
export const OBJ_LAMPPOST = 6;
export const OBJ_FOUNTAIN = 7;

// Building IDs
export const BLDG_NONE = 0;
export const BLDG_INN = 1;
export const BLDG_APOTHECARY = 2;
export const BLDG_LIBRARY = 3;
export const BLDG_PLAZA = 4;
export const BLDG_PARK = 5;
export const BLDG_BAKERY = 6;
export const BLDG_WORKSHOP = 7;
export const BLDG_COTTAGE_1 = 8;
export const BLDG_COTTAGE_2 = 9;
export const BLDG_COTTAGE_3 = 10;
export const BLDG_COTTAGE_4 = 11;
export const BLDG_COTTAGE_5 = 12;
export const BLDG_COTTAGE_6 = 13;
export const BLDG_COTTAGE_7 = 14;
export const BLDG_COTTAGE_8 = 15;
export const BLDG_COTTAGE_9 = 16;
export const BLDG_COTTAGE_10 = 17;

export type Direction = "up" | "down" | "left" | "right";

export interface Position {
  x: number;
  y: number;
}

export interface Player {
  position: Position;
  direction: Direction;
  isMoving: boolean;
  // For smooth interpolation between tiles
  visualX: number;
  visualY: number;
  animFrame: number;
}

export interface TileMap {
  width: number;
  height: number;
  ground: number[][]; // ground tile IDs
  collision: number[][]; // 0 = passable, 1 = impassable
  objects: number[][]; // object IDs
  buildings: number[][]; // building IDs (footprint area)
  buildingEntries: BuildingEntry[];
}

export interface BuildingEntry {
  id: number;
  name: string;
  description: string;
  // Top-left corner of the building footprint
  x: number;
  y: number;
  width: number; // in tiles
  height: number; // in tiles
  // Entry tile position
  entryX: number;
  entryY: number;
  // Optional nested sub-areas/rooms. Used to enrich location context in
  // prompts so agents know they're "inside the inn's kitchen" rather than
  // just "inside the inn", and so they don't propose meeting at a place
  // they're already standing in.
  rooms?: Room[];
}

export interface Room {
  name: string;
  /** Brief description of what's in this room — fed to LLM context. */
  description: string;
}

/**
 * Interactable world objects — physical things on the map that agents and
 * the player can use a verb on (`pray` at the altar, `read` at the
 * bookshelves, `forage` at the wildflower patch, …).
 *
 * Each object has a tile position so we can render it on the canvas and
 * compute paths to it. The verb says what activity this object supports.
 */
export type ActivityVerb = "eat" | "sleep" | "rest" | "pray" | "read" | "forage" | "bake";

/**
 * Optional state machine for an object. Three-stage:
 *
 *   default → duringAction → afterAction → (decay) → default
 *
 * - `default` is shown when nothing is happening; the renderer also uses it
 *   as the fallback sprite key.
 * - `duringAction` is set when an agent starts the verb here.
 * - `afterAction` is set when they finish — this is the state most other
 *   agents will perceive (e.g. `ready` on an oven means "fresh loaves").
 * - `decayTicks` controls how many ticks `afterAction` lingers before
 *   reverting to `default`. Omit to never decay.
 */
export interface ObjectStateMachine {
  default: string;
  duringAction?: string;
  afterAction?: string;
  decayTicks?: number;
}

export interface InteractableObject {
  /** Stable key referenced by the LLM in target_object. */
  id: string;
  /** Display name for UI + memory generation. */
  name: string;
  /** Tile position (x, y). */
  x: number;
  y: number;
  /** Which verb this object supports. */
  verb: ActivityVerb;
  /** Short flavour the LLM and the player UI can use. */
  flavour: string;
  /** Sprite kind — drives how it's rendered. */
  kind:
    | "altar"
    | "bookshelves"
    | "bed"
    | "wildflower_patch"
    | "inn_bar"
    | "bench"
    | "oven"
    | "cauldron"
    | "notice_board"
    | "well"
    | "stove";
  /** Optional state machine. Objects without one have no mutable state. */
  states?: ObjectStateMachine;
  /**
   * Optional role lock — only the named agent(s) can fire this verb here.
   * Use an array for objects with co-workers (e.g. inn kitchen has the cook
   * and the innkeeper). Player is exempt regardless; the rest of the village
   * is bound by this.
   */
  roleLock?: string | string[];
}
