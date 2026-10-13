/**
 * Interactable world objects — the things in the village that agents and the
 * player can use a verb on.
 *
 * Positions are tile coordinates. They sit on PASSABLE tiles (building
 * footprints are mostly collision=1 except plaza/park, so each object lives
 * on the building's entry tile or in the open). Beds are at cottage entry
 * tiles since cottages are sealed.
 *
 * Each verb is supported by at least one object so agents always have a place
 * to perform it. `forage` has two patches so agents naturally split up.
 */

import { InteractableObject } from "@/lib/types";

export const WORLD_OBJECTS: InteractableObject[] = [
  // ── Plaza ────────────────────────────────────────────────────────────────
  {
    id: "altar_plaza",
    name: "Crescent Shrine",
    kind: "altar",
    verb: "pray",
    x: 20, y: 21,
    flavour: "A small stone shrine to the crescent moon, candles always lit.",
  },
  {
    id: "bench_plaza",
    name: "Plaza Bench",
    kind: "bench",
    verb: "rest",
    x: 18, y: 22,
    flavour: "A worn stone bench under the leaning lamppost.",
  },

  // ── Inn ──────────────────────────────────────────────────────────────────
  {
    id: "inn_bar",
    name: "Inn Bar",
    kind: "inn_bar",
    verb: "eat",
    x: 3, y: 17, // inn entry
    flavour: "The bar at The Enchanted Hearth — stew, bread, hot drinks.",
  },

  // ── Library ──────────────────────────────────────────────────────────────
  {
    id: "bookshelves_library",
    name: "Library Bookshelves",
    kind: "bookshelves",
    verb: "read",
    x: 9, y: 5, // library entry
    flavour: "Towering shelves at The Gilded Quill — village histories, monster lore.",
  },

  // ── Park ─────────────────────────────────────────────────────────────────
  {
    id: "wildflower_patch_a",
    name: "Wildflower Patch (north)",
    kind: "wildflower_patch",
    verb: "forage",
    x: 28, y: 3,
    flavour: "Feverleaf and moon-mint grow thick here under the old oak.",
  },
  {
    id: "wildflower_patch_b",
    name: "Wildflower Patch (south)",
    kind: "wildflower_patch",
    verb: "forage",
    x: 30, y: 4,
    flavour: "A scrubby patch with sun-honey and bramble-thorn.",
  },
  {
    id: "bench_park",
    name: "Park Bench",
    kind: "bench",
    verb: "rest",
    x: 29, y: 6,
    flavour: "A weathered bench under the canopy of an ancient oak.",
  },

  // ── Beds — one per cottage. Position is the cottage's entry tile.
  //    Each cottage is sealed, so the bed is the only interactable that
  //    represents "your home" for sleep purposes.
  { id: "bed_cottage_1",  name: "Aldric House Bed",   kind: "bed", verb: "sleep", x: 25, y: 34, flavour: "A simple bed in the innkeeper's family home." },
  { id: "bed_cottage_2",  name: "Vale House Bed",     kind: "bed", verb: "sleep", x: 28, y: 34, flavour: "A quilt-piled bed in the librarian's quiet home." },
  { id: "bed_cottage_3",  name: "Breen House Bed",    kind: "bed", verb: "sleep", x: 31, y: 34, flavour: "A sturdy bed in the baker's house." },
  { id: "bed_cottage_4",  name: "Emberfell House Bed", kind: "bed", verb: "sleep", x: 25, y: 38, flavour: "A bed in the apothecary keeper's cottage." },
  { id: "bed_cottage_5",  name: "Hollowell House Bed", kind: "bed", verb: "sleep", x: 28, y: 38, flavour: "A shared bedroom for the village's elder bachelors." },
  { id: "bed_cottage_6",  name: "Dusk House Bed",     kind: "bed", verb: "sleep", x: 41, y: 28, flavour: "A small bed in a cheerful eastern cottage." },
  { id: "bed_cottage_7",  name: "Greenhaft House Bed", kind: "bed", verb: "sleep", x: 46, y: 28, flavour: "A tidy bed in the craftsman's cottage." },
  { id: "bed_cottage_8",  name: "Thornwood House Bed", kind: "bed", verb: "sleep", x: 51, y: 28, flavour: "A quiet bed at the meadow edge." },
  { id: "bed_cottage_9",  name: "Mornshade House Bed", kind: "bed", verb: "sleep", x: 41, y: 33, flavour: "A simply furnished bed under a small window." },
  { id: "bed_cottage_10", name: "Fletch House Bed",   kind: "bed", verb: "sleep", x: 46, y: 33, flavour: "A bed in a lively, slightly cluttered cottage." },

  // ── Workplace production (stateful, role-locked) ─────────────────────────
  // The bakery oven is the first object in the new Smallville-style
  // perception system. State transitions on `bake`:
  //   cold → baking → ready → (6 ticks) → cold
  // Other agents within ~6 tiles see the current state in their observation,
  // so news of "fresh loaves on the counter" spreads passively even without
  // a conversation.
  {
    id: "oven_bakery",
    name: "Bakery Oven",
    kind: "oven",
    verb: "bake",
    x: 3, y: 10, // bakery entry tile
    flavour: "A wood-fired stone oven; the source of the village's bread.",
    states: {
      default: "cold",
      duringAction: "baking",
      afterAction: "ready",
      decayTicks: 6,
    },
    // Martha Breen runs the bakery; Bren Hollowell is the semi-retired baker
    // who helps during morning rush. Both names match the agent-seeds roster.
    roleLock: ["Martha Breen", "Bren Hollowell"],
  },
];

