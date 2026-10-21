# Note Transfer Interaction Proposal

Status: accepted

Question: Are the entry points, cancellation boundaries, and import conflict flow predictable enough to become the implementation contract?

Interactive state prototype: [note-transfer.html](note-transfer.html). It simulates native dialogs and asynchronous completions; it does not read files, generate PDFs, or mutate Notes. The prototype is kept next to this decision ticket as a planning asset, not in production routes.

## Entry Points

- Add one `FileDown` icon menu to the Note titlebar trailing slot: HTML and Memo PDF. Memo PDF is saved as `<title>.memo.pdf`, a readable PDF with the re-importable `.memo` archive embedded; it exports the whole Note, including when a Whiteboard hides the text title. Topic context menus remain Topic-scoped.
- Add the same export submenu to the Library's single-Note context menu, using the clicked Note ID rather than the last active editor.
- Keep one Library `FileUp` button labelled “Import…”. It opens one native picker accepting `.memo`, `.md`, and `.markdown`; after selection, the application chooses the import workflow. A `.memo` file always receives strict Memo validation and never falls back to Markdown after a parse error. Markdown extensions continue through the existing Markdown preview/options flow. Other extensions are rejected as unsupported.
- Register format-specific export commands for the active Note and one global Note import command in the existing command palette. No additional shortcut is assigned by default. Native File-menu parity is deferred; the current menu lacks a general Note command bridge.
- Journal export always has an explicit target date/Note. Disable the command when no persisted target exists; do not create an empty Journal merely to export it.

## Export Flow

Choose HTML or Memo PDF -> flush pending Note changes -> capture a validated, immutable Note snapshot -> resolve resources and serialize/compile (and, for Memo PDF, create and embed the Memo archive) -> review degradation warnings when present -> native save dialog -> atomic file save -> completion feedback.

The snapshot is fixed after flushing; subsequent edits stay in the Note and do not change an in-progress export. Main coordinates the existing save handshake for relevant live editors, including exports started from the Library. Save failure offers retry without exporting an older snapshot silently.

Show meaningful stages (saving changes, preparing resources, generating PDF, saving file), never invented percentages. One transfer operation per owning window is sufficient initially; duplicate triggers are disabled in both UI and main. Editing/navigation may continue after snapshot capture. The transfer UI belongs to the window-level feature host so changing routes does not discard progress or retarget an operation.

Allow cancellation during preparation/compilation and before final commit. Main owns cancellation; a compiler job runs outside the main event loop in a terminable worker/process. Native dialogs use their own cancel action. During final rename/import transaction, show a brief non-cancellable finishing stage. A cancel that loses the race to commit returns the actual saved/imported result, never a false cancellation.

Resources that degrade show a count and an expandable list keyed by Topic/block, with continue/cancel before saving. HTML uses local inline assets where available; PDF uses Typst resource bytes. Compilation errors stop the export. Success shows a compact notification; warning results remain available in details. No automatic file opening or route change after export. Dialog cancellation has no error toast.

## Memo Import Flow

The single native picker classifies the selected file before showing a format-specific confirmation. `.memo` proceeds through: read and fully preflight into an immutable in-memory candidate -> confirmation -> atomic commit -> open imported Note. `.md` and `.markdown` proceed through the existing Markdown parser and options dialog. The user does not choose an importer from a menu.

Display file name, Note title/type, and Journal date if present. Follow the recorded Regular Note copy policy in [Memo identity](../issues/01-memo-import-identity.md): a unique editable title and reassigned NoteID, with the source title used as the suggested title only when available. ID conflict explicitly offers “Import as independent copy”; it is never described as merely renaming the title. The prototype uses a fixed example ID for visibility; production generates it in main.

Journal confirmation has no title/date editing or copy option. Date or ID collision is a hard refusal. Invalid/unsupported files fail before database mutation. Import rechecks title/identity constraints in the transaction; a race returns a structured conflict, leaving the candidate available for correction where allowed.

After commit, refresh affected Library/Journal/search state. Open a Regular Note using the returned Note ID and valid initial Topic ID (`/note/$noteId/$topicId`); an empty Note uses the existing empty-note navigation policy rather than inventing a Topic. Open a Journal using `/journals?date=...`. Flush any current editor before navigation. Cancel/failure leaves the current route intact. Imported review history/Learning State remains excluded.

## API Boundary

Proposed operations on the existing `@memorilo/desktop-api` contextual request surface:

```ts
type ExportFormat = 'memo' | 'html' | 'pdf'

startNoteExport({ noteId, format }): { operationId }
prepareNoteImport(): { status: 'cancelled' } | { operationId }
getNoteTransfer({ operationId }): TransferState
continueNoteTransfer({ operationId, decision }): TransferState
cancelNoteTransfer({ operationId }): TransferState
```

`TransferState` is a discriminated union for preparing, detected Markdown/Memo format, awaiting warning acceptance, import confirmation/conflict, choosing destination, committing, saved/imported, cancelled, and failed. `decision` allows only the action valid at that phase (accept warnings or confirm import with a Regular Note title); it cannot supply arbitrary paths, source, replacement IDs, PDF bytes, or compiler settings.

Use bounded polling of `getNoteTransfer` while active through the existing query layer, stopping on terminal state/unmount; avoid a new preload subscription transport just for this flow. Keep the operation in the window-level host across route changes. Main binds opaque IDs and prepared candidates to the sender, rejects cross-window access, expires inactive confirmation candidates, and releases active work when the owner closes. Expiry returns a typed status that asks the user to select the file again.

Typed errors include invalid-file, unsupported-version, projection-failed, resource-failed, compile-failed, title-conflict, journal-conflict, save-failed, busy, and expired. Domain errors carry codes/diagnostics; localized messages are composed in the renderer. The final commit always validates the authoritative candidate and current constraints. The exact storage/asset transaction is a separate persistence decision, not implemented by this UI prototype.

## Accessibility And Locale

Use `@memorilo/ui` menus/dialogs, Lucide FileUp/FileDown, localized tooltips/accessible names, and `data-window-no-drag` on titlebar controls. Menus support arrows/Enter/Escape; dialogs trap focus and restore it to the trigger or an appropriate fallback after navigation. Associate title validation with its field, announce stage changes politely, and announce blocking errors without moving focus unexpectedly.

Use existing opaque semantic surfaces. No new motion is necessary; any existing transitions respect reduced motion. Add transfer strings to the owning locale namespace in every supported language, with CLDR plural keys for warning counts. The prototype's state/scenario controls are review aids, not proposed production UI.

## Local References

- [Library titlebar import control](../../../../apps/desktop/renderer/src/features/notes/library/note-library-view.tsx)
- [Note titlebar composition](../../../../apps/desktop/renderer/src/features/notes/editor/note-editor-view.tsx)
- [Note persistence hooks](../../../../apps/desktop/renderer/src/features/notes/persistence/note-persistence-hooks.ts)
- [Native application menu](../../../../apps/desktop/main/src/application-menu.ts)
- [Existing route navigation](../../../../apps/desktop/renderer/src/routes/pages.tsx)
