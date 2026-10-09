import type {
  BookFileBinding,
  BookReadingState,
  ReadingAnnotation,
  ReadingPosition,
} from '@memorilo/reading-model'
import type { Effect } from 'effect'
import type { LoroDoc, UndoManager as LoroUndoManager } from 'loro-crdt'
import type { NodeJSON } from 'prosekit/core'
import type { EditorModeValue } from '../common/editor-mode'
import type {
  ImageOcclusionSnapshot,
  ImageOcclusionSource,
  ImageOcclusionSourceReference,
  ImageOcclusionState,
} from '../image-occlusion/image-occlusion-model'
import type { LoroTopic } from '../schema/topic-schema'
import type { TopicBlockEdit } from './editor-note-block-edits'
import type { EditorNoteIdentity } from './journal-note-identity'
import type { TopicContentProjection } from './topic-projection'
import type { TopicReaderReference } from './topic-reader-reference'
import { EditorNoteCardTopics } from './editor-note-card-topics'
import { createEditorNoteCollaborationRuntime } from './editor-note-collaboration-runtime'
import { createEditorNoteEntryRepository } from './editor-note-entry-repository'
import { EditorNoteRuntime } from './editor-note-runtime'
import { EditorNoteTopics } from './editor-note-topic-documents'

export { resolveEditorTopicBinding } from './editor-note-topic-documents'
export type {
  TopicReaderReference,
  TopicReaderRegionSource,
  TopicReaderSource,
  TopicReaderTextSource,
} from './topic-reader-reference'

export type NoteEntryKind = 'folder' | 'topic'

interface NoteEntryBase {
  id: string
  ordinal: number
  parentId: string | null
}

export interface FolderSnapshot extends NoteEntryBase {
  kind: 'folder'
  name: string
}

interface TopicSnapshotBase extends NoteEntryBase {
  kind: 'topic'
  /** The effective title: the explicit title, or the first content line when it is empty. */
  title: string
}

export type CardTopicKind = 'basic' | 'cloze' | 'highlight' | 'list' | 'set'
export type CardTopicSyncStatus = 'detached' | 'synced'

export interface CardTopicSource {
  kind: CardTopicKind
  sourceId: string
  sourceTopicId: string
  syncStatus: CardTopicSyncStatus
}

export interface RegularTopicSnapshot extends TopicSnapshotBase {
  cardSource?: CardTopicSource
  mode: EditorModeValue
  readerReference?: TopicReaderReference
  topicType: 'regular'
}

export interface BookTopicSnapshot extends TopicSnapshotBase {
  book: BookFileBinding
  mode: EditorModeValue
  topicType: 'book'
}

export interface ImageOcclusionTopicSnapshot extends TopicSnapshotBase {
  topicType: 'image-occlusion'
}

export interface WhiteboardTopicSnapshot extends TopicSnapshotBase {
  topicType: 'whiteboard'
}

export type TopicSnapshot
  = | BookTopicSnapshot
    | ImageOcclusionTopicSnapshot
    | RegularTopicSnapshot
    | WhiteboardTopicSnapshot

export type NoteEntrySnapshot = FolderSnapshot | TopicSnapshot

export type { TopicContentProjection }

export type { TopicBlockEdit }

export interface ApplyTopicBlockEditsInput {
  edits: readonly TopicBlockEdit[]
  topicId: string
}

export interface EditorNoteChange {
  noteId: string
  update: Uint8Array
}

export interface EditorNoteMutation {
  entriesChanged: boolean
  metadataChanged: boolean
  topicIds: readonly string[]
}

export interface EditorNoteVersion {
  readonly counter: number
  readonly peer: `${number}`
}

export interface CreateFolderInput {
  /** The zero-based position among the parent's children. Appends when omitted. */
  index?: number
  name: string
  /** The containing Folder, or `null`/omitted for a root Folder. Topics are not valid parents. */
  parentId?: string | null
}

