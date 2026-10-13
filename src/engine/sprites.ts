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

// ── Interactable world objects (altar, bookshelves, bed, etc.) ──────────────
import type { InteractableObject } from "@/lib/types";

/**
 * PNG sprite cache for interactable objects. The renderer will try the
 * specific state file first (`/assets/objects/<kind>_<state>.png`) and fall
 * back to the kind-only file (`<kind>.png`). If neither exists, the
 * procedural drawer takes over.
 *
 * Cache values:
 *   - HTMLImageElement: loaded successfully (use it)
 *   - false           : 404'd, do not retry
 *   - undefined       : not yet attempted
 */
const objectSpriteCache = new Map<string, HTMLImageElement | false>();

function getObjectSprite(kind: string, state?: string): HTMLImageElement | null {
  const keys = state ? [`${kind}_${state}`, kind] : [kind];
  for (const key of keys) {
    const cached = objectSpriteCache.get(key);
    if (cached instanceof HTMLImageElement) return cached;
    if (cached === false) continue; // known-missing; try next fallback
    if (typeof window === "undefined") return null; // SSR safety
    // Not attempted yet — kick off a load. We return null this frame; once
    // it's in cache the next frame will pick it up.
    const img = new Image();
    img.onload = () => objectSpriteCache.set(key, img);
    img.onerror = () => objectSpriteCache.set(key, false);
    img.src = `/assets/objects/${key}.png`;
    // Mark "pending" by NOT setting in the cache yet — that way we don't
    // double-attempt; the onload/onerror will set the final value.
    return null;
  }
  return null;
}

/**
 * Draw an interactable object on the canvas. Each kind has a small distinct
 * sprite — agents and the player can spot what they're walking toward.
 *
 * If a PNG exists at /assets/objects/<kind>(_<state>).png, that gets blitted.
 * Otherwise a procedural placeholder is drawn so the village always renders.
 *
 * Also draws a faint glow outline when `highlighted` is true (used when the
 * player is close enough to interact).
 */
