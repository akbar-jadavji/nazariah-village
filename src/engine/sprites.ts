import {
  TILE_SIZE,
  TILE_GRASS, TILE_DIRT, TILE_WATER, TILE_STONE, TILE_GRASS_DARK,
  OBJ_TREE, OBJ_FENCE_H, OBJ_FENCE_V, OBJ_BENCH, OBJ_FLOWER, OBJ_LAMPPOST, OBJ_FOUNTAIN,
  BLDG_INN, BLDG_APOTHECARY, BLDG_LIBRARY, BLDG_BAKERY, BLDG_WORKSHOP,
  BLDG_COTTAGE_1, BLDG_COTTAGE_2, BLDG_COTTAGE_3, BLDG_COTTAGE_4, BLDG_COTTAGE_5,
  Direction,
} from "@/lib/types";

// Color palette — Stardew Valley inspired
const COLORS = {
  grass: "#5a9e3e",
  grassDark: "#4a8a32",
  dirt: "#c4a46c",
  water: "#4a8abf",
  waterDeep: "#3a7aaf",
  stone: "#9e9e9e",
  stoneDark: "#8a8a8a",
  wood: "#8b6914",
  woodDark: "#6b4f10",
  roof: "#b04040",
  roofDark: "#903030",
  wall: "#d4c4a0",
  wallDark: "#b4a480",
  door: "#6b3a1a",
  window: "#6ab4d4",
  tree: "#2d7a2d",
  treeTrunk: "#6b4226",
  treeTop: "#3d9a3d",
  fence: "#a08050",
  bench: "#7a5a30",
  flower1: "#e05080",
  flower2: "#e0a020",
  flower3: "#8050e0",
  lamppost: "#505050",
  lampLight: "#ffe080",
  fountain: "#8ab4d4",
  fountainStone: "#808080",
  // Character colors
  skin: "#f0c090",
  hair: "#6a3a20",
  shirt: "#4060c0",
  pants: "#404060",
};

// Draw a single ground tile
export function drawGroundTile(ctx: CanvasRenderingContext2D, tileId: number, x: number, y: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;

  switch (tileId) {
    case TILE_GRASS:
      ctx.fillStyle = COLORS.grass;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      // Subtle grass detail
      ctx.fillStyle = COLORS.grassDark;
      ctx.fillRect(px + 4, py + 8, 2, 2);
      ctx.fillRect(px + 20, py + 4, 2, 2);
      ctx.fillRect(px + 12, py + 22, 2, 2);
      ctx.fillRect(px + 26, py + 16, 2, 2);
      break;
    case TILE_DIRT:
      ctx.fillStyle = COLORS.dirt;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      // Dirt texture
      ctx.fillStyle = "#b09458";
      ctx.fillRect(px + 6, py + 10, 2, 2);
      ctx.fillRect(px + 18, py + 6, 2, 2);
      ctx.fillRect(px + 24, py + 20, 2, 2);
      break;
    case TILE_WATER:
      ctx.fillStyle = COLORS.water;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      // Water sparkle
      ctx.fillStyle = COLORS.waterDeep;
      ctx.fillRect(px + 8, py + 6, 4, 2);
      ctx.fillRect(px + 20, py + 18, 4, 2);
      ctx.fillStyle = "#6ac0e0";
      ctx.fillRect(px + 14, py + 12, 3, 1);
      break;
    case TILE_STONE:
      ctx.fillStyle = COLORS.stone;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      // Stone pattern
      ctx.fillStyle = COLORS.stoneDark;
      ctx.fillRect(px + 15, py, 1, TILE_SIZE);
      ctx.fillRect(px, py + 15, TILE_SIZE, 1);
      break;
    case TILE_GRASS_DARK:
      ctx.fillStyle = COLORS.grassDark;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.fillStyle = "#3d7a28";
      ctx.fillRect(px + 8, py + 12, 2, 2);
      ctx.fillRect(px + 22, py + 6, 2, 2);
      break;
    default:
      ctx.fillStyle = COLORS.grass;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  }
}

