import {
  TileMap, BuildingEntry, MAP_WIDTH, MAP_HEIGHT,
  TILE_GRASS, TILE_DIRT, TILE_WATER, TILE_STONE, TILE_GRASS_DARK,
  OBJ_NONE, OBJ_TREE, OBJ_FENCE_H, OBJ_BENCH, OBJ_FLOWER, OBJ_LAMPPOST, OBJ_FOUNTAIN,
  BLDG_NONE, BLDG_INN, BLDG_APOTHECARY, BLDG_LIBRARY, BLDG_PLAZA,
  BLDG_PARK, BLDG_BAKERY, BLDG_WORKSHOP,
  BLDG_COTTAGE_1, BLDG_COTTAGE_2, BLDG_COTTAGE_3, BLDG_COTTAGE_4, BLDG_COTTAGE_5,
  BLDG_COTTAGE_6, BLDG_COTTAGE_7, BLDG_COTTAGE_8, BLDG_COTTAGE_9, BLDG_COTTAGE_10,
} from "@/lib/types";

function create2D(w: number, h: number, fill: number): number[][] {
  return Array.from({ length: h }, () => Array(w).fill(fill));
}

function fillRect(grid: number[][], x: number, y: number, w: number, h: number, val: number) {
  for (let row = y; row < y + h && row < grid.length; row++) {
    for (let col = x; col < x + w && col < grid[0].length; col++) {
      grid[row][col] = val;
    }
  }
}

function setTile(grid: number[][], x: number, y: number, val: number) {
  if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
    grid[y][x] = val;
  }
}

