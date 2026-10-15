export { demoEditorAdapters } from './adapters/demo-adapters'
export type { EditorAdapters, EditorTag, EditorTagStorage, ImageUploadInput } from './adapters/editor-adapters'
export type {
  AddClozeInput,
  CardExtension,
  CardExtensionOptions,
  ClozeIdentity,
  CreateCardId,
  InsertBasicCardInput,
  SetCardDirectionInput,
  SetCardPresentationInput,
  SetHighlightInput,
} from './card/card-extension'
export { defineCardExtension } from './card/card-extension'
export type {
  BasicCardDirection,
  BasicEditorCardProjection,
  CardAnswerPresentation,
  CardBlockAttrs,
  CardDelimiterAttrs,
  CardPracticeDirection,
  ClozeEditorCardProjection,
  ClozeMarkAttrs,
  EditorCardProjection,
  EditorReadingItemProjection,
  HighlightColor,
  HighlightEditorCardProjection,
  InlineHighlightMarkAttrs,
  MultiLineCardItemProjection,
  MultiLineEditorCardProjection,
  ReviewCardProjection,
} from './card/card-model'
export { projectEditorCards, projectEditorReadingItems } from './card/card-model'
export type { CardPreviewItemSelection, CardPreviewMode, CardPreviewProps } from './card/card-preview'
export { CardPreview } from './card/card-preview'
export type {
  EditorCardRecord,
  EditorCardRepository,
  EditorCardSearchInput,
  ReplaceTopicCardsInput,
} from './card/card-repository'
export { createMemoryEditorCardRepository } from './card/card-repository'
export type {
  CardSurfaceItemSelection,
  CardSurfaceProps,
  CardSurfaceSide,
} from './card/card-surface'
export { CardSurface } from './card/card-surface'
export type {
  EditorCardIntegration,
  EditorCardSync,
  EditorCardSyncError,
} from './card/card-sync'
export { createEditorCardSync, EditorCardSyncClosedError } from './card/card-sync'
export { EditorMode } from './common/editor-mode'
export type { EditorModeName, EditorModeValue } from './common/editor-mode'
export type { EditorPlatform } from './common/editor-platform'
export type { EditorShortcutConfiguration, FormattingShortcutConfiguration } from './common/formatting-shortcuts'
export type { OutlineFocusTarget, OutlineOptions } from './common/outline-runtime'
export { Editor } from './editor'
export type { EditorFocusTarget, EditorLayout, EditorProps } from './editor'
export type {
  EditorContentRenderer,
  EditorExportMark,
  EditorExportNode,
  EditorTaskStatus,
  HtmlContentRendererOptions,
  TypstContentRendererOptions,
} from './export'
export { editorTaskStatus, renderEditorContent, renderHtmlContent, renderTypstContent, renderTypstTask, typstTaskPrelude } from './export'
export type {
  EditorImageOcclusionIntegration,
  ImageOcclusionCardProjection,
  ImageOcclusionMode,
  ImageOcclusionSnapshot,
  ImageOcclusionSource,
  ImageOcclusionSourceReference,
  ImageOcclusionState,
  OcclusionBoundsShape,
  OcclusionBrushShape,
  OcclusionShape,
  OpenImageOcclusionInput,
  ReaderRegionImageOcclusionSourceReference,
  TopicImageOcclusionSourceReference,
} from './image-occlusion/image-occlusion-model'
export {
  containOcclusionBoundsShape,
  imageOcclusionBoundsStrokeWidth,
  imageOcclusionBrushStrokeWidth,
  imageOcclusionColor,
  imageOcclusionPreviewColor,
  imageOcclusionSourceKey,
  imageOcclusionSourceObjectId,
  imageOcclusionStateSignature,
  minimumOcclusionShapeSize,
  projectImageOcclusionCards,
  scaleOcclusionBrushPoints,
  shouldRegroupImageOcclusionShapes,
  transformOcclusionBrushShape,
  translateOcclusionBrushShape,
} from './image-occlusion/image-occlusion-model'
export type {
  MarkdownImportDiagnostic,
  MarkdownImportFlavor,
  MarkdownImportOptions,
  MarkdownImportResult,
} from './import/markdown-import'
export { parseMarkdownImport } from './import/markdown-import'
export { JournalEditor } from './journal-editor'
export type { JournalEditorProps } from './journal-editor'
export {
  convertLatexAstToTypstAst,
  convertLatexToTypst,
  parseLatexMath,
  renderTypstMathAst,
} from './math/latex-to-typst'
export type {
  LatexMathNode,
  LatexToTypstDiagnostic,
  LatexToTypstResult,
  TypstMathAst,
} from './math/latex-to-typst'
export { cardTopicTitle, projectCardTopicCards, projectCardTopicDefinitions } from './note/card-topic-projection'
export type {
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
  CreateSpreadsheetTopicInput,
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
  EditorSpreadsheetTopicDocument,
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
  SpreadsheetTopicSnapshot,
  SpreadsheetTopicValidationInput,
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
} from './note/editor-note'
export { cloneEditorNote, createEditorNote } from './note/editor-note'
export { whiteboardSceneSignature } from './note/editor-note-whiteboard'
export type { ResolveJournalTopicOptions } from './note/journal-note'
export { resolveJournalTopic } from './note/journal-note'
export type { TopicBlockProjection } from './note/topic-projection'
export { projectTopicBlocks } from './note/topic-projection'
export { hasTopicUserContent } from './note/topic-user-content'
export { useEditorTopicMode } from './note/use-editor-topic-mode'
export type {
  WhiteboardLibraryDocument,
  WhiteboardLibraryElement,
  WhiteboardLibraryItem,
} from './note/whiteboard-library-document'
export {
  createWhiteboardLibraryDocument,
  whiteboardLibrarySchemaVersion,
} from './note/whiteboard-library-document'
export type {
  LoroBookTopic,
  LoroImageOcclusionTopic,
  LoroRegularTopic,
  LoroSpreadsheetTopic,
  LoroTopic,
  LoroTopicDocument,
  LoroTopicMarkType,
  LoroTopicNode,
  LoroTopicNodeType,
  LoroTopicValidation,
  LoroWhiteboardTopic,
} from './schema'
export {
  isLoroTopic,
  LoroBookTopicEntrySchema,
  LoroImageOcclusionTopicEntrySchema,
  LoroRegularTopicEntrySchema,
  LoroSpreadsheetTopicEntrySchema,
  LoroTopicDocumentSchema,
  LoroTopicEntrySchema,
  LoroTopicNodeSchema,
  LoroTopicSchema,
  LoroWhiteboardTopicEntrySchema,
  validateLoroTopic,
} from './schema'
