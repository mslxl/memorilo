# New directions: balanced forms

The single-leaf refinements were rejected for poor visual balance. This round
explores a new graphic vocabulary based on broad paired or symmetrical forms.
The previously retained Knowledge Sprout remains unchanged.

## Shared rules

- The same solid moss-green tile and ivory mark across all four candidates,
  so the comparison focuses on form.
- One dominant composition per icon.
- Mirror symmetry or rotational symmetry; no isolated corner decoration.
- No separate leaves, checkmarks, calendar details, or feature badges.
- Flat fills only, with a transparent canvas outside the tile.

## Candidates

1. Open Pages: a broad mirrored pair of pages, referencing notes and a personal
   space for information. Familiar and quiet, with limited brand distinctiveness.
2. Paired Folios: two opposing clipped pages, a less literal brand mark for
   connected information and activity. Rotational symmetry keeps weight centered.
3. Gather: four equal page-like forms arranged around one center, suggesting a
   workspace that brings different activities together. Exact rotational symmetry.
4. Open M: a symmetrical initial for Memorilo with generous interior openings.
   The initial accommodates the product's full scope without a feature symbol.

The renderer prints the centroid of fully filled ivory pixels as a geometric
diagnostic. Geometric centering supports visual review but does not itself prove
perceptual balance.

Open Pages is shifted down by 3px and Open M by 16px to compensate for their
upper-weighted filled area. The paired and rotational marks remain centered
without offsets.

## Deliverables

Each candidate includes its SVG and PNGs at 1024, 256, 64, and 32 pixels.
`comparison.png` and `preview.html` show all four, including small-size previews
on light and dark surfaces.

Regenerate from the repository root:

```sh
node output/app-icons/render.mjs --balanced
```
