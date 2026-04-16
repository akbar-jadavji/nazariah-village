




Product Requirements Document
Generative Agents: Fantasy Village Simulation
A whimsical pixel-art world where AI agents live autonomous lives

Version 1.0  |  April 2026

1. Project Overview
This project is a browser-based simulation inspired by the Generative Agents paper (Park et al., 2023). It creates a pixelated fantasy village where 10–15 AI-powered agents live autonomous lives — forming relationships, pursuing self-directed goals, and reflecting on their experiences. The player inhabits the world as a character, able to freely converse with agents and observe emergent social dynamics.

The core purpose is experimentation with AI and emergent behavior. Agents have no predefined jobs or scripted routines. They receive only a backstory and must figure out what to do with their lives, how to relate to others, and what matters to them — all driven by GPT-4-turbo.

1.1 Design Principles
Emergence over scripting: No hardcoded behaviors. All agent decisions flow from their cognitive architecture and LLM reasoning.
Simplicity in infrastructure: Single codebase, single deployment target (Vercel). Minimal external dependencies.
Observability: Every agent’s inner life — memories, reflections, goals, relationships — should be inspectable in real time.
Whimsy: The world should feel charming and alive. Fantasy village aesthetic with AI-generated pixel art.

1.2 Key Metrics for Success
Agents form and maintain distinct relationships with different characters over multiple simulation days.
Agents set goals autonomously and take observable actions toward achieving them.
Conversations between agents (and with the player) reference past interactions and shared history.
The player can have meaningful, contextual conversations with any agent.

2. Technology Stack

Layer
Technology
Notes
Frontend Framework
Next.js 14+ (App Router)
React-based, deploys natively to Vercel
Rendering Engine
HTML5 Canvas + React
Custom canvas component for pixel world rendering. No game engine dependency.
Language
TypeScript
Full type safety across the codebase
LLM (Primary)
GPT-4-turbo (via OpenAI API)
High-stakes cognition: action decisions, conversations, reflections, goal formation
LLM (Secondary)
GPT-4o-mini (via OpenAI API)
Low-stakes tasks: importance scoring, observation summarization, batch operations. ~65x cheaper than GPT-4-turbo.
Embeddings
text-embedding-3-small (OpenAI)
For memory retrieval similarity scoring
Database
Supabase (PostgreSQL + pgvector)
Agent state, memory streams, relationships, world state. pgvector for embedding similarity search.
Pathfinding
A* algorithm
Grid-based pathfinding with obstacle avoidance
Deployment
Vercel
Serverless functions for sim ticks, static assets for frontend
Asset Pipeline
AI-generated pixel art
Consistent style prompts for sprites, tiles, and buildings

3. World Design
3.1 Map Structure
The world is a single continuous tile map, approximately 40×40 tiles. Each tile is 32×32 pixels. The entire map fits on screen without scrolling at standard resolutions (1280×1280 pixel canvas area). The map is defined as a JSON tilemap with layers for ground, objects, and collision.

3.2 Tile Layers
Ground layer: Grass, dirt paths, water, stone flooring. Purely visual.
Object layer: Trees, fences, furniture, decorative items. Some are impassable (collision).
Building layer: Named structures with defined entry tiles. Agents can enter and exit buildings.
Collision layer: Binary map of passable/impassable tiles for pathfinding.

3.3 Buildings (Social Anchors)
Buildings are named locations with descriptions and contextual flavor. They do not have ownership or economy. They exist to create social context — agents who spend time at the same building naturally form connections.

Building
Description
Behavioral Context
The Enchanted Hearth (Inn)
A warm tavern with a crackling fireplace and mismatched chairs
Social gathering, storytelling, relaxation. Agents come here to unwind and socialize.
Moonpetal Apothecary
Shelves lined with glowing bottles and dried herbs hanging from the ceiling
Curiosity, healing, quiet contemplation. Agents interested in nature or helping others gravitate here.
The Gilded Quill (Library)
Towering bookshelves with ladders and a reading nook by a stained-glass window
Learning, solitude, intellectual conversation. Agents seeking knowledge come here.
Starfall Plaza (Town Square)
An open cobblestone area with a fountain shaped like a crescent moon
Public gathering, chance encounters, announcements. The social hub of the village.
Eldergrove Park
A quiet grove of ancient trees with stone benches and a small pond
Reflection, nature, peace. Agents come here to think or enjoy solitude.
Hearthstone Bakery
A cozy shop with flour-dusted counters and the smell of fresh bread
Warmth, comfort, morning routines. A natural place for casual daily encounters.
The Wanderer’s Workshop
A cluttered workspace with tools, half-finished projects, and strange contraptions
Creativity, tinkering, purpose-seeking. Agents looking for something to do gravitate here.
Duskhollow Cottage Row (Homes)
A row of small, distinct cottages where agents sleep and spend private time
Rest, privacy, personal reflection. Each agent has an assigned home cottage.

