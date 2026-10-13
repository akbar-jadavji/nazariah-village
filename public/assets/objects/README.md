# World object sprites

Drop in 32×32 transparent PNGs to replace the procedural placeholders. The
client renderer (see `src/engine/sprites.ts → loadObjectSprite`) loads files
from this folder by name; any kind that doesn't have a PNG falls back to
the procedurally-drawn version so you can replace them one at a time without
breaking anything.

## Naming convention

There are two ways to name a file:

1. **`<kind>.png`** — a single sprite used for the object regardless of
   state. Good for things that don't change much.

   ```
   bed.png
   bench.png
   bookshelves.png
   altar.png
   inn_bar.png
   wildflower_patch.png
   ```

2. **`<kind>_<state>.png`** — a state-specific sprite. Used for objects whose
   `states` machine causes them to look meaningfully different. The renderer
   falls back to `<kind>.png` if a specific state file is missing.

   ```
   oven_cold.png      ← oven idle, no fire
   oven_baking.png    ← fire lit, smoke
   oven_ready.png     ← fresh loaves visible

   cauldron_empty.png
   cauldron_brewing.png
   cauldron_ready.png

   well_full.png
   well_low.png

   notice_board.png   ← any state
   stove_cold.png
   stove_simmering.png
   stove_ready.png
   ```

## Specs

- **Size:** 32×32 (one tile).
- **Format:** PNG with transparency. No background colour.
- **Anchor:** the sprite is drawn aligned to the top-left of the tile, same
  as the procedural placeholders. Center your art in the 32×32 canvas; the
  sprite should "stand on the ground" of the tile.
- **Style:** loose — whatever fits your village. The placeholders are flat,
  simple, no outlines; the renderer doesn't care, it just blits the PNG.
