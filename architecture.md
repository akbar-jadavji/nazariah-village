# Generative Village — Architecture

## Chunk 1: Project Scaffolding & Canvas World

### Stack
- Next.js 16 (App Router, TypeScript, Tailwind CSS)
- HTML5 Canvas for rendering
- Deploys to Vercel

### File Structure

```
generative-village/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Root page — renders GameCanvas
│   │   ├── layout.tsx            # App layout with metadata
│   │   └── globals.css           # Tailwind base styles
│   ├── components/
│   │   └── Canvas/
│   │       └── GameCanvas.tsx    # Main game loop: input, rendering, animation
│   ├── engine/
│   │   ├── sprites.ts            # All draw functions: tiles, objects, buildings, characters
│   │   └── world.ts              # Collision checks, tile/building lookups
│   ├── lib/
│   │   └── types.ts              # Constants (tile IDs, map size) and TypeScript types
│   └── data/
│       └── tilemap.ts            # Procedural 40×40 map generator
├── public/assets/                # Sprite sheets, tiles (placeholder for now)
├── prd.md                        # Product requirements document
├── architecture.md               # This file
└── start-dev.sh                  # Dev server launcher script
```

### Map (40×40 tiles, 32px each)

**Ground layer** — 5 tile types: grass, dark grass, dirt path, water, stone.
Main dirt crossroads at row 19–20 (east-west) and col 19–20 (north-south) with connecting paths to all buildings.

**Buildings** (from PRD section 3.3):
| ID | Name | Position | Size | Entry |
|----|------|----------|------|-------|
| 1 | The Enchanted Hearth (Inn) | (2,14) | 3×3 | (3,17) |
| 2 | Moonpetal Apothecary | (12,14) | 3×3 | (13,17) |
| 3 | The Gilded Quill (Library) | (8,2) | 3×3 | (9,5) |
| 4 | Starfall Plaza | (17,17) | 6×6 | (20,20) |
| 5 | Eldergrove Park | (27,2) | 5×5 | (29,7) |
| 6 | Hearthstone Bakery | (2,7) | 3×3 | (3,10) |
| 7 | The Wanderer's Workshop | (12,7) | 3×3 | (13,10) |
| 8–12 | Duskhollow Cottages (×5) | bottom-right | 2×2 each | south face |

Plaza and Park are open areas (walkable). All other buildings have collision on their footprint with a walkable entry tile.

**Objects** — trees (edges + scattered), fences, benches, flowers, lampposts, fountain. Trees, fences, lampposts, and fountain block movement. Flowers are walkable.

**Collision** — map edges, water, building footprints (except plaza/park), trees, lampposts, fences, fountain.

### Rendering Pipeline

1. **Ground cache**: Pre-rendered once to an offscreen canvas (static layer).
2. **Y-sorted drawables**: Objects, buildings, and player collected into an array, sorted by Y coordinate, then drawn in order for correct depth.
3. **Labels**: Plaza and Park names rendered as floating text labels.
4. **60fps render loop** via `requestAnimationFrame`.

### Player

- Starts at tile (20, 20) — center of Starfall Plaza.
- WASD / Arrow keys move one tile per press; holding repeats at ~150ms intervals.
- Smooth interpolation between tiles at 6 tiles/sec.
- Direction-dependent sprite: eyes face movement direction, back-of-head when facing up.
- Walk animation: 4-frame cycle at 8fps with leg movement and body bounce.

### Sprite System

All sprites are drawn procedurally (no image assets yet) using colored rectangles in a Stardew Valley-inspired palette. Each building has a unique color scheme (wall, roof, accent). Characters have skin, hair, shirt, and pants layers.

### Responsive Scaling

Canvas scales down to fit viewport while maintaining pixel-perfect rendering (`image-rendering: pixelated`).