3.4 Day/Night Cycle
The simulation runs on a day/night cycle. Each simulation day consists of approximately 96 ticks (each tick represents 15 minutes of in-world time). Visual changes include a darkening canvas overlay at night, warm lighting from building windows, and a subtle color shift.

Time Range
Period
Agent Behavior
6:00 AM – 8:00 AM
Morning
Agents wake up, leave homes, may visit the bakery or plaza
8:00 AM – 12:00 PM
Midday
Active exploration, socializing, pursuing goals
12:00 PM – 6:00 PM
Afternoon
Continued activity, conversations, visiting buildings
6:00 PM – 10:00 PM
Evening
Wind-down, inn visits, reflective conversations
10:00 PM – 6:00 AM
Night
Agents return home and sleep. Reflection/planning happens during sleep.

4. Agent Cognitive Architecture
Each agent is a fully autonomous entity powered by GPT-4-turbo. The cognitive architecture follows the Generative Agents paper with a hybrid reactive + goal-driven planning layer. Every agent has: a backstory, a memory stream, a reflection system, a goal tracker, a relationship model, and a planning/action system.

4.1 Agent Identity
Each agent is initialized with a seed of 3–5 personality traits and a brief backstory premise. GPT-4-turbo generates a full backstory from these seeds. The backstory includes: name, age, personality traits, a brief life history, core values, and an initial emotional state.

Example seed: Name: Elara Thornwood. Traits: curious, shy, loves stargazing. Premise: Arrived in the village recently after leaving her home in the mountains. Searching for something she can’t name.

GPT-4-turbo expands this into a 200–300 word backstory that becomes the agent’s foundational identity, included in every prompt as system context.

4.2 Memory Stream
The memory stream is the agent’s complete record of experience. Every observation, conversation, and internal thought is stored as a memory entry in Supabase.

4.2.1 Memory Entry Schema
Field
Type
Description
id
UUID
Unique identifier
agent_id
UUID
Which agent this memory belongs to
created_at
Timestamp
Real-world time of creation
sim_time
Integer
Simulation tick when this memory was created
type
Enum
observation, conversation, reflection, internal_thought
content
Text
Natural language description of the memory
embedding
Vector(1536)
text-embedding-3-small embedding of the content
importance
Float (0–1)
GPT-4-turbo rated importance score
last_accessed
Timestamp
When this memory was last retrieved
access_count
Integer
How many times this memory has been retrieved

4.2.2 Memory Retrieval
When an agent needs to recall memories (for planning, conversation, or reflection), the system retrieves the most relevant memories using a weighted score combining three factors:

Recency (weight: 1.0): Exponential decay based on simulation ticks since the memory was created. Recent memories score higher. Decay rate: 0.995 per tick.
Relevance (weight: 1.0): Cosine similarity between the query embedding and the memory embedding. Computed via pgvector.
Importance (weight: 1.0): The pre-computed importance score assigned when the memory was created.

Final score = recency_score + relevance_score + importance_score. The top 10–15 memories are retrieved and included in the agent’s prompt context.

4.2.3 Importance Scoring
When a new memory is created, GPT-4-turbo assigns an importance score from 0 to 1. The prompt provides examples: mundane observations (seeing a tree) score 0.1–0.3, social interactions score 0.4–0.6, emotionally significant events (a meaningful conversation, achieving a goal) score 0.7–0.9, and life-changing moments score 0.9–1.0.

4.3 Reflection System
Reflections are higher-order thoughts that synthesize patterns across memories. They are the mechanism by which agents develop self-awareness, form opinions, and evolve their understanding of the world and other agents.

4.3.1 Reflection Triggers
A reflection is triggered when the sum of importance scores of memories created since the last reflection exceeds a threshold (default: 2.5). This means reflections happen after several significant events, not on every tick.

4.3.2 Reflection Process
Retrieve the 20 most recent memories.
Ask GPT-4-turbo: Given these memories, what are 3 high-level observations or insights this agent might have?
For each insight, ask GPT-4-turbo to elaborate it into a full reflection (1–2 sentences).
Store each reflection as a new memory entry with type=reflection and its own importance score.
Reflections are themselves retrievable memories, so they compound over time.

4.4 Goal System
Agents maintain a list of active goals. Goals emerge from reflections and experiences — they are never assigned. Each goal has a description, a priority (0–1), a status (active, completed, abandoned), and a list of sub-steps the agent believes will help achieve it.

4.4.1 Goal Formation
During reflection, GPT-4-turbo may identify desires, aspirations, or problems the agent wants to address. These become goals. For example, after several lonely evenings, an agent might form the goal: “Get to know someone at the inn.” After discovering the workshop, an agent might set a goal: “Figure out what I want to build.”

