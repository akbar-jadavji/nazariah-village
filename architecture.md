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

---

## Chunk 3: Agent Movement & Pathfinding

### New files

```
src/
├── app/api/simulation/
│   ├── tick/route.ts         # POST — advance all agents one step, returns updated world
│   └── pause/route.ts        # POST — toggle is_paused in simulation_state
├── engine/
│   ├── pathfinding.ts        # A* on 4-connected tile grid (closure-based blocked fn)
│   └── buildings.ts          # Numeric bldg ID ↔ string key mapping, enterable set
supabase/migrations/
└── 002_agent_movement.sql    # Adds path (JSONB), next_decision_tick (INTEGER) to agents
```

### A* pathfinding (`engine/pathfinding.ts`)

`findPath(start, goal, width, height, blocked)` returns the list of tile steps from start (exclusive) to goal (inclusive), or `null` if unreachable.

- 4-connected grid (no diagonal movement)
- `blocked(x, y)` closure lets callers mix static collision with dynamic occupancy
- Max 2000 nodes expanded before giving up (prevents infinite loops on pathological maps)
- Returns `[]` if start === goal

### /api/simulation/tick — tick loop

Chunk 3 is pure movement, no LLM calls.

**Per-tick pipeline (server-side):**

1. Fetch `simulation_state` + all agents from Supabase.
2. If `is_paused`, return current state unchanged.
3. Increment `current_tick`. Advance `time_of_day` / `current_day` (96 ticks/day: morning < 20, midday < 48, afternoon < 64, evening < 80, night ≤ 96).
4. Build occupancy map `"x,y" → agentId` for all visible (non-indoor) agents.
5. For each agent:
   - **Skip** if `current_tick < next_decision_tick` (busy: inside a building, brief idle).
   - **Exit building**: if `current_building != null` and wait is over → clear `current_building`, `next_decision_tick = tick + 1–3`.
   - **Walk**: if `path` has tiles → attempt to advance to `path[0]`. If another agent holds that tile, wait. On arrival at path end, 50% chance to enter an enterable building (set `current_building`, `next_decision_tick = tick + 4–12`).
   - **Plan**: if no path → pick up to 8 random walkable destinations, run A* avoiding static collision + current occupancy. Store path.
6. Batch-update changed agents in parallel (`Promise.all`).
7. Update `simulation_state` tick/day/time. Return fresh agent list.

**Collision avoidance**: occupancy map prevents two agents landing on the same tile in the same tick. First-processed agent wins; others wait.

**Building enter/exit**: entry tiles are walkable in the static grid. When an agent steps onto an entry tile that belongs to an enterable building (not plaza/park), there's a 50% chance they "enter" — sprite disappears, `current_building` is set, `next_decision_tick` holds them for 4–12 ticks. On exit, they reappear at the same entry tile.

### /api/simulation/pause

`POST { paused: boolean }` — toggles `simulation_state.is_paused`. Frontend applies optimistically.

### Canvas updates

- **Play/Pause button** in the header. Paused by default (user must press Play).
- **Speed selector** (1x / 2x / 5x / 10x) → `1000 / 500 / 200 / 100 ms` between ticks.
- **Tick counter + day + time-of-day** shown in header bar.
- **Tick polling**: `setInterval` fires `POST /api/simulation/tick` at the selected speed while unpaused and agents exist. First tick fires immediately on play.
- **Agent interpolation**: each agent has `prevX/prevY` (position when tick arrived) and `current_x/current_y` (new target). Visual position is linearly interpolated over one tick interval: `t = (now - tickArrivedAt) / tickIntervalMs`, clamped to [0, 1]. Movement direction derived from the delta.
- Agents inside a building are hidden (sprite not drawn, name label not drawn).

---

## Chunk 4: Memory System & AI Decision-Making

### New / changed files

```
src/
├── app/api/simulation/tick/route.ts   # Full rewrite — LLM decision pipeline
├── lib/openai.ts                      # ActionDecisionSchema updated, InternalThoughtSchema added
supabase/migrations/
└── 003_memory_retrieval.sql           # match_memories(embedding, agent_id, n) RPC function
```

### Migration 003 — `match_memories` RPC

```sql
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536), p_agent_id UUID, match_count INT)
RETURNS TABLE (id UUID, sim_tick INT, type TEXT, content TEXT, importance REAL, relevance FLOAT)
```

Returns the nearest memories by cosine similarity. Server re-ranks by:
`score = 0.3 × recency(0.995^Δtick) + 0.3 × relevance + 0.4 × importance`

### Tick pipeline (Chunk 4 — AI-driven)

**Per-tick phases (for agents who need a new decision):**

1. **Classify agents**: walking (advance path), exiting building, night-go-home override, or needing a full AI decision cycle.
2. **Build observations** (pure JS): `"[Day N, morning, tick T] I am near The Gilded Quill. Nearby: Seren Vale, Kael Mornshade."`
3. **Embed** all observations in parallel (`text-embedding-3-small`) — `Promise.allSettled`.
4. **Retrieve memories + importance scoring** in parallel:
   - `match_memories` RPC → top 30 by cosine similarity, re-ranked to top 10 by recency+relevance+importance.
   - Batch importance scoring of all new observations: one `gpt-4o-mini` call returns a score per observation.
5. **Action decisions** (`gpt-4-turbo`, parallel, `allSettled`): receives backstory + traits + observation + top-10 memories → returns `{ chosen_action, target_building, reasoning }`.
6. **Internal thoughts** (25% chance when idle): `gpt-4o-mini` generates a first-person thought stored as `internal_thought` memory.
7. **Store memories** (observations + thoughts) with embeddings in Supabase.
8. **Execute actions**: walk agents advance a tile, AI-decided agents get A* paths set, idle agents get `next_decision_tick` deferred.
9. **Update `simulation_state`**.

**Night override**: when `time_of_day === "night"`, agents not at home skip the LLM entirely and get a direct `go_home` A* path computed server-side.

**Graceful degradation**: if any LLM call fails (`allSettled`), that agent falls back to random A* wander. Importance scoring failure defaults all scores to 0.3.

### Day/night visual overlay

In the `requestAnimationFrame` loop, after drawing all sprites, a semi-transparent dark blue rectangle is composited over the canvas:

| Time of day | Alpha |
|-------------|-------|
| morning / midday | 0 |
| afternoon | 0.08 |
| evening | 0.28 |
| night | 0.52 |

At evening/night, warm radial gradients are drawn from each building (window glow effect).

### Setup required (one-time for Chunk 4)

1. Run `supabase/migrations/003_memory_retrieval.sql` in Supabase SQL Editor.
2. Ensure `OPENAI_API_KEY` is in `.env.local`.
3. Without OpenAI configured, agents degrade to Chunk 3 random wander (no crash).
