# Memorilo flat icon studies

Four flat revisions of the original icon candidates, following the user's
request for a flat visual style. Original candidates remain in the parent
directory.

## Visual rules

- Solid color fills and strokes.
- No gradients, shadows, highlights, bevels, textures, or translucent materials.
- Two colors per icon, except the card stack which uses three.
- Simple silhouettes with a transparent canvas outside the rounded square.
- Original vector sources, not AI-generated raster edits.

## Candidates

1. Page M: one emerald M/open-page silhouette on ivory.
2. Recall Cards: two offset cards and a bold return symbol on terracotta.
3. Knowledge Sprout: ivory book and leaves on moss green.
4. Memory Loop: one apricot loop on graphite.

Each candidate includes an SVG and PNGs at 1024, 256, 64, and 32 pixels.
`comparison.png` and `preview.html` show all four directions with light and dark
small-size previews.

Regenerate this edition from the repository root:

```sh
node output/app-icons/render.mjs --flat
```

The renderer checks that flat SVGs contain no gradient, filter, opacity, or
paint-server styling. Application packaging is unchanged.