4.4.2 Goal Schema
Field
Type
Description
id
UUID
Unique identifier
agent_id
UUID
Which agent owns this goal
description
Text
Natural language description of the goal
priority
Float (0–1)
How important this goal is to the agent
status
Enum
active, completed, abandoned
steps
JSON Array
List of sub-steps the agent plans to take
created_at_tick
Integer
When the goal was formed
completed_at_tick
Integer (nullable)
When the goal was completed or abandoned

4.5 Planning & Action Loop
Each simulation tick, every agent goes through a decision cycle. This is the hybrid reactive + goal-driven system.

4.5.1 Tick Processing (Per Agent)
Perceive: The agent observes its surroundings — nearby agents, current location, time of day, any ongoing events. These observations become new memory entries.
Retrieve: Relevant memories are retrieved based on the current situation (surroundings + active goals).
Decide: GPT-4-turbo receives the agent’s backstory, retrieved memories, active goals, current surroundings, and relationship summaries. It outputs a structured action decision.
Act: The chosen action is executed (move, start conversation, enter building, idle/think, work on goal).
Record: The action and its outcome are stored as new memories.

4.5.2 Available Actions
Action
Description
Details
move_to
Walk toward a destination
Target: a building, a specific tile, or another agent. Uses A* pathfinding.
talk_to
Initiate conversation with a nearby agent
Triggers the conversation system (see section 4.6). Both agents must be within 3 tiles.
enter_building
Enter a building the agent is standing at
Agent’s location updates to the building interior. Building context is added to future prompts.
leave_building
Exit the current building
Agent appears at the building entrance tile.
idle
Do nothing / think / rest
Agent stays in place. May trigger an internal thought memory.
go_home
Return to assigned cottage
Primarily used at night or when the agent wants solitude.

4.6 Conversation System
When two agents decide to talk (or the player initiates a conversation), a multi-turn dialogue sequence begins.

4.6.1 Agent-to-Agent Conversations
The initiating agent’s prompt includes: their backstory, relevant memories about the other agent, their relationship history, current goals, current location context, and a prompt to generate an opening line.
The responding agent receives the same context plus the opening line, and generates a response.
This continues for 2–4 turns (GPT-4-turbo decides when to end the conversation naturally).
The full conversation is stored in both agents’ memory streams as a single memory entry per agent, summarizing what was said and what the agent thought/felt about it.

4.6.2 Player-to-Agent Conversations
The player can walk up to any agent and press a key to initiate conversation. A text input appears at the bottom of the screen. The player types freely, and the agent responds via GPT-4-turbo using their full cognitive context. The conversation continues until the player closes the dialogue or walks away. Player conversations are stored in the agent’s memory stream with high importance.

4.7 Relationship Model
Each agent maintains a relationship record for every other agent (and the player) they have interacted with.

Field
Type
Description
agent_id
UUID
The agent who holds this relationship
target_id
UUID
The other agent (or player)
familiarity
Float (0–1)
How well the agent knows the target. Increases with interactions.
sentiment
Float (-1 to 1)
How the agent feels about the target. Positive = warmth, negative = dislike.
summary
Text
GPT-4-turbo generated summary of the relationship (updated periodically)
last_interaction_tick
Integer
When they last interacted
interaction_count
Integer
Total number of interactions

After each interaction, the relationship record is updated. Every 5 interactions, GPT-4-turbo regenerates the relationship summary based on recent memories involving that agent.

5. Player System
The player exists as a character in the world alongside the AI agents. They can move around, enter buildings, and converse with agents. The player does not have an AI-driven cognitive architecture — they make their own decisions.

5.1 Player Controls
Movement: Arrow keys or WASD to move one tile at a time. The player sprite animates between tiles.
Interact: Press E or Enter when adjacent to an agent to open the conversation panel.
Conversation: Free text input. Type a message and press Enter to send. The agent responds in real-time (streamed).
Close conversation: Press Escape or walk away to end the dialogue.
Simulation controls: Play/pause button, speed slider (1x, 2x, 5x, 10x tick speed).

5.2 Player Identity
On first load, the player chooses a name and a sprite. The player has no backstory visible to agents — agents perceive the player as a newcomer to the village. This is intentional: it lets the player’s identity emerge through interactions, mirroring the agents’ own experience.

6. Frontend Architecture
6.1 Canvas Rendering System
The world is rendered on an HTML5 Canvas element managed by a React component. The rendering loop runs at 60fps for smooth sprite animation, independent of the simulation tick rate.

6.1.1 Rendering Layers (draw order)
Ground tiles (grass, paths, water)
Building bases and shadows
Objects (trees, fences, furniture)
Agent sprites (sorted by Y position for depth)
Player sprite
Building rooftops (drawn above agents when agents are not inside)
Day/night overlay (semi-transparent color filter)
UI overlays (agent names, thought bubbles)

