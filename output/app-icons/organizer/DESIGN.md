# Personal organizer: redesign

The calendar-and-book composites were rejected as unclear or cluttered and too
calendar-led. This round uses one recognizable object: a personal organizer.
The object can contain knowledge, notes, daily plans, and task lists.

This is one direction with three silhouettes, rather than another assortment
of feature symbols.

## Design choices

- A bound notebook/organizer is the primary silhouette.
- Section tabs, bindings, and a bookmark belong to the same physical object.
- Scheduling and tasks are considered through the planner/organizer metaphor.
  Calendar or clock recognition is intentionally no longer the main identifier.
- This tradeoff means explicit scheduling is less immediate; the object reads
  as a notebook or planner rather than a date-specific calendar.
- No independent plants, checkmarks, clocks, date grids, or feature badges.
- Two solid colors, shallow detail, and no gradients or effects.

## Three silhouettes

1. Indexed Journal: a closed organizer with a spine, three section tabs, and an
   inset bookmark. One compact object with an empty cover.
2. Bound Planner: three bindings and three broad content rows, referencing an
   everyday notebook for recording and arranging work.
3. Open Organizer: two mirrored pages, paired side tabs, and one bookmark at
   the binding. Most visibly connected to the earlier book direction.

The original retained Knowledge Sprout remains available. No candidate has
been selected for application packaging.

## Deliverables

SVG sources, PNGs at 1024, 256, 64, and 32 pixels, a comparison image, and a
responsive preview page.

Regenerate from the repository root:

```sh
node output/app-icons/render.mjs --organizer
```
