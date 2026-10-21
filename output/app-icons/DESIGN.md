# Memorilo application icon studies

These four candidates are original SVG artwork with PNG exports. The built-in
ImageGen calls for the first two directions failed with HTTP 404 because the
configured image model was unavailable. No image API CLI was used.

## Product basis

The current repository describes a local desktop workspace for reading, notes,
and spaced repetition. Its incremental learning workflow turns source reading
and annotations into notes and review cards.

Files inspected:

- `README.md`: reading, rich notes, journals, cards, whiteboards, and spreadsheets.
- `CONTEXT.md`: BookTopic, CardTopic, Reading Item, and Incremental Learning.
- `apps/desktop/renderer/src/app/shell/workspace-sidebar.tsx`: primary navigation.
- `apps/desktop/renderer/src/features/learning/learning-page.tsx`: review entry.
- `apps/desktop/renderer/src/features/notes/editor/note-editor.stylex.ts`: editor layout.
- `apps/desktop/renderer/src/features/reader/reader-page.stylex.ts`: reader layout.
- `packages/ui/src/theme.stylex.ts`: semantic tokens and three theme families.
- `docs/research/apple-liquid-glass-macos.md`: existing visual research.
- `apps/desktop/electron-builder.yml`: desktop targets and current icon configuration.

UI observations are based on source inspection. A live application was not
launched for this exercise.

## Directions

| Candidate | Meaning | Visual decision |
| --- | --- | --- |
| 01 Folded M | Memorilo + open pages + capture | Emerald folded M on warm ivory. Strongest candidate for a lasting brand mark. |
| 02 Recall Cards | Extracted notes returning for review | Ivory card stack, bold return symbol, terracotta tile. Most explicit learning metaphor. |
| 03 Knowledge Sprout | Reading that accumulates into knowledge | Opaque book pages and new leaves, moss green tile. Warmest and most approachable. |
| 04 Memory Loop | Repeated learning over time | Continuous copper ribbon on graphite. Most abstract and compact. |

All four use opaque materials, strong silhouettes, rounded square containers,
and transparent outer canvases. No blue backgrounds or translucent glass.
The icon palette is an exploration rather than a change to application theme
tokens.

## Deliverables and reproduction

- Each candidate has an editable SVG and a 1024px PNG.
- Additional PNG exports at 256px, 64px, and 32px support size comparisons.
- `comparison.png` is a four-column review sheet.
- `preview.html` is a responsive local gallery with links to source files.
- `render.mjs` exports assets using the repository's existing Sharp dependency.

Run from the repository root:

```sh
node output/app-icons/render.mjs
```

The SVGs are the source of truth. The candidates are not wired into the
application packaging.

## Prompt set for subsequent image-generation exploration

These prompts record the intended directions. They are not evidence of
successful AI image generation. The delivered images come from the SVG sources.

### 01 Folded M

Use case: logo-brand.
Asset type: one square desktop application icon for Memorilo.
Product: a local reading, rich note taking and spaced repetition study app.
Subject: two upright folded book pages form an uppercase M silhouette and an
open-book emblem, with a clean negative-space valley and a pale interior fold.
Composition: frontal, centered, one coherent symbol spanning 60% of an opaque
warm ivory rounded square tile; tile occupies 88% of the canvas.
Style: restrained macOS productivity icon, shallow sculptural depth, subtle
bevels, soft light, opaque paper or ceramic.
Palette: emerald #286747, ivory #F5F0E6, pale sage fold.
Constraints: readable at 32px; square 1024px PNG; transparent outside the tile;
no text, thin lines, tiny page details, blue, purple, translucent glass, brain,
sparkle, pencil, watermark, or existing brand logo.

### 02 Recall Cards

Use case: logo-brand.
Asset type: one square desktop application icon for Memorilo.
Subject: three substantial ivory study cards in a compact offset stack;
front card almost upright and prominent, carrying one thick terracotta return
symbol to represent active recall.
Composition: frontal, centered, large opaque rounded square terracotta tile
occupying 88% of the canvas.
Style: precise macOS icon finish, opaque paper-like ceramic, shallow depth,
broad shapes, soft restrained shadows.
Palette: terracotta #BD563C to #D6784F, ivory #FFF2D8, dark brick symbol.
Constraints: readable at small dock size; square 1024px PNG; transparent outside
the tile; no text, tiny details, blue, purple, glass, stars, brains, checkmarks,
pencils, or watermark.

### 03 Knowledge Sprout

Use case: logo-brand.
Asset type: one square desktop application icon for Memorilo.
Subject: an open ivory book with two large sage leaves emerging from its
central gutter, suggesting knowledge gained through incremental learning.
Composition: centered, frontal, balanced negative space, one opaque moss green
rounded square tile occupying 88% of the canvas.
Style: simple tactile paper or ceramic shapes, soft shallow depth, precise
curves, warm and calm rather than cartoonish.
Palette: moss #63836C and #304D3D, ivory #FFF6DD, pale sage #CDDDB0.
Constraints: readable at 32px; square 1024px PNG; transparent outside tile;
no lettering, veins, decorative writing, soil, extra plants, blue, purple,
translucent glass, watermark, or existing brand logo.

### 04 Memory Loop

Use case: logo-brand.
Asset type: one square desktop application icon for Memorilo.
Subject: a single thick continuous copper ribbon tracing a compact infinity
loop, with a precise over-under crossing, symbolizing repeated learning.
Composition: centered frontal view; large horizontal emblem; opaque graphite
rounded square tile occupying 88% of the canvas.
Style: original geometric brand mark, subtle bevel and shallow relief,
restrained material shading, broad silhouette.
Palette: graphite #1C211F to #373A36, copper #D99161 to #F5C99A.
Constraints: readable at 32px; square 1024px PNG; transparent outside tile;
no lettering, ornament, chain links, blue, purple, transparent glass, sparkle,
watermark, or existing brand logo.