6.1.2 Sprite Animation
Each character sprite has a spritesheet with frames for: idle (4 directions), walking (4 directions, 4 frames each), and talking (2 frames). Sprites are 32x32 pixels. Animation runs at 8fps (every 8 render frames at 60fps).

6.2 UI Layout
The screen is divided into two areas: the main canvas (left, ~70% width) and the inspector panel (right, ~30% width). The inspector panel slides in when an agent is selected and can be dismissed.

6.2.1 Inspector Panel Contents
Agent portrait: Enlarged sprite or generated portrait image.
Name and traits: Agent’s name and personality summary.
Current status: What the agent is currently doing and where they are.
Current thoughts: The agent’s most recent internal thought or plan.
Active goals: List of the agent’s current goals with status indicators.
Recent memories: The last 5–10 memories, with type icons (observation, conversation, reflection).
Relationship mini-graph: A small force-directed graph showing the selected agent at the center with lines to known agents. Line thickness = familiarity, color = sentiment (green positive, red negative). Clickable nodes to jump to that agent’s inspector.

6.3 Simulation Controls Bar
A control bar at the top or bottom of the screen provides: play/pause toggle, speed control (1x/2x/5x/10x), current simulation time and day number, save/load buttons, and a count of active agents.

7. Backend Architecture
7.1 API Routes
The simulation engine runs as Next.js API routes. Each tick is processed by a single API call that can be triggered by the frontend polling or a Vercel cron job.

Route
Method
Description
/api/simulation/tick
POST
Advance the simulation by one tick. Processes all agents sequentially. Returns updated world state.
/api/simulation/state
GET
Fetch current world state (agent positions, time, buildings).
/api/simulation/save
POST
Serialize and save current simulation state to Supabase.
/api/simulation/load
POST
Load a saved simulation state from Supabase.
/api/agent/[id]/memories
GET
Fetch an agent’s recent memories for the inspector panel.
/api/agent/[id]/goals
GET
Fetch an agent’s current goals.
/api/agent/[id]/relationships
GET
Fetch an agent’s relationship records.
/api/agent/[id]/chat
POST
Send a player message to an agent and get a streamed response.
/api/world/init
POST
Initialize a new simulation: generate agent backstories, set up world state.

7.2 Tick Processing Pipeline
A single tick processes all agents. To stay within Vercel’s serverless function timeout (default 10s on Hobby, 60s on Pro), agent processing should be parallelized where possible. The recommended approach:

Fetch current world state from Supabase (all agent positions, time, etc.).
For each agent in parallel: generate observations, retrieve memories, call GPT-4-turbo for action decision.
Resolve conflicts (two agents trying to occupy the same tile, mutual conversation initiation).
Execute actions: update positions, trigger conversations, store new memories.
Process any triggered reflections.
Update world state in Supabase.
Return updated state to frontend.

Important: For 10–15 agents, expect each tick to take 5–15 seconds depending on how many agents need LLM calls. Conversations (which require multiple LLM round-trips) should be resolved within the same tick but may extend processing time. Consider a Vercel Pro plan for the 60-second timeout, or process conversations asynchronously across ticks.

7.3 LLM Prompt Strategy
All LLM calls use structured JSON output (response_format: json_object) to ensure parseable responses. Calls are split across two models to stay within the $50/hour budget:

GPT-4-turbo (high-stakes calls):
Action Decision Prompt: System: agent backstory + personality. User: current location, nearby agents, time of day, active goals, 8–10 retrieved memories, relationship summaries for nearby agents. Expected output: JSON with chosen_action, target, reasoning.
Conversation Prompt: System: agent backstory + personality + relationship with conversation partner. User: conversation context, recent memories about this person, current goals. Expected output: JSON with dialogue_line, internal_thought, end_conversation (boolean).
Reflection Prompt: System: agent backstory. User: 20 most recent memories. Expected output: JSON array of 3 reflection strings.
Goal Formation Prompt: System: agent backstory + personality. User: recent reflections + current goals. Expected output: JSON with new_goals array (may be empty) and updated_goals array.

GPT-4o-mini (low-stakes calls):
Importance Scoring Prompt (batched): Score all new memories from a tick in a single call. System: scoring rubric with examples. User: array of memory contents. Expected output: JSON array of scores (float 0–1). Batching 10–20 memories into one call dramatically reduces overhead.
Observation Summarization: Condense raw perception data into concise memory entries. This is mechanical text processing that does not require GPT-4-turbo quality.

8. Database Schema (Supabase)

8.1 Tables

agents
Column
Type
Description
id
UUID (PK)
Agent identifier
name
Text
Agent display name
backstory
Text
Full generated backstory
traits
Text[]
Array of personality traits
sprite_key
Text
Reference to sprite asset
home_building_id
Text
Assigned home cottage
current_x
Integer
Current tile X position
current_y
Integer
Current tile Y position
current_building
Text (nullable)
Building the agent is inside, if any
status
Text
Current activity description
is_sleeping
Boolean
Whether the agent is asleep

