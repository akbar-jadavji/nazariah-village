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

---

## Chunk 2: Supabase Integration & Agent Spawning

### New files

```
src/
├── app/api/
│   ├── world/init/route.ts       # POST — generate 12 agents via GPT-4-turbo
│   ├── world/reset/route.ts      # POST — dev helper to wipe all data
│   └── simulation/state/route.ts # GET — fetch agents + sim state
├── lib/
│   ├── supabase.ts               # Server client + DB row types
│   └── openai.ts                 # OpenAI client, callJSON helper, Zod schemas, model constants
└── data/
    └── agent-seeds.json          # 12 hand-authored personality seeds

supabase/migrations/
└── 001_initial_schema.sql        # Tables + pgvector + indexes

.env.local.example                # Template for OPENAI_API_KEY and Supabase env vars
```

### Database schema

All tables defined in `supabase/migrations/001_initial_schema.sql`:

- **agents** — identity, traits, position, status (mutable state)
- **memories** — append-only stream with `vector(1536)` embedding column, `ivfflat` index for cosine similarity
- **goals** — JSONB steps, status enum, priority
- **relationships** — composite PK `(agent_id, target_id)`, no FK on target so it can point at the player
- **simulation_state** — singleton row for tick/day/time
- **saved_states** — JSONB snapshots for save/load (Chunk 8)

pgvector extension enabled via `CREATE EXTENSION vector`. No RLS, no Supabase Auth (per PRD).

### LLM layer (`lib/openai.ts`)

Model constants — env-overridable but default to the PRD contract:
- `MODEL_HIGH = "gpt-4-turbo"` (decisions, conversations, reflections, goals, backstories)
- `MODEL_LOW = "gpt-4o-mini"` (importance scoring, summarization)
- `MODEL_EMBED = "text-embedding-3-small"`

`callJSON()` wraps every LLM call with:
- `response_format: { type: "json_object" }`
- Zod schema validation — invalid JSON or schema failure **throws**. Caller handles the failure (skip tick, return error, retry). No auto-repair.

Zod schemas for all four GPT output contracts from the PRD (`ActionDecision`, `ConversationTurn`, `Reflection`, `ImportanceScores`) plus `Backstory` for Chunk 2.

### /api/world/init

1. Guards against overwriting an existing world (returns 409 if agents already exist).
2. Generates all 12 backstories in parallel with `Promise.allSettled`.
3. **Any failure aborts the whole init** — never writes partial world state.
4. Inserts all 12 rows at once, then creates the singleton `simulation_state` row.
5. `maxDuration = 60` — targets Vercel Pro.

### /api/simulation/state

Returns the public-safe subset of agent fields (no backstory) plus current sim state. Polled by the canvas on mount.

### Canvas updates

- Fetches state on mount. If Supabase is unreachable or the schema is missing, surfaces a small non-blocking amber warning ("Supabase not configured") — map still renders, player still moves.
- Agents render as colored character sprites at their DB positions, with name labels (dark pill, white text) above each sprite.
- Agents inside a building (`current_building != null`) are hidden (their sprite will reappear on exit).
- When `agentCount === 0`, an **Initialize World** button appears in the header.

### Setup required (one-time)

1. Create Supabase project → copy URL + anon + service role keys into `.env.local` (use `.env.local.example` as template).
2. Run `supabase/migrations/001_initial_schema.sql` in Supabase SQL Editor.
3. Get an `OPENAI_API_KEY` from platform.openai.com.
4. Reload the app → click **Initialize World**.