// Draw an object sprite
export function drawObject(ctx: CanvasRenderingContext2D, objId: number, x: number, y: number) {
  const px = x * TILE_SIZE;
  const py = y * TILE_SIZE;

  switch (objId) {
    case OBJ_TREE:
      // Trunk
      ctx.fillStyle = COLORS.treeTrunk;
      ctx.fillRect(px + 12, py + 16, 8, 16);
      // Foliage (round-ish)
      ctx.fillStyle = COLORS.tree;
      ctx.fillRect(px + 4, py + 2, 24, 18);
      ctx.fillStyle = COLORS.treeTop;
      ctx.fillRect(px + 8, py, 16, 14);
      ctx.fillRect(px + 6, py + 4, 20, 12);
      break;
    case OBJ_FENCE_H:
      ctx.fillStyle = COLORS.fence;
      ctx.fillRect(px, py + 12, TILE_SIZE, 4);
      ctx.fillRect(px, py + 20, TILE_SIZE, 4);
      // Posts
      ctx.fillRect(px + 2, py + 8, 4, 20);
      ctx.fillRect(px + 26, py + 8, 4, 20);
      break;
    case OBJ_FENCE_V:
      ctx.fillStyle = COLORS.fence;
      ctx.fillRect(px + 12, py, 4, TILE_SIZE);
      ctx.fillRect(px + 20, py, 4, TILE_SIZE);
      ctx.fillRect(px + 8, py + 2, 16, 4);
      ctx.fillRect(px + 8, py + 26, 16, 4);
      break;
    case OBJ_BENCH:
      ctx.fillStyle = COLORS.bench;
      // Seat
      ctx.fillRect(px + 4, py + 16, 24, 6);
      // Legs
      ctx.fillRect(px + 6, py + 22, 4, 6);
      ctx.fillRect(px + 22, py + 22, 4, 6);
      // Backrest
      ctx.fillRect(px + 4, py + 10, 24, 4);
      ctx.fillRect(px + 4, py + 10, 2, 10);
      ctx.fillRect(px + 26, py + 10, 2, 10);
      break;
    case OBJ_FLOWER:
      // Stem
      ctx.fillStyle = "#3a8030";
      ctx.fillRect(px + 14, py + 16, 4, 12);
      // Petals (random-ish color based on position)
      const flowerColor = (x + y) % 3 === 0 ? COLORS.flower1 :
                           (x + y) % 3 === 1 ? COLORS.flower2 : COLORS.flower3;
      ctx.fillStyle = flowerColor;
      ctx.fillRect(px + 10, py + 10, 12, 10);
      ctx.fillRect(px + 12, py + 8, 8, 14);
      // Center
      ctx.fillStyle = "#f0e040";
      ctx.fillRect(px + 14, py + 12, 4, 4);
      break;
    case OBJ_LAMPPOST:
      // Pole
      ctx.fillStyle = COLORS.lamppost;
      ctx.fillRect(px + 14, py + 8, 4, 24);
      // Base
      ctx.fillRect(px + 10, py + 28, 12, 4);
      // Lamp
      ctx.fillStyle = COLORS.lampLight;
      ctx.fillRect(px + 10, py + 2, 12, 8);
      ctx.fillStyle = COLORS.lamppost;
      ctx.fillRect(px + 10, py + 2, 12, 2);
      break;
    case OBJ_FOUNTAIN:
      // Basin
      ctx.fillStyle = COLORS.fountainStone;
      ctx.fillRect(px + 2, py + 14, 28, 16);
      ctx.fillRect(px + 6, py + 10, 20, 4);
      // Water
      ctx.fillStyle = COLORS.fountain;
      ctx.fillRect(px + 6, py + 16, 20, 12);
      // Center spout
      ctx.fillStyle = COLORS.fountainStone;
      ctx.fillRect(px + 14, py + 6, 4, 14);
      // Water spray
      ctx.fillStyle = "#a0d0f0";
      ctx.fillRect(px + 12, py + 2, 8, 6);
      break;
  }
}

// Building color schemes
const BUILDING_STYLES: Record<number, { wall: string; roof: string; roofDark: string; accent: string }> = {
  [BLDG_INN]:        { wall: "#d4b88c", roof: "#a04040", roofDark: "#803030", accent: "#e08030" },
  [BLDG_APOTHECARY]: { wall: "#c0d4c0", roof: "#506050", roofDark: "#405040", accent: "#80c060" },
  [BLDG_LIBRARY]:    { wall: "#c0b4d4", roof: "#604080", roofDark: "#503070", accent: "#d4a020" },
  [BLDG_BAKERY]:     { wall: "#e0d0b0", roof: "#c08040", roofDark: "#a06830", accent: "#f0c060" },
  [BLDG_WORKSHOP]:   { wall: "#b0a090", roof: "#606060", roofDark: "#505050", accent: "#c0a040" },
};

