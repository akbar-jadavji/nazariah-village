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
}
