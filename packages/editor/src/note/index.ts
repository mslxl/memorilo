export { cardTopicTitle, projectCardTopicCards, projectCardTopicDefinitions } from './card-topic-projection'
export type {
  ApplyTopicBlockEditsInput,
  BookTopicSnapshot,
  BookTopicValidationInput,
  CardTopicKind,
  CardTopicReconciliationResult,
  CardTopicSource,
  CardTopicSyncStatus,
  CreateBookTopicInput,
  CreateEditorNoteOptions,
  CreateEmbeddedEditorInput,
  CreateFolderInput,
  CreateImageOcclusionTopicInput,
  CreateTopicInput,
  CreateWhiteboardTopicInput,
  DeleteNoteEntryInput,
  DeleteNoteEntryStrategy,
  EditorBookTopicDocument,
  EditorEmbeddedDocument,
  EditorImageOcclusionTopicDocument,
  EditorNote,
  EditorNoteChange,
  EditorNoteMutation,
  EditorNoteVersion,
  EditorOpenedTopic,
  EditorTopicDocument,
  EditorWhiteboardTopicDocument,
  EmbeddedEditorSnapshot,
  FolderSnapshot,
  ImageOcclusionTopicSnapshot,
  ImageOcclusionTopicValidationInput,
  MoveNoteEntryInput,
  NoteEntryKind,
  NoteEntrySnapshot,
  RegularTopicSnapshot,
  RegularTopicValidationInput,
  TopicBlockEdit,
  TopicContentProjection,
  TopicReaderReference,
  TopicReaderRegionSource,
  TopicReaderSource,
  TopicReaderTextSource,
  TopicSnapshot,
  TopicValidationInput,
  WhiteboardScene,
  WhiteboardTopicSnapshot,
  WhiteboardTopicValidationInput,
} from './editor-note'
export { cloneEditorNote, createEditorNote, createJournalNote } from './editor-note'
export { NOTE_SCHEMA_VERSION } from './editor-note-crdt'
export { whiteboardSceneSignature } from './editor-note-whiteboard'
export type { ResolveJournalTopicOptions } from './journal-note'
export { resolveJournalTopic } from './journal-note'
export type { EditorNoteIdentity } from './journal-note-identity'
export { journalDateFromNoteId, journalNoteId } from './journal-note-identity'
export type { TopicBlockProjection } from './topic-projection'
export { hasTopicUserContent } from './topic-user-content'
export type {
  WhiteboardLibraryDocument,
  WhiteboardLibraryElement,
  WhiteboardLibraryItem,
} from './whiteboard-library-document'
export {
  createWhiteboardLibraryDocument,
  whiteboardLibrarySchemaVersion,
} from './whiteboard-library-document'
