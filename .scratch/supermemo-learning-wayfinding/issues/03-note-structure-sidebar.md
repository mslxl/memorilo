# Note Structure Sidebar Navigation

Type: prototype
Status: resolved

## Question

What is the contract for the navigable Note Structure sidebar beside Learning?

Decide through a concrete interaction prototype or wireframe:

- which NoteEntry kinds appear (Folder, Topic, CardTopic, BookTopic, and other special Topics);
- how the active learning source, current Card/Item, detached CardTopic, and unavailable entries are represented;
- whether clicking an entry switches the learning queue, opens the source editor, or only changes context;
- how expansion, collapse, keyboard navigation, typeahead, and focus return work;
- what happens to an in-progress edit, pending save, revealed answer, and rating history when navigation changes;
- how the sidebar behaves at narrow widths and under reduced motion.

The result must preserve Note hierarchy semantics and identify the public component/module seam without moving feature-specific domain behavior into `packages/ui` prematurely.

## Prototype

The selected Variant B in [learning-workspace.html](../prototype/learning-workspace.html) is the interaction reference for the rail, including active-row highlighting, collapse behavior, and narrow-width fallback.

## Answer

The Learning workspace includes a feature-owned navigable Note Structure rail. It reuses the existing `NoteEntrySnapshot` projection and public `Sidebar` primitives, but does not reuse the full NoteInspector mutation/context-menu surface.

- The rail displays all entries in the current Note hierarchy: Folder, RegularTopic, CardTopic, BookTopic, ImageOcclusionTopic, and WhiteboardTopic. Icons and status markers distinguish entries that do not have a compatible editable learning surface.
- Folder rows only expand/collapse. Clicking a Topic or CardTopic switches the learning context inside the current Learn workspace; it does not leave to the normal Note editor. Special Topics without a compatible surface expose their status or use an explicit destination action for their existing editor/reader surface. The rail never silently changes global scope or crosses into another Note.
- The rail uses dual state markers: one strong active state for the current learning object (Reading Item or Review Target), and one lighter source marker for the Topic/CardTopic containing the source Highlight. Processing state, due status, detached state, and unavailable state are represented with accessible text/icon/badge semantics, not color alone.
- Before navigation, the current editor is flushed through the existing persistence boundary. A successful flush permits immediate navigation without a save-confirmation dialog. A failed flush blocks navigation, retains focus/context, and shows the error in the rail and learning status. No local draft store is introduced.
- On narrow windows, the right rail becomes a collapsible sheet/overlay opened from a structure control. It does not permanently compress the reading canvas; dismissing it returns focus to the trigger, and reduced motion uses a short opacity/state transition.
- Keyboard navigation, disclosure state, `aria-current`/selected semantics, focus return, and live updates from Note collaboration are part of the feature contract. The sidebar must remain stable while the editor is mounted and must not remount content merely to change selection.

This resolves the sidebar interaction decision. Production work requires focused tests for full-entry projection, folder disclosure, Topic/CardTopic context switching, dual active/source markers, flush failure blocking navigation, concurrent entry updates, keyboard focus return, and narrow-sheet behavior.