memories
Column
Type
Description
id
UUID (PK)
Memory identifier
agent_id
UUID (FK → agents)
Owning agent
sim_tick
Integer
Simulation tick created
type
Enum
observation, conversation, reflection, internal_thought
content
Text
Memory content
embedding
Vector(1536)
Embedding for similarity search
importance
Float
Importance score (0–1)
last_accessed
Timestamp
Last retrieval time
access_count
Integer
Retrieval count

goals
Column
Type
Description
id
UUID (PK)
Goal identifier
agent_id
UUID (FK → agents)
Owning agent
description
Text
Goal description
priority
Float
Priority (0–1)
status
Enum
active, completed, abandoned
steps
JSONB
Planned sub-steps
created_at_tick
Integer
Tick when formed
completed_at_tick
Integer (nullable)
Tick when resolved

relationships
Column
Type
Description
agent_id
UUID (FK → agents)
Agent holding this record
target_id
UUID
The other agent or player
familiarity
Float
How well they know the target (0–1)
sentiment
Float
Positive/negative feeling (-1 to 1)
summary
Text
LLM-generated relationship summary
last_interaction_tick
Integer
Last interaction tick
interaction_count
Integer
Total interactions

simulation_state
Column
Type
Description
id
UUID (PK)
State identifier
current_tick
Integer
Current simulation tick
current_day
Integer
Current day number
time_of_day
Text
morning, midday, afternoon, evening, night
is_paused
Boolean
Whether the sim is paused
created_at
Timestamp
When this sim was created

saved_states
Column
Type
Description
id
UUID (PK)
Save identifier
name
Text
User-given save name
snapshot
JSONB
Full serialized simulation state
created_at
Timestamp
When saved

8.2 Indexes
memories: agent_id + sim_tick (for recency queries)
memories: embedding using ivfflat or hnsw (for pgvector similarity search)
goals: agent_id + status (for active goal lookups)
relationships: agent_id + target_id (unique composite key)

9. Asset Pipeline
All visual assets are AI-generated pixel art. To maintain visual consistency, all generation should use the same style prompt prefix and target the same resolution.

9.1 Style Guidelines
Resolution: 32×32 pixels per tile/sprite. Upscale to 64×64 or 128×128 for generation, then downscale.
Palette: Limited color palette (16–32 colors) inspired by Stardew Valley. Warm greens, earthy browns, soft blues, magical purples.
Style prompt prefix: "16-bit pixel art, top-down RPG style, Stardew Valley aesthetic, fantasy village, warm colors, clean pixel edges, no anti-aliasing"
Character sprites: Need idle, walk (4 directions × 4 frames), and talk animations. Generate as spritesheets.
Building sprites: 2–4 tile footprints with distinct silhouettes. Should be readable at 32px per tile.

9.2 Required Assets
Category
Count
Details
Character spritesheets
10–15
One per agent + one for the player. Each with idle/walk/talk frames.
Building exterior sprites
8
One per building listed in section 3.3
Ground tiles
~10
Grass, dirt, stone, water, path variations
Object sprites
~15–20
Trees, fences, benches, flowers, lampposts, fountain
UI elements
~5–10
Dialogue box, inspector panel background, buttons, icons

10. Implementation Chunks
The project is divided into 8 sequential chunks. Each chunk is independently testable and produces a working increment. Do not proceed to the next chunk until the current one is complete and verified.

IMPORTANT FOR CURSOR: Complete each chunk fully before moving to the next. Each chunk includes specific acceptance criteria that must pass before proceeding.

Chunk 1: Project Scaffolding & Canvas World
Goal: Get a visible, navigable pixel world on screen with a player character that can walk around.

Deliverables
Next.js 14 project initialized with TypeScript, Tailwind CSS, and App Router.
HTML5 Canvas component that renders a 40×40 tile map from a JSON tilemap definition.
Ground layer rendering with at least 3 tile types (grass, dirt path, water).
Collision layer that prevents movement through walls/water.
Static building sprites placed on the map (exterior only, no entry yet).
Static object sprites (trees, fences) placed on the map.
Player sprite that moves with WASD/arrow keys, one tile per keypress, with walk animation.
Camera centered on the player (or full map visible if it fits the viewport).
Basic sprite animation system (spritesheet frame cycling at 8fps).

Acceptance Criteria
The map renders correctly with visible ground, buildings, and objects.
The player can move in all 4 directions and is blocked by collision tiles.
Walk animation plays correctly in all 4 directions.
The app deploys to Vercel without errors.

Chunk 2: Supabase Integration & Agent Spawning
Goal: Connect to Supabase, create the database schema, generate agent backstories, and display agents on the map.