export interface CreateTopicInput {
  /** The zero-based position among the parent's children. Appends when omitted. */
  index?: number
  /** Initial ProseMirror content. A canonical empty document is created when omitted. */
  initialContent?: NodeJSON
  mode: EditorModeValue
  /** The containing Topic or Folder, or `null`/omitted for a root Topic. */
  parentId?: string | null
  /** A system-managed source shown above the Topic Editor. */
  readerReference?: TopicReaderReference
  /** An explicit title. Use an empty string to derive the effective title from the first content line. */
  title: string
}

export interface CreateBookTopicInput {
  book: BookFileBinding
  /** The zero-based position among the parent's children. Appends when omitted. */
  index?: number
  /** Initial ProseMirror content. A canonical empty document is created when omitted. */
  initialContent?: NodeJSON
  mode: EditorModeValue
  /** The containing Topic or Folder, or `null`/omitted for a root BookTopic. */
  parentId?: string | null
  /** An explicit, non-empty title independent from the publication title. */
  title: string
}

export interface CreateImageOcclusionTopicInput {
  /** The zero-based position among the source Topic's children. Appends when omitted. */
  index?: number
  snapshot: (source: ImageOcclusionSource) => Promise<ImageOcclusionSnapshot>
  source: ImageOcclusionSourceReference
  title: string
}

export interface CreateWhiteboardTopicInput {
  index?: number
  parentId?: string | null
  title: string
}

export interface CreateEmbeddedEditorInput {
  /** Initial ProseMirror content. A canonical empty document is created when omitted. */
  initialContent?: NodeJSON
  mode: EditorModeValue
}

export interface MoveNoteEntryInput {
  entryId: string
  index?: number
  parentId?: string | null
}

export type DeleteNoteEntryStrategy = 'delete-subtree' | 'promote-children'

export interface DeleteNoteEntryInput {
  entryId: string
  strategy: DeleteNoteEntryStrategy
}

export interface RegularTopicValidationInput {
  readonly document: NodeJSON
  readonly entry: unknown
}

export interface BookTopicValidationInput extends RegularTopicValidationInput {
  readonly annotations: unknown
  readonly readingState: unknown
}

export interface ImageOcclusionTopicValidationInput {
  readonly entry: unknown
  readonly state: unknown
}

export type TopicValidationInput
  = | BookTopicValidationInput
    | ImageOcclusionTopicValidationInput
    | RegularTopicValidationInput
    | WhiteboardTopicValidationInput

export interface EmbeddedEditorValidationInput {
  readonly document: NodeJSON
  readonly editorId: string
  readonly editorMode: EditorModeValue
}

export interface WhiteboardTopicValidationInput {
  readonly embeddedEditors: Readonly<Record<string, EmbeddedEditorValidationInput>>
  readonly entry: unknown
  readonly scene: unknown
}

export interface EditorTopicDocument {
  /** Stable identity of this editor document. */
  readonly documentId: string
  /** Returns the current editor mode stored in the Topic. */
  readonly getMode: () => EditorModeValue
  readonly noteId: string
  /** Changes the Topic's editor mode in the owning Note's LoroDoc. */
  readonly setMode: (mode: EditorModeValue) => void
  /** Subscribes to changes in the owning Note's LoroDoc. */
  readonly subscribe: (listener: () => void) => () => void
  readonly topicId: string
}

export interface EditorEmbeddedDocument extends EditorTopicDocument {
  readonly editorId: string
}

export interface EditorBookTopicDocument extends EditorTopicDocument {
  /** Returns a detached snapshot of the current concrete file binding. */
  readonly getBook: () => BookFileBinding
  /** Returns a detached snapshot of the current position and annotations. */
  readonly getReadingState: () => BookReadingState
  /** Rebinds to another concrete file of the same format without changing reading state. */
  readonly rebind: (book: BookFileBinding) => void
  /** Reconciles annotations by stable annotation ID. */
  readonly setAnnotations: (annotations: readonly ReadingAnnotation[]) => void
  /** Stores the current format-specific reading position. */
  readonly setPosition: (position: ReadingPosition) => void
}

export interface EditorImageOcclusionTopicDocument {
  readonly getState: () => ImageOcclusionState
  readonly noteId: string
  readonly setState: (state: ImageOcclusionState) => void
  readonly subscribe: (listener: () => void) => () => void
  readonly topicId: string
}