export function generateTileMap(): TileMap {
  const ground = create2D(MAP_WIDTH, MAP_HEIGHT, TILE_GRASS);
  const collision = create2D(MAP_WIDTH, MAP_HEIGHT, 0);
  const objects = create2D(MAP_WIDTH, MAP_HEIGHT, OBJ_NONE);
  const buildings = create2D(MAP_WIDTH, MAP_HEIGHT, BLDG_NONE);

  // ── Water ────────────────────────────────────────────────────────────────
  // Pond in the park (top-left quadrant)
  fillRect(ground, 30, 4, 4, 3, TILE_WATER);
  fillRect(collision, 30, 4, 4, 3, 1);
  // Stream east side (original area)
  for (let y = 7; y < 15; y++) {
    setTile(ground, 38, y, TILE_WATER);
    setTile(ground, 39, y, TILE_WATER);
    setTile(collision, 38, y, 1);
    setTile(collision, 39, y, 1);
  }
  // Small pond in the new eastern meadow
  fillRect(ground, 52, 6, 3, 3, TILE_WATER);
  fillRect(collision, 52, 6, 3, 3, 1);

  // ── Main roads (dirt) ────────────────────────────────────────────────────
  // Central E-W road — now runs full width (60 tiles)
  fillRect(ground, 0, 19, MAP_WIDTH, 2, TILE_DIRT);
  // Central N-S road
  fillRect(ground, 19, 0, 2, MAP_HEIGHT, TILE_DIRT);
  // Path to park
  fillRect(ground, 21, 5, 8, 1, TILE_DIRT);
  // Path to original cottage row (bottom-left)
  fillRect(ground, 21, 30, 10, 1, TILE_DIRT);
  fillRect(ground, 30, 30, 1, 8, TILE_DIRT);
  // Paths to bakery and workshop
  fillRect(ground, 5, 12, 14, 1, TILE_DIRT);
  fillRect(ground, 5, 12, 1, 7, TILE_DIRT);
  // Path to library
  fillRect(ground, 10, 5, 1, 7, TILE_DIRT);
  fillRect(ground, 10, 5, 9, 1, TILE_DIRT);
  // ── New eastern paths ────────────────────────────────────────────────────
  // N-S connector: from main road down to new cottage cluster
  fillRect(ground, 44, 20, 1, 14, TILE_DIRT);
  // E-W path through new cottage cluster
  fillRect(ground, 40, 29, 18, 1, TILE_DIRT);
  // E-W path for second cottage row
  fillRect(ground, 40, 34, 14, 1, TILE_DIRT);
  // Connecting spur from E-W main road to eastern cluster
  fillRect(ground, 40, 19, 5, 1, TILE_DIRT); // redundant but explicit

  // ── Stone at town plaza ───────────────────────────────────────────────────
  fillRect(ground, 17, 17, 6, 6, TILE_STONE);

  // ── Darker grass patches ─────────────────────────────────────────────────
  fillRect(ground, 28, 2, 6, 2, TILE_GRASS_DARK);
  fillRect(ground, 2, 28, 5, 5, TILE_GRASS_DARK);
  fillRect(ground, 34, 34, 4, 4, TILE_GRASS_DARK);
  fillRect(ground, 48, 10, 6, 4, TILE_GRASS_DARK); // eastern meadow patches
  fillRect(ground, 55, 22, 4, 5, TILE_GRASS_DARK);
  fillRect(ground, 42, 36, 8, 3, TILE_GRASS_DARK);

  // ── Building definitions ─────────────────────────────────────────────────
  const buildingEntries: BuildingEntry[] = [
    { id: BLDG_INN, name: "The Enchanted Hearth", description: "A warm tavern with a crackling fireplace",
      x: 2, y: 14, width: 3, height: 3, entryX: 3, entryY: 17 },
    { id: BLDG_APOTHECARY, name: "Moonpetal Apothecary", description: "Shelves lined with glowing bottles and dried herbs",
      x: 12, y: 14, width: 3, height: 3, entryX: 13, entryY: 17 },
    { id: BLDG_LIBRARY, name: "The Gilded Quill", description: "Towering bookshelves with ladders and a reading nook",
      x: 8, y: 2, width: 3, height: 3, entryX: 9, entryY: 5 },
    { id: BLDG_PLAZA, name: "Starfall Plaza", description: "An open cobblestone area with a crescent moon fountain",
      x: 17, y: 17, width: 6, height: 6, entryX: 20, entryY: 20 },
    { id: BLDG_PARK, name: "Eldergrove Park", description: "A quiet grove of ancient trees with stone benches",
      x: 27, y: 2, width: 5, height: 5, entryX: 29, entryY: 7 },
    { id: BLDG_BAKERY, name: "Hearthstone Bakery", description: "A cozy shop with flour-dusted counters",
      x: 2, y: 7, width: 3, height: 3, entryX: 3, entryY: 10 },
    { id: BLDG_WORKSHOP, name: "The Wanderer's Workshop", description: "A cluttered workspace with tools and strange contraptions",
      x: 12, y: 7, width: 3, height: 3, entryX: 13, entryY: 10 },
    // Original cottages — bottom-left cluster
    { id: BLDG_COTTAGE_1, name: "Aldric House", description: "The innkeeper's family home",
      x: 25, y: 32, width: 2, height: 2, entryX: 25, entryY: 34 },
    { id: BLDG_COTTAGE_2, name: "Vale House", description: "The librarian's quiet home",
      x: 28, y: 32, width: 2, height: 2, entryX: 28, entryY: 34 },
    { id: BLDG_COTTAGE_3, name: "Breen House", description: "The baker and craftsman's home",
      x: 31, y: 32, width: 2, height: 2, entryX: 31, entryY: 34 },
    { id: BLDG_COTTAGE_4, name: "Emberfell House", description: "The apothecary keeper's home",
      x: 25, y: 36, width: 2, height: 2, entryX: 25, entryY: 38 },
    { id: BLDG_COTTAGE_5, name: "Hollowell House", description: "A shared home for the village's elder bachelors",
      x: 28, y: 36, width: 2, height: 2, entryX: 28, entryY: 38 },
    // New eastern cottage cluster
    { id: BLDG_COTTAGE_6, name: "Dusk House", description: "A small cheerful cottage near the eastern meadow",
      x: 41, y: 26, width: 2, height: 2, entryX: 41, entryY: 28 },
    { id: BLDG_COTTAGE_7, name: "Greenhaft House", description: "A tidy craftsman's cottage",
      x: 46, y: 26, width: 2, height: 2, entryX: 46, entryY: 28 },
    { id: BLDG_COTTAGE_8, name: "Thornwood House", description: "A quiet cottage at the meadow edge",
      x: 51, y: 26, width: 2, height: 2, entryX: 51, entryY: 28 },
    { id: BLDG_COTTAGE_9, name: "Mornshade House", description: "A simply furnished cottage",
      x: 41, y: 31, width: 2, height: 2, entryX: 41, entryY: 33 },
    { id: BLDG_COTTAGE_10, name: "Fletch House", description: "A lively, slightly cluttered cottage",
      x: 46, y: 31, width: 2, height: 2, entryX: 46, entryY: 33 },
  ];

  // Place buildings on grid + collision
  for (const b of buildingEntries) {
    fillRect(buildings, b.x, b.y, b.width, b.height, b.id);
    if (b.id !== BLDG_PLAZA && b.id !== BLDG_PARK) {
      fillRect(collision, b.x, b.y, b.width, b.height, 1);
    }
  }
  for (const b of buildingEntries) {
    setTile(collision, b.entryX, b.entryY, 0);
  }

  // ── Objects ───────────────────────────────────────────────────────────────
  const treePositions = [
    // Top edge trees
    [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],
    [13,0],[14,0],[15,0],[16,0],[17,0],[18,0],
    [22,0],[23,0],[24,0],[25,0],[26,0],
    [35,0],[36,0],[37,0],[38,0],[39,0],
    [45,0],[46,0],[47,0],[48,0],[49,0],[50,0],
    [55,0],[56,0],[57,0],[58,0],[59,0],
    // Left edge trees
    [0,1],[0,2],[0,3],[0,4],[0,5],[0,6],
    [0,21],[0,22],[0,23],[0,24],[0,25],[0,26],[0,27],
    [0,33],[0,34],[0,35],[0,36],[0,37],[0,38],[0,39],
    // Right edge trees (new: x=59)
    [59,1],[59,2],[59,3],[59,4],[59,5],[59,6],[59,7],
    [59,10],[59,11],[59,12],[59,13],[59,14],[59,15],
    [59,21],[59,22],[59,23],[59,24],
    [59,28],[59,29],[59,30],[59,31],[59,32],
    [59,35],[59,36],[59,37],[59,38],[59,39],
    // Bottom edge trees
    [0,39],[1,39],[2,39],[3,39],[4,39],[5,39],
    [10,39],[11,39],[12,39],[13,39],[14,39],[15,39],[16,39],
    [17,39],[18,39],[19,39],[20,39],[21,39],[22,39],
    [35,39],[36,39],[37,39],[38,39],
    [50,39],[51,39],[52,39],[53,39],[54,39],
    // Scattered interior (original area)
    [6,24],[7,25],[8,26],[15,25],[16,28],
    [3,32],[4,33],[6,35],[7,30],
    // Park trees
    [27,3],[28,2],[31,3],[32,5],[29,5],
    // Old stream border (x=37 area)
    [37,8],[37,10],[37,12],[37,14],
    // Eastern meadow trees
    [42,3],[43,5],[45,4],[47,2],[50,3],[53,4],[56,3],[58,5],
    [42,12],[44,14],[48,11],[50,13],[54,12],[57,14],
    [55,20],[57,21],[56,27],[58,30],
    [40,37],[43,38],[50,37],[54,38],[57,36],
  ];
  for (const [tx, ty] of treePositions) {
    setTile(objects, tx, ty, OBJ_TREE);
    setTile(collision, tx, ty, 1);
  }

  // Fences
  for (let x = 1; x < 7; x++) {
    setTile(objects, x, 11, OBJ_FENCE_H);
    setTile(collision, x, 11, 1);
  }

  // Benches
  setTile(objects, 28, 4, OBJ_BENCH);
  setTile(objects, 30, 6, OBJ_BENCH);
  setTile(objects, 47, 22, OBJ_BENCH); // eastern meadow bench
  setTile(objects, 53, 24, OBJ_BENCH);

  // Plaza fountain
  setTile(objects, 19, 19, OBJ_FOUNTAIN);
  setTile(collision, 19, 19, 1);

  // Flowers
  const flowerPositions = [
    [4,18],[5,18],[14,18],[15,18],
    [22,8],[23,8],[24,9],
    [33,28],[34,28],[35,29],
    [11,32],[12,33],
    [41,23],[43,24],[46,23],[49,24], // eastern meadow flowers
    [55,16],[57,17],[53,18],
  ];
  for (const [fx, fy] of flowerPositions) {
    setTile(objects, fx, fy, OBJ_FLOWER);
  }

  // Lampposts along main roads + new eastern path
  const lampPositions = [
    [9,19],[14,19],[24,19],[29,19],[34,19],[39,19],[44,19],[49,19],[54,19],
    [19,9],[19,14],[19,24],[19,29],[19,34],
    [44,24],[44,29], // eastern N-S path lamps
  ];
  for (const [lx, ly] of lampPositions) {
    setTile(objects, lx, ly, OBJ_LAMPPOST);
    setTile(collision, lx, ly, 1);
  }

  // Map edges impassable
  for (let x = 0; x < MAP_WIDTH; x++) {
    setTile(collision, x, 0, 1);
    setTile(collision, x, MAP_HEIGHT - 1, 1);
  }
  for (let y = 0; y < MAP_HEIGHT; y++) {
    setTile(collision, 0, y, 1);
    setTile(collision, MAP_WIDTH - 1, y, 1);
  }

  return { width: MAP_WIDTH, height: MAP_HEIGHT, ground, collision, objects, buildings, buildingEntries };
}
