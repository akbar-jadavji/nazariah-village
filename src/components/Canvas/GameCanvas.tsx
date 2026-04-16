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

// Movement interpolation speed (tiles per second)
const MOVE_SPEED = 6;

// Animation frame rate (8fps means change frame every 125ms)
const ANIM_FPS = 8;

type AgentRender = {
  id: string;
  name: string;
  sprite_key: string;
  current_x: number;
  current_y: number;
  current_building: string | null;
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
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [initing, setIniting] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

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

  // Fetch world state (agents) once on mount
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
        agentsRef.current = data.agents ?? [];
        setAgentCount(agentsRef.current.length);
      } catch (e) {
        setStateError(String(e).slice(0, 200));
        setAgentCount(0);
      }
    };
    load();
  }, []);

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
      // Refresh state
      const stateRes = await fetch("/api/simulation/state");
      const stateData = await stateRes.json();
      agentsRef.current = stateData.agents ?? [];
      setAgentCount(agentsRef.current.length);
    } catch (e) {
      setInitError(String(e).slice(0, 200));
    } finally {
      setIniting(false);
    }
  }, [initing]);

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

    // If still interpolating toward target, continue
    const dx = player.position.x - player.visualX;
    const dy = player.position.y - player.visualY;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist > 0.01) {
      // Still moving toward target tile
      const step = MOVE_SPEED / 60; // per frame at 60fps
      if (Math.abs(dx) > 0.01) {
        player.visualX += Math.sign(dx) * Math.min(step, Math.abs(dx));
      }
      if (Math.abs(dy) > 0.01) {
        player.visualY += Math.sign(dy) * Math.min(step, Math.abs(dy));
      }
      player.isMoving = true;
      return;
    }

    // Snap to tile
    player.visualX = player.position.x;
    player.visualY = player.position.y;

    // Check for new movement input (one tile per keypress, with repeat while held)
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
      // Rate limit movement: ~150ms between tile moves
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

      // Buildings (draw once per building, not per tile)
      const drawnBuildings = new Set<number>();
      for (const entry of tilemap.buildingEntries) {
        if (drawnBuildings.has(entry.id)) continue;
        // Skip plaza and park - they're open areas, not buildings with roofs
        if (entry.id === BLDG_PLAZA || entry.id === BLDG_PARK) continue;
        drawnBuildings.add(entry.id);
        drawables.push({
          y: entry.y + entry.height - 1,
          draw: () => drawBuilding(ctx, entry.id, entry.x, entry.y, entry.width, entry.height, entry.entryX, entry.entryY),
        });
      }

      // Agents (hidden when inside a building)
      const frame = playerRef.current.animFrame;
      for (const agent of agentsRef.current) {
        if (agent.current_building) continue;
        const color = agent.sprite_key.startsWith("char:")
          ? agent.sprite_key.slice(5)
          : "#8080c0";
        const ax = agent.current_x;
        const ay = agent.current_y;
        drawables.push({
          y: ay,
          draw: () => drawCharacter(ctx, ax, ay, "down", frame, false, color),
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

      // Agent name labels (drawn above all sprites)
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      for (const agent of agentsRef.current) {
        if (agent.current_building) continue;
        const lx = agent.current_x * TILE_SIZE + TILE_SIZE / 2;
        const ly = agent.current_y * TILE_SIZE - 2;
        const textW = ctx.measureText(agent.name).width;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(lx - textW / 2 - 3, ly - 9, textW + 6, 11);
        ctx.fillStyle = "#fff";
        ctx.fillText(agent.name, lx, ly);
      }

      // Draw building/location labels
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      for (const entry of tilemap.buildingEntries) {
        if (entry.id === BLDG_PLAZA || entry.id === BLDG_PARK) {
          // Draw label for open areas
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

  // Responsive scaling: fit the canvas in the viewport
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      // Leave room for some padding
      const maxW = window.innerWidth - 32;
      const maxH = window.innerHeight - 80;
      const s = Math.min(maxW / CANVAS_PIXEL_W, maxH / CANVAS_PIXEL_H, 1);
      setScale(s);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  const showInitButton = agentCount === 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <h1 className="text-xl font-bold text-amber-200 mb-2 font-mono">
        Generative Village
      </h1>
      <div className="flex items-center gap-4 mb-3 font-mono text-sm">
        <span className="text-gray-400">WASD or Arrow Keys to move</span>
        {agentCount !== null && (
          <span className="text-gray-500">
            · {agentCount} {agentCount === 1 ? "agent" : "agents"}
          </span>
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
          Supabase not configured: {stateError}
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
        Chunk 2 — Supabase Integration & Agent Spawning
      </p>
    </div>
  );
}