export type WhiteboardScene = Readonly<Record<string, unknown>>

export interface EmbeddedEditorSnapshot {
  readonly editorId: string
  readonly mode: EditorModeValue
}

export interface EditorWhiteboardTopicDocument {
  readonly createEmbeddedEditor: (input: CreateEmbeddedEditorInput) => string
  readonly deleteEmbeddedEditor: (editorId: string) => void
  readonly duplicateEmbeddedEditor: (editorId: string) => string
  readonly getEmbeddedEditor: (editorId: string) => EditorEmbeddedDocument
  readonly getEmbeddedEditors: () => readonly EmbeddedEditorSnapshot[]
  readonly getScene: () => WhiteboardScene
  readonly noteId: string
  readonly setScene: (scene: WhiteboardScene) => void
  readonly subscribe: (listener: () => void) => () => void
  readonly topicId: string
}

export type EditorOpenedTopic
  = | EditorImageOcclusionTopicDocument
    | EditorTopicDocument
    | EditorWhiteboardTopicDocument
/**
 * Owns a Note's authoritative in-memory LoroDoc and exposes Note-level editing operations.
 * Topic documents returned by `getTopic` are lightweight handles over this same LoroDoc.
 */
export interface EditorNote {
  readonly id: string
  /** Atomically applies validated structural Block edits to one Topic. */
  applyTopicBlockEdits: (input: ApplyTopicBlockEditsInput) => void
  /** Checks out a historical version and detaches the Note from its editable latest state. */
  checkout: (version: readonly EditorNoteVersion[]) => void
  /** Returns a time-traveling Note to its editable latest state. */
  checkoutLatest: () => void
  /** Creates a Folder and returns its stable entry ID. */
  createFolder: (input: CreateFolderInput) => string
  /** Atomically creates a BookTopic with editable content and initialized reading state. */
  createBookTopic: (input: CreateBookTopicInput) => string
  /** Creates the only ImageOcclusionTopic associated with one Topic image or BookTopic Reader region. */
  createImageOcclusionTopic: (input: CreateImageOcclusionTopicInput) => Promise<string>
  /** Atomically creates a whiteboard Topic with an empty scene. */
  createWhiteboardTopic: (input: CreateWhiteboardTopicInput) => string
  /** Atomically creates a Topic entry and its initialized content tree, then returns its stable entry ID. */
  createTopic: (input: CreateTopicInput) => string
  /** Deletes an entry using the requested child-handling strategy. */
  deleteEntry: (input: DeleteNoteEntryInput) => void
  /** Exports a complete snapshot of the current LoroDoc state. */
  exportSnapshot: () => Uint8Array
  /** Exports all updates, or only updates after the supplied version vector. */
  exportUpdates: (from?: readonly EditorNoteVersion[]) => Uint8Array
  /** Returns the current entry projection. Topic snapshots contain effective titles. */
  getEntries: () => readonly NoteEntrySnapshot[]
  /** Returns the aggregate-owned Note subtype identity. */
  getIdentity: () => EditorNoteIdentity
  /**
   * Returns an editable handle for an existing Topic in this Note.
   * The handle does not copy, synchronize, or persist the Topic.
   */
  getTopic: (topicId: string) => EditorTopicDocument
  /** Returns the reading handle for an existing BookTopic. */
  getBookTopic: (topicId: string) => EditorBookTopicDocument
  /** Returns the specialized state handle for an existing ImageOcclusionTopic. */
  getImageOcclusionTopic: (topicId: string) => EditorImageOcclusionTopicDocument
  /** Finds the unique ImageOcclusionTopic associated with one source image or Reader region. */
  findImageOcclusionTopic: (source: ImageOcclusionSourceReference) => EditorImageOcclusionTopicDocument | null
  /** Returns the scene and Embedded Editor handle for an existing WhiteboardTopic. */
  getWhiteboardTopic: (topicId: string) => EditorWhiteboardTopicDocument
  /** Returns the current block projection and effective title for an existing Topic. */
  getTopicContent: (topicId: string) => TopicContentProjection
  /** Returns the system-managed Reader source for a regular Topic, when present. */
  getTopicReaderReference: (topicId: string) => TopicReaderReference | null
  /** Returns the exact plain JavaScript object passed to Topic validation. */
  getTopicValidationInput: (topicId: string) => TopicValidationInput
  /** Validates a Topic's Loro entry and referenced content tree as one complete object. */
  validateTopic: (topicId: string) => Effect.Effect<LoroTopic, Error>
  /** Returns the Note title stored in the LoroDoc. */
  getTitle: () => string
  /** Returns whether this Note participates in learning. */
  getLearningEnabled: () => boolean
  /** Returns the current Loro version vector in a serializable form. */
  getVersion: () => readonly EditorNoteVersion[]
  /** Reports whether this aggregate contains semantic content beyond its initial unnamed root Topic. */
  hasUserContent: () => boolean
  /** Imports an idempotent Loro update and describes which projections became dirty. */
  importUpdates: (updates: Uint8Array) => EditorNoteMutation
  /** Reports whether the Note is currently checked out at a historical version. */
  isTimeTraveling: () => boolean
  /** Moves an entry within the Note entry tree. */
  moveEntry: (input: MoveNoteEntryInput) => void
  /** Renames an entry. Topic labels may be empty; Folder names must remain non-empty. */
  renameEntry: (entryId: string, label: string) => void
  /** Replaces, detaches, or removes the system-managed Reader source for a regular Topic. */
  setTopicReaderReference: (topicId: string, reference: TopicReaderReference | null) => void
  reconcileCardTopics: (input: { document: NodeJSON, topicId: string }) => CardTopicReconciliationResult
  /** Creates a CardTopic for an existing Highlight only when the user explicitly requests it. */
  createCardTopicFromHighlight: (input: { highlightId: string, sourceTopicId: string }) => string
  resyncCardTopic: (topicId: string) => void
  /** Replaces the non-empty Note title. */
  renameNote: (title: string) => void
  /** Gives copied learning identities fresh values while preserving Note-local identities. */
  remapLearningIdentities: () => void
  /** Rewrites resource-bearing values in the Note's authoritative documents. */
  rewriteResourceReferences: (rewrite: (source: string, key?: string) => string) => void
  /** Enables or disables learning for this Note. */
  setLearningEnabled: (enabled: boolean) => void
  /** Subscribes to locally generated Loro updates that callers should persist or transmit. */
  subscribe: (listener: (change: EditorNoteChange) => void) => () => void
}

