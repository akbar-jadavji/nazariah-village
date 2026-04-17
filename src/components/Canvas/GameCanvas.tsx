"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import {
  TILE_SIZE, MAP_WIDTH, MAP_HEIGHT,
  OBJ_NONE, BLDG_PLAZA, BLDG_PARK,
  Direction, Player, TileMap,
} from "@/lib/types";
import { generateTileMap } from "@/data/tilemap";
import { drawGroundTile, drawObject, drawBuilding, drawCharacter } from "@/engine/sprites";
import { isPassable } from "@/engine/world";

const CANVAS_PIXEL_W = MAP_WIDTH * TILE_SIZE;  // 1280
const CANVAS_PIXEL_H = MAP_HEIGHT * TILE_SIZE; // 1280

// Player movement interpolation speed (tiles per second)
const MOVE_SPEED = 6;

// Animation frame rate (8fps means change frame every 125ms)
const ANIM_FPS = 8;

// Sim speed presets: ms between tick calls.
const SPEED_INTERVALS_MS: Record<number, number> = {
  1: 1000,
  2: 500,
  5: 200,
  10: 100,
};

type SimState = {
  current_tick: number;
  current_day: number;
  time_of_day: string;
  is_paused: boolean;
};

type AgentServer = {
  id: string;
  name: string;
  sprite_key: string;
  current_x: number;
  current_y: number;
  current_building: string | null;
  status?: string;
};