const COTTAGE_STYLE = { wall: "#d4c4a8", roof: "#8b6040", roofDark: "#6b4830", accent: "#a09070" };

// Draw a building (called once per building, covering its full footprint)
export function drawBuilding(
  ctx: CanvasRenderingContext2D,
  buildingId: number,
  bx: number, by: number,
  bw: number, bh: number,
  entryX: number, entryY: number
) {
  const px = bx * TILE_SIZE;
  const py = by * TILE_SIZE;
  const pw = bw * TILE_SIZE;
  const ph = bh * TILE_SIZE;

  const isCottage = buildingId >= BLDG_COTTAGE_1 && buildingId <= BLDG_COTTAGE_5;
  const style = isCottage ? COTTAGE_STYLE : (BUILDING_STYLES[buildingId] || COTTAGE_STYLE);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.fillRect(px + 4, py + 4, pw, ph);

  // Wall
  ctx.fillStyle = style.wall;
  ctx.fillRect(px, py + 6, pw, ph - 6);

  // Roof
  ctx.fillStyle = style.roof;
  ctx.fillRect(px - 2, py, pw + 4, 10);
  ctx.fillStyle = style.roofDark;
  ctx.fillRect(px - 2, py, pw + 4, 4);

  // Door at entry position
  const doorPx = entryX * TILE_SIZE;
  const doorPy = (entryY - 1) * TILE_SIZE; // door is on the bottom wall of the building
  ctx.fillStyle = COLORS.door;
  ctx.fillRect(doorPx + 10, doorPy + 16, 12, 16);
  // Door handle
  ctx.fillStyle = COLORS.lampLight;
  ctx.fillRect(doorPx + 18, doorPy + 24, 2, 2);

  // Windows
  const windowY = py + 12;
  if (bw >= 3) {
    // Left window
    ctx.fillStyle = COLORS.window;
    ctx.fillRect(px + 6, windowY, 10, 10);
    ctx.fillStyle = style.wall;
    ctx.fillRect(px + 10, windowY, 2, 10);
    ctx.fillRect(px + 6, windowY + 4, 10, 2);
    // Right window
    ctx.fillStyle = COLORS.window;
    ctx.fillRect(px + pw - 16, windowY, 10, 10);
    ctx.fillStyle = style.wall;
    ctx.fillRect(px + pw - 12, windowY, 2, 10);
    ctx.fillRect(px + pw - 16, windowY + 4, 10, 2);
  }

  // Building name plate accent
  ctx.fillStyle = style.accent;
  ctx.fillRect(px + 4, py + 6, pw - 8, 2);
}

// Draw a character sprite (player or agent placeholder)
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  visualX: number,
  visualY: number,
  direction: Direction,
  animFrame: number,
  isMoving: boolean,
  color: string = COLORS.shirt
) {
  const px = visualX * TILE_SIZE;
  const py = visualY * TILE_SIZE;

  // Walking bounce
  const bounce = isMoving ? Math.sin(animFrame * Math.PI / 2) * 2 : 0;
  const bobY = py - bounce;

  // Body/shirt
  ctx.fillStyle = color;
  ctx.fillRect(px + 8, bobY + 10, 16, 12);

  // Head
  ctx.fillStyle = COLORS.skin;
  ctx.fillRect(px + 10, bobY + 2, 12, 10);

  // Hair
  ctx.fillStyle = COLORS.hair;
  ctx.fillRect(px + 10, bobY + 1, 12, 4);

  // Eyes (direction-dependent)
  ctx.fillStyle = "#222";
  switch (direction) {
    case "down":
      ctx.fillRect(px + 13, bobY + 6, 2, 2);
      ctx.fillRect(px + 17, bobY + 6, 2, 2);
      break;
    case "up":
      // Back of head, no eyes visible
      ctx.fillStyle = COLORS.hair;
      ctx.fillRect(px + 10, bobY + 2, 12, 8);
      break;
    case "left":
      ctx.fillRect(px + 11, bobY + 6, 2, 2);
      break;
    case "right":
      ctx.fillRect(px + 19, bobY + 6, 2, 2);
      break;
  }

  // Legs
  ctx.fillStyle = COLORS.pants;
  const legOffset = isMoving ? Math.sin(animFrame * Math.PI / 2) * 2 : 0;
  ctx.fillRect(px + 10, bobY + 22, 5, 8 + legOffset);
  ctx.fillRect(px + 17, bobY + 22, 5, 8 - legOffset);
}
