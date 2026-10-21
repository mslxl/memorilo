# Memorilo: knowledge and everyday action

This round retains the previous flat candidate 03 unchanged and adds three
flat candidates that account for scheduling and Todos alongside reading, notes,
journals, and learning.

## Additional source inspection

- `apps/desktop/renderer/src/features/todo/todo-page.tsx`: list, board, agenda,
  timeline, calendar, and quadrant views; today and upcoming task scopes.
- `docs/adr/0013-explicit-todo-schedule-and-shared-occurrence-projection.md`:
  explicit no-schedule, deadline, and time-span models; a shared projection
  powering the in-app calendar and external calendar feed.

The working product direction is a personal workspace for knowledge and action.
Spaced repetition is one feature, and neither a return arrow nor study cards
should define the whole brand.

## Candidates

| Label | Direction | Tradeoff |
| --- | --- | --- |
| A | Retained Knowledge Sprout | Broad growth metaphor; reading is explicit, planning is implicit. Unmodified previous candidate 03. |
| B | Grow and Do | Retains the accepted visual direction while linking note content with a completed action. |
| C | Daybook | Most explicit note/calendar and Todo metaphor; can read as a planner first. |
| D | Growing Check | Simple growth-and-progress mark; can read as a Todo app first. |

Candidate B is the closest development of the retained direction. The next
choice should consider whether a literal checkmark strengthens the brand or
makes the mark too specific to task completion.

## Deliverables

Editable SVGs and PNGs at 1024, 256, 64, and 32 pixels.
`comparison.png` includes the retained candidate and three alternatives.
`preview.html` provides a responsive gallery.

All graphics use solid fills or strokes. No gradients, shadows, or material
effects. No application source or packaging settings are changed.

Regenerate from the repository root:

```sh
node output/app-icons/render.mjs --workspace
```
