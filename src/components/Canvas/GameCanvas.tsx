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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 4) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Player movement interpolation speed (tiles per second)
const MOVE_SPEED = 6;
// Must match TALK_RADIUS in the tick route
const TALK_RADIUS = 3;

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

type ConvoTurn = { speaker: string; speakerId: string; line: string; thought: string };
type ConvoLog = {
  agentAId: string; agentBId: string;
  agentAName: string; agentBName: string;
  turns: ConvoTurn[];
  tick: number;
};

type SpeechBubble = {
  agentId: string;
  text: string;
  expiresAt: number; // performance.now() timestamp
};

type BubbleBound = {
  agentId: string;
  x: number; y: number; w: number; h: number; // canvas px coords
};

type AgentBound = {
  agentId: string;
  x: number; y: number; w: number; h: number;
};

type MemoryEntry = { type: string; content: string; sim_tick: number; importance: number };
type GoalEntry = { id: string; description: string; priority: number; status: string; steps: unknown; created_at_tick: number };
type RelEntry = { target_id: string; targetName: string; familiarity: number; sentiment: number; summary: string | null; interaction_count: number };

type InspectorData = {
  agent: {
    id: string; name: string; backstory: string; traits: string[];
    sprite_key: string; status: string; current_building: string | null;
    home_building_id: string; current_x: number; current_y: number;
  };
  memories: MemoryEntry[];
  goals: GoalEntry[];
  relationships: RelEntry[];
};

