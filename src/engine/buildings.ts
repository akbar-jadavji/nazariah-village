import {
  BLDG_INN, BLDG_APOTHECARY, BLDG_LIBRARY, BLDG_PLAZA, BLDG_PARK,
  BLDG_BAKERY, BLDG_WORKSHOP,
  BLDG_COTTAGE_1, BLDG_COTTAGE_2, BLDG_COTTAGE_3, BLDG_COTTAGE_4, BLDG_COTTAGE_5,
} from "@/lib/types";

/**
 * Map numeric building IDs ↔ stable string keys that agents use in the DB
 * (home_building_id, current_building). Kept in sync with agent-seeds.json.
 * Plaza and park are intentionally absent — they are open areas, not
 * enterable buildings.
 */
export const BUILDING_ID_TO_KEY: Record<number, string> = {
  [BLDG_INN]: "inn",
  [BLDG_APOTHECARY]: "apothecary",
  [BLDG_LIBRARY]: "library",
  [BLDG_PLAZA]: "plaza",
  [BLDG_PARK]: "park",
  [BLDG_BAKERY]: "bakery",
  [BLDG_WORKSHOP]: "workshop",
  [BLDG_COTTAGE_1]: "cottage_1",
  [BLDG_COTTAGE_2]: "cottage_2",
  [BLDG_COTTAGE_3]: "cottage_3",
  [BLDG_COTTAGE_4]: "cottage_4",
  [BLDG_COTTAGE_5]: "cottage_5",
};

export const ENTERABLE_BUILDING_IDS = new Set<number>([
  BLDG_INN, BLDG_APOTHECARY, BLDG_LIBRARY, BLDG_BAKERY, BLDG_WORKSHOP,
  BLDG_COTTAGE_1, BLDG_COTTAGE_2, BLDG_COTTAGE_3, BLDG_COTTAGE_4, BLDG_COTTAGE_5,
]);
