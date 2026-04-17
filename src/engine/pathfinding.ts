import { Position } from "@/lib/types";

/**
 * A* pathfinding on a 4-connected tile grid.
 *
 * `blocked(x, y)` should return true for tiles the agent cannot step on.
 * This indirection lets the caller mix static collision with dynamic
 * occupancy (e.g. other agents) if desired.
 *
 * Returns the list of steps starting AFTER the start tile, ending at the goal
 * (inclusive). Returns null if no path exists, or empty array if start === goal.
 */
export function findPath(
  start: Position,
  goal: Position,
  width: number,
  height: number,
  blocked: (x: number, y: number) => boolean,
  maxNodes = 2000,
): Position[] | null {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (blocked(goal.x, goal.y)) return null;

  const key = (x: number, y: number) => y * width + x;
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  // Node store keyed by tile index.
  type Node = { x: number; y: number; g: number; f: number; parent: number };
  const nodes = new Map<number, Node>();

  const startKey = key(start.x, start.y);
  nodes.set(startKey, { x: start.x, y: start.y, g: 0, f: h(start.x, start.y), parent: -1 });

  // Open set — small enough for 40x40 that a sorted-insert array is fine.
  const open: number[] = [startKey];
  const closed = new Set<number>();

  const neighbors = [
    [0, -1], [1, 0], [0, 1], [-1, 0],
  ];

  let expanded = 0;
  while (open.length > 0) {
    if (expanded++ > maxNodes) return null;

    // Pop lowest-f node.
    let bestIdx = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i++) {
      const n = nodes.get(open[i])!;
      if (n.f < bestF) { bestF = n.f; bestIdx = i; }
    }
    const currentKey = open.splice(bestIdx, 1)[0];
    const current = nodes.get(currentKey)!;

    if (current.x === goal.x && current.y === goal.y) {
      // Reconstruct path (exclude the start).
      const out: Position[] = [];
      let nk = currentKey;
      while (nk !== startKey) {
        const n = nodes.get(nk)!;
        out.push({ x: n.x, y: n.y });
        nk = n.parent;
      }
      out.reverse();
      return out;
    }

    closed.add(currentKey);

    for (const [dx, dy] of neighbors) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      // The goal itself is always considered walkable (already validated above).
      if (!(nx === goal.x && ny === goal.y) && blocked(nx, ny)) continue;

      const tentativeG = current.g + 1;
      const existing = nodes.get(nk);
      if (existing && tentativeG >= existing.g) continue;

      nodes.set(nk, {
        x: nx, y: ny,
        g: tentativeG,
        f: tentativeG + h(nx, ny),
        parent: currentKey,
      });
      if (!existing) open.push(nk);
    }
  }

  return null;
}
