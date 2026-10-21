# SuperMemo-style Incremental Learning Workspace

Label: wayfinder:map

## Destination

Produce an execution-ready specification and ordered implementation ticket set for replacing Memorilo's current read-only Learning Review workflow with a SuperMemo-style incremental learning workspace. The destination includes editable Topic/Item learning, interleaved reading and active recall, durable content/provenance semantics, and a navigable Note Structure sidebar beside the learning surface.

The map is complete when the remaining product, domain, migration, interaction, and acceptance decisions are explicit. It does not implement the feature unless a later ticket explicitly carries execution.

## Notes

Domain: desktop renderer learning workflow, editor/CardTopic model, Note hierarchy, persistence and migration.

Consult `domain-modeling` when terms such as Incremental Learning, Reading Item, Topic, Item, Card, or Note Structure become canonical; consult `grilling` for human decisions; consult `prototype` for interaction and layout questions; consult `codebase-design` for module seams; consult `apple-design` for the learning workspace, sidebar, focus, motion, and reduced-motion behavior.

The user selected: complete SuperMemo-style incremental learning; a navigable Note Structure sidebar; direct writeback to the source Topic; and permission for a destructive migration. Existing FSRS history, CardID, and Review Event compatibility are not a requirement, but the migration must still state what is intentionally discarded and how the app recovers from stale or malformed data.

Do not add a compatibility layer or forward-compatibility path unless a ticket proves it is needed. Do not add tests as a separate scope item; include focused verification in implementation acceptance. Do not commit code as part of charting this map.

## Decisions so far

<!-- Closed tickets are appended here as the map advances. Open tickets are discovered from issues/. -->

- [Learning Model and Interleaved Queue](issues/01-learning-model-and-queue.md): Reading Items explicitly opt in, reference existing Highlights by stable Block/Highlight identity without copying Blocks, interleave with FSRS Review Targets under a fair hard-due-first queue, and cascade-delete with their Highlight; this supersedes the earlier copy-Block assumption and conflicts with ADR 0006's automatic Highlight→CardTopic rule.
- [Editable Learning Interaction Contract](issues/02-editable-learning-interaction.md): Choose the reading-first Variant B layout with a right Note Structure rail; editing is always available and auto-saved, but content edits/navigation never reschedule, while explicit semantic learning actions advance Reading Item processing.
- [Note Structure Sidebar Navigation](issues/03-note-structure-sidebar.md): Show the complete current Note hierarchy in a feature-owned right rail; Topic/CardTopic clicks switch context in Learn, active learning/source states are dual-marked, navigation flushes and blocks on save failure, and narrow screens use a focus-returning sheet.
- [Destructive Learning Migration Boundary](issues/04-destructive-migration-boundary.md): Because the feature is unreleased, modify Learning schema/contracts directly with no migration, compatibility path, version bump, startup warning, or automatic database deletion; preserve Note content and fail visibly if initialization cannot use the edited schema.
- [Implementation Sequence and Acceptance Criteria](issues/05-implementation-sequence-and-acceptance.md): Execute domain/ADR, storage/queue, editor projection, main/preload, renderer workspace, then E2E verification in order; directly reshape unreleased Learning data, replace `/learning/review`, and require layered tests for Highlight-as-Extract, scheduling separation, sidebar navigation, and failure behavior.

## Not yet specified

None. The implementation sequence, ownership boundaries, destructive development policy, ADR update, and acceptance gates are specified in issues 01–05.

## Resolution

All decision tickets are resolved. The map is complete and execution can begin; ADR 0006 has been updated to record the Highlight-as-Extract boundary.

## Out of scope

- Preserving or synchronizing the existing FSRS/CardTopic learning history when the migration decision intentionally discards it.
- Implementing SuperMemo's proprietary algorithm as an exact replacement before the new product model is specified.
- Unrelated changes to general Note editing, reader, whiteboard, or sync behavior except where the new learning workspace needs an explicit integration seam.
- Cloud synchronization, remote SuperMemo import, or third-party plugin support.