// Client-side rendering state for each agent — includes visual interpolation.
type AgentRender = AgentServer & {
  prevX: number;
  prevY: number;
  tickArrivedAt: number; // performance.now() when last DB position was received
  direction: Direction;
  animFrame: number;
  isMoving: boolean;
};

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tilemapRef = useRef<TileMap | null>(null);
  const playerRef = useRef<Player>({
    position: { x: 20, y: 20 },
    direction: "down",
    isMoving: false,
    visualX: 20,
    visualY: 20,
    animFrame: 0,
  });
  const keysRef = useRef<Set<string>>(new Set());
  const lastMoveTimeRef = useRef(0);
  const animTimerRef = useRef(0);
  const groundCacheRef = useRef<HTMLCanvasElement | null>(null);
  const agentsRef = useRef<AgentRender[]>([]);
  const tickIntervalMsRef = useRef<number>(SPEED_INTERVALS_MS[1]);
  const tickingRef = useRef(false); // prevents overlapping tick requests

  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [initing, setIniting] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const [simState, setSimState] = useState<SimState | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [paused, setPaused] = useState(true); // default paused until user presses play

  // Generate tilemap once
  if (!tilemapRef.current) {
    tilemapRef.current = generateTileMap();
  }

  // Pre-render the ground layer to an offscreen canvas (it never changes)
  const buildGroundCache = useCallback(() => {
    const tilemap = tilemapRef.current;
    if (!tilemap) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_PIXEL_W;
    offscreen.height = CANVAS_PIXEL_H;
    const ctx = offscreen.getContext("2d")!;

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        drawGroundTile(ctx, tilemap.ground[y][x], x, y);
      }
    }
    groundCacheRef.current = offscreen;
  }, []);

  // Merge a server agent list into the client render state, preserving
  // interpolation continuity (prev → target, tickArrivedAt).
  const mergeAgents = useCallback((serverAgents: AgentServer[], receivedAt: number) => {
    const byId = new Map(agentsRef.current.map((a) => [a.id, a]));
    const merged: AgentRender[] = serverAgents.map((sa) => {
      const existing = byId.get(sa.id);
      if (!existing) {
        return {
          ...sa,
          prevX: sa.current_x,
          prevY: sa.current_y,
          tickArrivedAt: receivedAt,
          direction: "down",
          animFrame: 0,
          isMoving: false,
        };
      }
      // Derive movement direction from the delta.
      const dx = sa.current_x - existing.current_x;
      const dy = sa.current_y - existing.current_y;
      let direction = existing.direction;
      if (dx > 0) direction = "right";
      else if (dx < 0) direction = "left";
      else if (dy > 0) direction = "down";
      else if (dy < 0) direction = "up";
      const moved = dx !== 0 || dy !== 0;
      return {
        ...sa,
        prevX: existing.current_x,
        prevY: existing.current_y,
        tickArrivedAt: receivedAt,
        direction,
        animFrame: existing.animFrame,
        isMoving: moved,
      };
    });
    agentsRef.current = merged;
  }, []);

  // Fetch world state (agents + sim state) on mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/simulation/state");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStateError(data.error ?? `HTTP ${res.status}`);
          setAgentCount(0);
          return;
        }
        mergeAgents(data.agents ?? [], performance.now());
        setAgentCount(agentsRef.current.length);
        if (data.state) {
          setSimState(data.state);
          setPaused(!!data.state.is_paused);
        }
      } catch (e) {
        setStateError(String(e).slice(0, 200));
        setAgentCount(0);
      }
    };
    load();
  }, [mergeAgents]);

  const handleInit = useCallback(async () => {
    if (initing) return;
    setIniting(true);
    setInitError(null);
    try {
      const res = await fetch("/api/world/init", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setInitError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const stateRes = await fetch("/api/simulation/state");
      const stateData = await stateRes.json();
      mergeAgents(stateData.agents ?? [], performance.now());
      setAgentCount(agentsRef.current.length);
      if (stateData.state) {
        setSimState(stateData.state);
        setPaused(!!stateData.state.is_paused);
      }
    } catch (e) {
      setInitError(String(e).slice(0, 200));
    } finally {
      setIniting(false);
    }
  }, [initing, mergeAgents]);

  // Sim tick polling — runs when not paused and agents exist.
  useEffect(() => {
    tickIntervalMsRef.current = SPEED_INTERVALS_MS[speed] ?? 500;
  }, [speed]);

  useEffect(() => {
    if (paused) return;
    if ((agentCount ?? 0) === 0) return;

    let stopped = false;
    const runTick = async () => {
      if (stopped || tickingRef.current) return;
      tickingRef.current = true;
      try {
        const res = await fetch("/api/simulation/tick", { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setStateError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        mergeAgents(data.agents ?? [], performance.now());
        if (data.state) setSimState(data.state);
      } catch (e) {
        setStateError(String(e).slice(0, 200));
      } finally {
        tickingRef.current = false;
      }
    };
    const id = setInterval(runTick, tickIntervalMsRef.current);
    // fire one immediately so movement starts without a delay
    runTick();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [paused, speed, agentCount, mergeAgents]);

  const togglePause = useCallback(async () => {
    const nextPaused = !paused;
    setPaused(nextPaused); // optimistic
    try {
      await fetch("/api/simulation/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
    } catch {
      // non-fatal — keep local state
    }
  }, [paused]);

  // Handle keyboard input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        e.preventDefault();
        keysRef.current.add(key);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Process player movement (called each frame)
  const processInput = useCallback((now: number) => {
    const player = playerRef.current;
    const tilemap = tilemapRef.current;
    if (!tilemap) return;

    const dx = player.position.x - player.visualX;
    const dy = player.position.y - player.visualY;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist > 0.01) {
      const step = MOVE_SPEED / 60;
      if (Math.abs(dx) > 0.01) {
        player.visualX += Math.sign(dx) * Math.min(step, Math.abs(dx));
      }
      if (Math.abs(dy) > 0.01) {
        player.visualY += Math.sign(dy) * Math.min(step, Math.abs(dy));
      }
      player.isMoving = true;
      return;
    }

    player.visualX = player.position.x;
    player.visualY = player.position.y;

    const keys = keysRef.current;
    let dir: Direction | null = null;
    let nx = player.position.x;
    let ny = player.position.y;

    if (keys.has("w") || keys.has("arrowup")) { dir = "up"; ny--; }
    else if (keys.has("s") || keys.has("arrowdown")) { dir = "down"; ny++; }
    else if (keys.has("a") || keys.has("arrowleft")) { dir = "left"; nx--; }
    else if (keys.has("d") || keys.has("arrowright")) { dir = "right"; nx++; }

    if (dir) {
      player.direction = dir;
      if (now - lastMoveTimeRef.current > 150) {
        if (isPassable(tilemap, nx, ny)) {
          player.position.x = nx;
          player.position.y = ny;
          lastMoveTimeRef.current = now;
          player.isMoving = true;
        }
      }
    } else {
      player.isMoving = false;
    }
  }, []);

  // Main render loop
  useEffect(() => {
    buildGroundCache();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    let rafId: number;

    const render = (timestamp: number) => {
      const tilemap = tilemapRef.current;
      if (!tilemap) return;

      processInput(timestamp);

      // Update animation frame counter (8fps)
      animTimerRef.current += 1;
      if (animTimerRef.current >= 60 / ANIM_FPS) {
        animTimerRef.current = 0;
        playerRef.current.animFrame = (playerRef.current.animFrame + 1) % 4;
        for (const a of agentsRef.current) {
          a.animFrame = (a.animFrame + 1) % 4;
        }
      }

      // Interpolate each agent's visual position toward its target tile,
      // over the length of one tick interval.
      const tickMs = tickIntervalMsRef.current;
      for (const a of agentsRef.current) {
        const t = Math.min(1, (timestamp - a.tickArrivedAt) / tickMs);
        a.isMoving = t < 1 && (a.prevX !== a.current_x || a.prevY !== a.current_y);
      }

      // Clear and draw ground cache
      ctx.clearRect(0, 0, CANVAS_PIXEL_W, CANVAS_PIXEL_H);
      if (groundCacheRef.current) {
        ctx.drawImage(groundCacheRef.current, 0, 0);
      }

      // Collect all drawable entities for Y-sorting
      const drawables: { y: number; draw: () => void }[] = [];

      // Objects
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const objId = tilemap.objects[y][x];
          if (objId !== OBJ_NONE) {
            const capturedY = y;
            const capturedX = x;
            drawables.push({
              y: capturedY,
              draw: () => drawObject(ctx, objId, capturedX, capturedY),
            });
          }
        }
      }

      // Buildings
      const drawnBuildings = new Set<number>();
      for (const entry of tilemap.buildingEntries) {
        if (drawnBuildings.has(entry.id)) continue;
        if (entry.id === BLDG_PLAZA || entry.id === BLDG_PARK) continue;
        drawnBuildings.add(entry.id);
        drawables.push({
          y: entry.y + entry.height - 1,
          draw: () => drawBuilding(ctx, entry.id, entry.x, entry.y, entry.width, entry.height, entry.entryX, entry.entryY),
        });
      }

      // Agents (hidden when inside a building). Use interpolated visual pos.
      for (const agent of agentsRef.current) {
        if (agent.current_building) continue;
        const color = agent.sprite_key.startsWith("char:")
          ? agent.sprite_key.slice(5)
          : "#8080c0";
        const t = Math.min(1, (timestamp - agent.tickArrivedAt) / tickIntervalMsRef.current);
        const vx = agent.prevX + (agent.current_x - agent.prevX) * t;
        const vy = agent.prevY + (agent.current_y - agent.prevY) * t;
        const dir = agent.direction;
        const frame = agent.animFrame;
        const moving = agent.isMoving;
        drawables.push({
          y: vy,
          draw: () => drawCharacter(ctx, vx, vy, dir, frame, moving, color),
        });
      }

      // Player
      const player = playerRef.current;
      drawables.push({
        y: player.visualY,
        draw: () => drawCharacter(ctx, player.visualX, player.visualY, player.direction, player.animFrame, player.isMoving, "#4060c0"),
      });

      // Sort by Y (depth) and draw
      drawables.sort((a, b) => a.y - b.y);
      for (const d of drawables) {
        d.draw();
      }

      // Agent name labels (drawn above sprites, using interpolated positions)
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      for (const agent of agentsRef.current) {
        if (agent.current_building) continue;
        const t = Math.min(1, (timestamp - agent.tickArrivedAt) / tickIntervalMsRef.current);
        const vx = agent.prevX + (agent.current_x - agent.prevX) * t;
        const vy = agent.prevY + (agent.current_y - agent.prevY) * t;
        const lx = vx * TILE_SIZE + TILE_SIZE / 2;
        const ly = vy * TILE_SIZE - 2;
        const textW = ctx.measureText(agent.name).width;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(lx - textW / 2 - 3, ly - 9, textW + 6, 11);
        ctx.fillStyle = "#fff";
        ctx.fillText(agent.name, lx, ly);
      }

      // Building/location labels
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      for (const entry of tilemap.buildingEntries) {
        if (entry.id === BLDG_PLAZA || entry.id === BLDG_PARK) {
          const lx = (entry.x + entry.width / 2) * TILE_SIZE;
          const ly = entry.y * TILE_SIZE - 4;
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          const textW = ctx.measureText(entry.name).width;
          ctx.fillRect(lx - textW / 2 - 3, ly - 9, textW + 6, 13);
          ctx.fillStyle = "#333";
          ctx.fillText(entry.name, lx, ly);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [buildGroundCache, processInput]);

  // Responsive scaling
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const updateScale = () => {
      const maxW = window.innerWidth - 32;
      const maxH = window.innerHeight - 120;
      const s = Math.min(maxW / CANVAS_PIXEL_W, maxH / CANVAS_PIXEL_H, 1);
      setScale(s);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  const showInitButton = agentCount === 0;
  const canControlSim = (agentCount ?? 0) > 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <h1 className="text-xl font-bold text-amber-200 mb-2 font-mono">
        Generative Village
      </h1>
      <div className="flex items-center gap-3 mb-3 font-mono text-sm flex-wrap justify-center">
        <span className="text-gray-400">WASD / Arrows to move</span>
        {agentCount !== null && (
          <span className="text-gray-500">
            · {agentCount} {agentCount === 1 ? "agent" : "agents"}
          </span>
        )}
        {simState && (
          <span className="text-gray-400">
            · Day {simState.current_day} · {simState.time_of_day} · tick {simState.current_tick}
          </span>
        )}
        {canControlSim && (
          <>
            <button
              onClick={togglePause}
              className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold"
            >
              {paused ? "▶ Play" : "⏸ Pause"}
            </button>
            <label className="flex items-center gap-1 text-gray-400">
              Speed
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="bg-gray-800 text-gray-200 rounded px-2 py-1 text-xs"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={5}>5x</option>
                <option value={10}>10x</option>
              </select>
            </label>
          </>
        )}
        {showInitButton && (
          <button
            onClick={handleInit}
            disabled={initing}
            className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 disabled:bg-gray-700 text-white text-xs font-bold"
          >
            {initing ? "Generating agents..." : "Initialize World"}
          </button>
        )}
      </div>
      {stateError && (
        <div className="mb-2 px-3 py-1 bg-amber-900/60 text-amber-200 text-xs font-mono rounded max-w-2xl">
          Supabase: {stateError}
        </div>
      )}
      {initError && (
        <div className="mb-2 px-3 py-1 bg-red-900/70 text-red-200 text-xs font-mono rounded max-w-2xl">
          {initError}
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={CANVAS_PIXEL_W}
        height={CANVAS_PIXEL_H}
        style={{
          width: CANVAS_PIXEL_W * scale,
          height: CANVAS_PIXEL_H * scale,
          imageRendering: "pixelated",
          border: "2px solid #4a3a2a",
          borderRadius: "4px",
        }}
        tabIndex={0}
      />
      <p className="text-xs text-gray-500 mt-2 font-mono">
        Chunk 3 — Agent Movement & Pathfinding
      </p>
    </div>
  );
}