export function drawInteractable(
  ctx: CanvasRenderingContext2D,
  obj: InteractableObject,
  highlighted = false,
  currentState?: string,
) {
  const px = obj.x * TILE_SIZE;
  const py = obj.y * TILE_SIZE;

  if (highlighted) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 220, 130, 0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.restore();
  }

  // Try the PNG path first. If we get a real image back, blit and return.
  const sprite = getObjectSprite(obj.kind, currentState);
  if (sprite) {
    ctx.drawImage(sprite, px, py, TILE_SIZE, TILE_SIZE);
    return;
  }

  switch (obj.kind) {
    case "altar": {
      // Stone block with a lit candle on top.
      ctx.fillStyle = "#6a6a78";
      ctx.fillRect(px + 8, py + 16, 16, 12);
      ctx.fillStyle = "#4a4a55";
      ctx.fillRect(px + 8, py + 24, 16, 4);
      // Candle
      ctx.fillStyle = "#f0e8c8";
      ctx.fillRect(px + 14, py + 6, 4, 10);
      // Flame
      ctx.fillStyle = "#f6c060";
      ctx.fillRect(px + 14, py + 2, 4, 4);
      ctx.fillStyle = "#ffeea0";
      ctx.fillRect(px + 15, py + 3, 2, 2);
      // Crescent etched on the front
      ctx.fillStyle = "#aaa6b8";
      ctx.fillRect(px + 13, py + 20, 6, 2);
      break;
    }
    case "bookshelves": {
      // Vertical wooden case with rows of colored book spines.
      ctx.fillStyle = "#5a3a20";
      ctx.fillRect(px + 4, py + 2, 24, 28);
      ctx.fillStyle = "#3a2418";
      ctx.fillRect(px + 4, py + 2, 24, 2); // top trim
      ctx.fillRect(px + 4, py + 28, 24, 2); // bottom trim
      // Books row 1
      const colors = ["#c44848", "#4868c4", "#c4a448", "#48a448", "#a448c4"];
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = colors[(i + row) % colors.length];
          ctx.fillRect(px + 5 + i * 5, py + 6 + row * 8, 4, 6);
        }
      }
      break;
    }
    case "bed": {
      // Brown frame, beige sheet, darker pillow on one end.
      ctx.fillStyle = "#5a3a20";
      ctx.fillRect(px + 2, py + 10, 28, 18);
      ctx.fillStyle = "#d4c8a0";
      ctx.fillRect(px + 4, py + 12, 24, 14);
      // Pillow
      ctx.fillStyle = "#f0e8d8";
      ctx.fillRect(px + 4, py + 12, 8, 6);
      // Blanket fold
      ctx.fillStyle = "#a06848";
      ctx.fillRect(px + 14, py + 18, 14, 8);
      break;
    }
    case "wildflower_patch": {
      // Cluster of small colored dots = flowers.
      ctx.fillStyle = "#3a8030";
      ctx.fillRect(px + 4, py + 24, 24, 6); // grass mat
      const dots: [number, number, string][] = [
        [8, 18, "#e6588c"],
        [14, 14, "#f0c050"],
        [20, 20, "#a06ad0"],
        [24, 16, "#e6588c"],
        [10, 22, "#f0c050"],
        [18, 24, "#a0d050"],
        [22, 26, "#a06ad0"],
      ];
      for (const [dx, dy, color] of dots) {
        ctx.fillStyle = color;
        ctx.fillRect(px + dx, py + dy, 3, 3);
      }
      break;
    }
    case "inn_bar": {
      // Wooden bar counter with a tankard.
      ctx.fillStyle = "#7a4a28";
      ctx.fillRect(px + 2, py + 14, 28, 14);
      ctx.fillStyle = "#5a3a18";
      ctx.fillRect(px + 2, py + 14, 28, 3);
      ctx.fillRect(px + 2, py + 26, 28, 2);
      // Tankard
      ctx.fillStyle = "#aaa6a0";
      ctx.fillRect(px + 14, py + 8, 6, 10);
      ctx.fillStyle = "#ddd8c8"; // foam
      ctx.fillRect(px + 14, py + 8, 6, 2);
      // Plate
      ctx.fillStyle = "#e6e0d0";
      ctx.fillRect(px + 22, py + 18, 6, 3);
      break;
    }
    case "bench": {
      // Reuse the bench look from OBJ_BENCH but slightly lighter so it
      // reads as "interactable" vs the inert decorative ones.
      ctx.fillStyle = "#8a6a3a";
      ctx.fillRect(px + 4, py + 16, 24, 6);
      ctx.fillStyle = "#6a4a20";
      ctx.fillRect(px + 6, py + 22, 4, 8);
      ctx.fillRect(px + 22, py + 22, 4, 8);
      ctx.fillStyle = "#8a6a3a";
      ctx.fillRect(px + 4, py + 10, 24, 4);
      ctx.fillRect(px + 4, py + 10, 2, 12);
      ctx.fillRect(px + 26, py + 10, 2, 12);
      break;
    }
    case "oven": {
      // Stone arch on the bottom; fire/glow + bread visible based on state.
      // Base body
      ctx.fillStyle = "#5a4a3a";
      ctx.fillRect(px + 4, py + 6, 24, 22);
      ctx.fillStyle = "#3a2a20";
      ctx.fillRect(px + 4, py + 26, 24, 2);
      // Arched mouth
      ctx.fillStyle = "#1a0e08";
      ctx.fillRect(px + 8, py + 12, 16, 12);
      ctx.fillStyle = "#5a4a3a";
      ctx.fillRect(px + 8, py + 12, 2, 4);
      ctx.fillRect(px + 22, py + 12, 2, 4);
      // Chimney
      ctx.fillStyle = "#6a5a4a";
      ctx.fillRect(px + 18, py + 2, 6, 6);

      if (currentState === "baking") {
        // Glow + smoke
        ctx.fillStyle = "#f0a040";
        ctx.fillRect(px + 11, py + 17, 10, 6);
        ctx.fillStyle = "#ffd060";
        ctx.fillRect(px + 13, py + 19, 6, 3);
        // Smoke puffs
        ctx.fillStyle = "rgba(220,210,200,0.6)";
        ctx.fillRect(px + 19, py + 0, 4, 3);
        ctx.fillRect(px + 21, py - 2, 4, 3);
      } else if (currentState === "ready") {
        // Embers + bread on a tray below the mouth
        ctx.fillStyle = "#c44040";
        ctx.fillRect(px + 12, py + 21, 8, 2);
        // Three round loaves
        ctx.fillStyle = "#c4965a";
        ctx.fillRect(px + 6, py + 28, 6, 3);
        ctx.fillRect(px + 14, py + 28, 6, 3);
        ctx.fillRect(px + 22, py + 28, 6, 3);
        ctx.fillStyle = "#a07840";
        ctx.fillRect(px + 6, py + 30, 6, 1);
        ctx.fillRect(px + 14, py + 30, 6, 1);
        ctx.fillRect(px + 22, py + 30, 6, 1);
      }
      // cold: nothing extra — just the dark hearth
      break;
    }
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