// Lookup helpers
const BY_ID = new Map(WORLD_OBJECTS.map((o) => [o.id, o]));
export function getObject(id: string): InteractableObject | undefined {
  return BY_ID.get(id);
}

/** All objects matching a verb — used to suggest a target when the LLM omits one. */
export function objectsForVerb(verb: InteractableObject["verb"]): InteractableObject[] {
  return WORLD_OBJECTS.filter((o) => o.verb === verb);
}

/** Chebyshev (king-move) distance, since pathfinding uses 4-connected moves. */
function tileDist(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Nearest object supporting `verb`, ranked by tile distance from (x, y). */
export function nearestObjectForVerb(
  verb: InteractableObject["verb"],
  x: number, y: number,
): InteractableObject | undefined {
  const candidates = objectsForVerb(verb);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, o) =>
    tileDist(o.x, o.y, x, y) < tileDist(best.x, best.y, x, y) ? o : best,
  );
}

/** Object directly at or adjacent to (x, y) — for player E-key interactions. */
export function objectAtOrNear(x: number, y: number, radius = 1): InteractableObject | undefined {
  return WORLD_OBJECTS.find((o) => tileDist(o.x, o.y, x, y) <= radius);
}

/**
 * Activity tuning — durations in ticks (1 tick ≈ 15 sim-minutes), state
 * effects when the activity completes. Player and agent share these numbers.
 */
export const VERB_TUNING: Record<InteractableObject["verb"], {
  durationTicks: number;
  hungerDelta: number;
  energyDelta: number;
  completionFlavour: (agentName: string, objectName: string) => string;
}> = {
  eat: {
    durationTicks: 2,
    hungerDelta: -40,
    energyDelta: 0,
    completionFlavour: (n, o) => `${n} ate a meal at ${o}.`,
  },
  sleep: {
    durationTicks: 8, // ~2 sim-hours of game time; long enough to "rest the night"
    hungerDelta: 15,
    energyDelta: 80,
    completionFlavour: (n, o) => `${n} slept in ${o} and feels well-rested.`,
  },
  rest: {
    durationTicks: 1,
    hungerDelta: 2,
    energyDelta: 15,
    completionFlavour: (n, o) => `${n} sat at ${o} for a while and gathered themselves.`,
  },
  pray: {
    durationTicks: 2,
    hungerDelta: 1,
    energyDelta: 0,
    completionFlavour: (n, o) => `${n} prayed quietly at ${o}.`,
  },
  read: {
    durationTicks: 3,
    hungerDelta: 2,
    energyDelta: -2,
    completionFlavour: (n, o) => `${n} read at ${o} and reflected on what they learned.`,
  },
  forage: {
    durationTicks: 2,
    hungerDelta: 3,
    energyDelta: -5,
    completionFlavour: (n, o) => `${n} foraged at ${o}, gathering a small bundle of herbs.`,
  },
  bake: {
    durationTicks: 3,
    hungerDelta: 5,
    energyDelta: -5,
    completionFlavour: (n, o) => `${n} pulled fresh loaves from ${o}.`,
  },
};

/**
 * Hand-templated free-text detail for each object's state phase. This is the
 * "free-text half" of option C — it's what other agents will read when they
 * pass nearby, on top of the named state. Keep it short and atmospheric.
 *
 * Returns null when the state has no meaningful detail (e.g. an oven that's
 * just sitting cold doesn't need one).
 */
export function buildStateDetail(
  kind: InteractableObject["kind"],
  state: string,
  actorName: string | null,
): string | null {
  if (kind === "oven") {
    if (state === "baking") return `${actorName ?? "someone"} tending the fire, the smell of yeast drifting out`;
    if (state === "ready")  return `fresh loaves cooling on the counter, baked by ${actorName ?? "the baker"} this morning`;
    return null;
  }
  return null;
}