export interface CardTopicReconciliationResult {
  detachedTopicId: string | null
}

export interface CreateEditorNoteOptions {
  /** The stable Note ID expected in restored data or assigned to a new Note. */
  id: string
  /** Creates the default Topic with this text as its first H1 Block. Only valid for a new Note. */
  initialTopicHeading?: string
  /** Creates this regular Topic as the only initial root entry. Only valid for a new Note. */
  initialTopic?: Omit<CreateTopicInput, 'index' | 'parentId'>
  /** Creates a BookTopic as the only initial root entry. Only valid for a new Note. */
  initialBookTopic?: Omit<CreateBookTopicInput, 'index' | 'parentId'>
  /** A previously exported Note snapshot. */
  snapshot?: Uint8Array | null
  /** The title for a new Note. Defaults to `Untitled` and is ignored when restoring. */
  title?: string
  /** Whether a new Note participates in learning. Defaults to enabled. */
  learningEnabled?: boolean
  /** Updates to import after the snapshot, or the complete history when no snapshot is supplied. */
  updates?: readonly Uint8Array[]
}

export interface EditorTopicBinding {
  documentId: string
  doc: LoroDoc
  tree: ReturnType<LoroDoc['getTree']>
  topicId: string
  undoManager: LoroUndoManager
}

/**
 * Creates a new Note or restores one from a snapshot and incremental updates.
 *
 * A new Note atomically contains one root Topic in Document mode. The default Topic has an
 * empty explicit title and either a canonical empty document or the requested initial H1, so
 * callers can immediately obtain it through `getEntries()` and pass `getTopic(topicId)` to the Editor.
 */