Deliverables
Supabase project created and connected via environment variables.
All database tables created (agents, memories, goals, relationships, simulation_state, saved_states) with proper types and indexes.
pgvector extension enabled and vector column configured on memories table.
/api/world/init endpoint that generates 10–15 agents: takes seed traits, calls GPT-4-turbo to generate backstories, inserts into agents table.
Agent sprites rendered on the canvas at their initial positions.
Agents assigned to home cottages.
Basic agent name labels rendered above sprites.
Environment variable setup for OpenAI API key.

Acceptance Criteria
Running /api/world/init populates the database with 10–15 agents, each with a unique backstory.
Agents appear on the canvas at their starting positions.
The Supabase dashboard shows properly structured data in all tables.
pgvector similarity search works (test with a manual query).


Chunk 3: Agent Movement & Pathfinding
Goal: Agents can move around the map autonomously using A* pathfinding. No AI decisions yet — agents move to random destinations.

Deliverables
A* pathfinding algorithm implemented on the tile grid, respecting the collision layer.
Agents select random walkable destinations and path to them.
Agents animate smoothly between tiles (interpolated movement, not teleporting).
Agents avoid walking through each other (basic collision avoidance or queuing).
Building entry/exit: agents can walk to a building entrance tile and enter (sprite disappears), then exit later (sprite reappears).
Y-sorting: agents and objects render in correct depth order (lower Y = behind).
Simulation tick system: a /api/simulation/tick endpoint that advances all agents one step along their paths.
Frontend polls /api/simulation/tick and updates canvas.

Acceptance Criteria
Agents visibly walk around the map on varied paths without getting stuck.
Agents enter and exit buildings.
No agents overlap or pass through walls.
The tick system works: pressing play advances the simulation, pause stops it.

Chunk 4: Memory System & Basic AI Decision-Making
Goal: Agents make LLM-driven decisions about where to go and what to do. Memory stream is functional.

Deliverables
Observation system: each tick, agents generate observation memories based on what they see (nearby agents, current location, time of day).
Memory storage: observations are stored in Supabase with embeddings (via text-embedding-3-small) and importance scores (via GPT-4-turbo).
Memory retrieval: given a query, retrieve top memories using recency + relevance + importance weighted scoring via pgvector.
Action decision prompt: each tick, GPT-4-turbo decides the agent’s next action based on backstory + memories + surroundings.
Agents now move with purpose (choosing buildings or areas based on their personality and memories) instead of randomly.
Day/night cycle: visual overlay changes, agents go home at night.
Internal thoughts: agents occasionally generate internal thought memories (“I wonder what that building is”).

Acceptance Criteria
Agent memories accumulate in Supabase and are visible via direct DB query.
Memory retrieval returns contextually relevant results (test with specific scenarios).
Agents make visibly different choices based on their personalities (e.g., a curious agent explores, a shy agent stays home more).
Day/night cycle visually works and agents go home at night.

Chunk 5: Conversations & Relationships
Goal: Agents talk to each other with context-aware dialogue. Relationships form and evolve.

Deliverables
Conversation initiation: when two agents are near each other, they may decide to talk (based on their action decision).
Turn-based dialogue: 2–4 turns of GPT-4-turbo generated dialogue between agents, each informed by personality, memories, and relationship history.
Conversation visualization: speech bubbles appear above agents during conversations. The most recent line of dialogue is shown.
Conversation memory storage: each agent stores a summary of the conversation in their memory stream.
Relationship creation and updates: after each conversation, familiarity and sentiment scores are updated. Every 5 interactions, the relationship summary is regenerated.
Conversation log: all conversations are logged and viewable in a debug/admin panel.

Acceptance Criteria
Agents have visible conversations with contextually appropriate dialogue.
Conversation content references the agents’ personalities and any shared history.
Relationship records appear in Supabase and evolve over multiple interactions.
An agent who has talked to another agent multiple times shows increased familiarity.

Chunk 6: Reflections, Goals & Emergent Behavior
Goal: The full cognitive architecture is operational. Agents reflect, form goals, and pursue them.

Deliverables
Reflection trigger system: track importance score accumulation since last reflection. Trigger at threshold (2.5).
Reflection generation: GPT-4-turbo synthesizes high-level insights from recent memories. Stored as reflection-type memories.
Goal formation: during reflections, agents may identify new goals. Stored in the goals table.
Goal-driven planning: agents consider their active goals when making action decisions. They take steps toward their goals.
Goal completion/abandonment: GPT-4-turbo can mark goals as completed or abandoned based on outcomes.
Inspector panel: full agent inspector showing current thoughts, goals, memories, and relationship mini-graph.
Relationship mini-graph: force-directed graph visualization using Canvas or a lightweight library.