// Client-side rendering state for each agent — includes visual interpolation.
type AgentRender = AgentServer & {
  prevX: number;
  prevY: number;
  tickArrivedAt: number; // performance.now() when last DB position was received
  lerpDurationMs: number; // actual elapsed time between the last two tick completions
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
  const lastTickCompletedAtRef = useRef<number>(0);
  const tickingRef = useRef(false);
  const simStateRef = useRef<SimState | null>(null);
  const speechBubblesRef = useRef<SpeechBubble[]>([]);
  const bubbleBoundsRef = useRef<BubbleBound[]>([]);
  const agentBoundsRef = useRef<AgentBound[]>([]);
  const convoLogRef = useRef<ConvoLog[]>([]);
  const inspectorIdRef = useRef<string | null>(null);

  const [convoLog, setConvoLog] = useState<ConvoLog[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [selectedConvoIdx, setSelectedConvoIdx] = useState<number | null>(null);
  const convoItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [initing, setIniting] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [inspectorData, setInspectorData] = useState<InspectorData | null>(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);

  const [simState, setSimState] = useState<SimState | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  const [paused, setPaused] = useState(true);

  // ── Player identity ──────────────────────────────────────────────────────
  const [playerName, setPlayerName] = useState("");
  const [playerColor, setPlayerColor] = useState("#4060c0");
  const playerNameRef = useRef("");
  const playerColorRef = useRef("#4060c0");
  const [showSetup, setShowSetup] = useState(false);
  const [setupNameDraft, setSetupNameDraft] = useState("");
  const [setupColorDraft, setSetupColorDraft] = useState("#4060c0");

  // ── Player chat ───────────────────────────────────────────────────────────
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const chatAgentIdRef = useRef<string | null>(null);
  const [chatAgentName, setChatAgentName] = useState("");
  type ChatMsg = { role: "user" | "assistant"; content: string };
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [agentChatRequests, setAgentChatRequests] = useState<{ agentId: string; agentName: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync with state (render loop + keyboard handler read refs directly)
  inspectorIdRef.current = inspectorId;
  playerColorRef.current = playerColor;
  playerNameRef.current = playerName;
  chatAgentIdRef.current = chatAgentId;

  // Zoom: responsiveScale fits canvas to window; userZoom is user-controlled multiplier
  const [responsiveScale, setResponsiveScale] = useState(1);
  const [userZoom, setUserZoom] = useState(1);
  const finalScale = responsiveScale * userZoom;

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

  const mergeAgents = useCallback((serverAgents: AgentServer[], receivedAt: number, lerpDurationMs: number) => {
    const byId = new Map(agentsRef.current.map((a) => [a.id, a]));
    const merged: AgentRender[] = serverAgents.map((sa) => {
      const existing = byId.get(sa.id);
      if (!existing) {
        return {
          ...sa,
          prevX: sa.current_x,
          prevY: sa.current_y,
          tickArrivedAt: receivedAt,
          lerpDurationMs,
          direction: "down" as Direction,
          animFrame: 0,
          isMoving: false,
        };
      }
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
        lerpDurationMs,
        direction,
        animFrame: existing.animFrame,
        isMoving: moved,
      };
    });
    agentsRef.current = merged;
  }, []);

  // Fetch world state on mount
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
        mergeAgents(data.agents ?? [], performance.now(), tickIntervalMsRef.current);
        setAgentCount(agentsRef.current.length);
        if (data.state) {
          setSimState(data.state);
          simStateRef.current = data.state;
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
      mergeAgents(stateData.agents ?? [], performance.now(), tickIntervalMsRef.current);
      setAgentCount(agentsRef.current.length);
      if (stateData.state) {
        setSimState(stateData.state);
        simStateRef.current = stateData.state;
        setPaused(!!stateData.state.is_paused);
      }
    } catch (e) {
      setInitError(String(e).slice(0, 200));
    } finally {
      setIniting(false);
    }
  }, [initing, mergeAgents]);

  // Restart: reset + re-init
  const handleRestart = useCallback(async () => {
    if (restarting || initing) return;
    setRestarting(true);
    setInitError(null);
    setPaused(true);
    // Clear client state immediately
    agentsRef.current = [];
    speechBubblesRef.current = [];
    bubbleBoundsRef.current = [];
    convoLogRef.current = [];
    setConvoLog([]);
    setSimState(null);
    simStateRef.current = null;
    setAgentCount(null);
    setSelectedConvoIdx(null);
    try {
      const resetRes = await fetch("/api/world/reset", { method: "POST" });
      if (!resetRes.ok) {
        const d = await resetRes.json().catch(() => ({}));
        setInitError(d.error ?? `Reset failed: HTTP ${resetRes.status}`);
        setAgentCount(0);
        return;
      }
      setIniting(true);
      const initRes = await fetch("/api/world/init", { method: "POST" });
      const initData = await initRes.json();
      if (!initRes.ok) {
        setInitError(initData.error ?? `Init failed: HTTP ${initRes.status}`);
        setAgentCount(0);
        return;
      }
      const stateRes = await fetch("/api/simulation/state");
      const stateData = await stateRes.json();
      mergeAgents(stateData.agents ?? [], performance.now(), tickIntervalMsRef.current);
      setAgentCount(agentsRef.current.length);
      if (stateData.state) {
        setSimState(stateData.state);
        simStateRef.current = stateData.state;
        setPaused(!!stateData.state.is_paused);
      }
    } catch (e) {
      setInitError(String(e).slice(0, 200));
      setAgentCount(0);
    } finally {
      setRestarting(false);
      setIniting(false);
    }
  }, [restarting, initing, mergeAgents]);

  // Speed interval sync
  useEffect(() => {
    tickIntervalMsRef.current = SPEED_INTERVALS_MS[speed] ?? 500;
  }, [speed]);

  // Load player identity from localStorage on mount
  useEffect(() => {
    const name = localStorage.getItem("playerName");
    const color = localStorage.getItem("playerColor") ?? "#4060c0";
    if (name) {
      setPlayerName(name);
      setPlayerColor(color);
      playerNameRef.current = name;
      playerColorRef.current = color;
    } else {
      setShowSetup(true);
    }
  }, []);

  // Sim tick polling
  useEffect(() => {
    if (paused) return;
    if ((agentCount ?? 0) === 0) return;

    lastTickCompletedAtRef.current = 0;
    let stopped = false;
    const runTick = async () => {
      if (stopped || tickingRef.current) return;
      tickingRef.current = true;
      try {
        const player = playerRef.current;
        const res = await fetch("/api/simulation/tick", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            playerX: player.position.x,
            playerY: player.position.y,
            playerName: playerNameRef.current || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setStateError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        const now = performance.now();
        const prev = lastTickCompletedAtRef.current;
        const actualElapsed = prev > 0 ? now - prev : tickIntervalMsRef.current;
        const lerpDurationMs = Math.min(actualElapsed, tickIntervalMsRef.current);
        lastTickCompletedAtRef.current = now;
        mergeAgents(data.agents ?? [], now, lerpDurationMs);
        if (data.state) {
          setSimState(data.state);
          simStateRef.current = data.state;
        }
        if (data.conversations && data.conversations.length > 0) {
          const tick = data.state?.current_tick ?? 0;
          const BUBBLE_DURATION = 6000;
          for (const convo of data.conversations as ConvoLog[]) {
            const lastForA = [...convo.turns].reverse().find((t) => t.speakerId === convo.agentAId);
            const lastForB = [...convo.turns].reverse().find((t) => t.speakerId === convo.agentBId);
            if (lastForA) speechBubblesRef.current.push({ agentId: convo.agentAId, text: lastForA.line, expiresAt: now + BUBBLE_DURATION });
            if (lastForB) speechBubblesRef.current.push({ agentId: convo.agentBId, text: lastForB.line, expiresAt: now + BUBBLE_DURATION });
          }
          setConvoLog((prev) => {
            const next = [
              ...data.conversations.map((c: ConvoLog) => ({ ...c, tick })),
              ...prev,
            ].slice(0, 20);
            convoLogRef.current = next;
            return next;
          });
        }
        // Handle agents that want to initiate chat with the player
        if (data.agentChatRequests && data.agentChatRequests.length > 0 && !chatAgentIdRef.current) {
          setAgentChatRequests((prev) => {
            const existingIds = new Set(prev.map((r: { agentId: string }) => r.agentId));
            const fresh = (data.agentChatRequests as { agentId: string; agentName: string }[])
              .filter((r) => !existingIds.has(r.agentId));
            return [...prev, ...fresh].slice(0, 3);
          });
        }
      } catch (e) {
        setStateError(String(e).slice(0, 200));
      } finally {
        tickingRef.current = false;
      }
    };
    const id = setInterval(runTick, tickIntervalMsRef.current);
    runTick();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [paused, speed, agentCount, mergeAgents]);

  const togglePause = useCallback(async () => {
    const nextPaused = !paused;
    setPaused(nextPaused);
    try {
      await fetch("/api/simulation/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
    } catch {
      // non-fatal
    }
  }, [paused]);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Keyboard input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept keys when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const key = e.key.toLowerCase();

      if (key === "escape") {
        setChatAgentId(null);
        chatAgentIdRef.current = null;
        return;
      }

      if (key === "e") {
        if (chatAgentIdRef.current) {
          setChatAgentId(null);
          chatAgentIdRef.current = null;
          return;
        }
        // Find nearest agent within TALK_RADIUS
        const player = playerRef.current;
        let nearest: AgentRender | null = null;
        let minD = Infinity;
        for (const a of agentsRef.current) {
          if (a.current_building) continue;
          const d = Math.max(
            Math.abs(a.current_x - player.position.x),
            Math.abs(a.current_y - player.position.y),
          );
          if (d <= TALK_RADIUS && d < minD) { minD = d; nearest = a; }
        }
        if (nearest) {
          setChatAgentId(nearest.id);
          chatAgentIdRef.current = nearest.id;
          setChatAgentName(nearest.name);
          setChatMessages([]);
          setChatInput("");
        }
        return;
      }

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

  const processInput = useCallback((now: number) => {
    const player = playerRef.current;
    const tilemap = tilemapRef.current;
    if (!tilemap) return;

    const dx = player.position.x - player.visualX;
    const dy = player.position.y - player.visualY;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist > 0.01) {
      const step = MOVE_SPEED / 60;
      if (Math.abs(dx) > 0.01) player.visualX += Math.sign(dx) * Math.min(step, Math.abs(dx));
      if (Math.abs(dy) > 0.01) player.visualY += Math.sign(dy) * Math.min(step, Math.abs(dy));
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

      animTimerRef.current += 1;
      if (animTimerRef.current >= 60 / ANIM_FPS) {
        animTimerRef.current = 0;
        playerRef.current.animFrame = (playerRef.current.animFrame + 1) % 4;
        for (const a of agentsRef.current) {
          a.animFrame = (a.animFrame + 1) % 4;
        }
      }

      for (const a of agentsRef.current) {
        const t = Math.min(1, (timestamp - a.tickArrivedAt) / a.lerpDurationMs);
        a.isMoving = t < 1 && (a.prevX !== a.current_x || a.prevY !== a.current_y);
      }

      ctx.clearRect(0, 0, CANVAS_PIXEL_W, CANVAS_PIXEL_H);
      if (groundCacheRef.current) {
        ctx.drawImage(groundCacheRef.current, 0, 0);
      }

      const drawables: { y: number; draw: () => void }[] = [];

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

      for (const agent of agentsRef.current) {
        if (agent.current_building) continue;
        const color = agent.sprite_key.startsWith("char:")
          ? agent.sprite_key.slice(5)
          : "#8080c0";
        const t = Math.min(1, (timestamp - agent.tickArrivedAt) / agent.lerpDurationMs);
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

      const player = playerRef.current;
      drawables.push({
        y: player.visualY,
        draw: () => drawCharacter(ctx, player.visualX, player.visualY, player.direction, player.animFrame, player.isMoving, playerColorRef.current),
      });

      drawables.sort((a, b) => a.y - b.y);
      for (const d of drawables) d.draw();

      // Agent name labels
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      for (const agent of agentsRef.current) {
        if (agent.current_building) continue;
        const t = Math.min(1, (timestamp - agent.tickArrivedAt) / agent.lerpDurationMs);
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

      // Player name label
      if (playerNameRef.current) {
        const plx = player.visualX * TILE_SIZE + TILE_SIZE / 2;
        const ply = player.visualY * TILE_SIZE - 2;
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        const pLabel = playerNameRef.current + " ★";
        const ptw = ctx.measureText(pLabel).width;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(plx - ptw / 2 - 3, ply - 9, ptw + 6, 11);
        ctx.fillStyle = "#ffd700";
        ctx.fillText(pLabel, plx, ply);
      }

      // E-to-chat indicator: green ring around agents within TALK_RADIUS, "E" hint for closest
      if (!chatAgentIdRef.current) {
        let closestAgent: AgentRender | null = null;
        let closestDist = Infinity;
        for (const agent of agentsRef.current) {
          if (agent.current_building) continue;
          const d = Math.max(
            Math.abs(agent.current_x - player.position.x),
            Math.abs(agent.current_y - player.position.y),
          );
          if (d <= TALK_RADIUS) {
            const t2 = Math.min(1, (timestamp - agent.tickArrivedAt) / agent.lerpDurationMs);
            const vx2 = agent.prevX + (agent.current_x - agent.prevX) * t2;
            const vy2 = agent.prevY + (agent.current_y - agent.prevY) * t2;
            ctx.save();
            ctx.strokeStyle = "#22c55e";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.arc(vx2 * TILE_SIZE + TILE_SIZE / 2, vy2 * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE * 0.7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            if (d < closestDist) { closestDist = d; closestAgent = agent; }
          }
        }
        if (closestAgent) {
          const t2 = Math.min(1, (timestamp - closestAgent.tickArrivedAt) / closestAgent.lerpDurationMs);
          const vx2 = closestAgent.prevX + (closestAgent.current_x - closestAgent.prevX) * t2;
          const vy2 = closestAgent.prevY + (closestAgent.current_y - closestAgent.prevY) * t2;
          ctx.font = "bold 8px monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "#22c55e";
          ctx.fillText("[E] chat", vx2 * TILE_SIZE + TILE_SIZE / 2, vy2 * TILE_SIZE + TILE_SIZE + 9);
        }
      }

      // Record agent click bounds + draw selection ring for inspector
      agentBoundsRef.current = [];
      for (const agent of agentsRef.current) {
        if (agent.current_building) continue;
        const t = Math.min(1, (timestamp - agent.tickArrivedAt) / agent.lerpDurationMs);
        const vx = agent.prevX + (agent.current_x - agent.prevX) * t;
        const vy = agent.prevY + (agent.current_y - agent.prevY) * t;
        agentBoundsRef.current.push({
          agentId: agent.id,
          x: vx * TILE_SIZE + 2,
          y: vy * TILE_SIZE + 2,
          w: TILE_SIZE - 4,
          h: TILE_SIZE - 2,
        });
        if (agent.id === inspectorIdRef.current) {
          ctx.save();
          ctx.strokeStyle = "#ffd700";
          ctx.lineWidth = 2;
          ctx.shadowColor = "#ffd700";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(
            vx * TILE_SIZE + TILE_SIZE / 2,
            vy * TILE_SIZE + TILE_SIZE / 2,
            TILE_SIZE * 0.72,
            0, Math.PI * 2,
          );
          ctx.stroke();
          ctx.restore();
        }
      }

      // Speech bubbles — expire old, draw active, record click bounds
      speechBubblesRef.current = speechBubblesRef.current.filter((b) => b.expiresAt > timestamp);
      const agentMap = new Map(agentsRef.current.map((a) => [a.id, a]));
      bubbleBoundsRef.current = []; // reset hit boxes each frame
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      for (const bubble of speechBubblesRef.current) {
        const agent = agentMap.get(bubble.agentId);
        if (!agent || agent.current_building) continue;
        const t = Math.min(1, (timestamp - agent.tickArrivedAt) / agent.lerpDurationMs);
        const vx = agent.prevX + (agent.current_x - agent.prevX) * t;
        const vy = agent.prevY + (agent.current_y - agent.prevY) * t;
        const bx = vx * TILE_SIZE;
        const by = vy * TILE_SIZE - 14;
        const words = bubble.text.split(" ");
        const lines: string[] = [];
        let cur = "";
        for (const w of words) {
          if ((cur + w).length > 28) { lines.push(cur.trim()); cur = ""; }
          cur += w + " ";
        }
        if (cur.trim()) lines.push(cur.trim());
        const lh = 10;
        const bw = Math.min(180, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 8);
        const bh = lines.length * lh + 6;
        const fadeAlpha = Math.min(1, (bubble.expiresAt - timestamp) / 1500);
        ctx.globalAlpha = fadeAlpha;
        ctx.fillStyle = "#fffde8";
        ctx.strokeStyle = "#888";
        ctx.lineWidth = 1;
        roundRect(ctx, bx - 2, by - bh, bw, bh);
        ctx.fill();
        ctx.stroke();
        // Tail
        ctx.beginPath();
        ctx.moveTo(bx + 6, by);
        ctx.lineTo(bx + 12, by + 5);
        ctx.lineTo(bx + 16, by);
        ctx.fillStyle = "#fffde8";
        ctx.fill();
        ctx.fillStyle = "#333";
        lines.forEach((line, i) => ctx.fillText(line, bx + 2, by - bh + lh * (i + 1)));
        ctx.globalAlpha = 1;

        // Clickable cursor hint — small arrow icon in top-right of bubble
        ctx.globalAlpha = fadeAlpha * 0.7;
        ctx.fillStyle = "#555";
        ctx.font = "7px monospace";
        ctx.fillText("▸", bx - 2 + bw - 9, by - bh + 8);
        ctx.font = "8px monospace";
        ctx.globalAlpha = 1;

        // Record hit bounds (canvas px coords) for click detection
        bubbleBoundsRef.current.push({
          agentId: bubble.agentId,
          x: bx - 2,
          y: by - bh,
          w: bw,
          h: bh + 6, // include tail
        });
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

      // Day/night overlay
      const timeOfDay = simStateRef.current?.time_of_day ?? "morning";
      const nightAlpha: Record<string, number> = {
        morning: 0,
        midday: 0,
        afternoon: 0.08,
        evening: 0.28,
        night: 0.52,
      };
      const alpha = nightAlpha[timeOfDay] ?? 0;
      if (alpha > 0) {
        ctx.fillStyle = `rgba(10, 15, 40, ${alpha})`;
        ctx.fillRect(0, 0, CANVAS_PIXEL_W, CANVAS_PIXEL_H);
      }
      if (alpha >= 0.28) {
        for (const entry of tilemap.buildingEntries) {
          const wx = (entry.x + entry.width / 2) * TILE_SIZE;
          const wy = entry.y * TILE_SIZE + 8;
          const grd = ctx.createRadialGradient(wx, wy, 0, wx, wy, TILE_SIZE * 2);
          grd.addColorStop(0, "rgba(255, 200, 80, 0.18)");
          grd.addColorStop(1, "rgba(255, 200, 80, 0)");
          ctx.fillStyle = grd;
          ctx.fillRect(wx - TILE_SIZE * 2, wy - TILE_SIZE * 2, TILE_SIZE * 4, TILE_SIZE * 4);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [buildGroundCache, processInput]);

  // Responsive scale: fit canvas to window, capped at 1× native
  useEffect(() => {
    const updateScale = () => {
      const maxW = window.innerWidth - 32;
      const maxH = window.innerHeight - 160;
      const s = Math.min(maxW / CANVAS_PIXEL_W, maxH / CANVAS_PIXEL_H, 1);
      setResponsiveScale(s);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Scroll selected conversation into view when log opens or selection changes
  useEffect(() => {
    if (selectedConvoIdx !== null && logOpen) {
      convoItemRefs.current[selectedConvoIdx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedConvoIdx, logOpen]);

  // Fetch agent detail when inspector opens
  useEffect(() => {
    if (!inspectorId) { setInspectorData(null); return; }
    setInspectorLoading(true);
    setInspectorData(null);
    fetch(`/api/agent/${inspectorId}`)
      .then((r) => r.json())
      .then((d) => setInspectorData(d))
      .catch(() => {})
      .finally(() => setInspectorLoading(false));
  }, [inspectorId]);

  // Confirm player setup
  const confirmSetup = useCallback(() => {
    const name = setupNameDraft.trim() || "Wanderer";
    const color = setupColorDraft;
    setPlayerName(name);
    setPlayerColor(color);
    playerNameRef.current = name;
    playerColorRef.current = color;
    localStorage.setItem("playerName", name);
    localStorage.setItem("playerColor", color);
    setShowSetup(false);
  }, [setupNameDraft, setupColorDraft]);

  // Send a player chat message to the selected agent (streaming)
  const sendChatMessage = useCallback(async () => {
    if (!chatInput.trim() || chatStreaming || !chatAgentId) return;
    const message = chatInput.trim();
    setChatInput("");
    const outgoing: ChatMsg = { role: "user", content: message };
    setChatMessages((prev) => [...prev, outgoing]);
    setChatStreaming(true);
    try {
      const res = await fetch(`/api/agent/${chatAgentId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          playerName: playerNameRef.current || "Visitor",
          history: chatMessages,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let agentText = "";
      setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        agentText += decoder.decode(value, { stream: true });
        setChatMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: agentText };
          return copy;
        });
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "(No response — try again)" }]);
    } finally {
      setChatStreaming(false);
    }
  }, [chatInput, chatStreaming, chatAgentId, chatMessages]);

  // Canvas click: check if any speech bubble was clicked
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert CSS click coords → canvas pixel coords
    const canvasX = ((e.clientX - rect.left) / rect.width) * CANVAS_PIXEL_W;
    const canvasY = ((e.clientY - rect.top) / rect.height) * CANVAS_PIXEL_H;

    // Agent sprites take priority over speech bubbles
    for (const b of agentBoundsRef.current) {
      if (canvasX >= b.x && canvasX <= b.x + b.w && canvasY >= b.y && canvasY <= b.y + b.h) {
        setInspectorId((prev) => (prev === b.agentId ? null : b.agentId)); // toggle
        return;
      }
    }

    // Speech bubble click → open conversation log entry
    for (const b of bubbleBoundsRef.current) {
      if (canvasX >= b.x && canvasX <= b.x + b.w && canvasY >= b.y && canvasY <= b.y + b.h) {
        const idx = convoLogRef.current.findIndex(
          (c) => c.agentAId === b.agentId || c.agentBId === b.agentId,
        );
        if (idx >= 0) {
          setLogOpen(true);
          setSelectedConvoIdx(idx);
        }
        break;
      }
    }
  }, []);

  const showInitButton = agentCount === 0;
  const canControlSim = (agentCount ?? 0) > 0;
  const busy = restarting || initing;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <h1 className="text-xl font-bold text-amber-200 mb-2 font-mono">
        Generative Village
      </h1>

      {/* Controls row */}
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
              disabled={busy}
              className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 disabled:bg-gray-700 text-white text-xs font-bold"
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
            <button
              onClick={handleRestart}
              disabled={busy}
              className="px-3 py-1 rounded bg-red-900 hover:bg-red-700 disabled:bg-gray-700 text-white text-xs font-bold"
              title="Wipe the world and generate fresh agents"
            >
              {restarting ? "Restarting…" : "↺ Restart"}
            </button>
          </>
        )}

        {showInitButton && (
          <button
            onClick={handleInit}
            disabled={initing}
            className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 disabled:bg-gray-700 text-white text-xs font-bold"
          >
            {initing ? "Generating agents…" : "Initialize World"}
          </button>
        )}

        {/* Zoom controls */}
        <div className="flex items-center gap-1 text-gray-400">
          <button
            onClick={() => setUserZoom((z) => Math.max(0.25, parseFloat((z / 1.25).toFixed(3))))}
            className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold leading-none"
            title="Zoom out"
          >−</button>
          <span className="text-xs w-10 text-center">
            {Math.round(finalScale * 100)}%
          </span>
          <button
            onClick={() => setUserZoom((z) => Math.min(4, parseFloat((z * 1.25).toFixed(3))))}
            className="w-6 h-6 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold leading-none"
            title="Zoom in"
          >+</button>
          {userZoom !== 1 && (
            <button
              onClick={() => setUserZoom(1)}
              className="px-2 h-6 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs"
              title="Reset zoom"
            >⊙</button>
          )}
        </div>
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
      {restarting && !initError && (
        <div className="mb-2 px-3 py-1 bg-gray-800 text-gray-300 text-xs font-mono rounded max-w-2xl">
          {initing ? "Generating new agents… (this takes ~30s)" : "Resetting world…"}
        </div>
      )}

      {/* Scrollable canvas viewport */}
      <div
        className="overflow-auto rounded"
        style={{
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 160px)",
          border: "2px solid #4a3a2a",
          borderRadius: "4px",
          cursor: bubbleBoundsRef.current.length > 0 ? "pointer" : "default",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_PIXEL_W}
          height={CANVAS_PIXEL_H}
          onClick={handleCanvasClick}
          style={{
            display: "block",
            width: CANVAS_PIXEL_W * finalScale,
            height: CANVAS_PIXEL_H * finalScale,
            imageRendering: "pixelated",
          }}
          tabIndex={0}
        />
      </div>

      <p className="text-xs text-gray-500 mt-2 font-mono">
        Chunk 7 — Player Integration · Press E near an agent to chat · Click agent to inspect
      </p>

      {/* Conversation log panel */}
      <div className="w-full max-w-2xl mt-3 font-mono text-xs">
        <button
          onClick={() => setLogOpen((o) => !o)}
          className="w-full px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-left rounded flex justify-between items-center"
        >
          <span>Conversation Log ({convoLog.length})</span>
          <span>{logOpen ? "▲" : "▼"}</span>
        </button>
        {logOpen && (
          <div className="bg-gray-900 border border-gray-700 rounded-b max-h-64 overflow-y-auto p-2 space-y-3">
            {convoLog.length === 0 ? (
              <p className="text-gray-500 italic">No conversations yet. Agents will talk when they meet.</p>
            ) : (
              convoLog.map((c, i) => (
                <div
                  key={i}
                  ref={(el) => { convoItemRefs.current[i] = el; }}
                  className={`border-b pb-2 transition-colors ${
                    selectedConvoIdx === i
                      ? "border-amber-600 bg-amber-900/20 rounded px-1"
                      : "border-gray-800"
                  }`}
                >
                  <div className="text-gray-400 mb-1">
                    Tick {c.tick} · {c.agentAName} &amp; {c.agentBName}
                  </div>
                  {c.turns.map((turn, j) => (
                    <div key={j} className={turn.speakerId === c.agentAId ? "text-amber-300" : "text-sky-300"}>
                      <span className="font-bold">{turn.speaker}:</span> {turn.line}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {/* Player name setup modal */}
      {showSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-gray-900 border border-amber-700 rounded-xl p-6 w-80 font-mono text-sm shadow-2xl">
            <h2 className="text-amber-200 font-bold text-base mb-1">Welcome to the Village</h2>
            <p className="text-gray-400 text-xs mb-4">What shall you be called?</p>
            <input
              autoFocus
              type="text"
              placeholder="Enter your name…"
              value={setupNameDraft}
              onChange={(e) => setSetupNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmSetup(); }}
              maxLength={20}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100 text-sm mb-3 outline-none focus:border-amber-500"
            />
            <div className="mb-4">
              <p className="text-gray-400 text-xs mb-2">Choose your colour:</p>
              <div className="flex gap-2 flex-wrap">
                {["#4060c0","#c04040","#40a040","#a040a0","#c08020","#208080","#808080"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setSetupColorDraft(c)}
                    className="w-7 h-7 rounded-full border-2 transition-all"
                    style={{
                      background: c,
                      borderColor: setupColorDraft === c ? "#ffd700" : "transparent",
                      boxShadow: setupColorDraft === c ? "0 0 6px #ffd700" : "none",
                    }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={confirmSetup}
              className="w-full py-2 bg-amber-700 hover:bg-amber-600 text-white rounded font-bold"
            >
              Enter the Village
            </button>
          </div>
        </div>
      )}

      {/* Agent-initiated chat request notifications */}
      {agentChatRequests.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 font-mono text-xs">
          {agentChatRequests.map((req) => (
            <div key={req.agentId} className="flex items-center gap-3 bg-gray-900 border border-amber-600 rounded-lg px-4 py-2 shadow-lg">
              <span className="text-amber-300">
                <span className="font-bold">{req.agentName}</span> wants to talk to you
              </span>
              <button
                onClick={() => {
                  setChatAgentId(req.agentId);
                  chatAgentIdRef.current = req.agentId;
                  setChatAgentName(req.agentName);
                  setChatMessages([]);
                  setChatInput("");
                  setAgentChatRequests((prev) => prev.filter((r) => r.agentId !== req.agentId));
                }}
                className="px-2 py-0.5 bg-amber-700 hover:bg-amber-600 text-white rounded text-xs"
              >
                Chat
              </button>
              <button
                onClick={() => setAgentChatRequests((prev) => prev.filter((r) => r.agentId !== req.agentId))}
                className="text-gray-500 hover:text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Player chat panel */}
      {chatAgentId && (
        <div className="fixed bottom-0 right-0 z-40 w-80 h-96 flex flex-col bg-gray-900 border border-gray-700 rounded-tl-xl shadow-2xl font-mono text-xs">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 rounded-tl-xl">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-amber-200 font-bold">{chatAgentName}</span>
            </div>
            <button
              onClick={() => { setChatAgentId(null); chatAgentIdRef.current = null; }}
              className="text-gray-500 hover:text-white text-sm"
            >
              ✕
            </button>
          </div>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {chatMessages.length === 0 && (
              <p className="text-gray-600 italic text-center mt-8">
                Say something to {chatAgentName}…
              </p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-1.5 leading-relaxed ${
                    msg.role === "user"
                      ? "bg-amber-700/70 text-amber-100"
                      : "bg-gray-800 text-gray-200"
                  }`}
                >
                  {msg.content || <span className="opacity-50">…</span>}
                </div>
              </div>
            ))}
            {chatStreaming && chatMessages[chatMessages.length - 1]?.role === "user" && (
              <div className="flex justify-start">
                <div className="bg-gray-800 text-gray-400 rounded-lg px-3 py-1.5">…</div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {/* Input */}
          <div className="flex gap-1 p-2 border-t border-gray-800">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendChatMessage(); }}
              placeholder="Type a message…"
              disabled={chatStreaming}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100 text-xs outline-none focus:border-amber-500 disabled:opacity-50"
            />
            <button
              onClick={sendChatMessage}
              disabled={chatStreaming || !chatInput.trim()}
              className="px-3 py-1 bg-amber-700 hover:bg-amber-600 disabled:bg-gray-700 text-white rounded text-xs font-bold"
            >
              ↵
            </button>
          </div>
        </div>
      )}

      {/* Agent inspector overlay */}
      {inspectorId && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60"
          onClick={() => setInspectorId(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-t-xl sm:rounded-xl w-full sm:max-w-sm max-h-[80vh] overflow-y-auto font-mono text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {inspectorLoading || !inspectorData ? (
              <div className="p-6 text-gray-500 text-center">
                {inspectorLoading ? "Loading…" : "No data"}
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-800 sticky top-0 bg-gray-900">
                  <div
                    className="w-9 h-9 rounded-full flex-shrink-0 border-2 border-gray-600"
                    style={{ background: inspectorData.agent.sprite_key.replace("char:", "") }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-amber-200 font-bold text-sm truncate">
                      {inspectorData.agent.name}
                    </div>
                    <div className="flex gap-1 flex-wrap mt-0.5">
                      {inspectorData.agent.traits.map((t, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-400 text-xs">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setInspectorId(null)}
                    className="text-gray-500 hover:text-white text-lg leading-none flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Status */}
                  <div className="flex items-center gap-2 text-gray-400">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      inspectorData.agent.status === "walking" ? "bg-blue-900 text-blue-300" :
                      inspectorData.agent.status === "talking" ? "bg-green-900 text-green-300" :
                      inspectorData.agent.status === "resting" ? "bg-purple-900 text-purple-300" :
                      inspectorData.agent.status === "thinking" ? "bg-yellow-900 text-yellow-300" :
                      "bg-gray-800 text-gray-400"
                    }`}>
                      {inspectorData.agent.status}
                    </span>
                    <span className="text-gray-500 text-xs">
                      {inspectorData.agent.current_building
                        ? `inside ${inspectorData.agent.current_building}`
                        : `tile (${inspectorData.agent.current_x}, ${inspectorData.agent.current_y})`}
                    </span>
                  </div>

                  {/* Backstory */}
                  <details className="group">
                    <summary className="text-gray-400 cursor-pointer list-none flex items-center gap-1 select-none">
                      <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                      Backstory
                    </summary>
                    <p className="text-gray-400 mt-2 leading-relaxed text-xs">
                      {inspectorData.agent.backstory}
                    </p>
                  </details>

                  {/* Recent Memories */}
                  <div>
                    <div className="text-gray-300 font-bold mb-2">Recent Memories</div>
                    {inspectorData.memories.length === 0 ? (
                      <div className="text-gray-600 italic">None yet</div>
                    ) : (
                      inspectorData.memories.slice(0, 6).map((m, i) => (
                        <div key={i} className="mb-2 text-xs leading-relaxed">
                          <span className={`font-bold mr-1 ${
                            m.type === "reflection" ? "text-purple-400" :
                            m.type === "conversation" ? "text-sky-400" :
                            m.type === "internal_thought" ? "text-yellow-400" :
                            "text-green-400"
                          }`}>
                            [{m.type}]
                          </span>
                          <span className="text-gray-400">{m.content}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Active Goals */}
                  {inspectorData.goals.length > 0 && (
                    <div>
                      <div className="text-gray-300 font-bold mb-2">Active Goals</div>
                      {inspectorData.goals.map((g, i) => (
                        <div key={i} className="bg-gray-800 rounded-lg p-3 mb-2">
                          <div className="text-amber-300 leading-snug">{g.description}</div>
                          <div className="text-gray-500 mt-1">Priority {g.priority}/5</div>
                          {Array.isArray(g.steps) && (g.steps as string[]).length > 0 && (
                            <ul className="text-gray-500 mt-1 space-y-0.5 list-none">
                              {(g.steps as string[]).map((s, j) => (
                                <li key={j} className="flex gap-1">
                                  <span className="text-gray-600">›</span>
                                  {s}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Relationships */}
                  {inspectorData.relationships.length > 0 && (
                    <div>
                      <div className="text-gray-300 font-bold mb-2">Relationships</div>
                      {inspectorData.relationships.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 mb-2">
                          <span className="text-gray-300 w-28 truncate flex-shrink-0">
                            {r.targetName}
                          </span>
                          <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.round(r.familiarity * 100)}%`,
                                background: r.sentiment >= 0 ? "#d97706" : "#7f1d1d",
                              }}
                            />
                          </div>
                          <span className="text-gray-500 text-xs w-8 text-right flex-shrink-0">
                            {Math.round(r.familiarity * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