export function createEditorNote(options: CreateEditorNoteOptions): EditorNote {
  const runtime = EditorNoteRuntime.open(options)
  return createEditorNoteFromRuntime(runtime)
}

/** Creates an independent import copy while retaining the current semantic state. */
export function cloneEditorNote(options: CreateEditorNoteOptions, newId: string): EditorNote {
  return createEditorNoteFromRuntime(EditorNoteRuntime.clone(options, newId))
}

export function createJournalNote(journalDate: string, learningEnabled = true): EditorNote {
  return createEditorNoteFromRuntime(EditorNoteRuntime.openJournal(journalDate, learningEnabled))
}

function createEditorNoteFromRuntime(runtime: EditorNoteRuntime): EditorNote {
  const { doc, noteId: id } = runtime
  const entryRepository = createEditorNoteEntryRepository({
    runMutation: operation => runtime.runMutation(operation),
    runtime,
  })
  const topics = new EditorNoteTopics(runtime)
  const cardTopics = new EditorNoteCardTopics(runtime)
  const collaboration = createEditorNoteCollaborationRuntime({
    doc,
    noteId: id,
    onSubscriberError: error => console.error(`EditorNote ${id} subscriber failed`, error),
  })
  const note: EditorNote = {
    id,
    applyTopicBlockEdits: (input) => {
      topics.applyBlockEdits(input)
      const validation = topics.validationInput(input.topicId)
      if ('document' in validation)
        cardTopics.reconcile({ document: validation.document, topicId: input.topicId })
    },
    getTopic: topicId => topics.get(topicId),
    getBookTopic: topicId => topics.getBook(topicId),
    getImageOcclusionTopic: topicId => topics.getImageOcclusion(topicId),
    findImageOcclusionTopic: source => topics.findImageOcclusion(source),
    getWhiteboardTopic: topicId => topics.getWhiteboard(topicId),
    checkout: collaboration.checkout,
    checkoutLatest: collaboration.checkoutLatest,
    createFolder: entryRepository.createFolder,
    createBookTopic: entryRepository.createBookTopic,
    createImageOcclusionTopic: entryRepository.createImageOcclusionTopic,
    createWhiteboardTopic: entryRepository.createWhiteboardTopic,
    createTopic: entryRepository.createTopic,
    deleteEntry: entryRepository.deleteEntry,
    exportSnapshot: collaboration.exportSnapshot,
    exportUpdates: collaboration.exportUpdates,
    getEntries: entryRepository.getEntries,
    getIdentity: () => runtime.getIdentity(),
    getTopicContent: topicId => topics.content(topicId),
    getTopicReaderReference: entryRepository.getTopicReaderReference,
    getTitle: () => runtime.getTitle(),
    getLearningEnabled: () => runtime.getLearningEnabled(),
    getTopicValidationInput: topicId => topics.validationInput(topicId),
    validateTopic: topicId => topics.validate(topicId),
    getVersion: collaboration.getVersion,
    hasUserContent: entryRepository.hasUserContent,
    importUpdates: (updates) => {
      const mutation = collaboration.importUpdates(updates)
      runtime.getIdentity()
      return mutation
    },
    isTimeTraveling: collaboration.isTimeTraveling,
    moveEntry: entryRepository.moveEntry,
    renameEntry: entryRepository.renameEntry,
    renameNote: title => runtime.rename(title),
    remapLearningIdentities: () => topics.remapLearningIdentities(),
    rewriteResourceReferences: rewrite => topics.rewriteResourceReferences(rewrite),
    setLearningEnabled: enabled => runtime.setLearningEnabled(enabled),
    setTopicReaderReference: entryRepository.setTopicReaderReference,
    reconcileCardTopics: input => cardTopics.reconcile(input),
    createCardTopicFromHighlight: input => cardTopics.createFromHighlight(input),
    resyncCardTopic: topicId => cardTopics.resync(topicId),
    subscribe: collaboration.subscribe,
  }
  return note
}
