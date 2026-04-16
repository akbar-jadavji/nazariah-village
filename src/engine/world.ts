import { TileMap, Position } from "@/lib/types";

export function isPassable(tilemap: TileMap, x: number, y: number): boolean {
  if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return false;
  return tilemap.collision[y][x] === 0;
}

export function getTileInfo(tilemap: TileMap, x: number, y: number) {
  if (x < 0 || x >= tilemap.width || y < 0 || y >= tilemap.height) return null;
  return {
    ground: tilemap.ground[y][x],
    collision: tilemap.collision[y][x],
    object: tilemap.objects[y][x],
    building: tilemap.buildings[y][x],
  };
}

export function getBuildingAt(tilemap: TileMap, pos: Position) {
  const bId = tilemap.buildings[pos.y]?.[pos.x];
  if (!bId) return null;
  return tilemap.buildingEntries.find(b => b.id === bId) ?? null;
}