Acceptance Criteria
Agents generate reflections that synthesize patterns from their experiences.
Agents form goals organically (visible in the inspector and database).
Agents take observable actions toward their goals (e.g., an agent with a goal to make friends visits social locations more).
The inspector panel shows a complete view of an agent’s inner life.
The relationship graph correctly displays connections between agents.

Chunk 7: Player Integration
Goal: The player exists as a character in the world and can converse with agents.

Deliverables
Player character setup: name entry and sprite selection on first load.
Player movement is integrated with the simulation (player moves freely, sim ticks continue around them).
Conversation initiation: press E/Enter near an agent to open the dialogue panel.
Free text input: player types messages, agent responds via GPT-4-turbo streaming.
/api/agent/[id]/chat endpoint with streaming support (server-sent events or similar).
Player conversations stored in agent memory streams with appropriate importance.
Agents acknowledge and remember the player in future interactions.
Agents can initiate conversation with the player (a thought bubble appears, player can accept or ignore).

Acceptance Criteria
The player can walk up to any agent and have a free-form conversation.
Agent responses are contextual, referencing their personality, current situation, and any prior interactions with the player.
After talking to an agent, that agent remembers the conversation in future interactions.
Agents form relationship records with the player that evolve over time.

Chunk 8: Save/Load, Polish & Deployment
Goal: The simulation is complete, persistent, and deployable.

Deliverables
Save system: serialize the full simulation state (agents, memories, goals, relationships, world state) to a JSONB snapshot in Supabase.
Load system: restore a saved state, reinitializing all agents from the snapshot.
Save/load UI: buttons in the control bar, with save name input and a list of saved states to choose from.
Performance optimization: batch database operations, minimize LLM calls where possible (cache embeddings, debounce non-critical operations).
Error handling: graceful handling of LLM API failures, database timeouts, and edge cases.
Loading states: show progress indicators during tick processing and conversation generation.
Mobile-responsive layout (the canvas scales down, inspector becomes a bottom sheet).
Final Vercel deployment with environment variables configured.
README with setup instructions for local development.

Acceptance Criteria
Save and load work correctly — a loaded save resumes the simulation exactly where it left off.
The app is deployed to Vercel and accessible via URL.
The simulation runs for at least 3 in-game days without errors or degradation.
All API error cases are handled gracefully (no unhandled crashes).

11. Recommended File Structure

generative-village/
├── public/assets/ — Sprite sheets, tile images, UI assets
├── src/
│   ├── app/ — Next.js App Router pages and layouts
│   │   ├── page.tsx — Main simulation page
│   │   └── api/ — All API routes (simulation, agent, world)
│   ├── components/ — React components
│   │   ├── Canvas/ — GameCanvas, SpriteRenderer, TileRenderer
│   │   ├── UI/ — InspectorPanel, ControlBar, DialogueBox, RelationshipGraph
│   │   └── Player/ — PlayerController, ConversationInput
│   ├── engine/ — Core simulation logic
│   │   ├── simulation.ts — Tick processing pipeline
│   │   ├── pathfinding.ts — A* implementation
│   │   ├── world.ts — Map, buildings, collision
│   │   └── time.ts — Day/night cycle logic
│   ├── agents/ — Agent cognitive systems
│   │   ├── memory.ts — Memory stream, retrieval, importance scoring
│   │   ├── reflection.ts — Reflection triggers and generation
│   │   ├── goals.ts — Goal formation and tracking
│   │   ├── planning.ts — Action decision loop
│   │   ├── conversation.ts — Agent-to-agent and player dialogue
│   │   └── relationships.ts — Relationship model
│   ├── lib/ — Shared utilities
│   │   ├── supabase.ts — Supabase client setup
│   │   ├── openai.ts — OpenAI client + prompt templates
│   │   └── types.ts — Shared TypeScript types
│   └── data/ — Static data
│       ├── tilemap.json — World map definition
│       ├── buildings.json — Building definitions and descriptions
│       └── agent-seeds.json — Seed traits for agent generation
├── supabase/migrations/ — SQL migration files
├── .env.local — API keys (never commit)
└── next.config.js

12. Cost Management: $50/Hour Budget
Hard constraint: The simulation must cost no more than $50 for one hour of continuous play at normal speed. This section details the tiered LLM strategy and optimizations that make this achievable.

12.1 Model Pricing Reference
Model
Input (per 1M tokens)
Output (per 1M tokens)
Use Case
GPT-4-turbo
$10.00
$30.00
Action decisions, conversations, reflections, goals
GPT-4o-mini
$0.15
$0.60
Importance scoring (batched), observation summaries
text-embedding-3-small
$0.02
—
Memory embeddings for similarity search

GPT-4o-mini is approximately 65x cheaper than GPT-4-turbo for input and 50x cheaper for output. By routing low-stakes calls to this model, we dramatically reduce per-tick costs without sacrificing the quality of agent behavior where it matters.

12.2 Key Optimization: Skip Idle Agents
Not every agent needs a GPT-4-turbo call every tick. An agent who is mid-path (walking from A to B with no new stimuli) does not need to re-decide their action. Only agents whose situation has changed need a full action decision call:

Needs LLM call: Agent arrived at destination, new agent entered perception range, conversation ended, woke up, goal step completed.
Skips LLM call: Agent is mid-walk on a path, agent is sleeping, agent is mid-conversation (handled by conversation system).

In practice, with 12 agents, approximately 4–6 agents need an action decision per tick. The rest are walking, sleeping, or in conversation. This alone cuts the most expensive operation nearly in half.

12.3 Cost Per Tick (Optimized)
Assuming 12 agents, with idle-skipping and tiered models:

Operation
Model
Calls/Tick
Input Tokens
Output Tokens
Cost/Tick
Action decisions
GPT-4-turbo
5 (active agents)
~1,200 each
~200 each
$0.060 + $0.030 = $0.090
Conversations (avg 1/tick)
GPT-4-turbo
3 turns
~1,000 each
~150 each
$0.030 + $0.014 = $0.044
Importance scoring (batched)
GPT-4o-mini
1 (batch of 12–18)
~800 total
~200 total
<$0.001
Reflections (~1 per 10 ticks)
GPT-4-turbo
0.3
~2,000
~300
$0.006 + $0.003 = $0.009
Goal updates (~1 per 15 ticks)
GPT-4-turbo
0.2
~1,500
~250
$0.003 + $0.002 = $0.005
Embeddings
text-embedding-3-small
~15
~100 each
—
<$0.001

Estimated cost per tick: ~$0.15

12.4 Hourly Cost Calculation
The tick rate depends on simulation speed. Each tick takes approximately 3–8 seconds to process (parallelized agent calls). At different speed settings:

Speed
Effective Tick Rate
Ticks per Hour
Est. Hourly Cost
1x (normal)
~1 tick / 10 sec
~360
$54 (at ceiling)
1x (typical)
~1 tick / 12 sec
~300
$45
2x
~1 tick / 6 sec
~600
$90 (over budget)

Budget enforcement strategy: Implement a rolling cost tracker that estimates spend per hour. If the projected hourly rate approaches $50, the system automatically applies additional throttling:

Tier 1 (under $40/hr): Full behavior — all optimizations above, no further throttling.
Tier 2 ($40–$50/hr): Reduce memory retrieval from 10 to 6 per agent. Limit conversations to 2 turns max. Increase idle-skip threshold.
Tier 3 (at $50/hr): Pause automatic ticks. Require manual step-through until the rate drops.

The cost tracker should be visible in the simulation control bar so the player can see their approximate spend rate and remaining budget.

12.5 Additional Cost Optimizations
Prompt compression: Keep backstory summaries under 150 tokens. Use terse system prompts. Trim memory content to essential details.
Embedding cache: Cache embeddings for repeated or near-identical observations (e.g., seeing the same building each morning). Use a hash-based lookup before calling the embedding API.
Conversation cooldown: Agents cannot talk to the same agent for 8 ticks after a conversation. This naturally limits the most expensive operation.
Night optimization: Sleeping agents make zero LLM calls. Night ticks (10 PM–6 AM = 32 ticks) cost near-zero, only processing reflections for agents whose threshold was met. This means roughly 1/3 of all ticks are essentially free.
Speed cap: Disable 5x and 10x speed by default. These speeds would blow through the budget in minutes. Allow them only with an explicit budget override toggle.

13. Risks & Mitigations

Risk
Impact
Mitigation
Vercel serverless timeout
Tick processing exceeds function timeout
Parallelize agent processing. Use Vercel Pro (60s timeout). Split conversations across ticks if needed.
LLM response inconsistency
GPT-4-turbo returns unparseable or nonsensical output
Use JSON mode (response_format). Validate all responses against expected schemas. Retry with exponential backoff.
Memory bloat
Thousands of memories slow down retrieval
Implement memory pruning: archive memories with very low access counts after N ticks. Keep active memory stream under 500 entries per agent.
Agent behavioral convergence
All agents start behaving the same way
Ensure backstories are sufficiently diverse. Include personality traits in every prompt. Monitor for convergence during testing.
Conversation loops
Two agents get stuck in repetitive dialogue
Enforce the 4-turn maximum. Add conversation cooldown (agents can’t talk to the same agent again for 8 ticks).
Asset style inconsistency
AI-generated sprites look mismatched
Use a single, detailed style prompt. Generate all assets in one batch. Manually curate and touch up if needed.
Budget overrun at high speed
2x+ speed exceeds $50/hour
Implement rolling cost tracker with automatic throttling tiers. Cap speed at 1x by default. Display spend rate in the control bar.


— End of Document —