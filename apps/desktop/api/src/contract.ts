import type { DesktopConfiguration } from '@memorilo/desktop-config/contract'
import type {
  LearningQueueItem,
  LearningStorage,
  ListLearningQueueInput,
  ListTodoTasksInput,
  TodoCalendarEvent,
  TodoCalendarSubscription,
  TodoReminder,
  TodoRepeatRule,
  TodoSchedule,
  TodoTask,
  TodoTaskPage,
  TodoTaskStatus,
} from '@memorilo/editor-storage'
import type { ReviewCardProjection } from '@memorilo/editor/card'
import type { WhiteboardLibraryItem } from '@memorilo/editor/note'
import type { BookFileBinding, BookReadingState } from '@memorilo/reading-model'
import type {
  AddShelfSourceInput,
  BrowseShelfInput,
  OpenShelfReadingInput,
  PreparedShelfReading,
  PrepareShelfReadingInput,
  ShelfAssetInput,
  ShelfAssetResult,
  ShelfBrowseResult,
  ShelfPublicationDetails,
  ShelfPublicationDetailsInput,
  ShelfReadingDocument,
  ShelfReadingRangeInput,
  ShelfSource,
  UpdateShelfSourceInput,
} from '@memorilo/shelf'

export type { DesktopConfiguration } from '@memorilo/desktop-config/contract'
export type {
  AddShelfSourceInput,
  BrowseShelfInput,
  OpenShelfReadingInput,
  PreparedShelfReading,
  PrepareShelfReadingInput,
  ShelfAssetInput,
  ShelfAssetResult,
  ShelfBrowseResult,
  ShelfPublicationDetails,
  ShelfPublicationDetailsInput,
  ShelfReadingDocument,
  ShelfReadingRangeInput,
  ShelfSource,
  UpdateShelfSourceInput,
} from '@memorilo/shelf'

export interface CaptureDesktopReaderRegionInput {
  height: number
  width: number
  x: number
  y: number
}

export interface SaveDesktopImageInput {
  data: Uint8Array
  fileName: string
  mimeType: string
}

export interface SaveDesktopImageResult {
  src: string
}

export interface ImportDesktopNetworkImageInput {
  source: string
}

export interface DesktopAssetCandidate {
  byteSize: number
  fileName: string
  originalFileName: string
}

export interface DesktopMissingAsset {
  fileName: string
  originalFileName: string
  referenceCount: number
}

export interface DesktopAssetCheckResult {
  candidates: readonly DesktopAssetCandidate[]
  managedAssetCount: number
  missingAssets: readonly DesktopMissingAsset[]
  referencedAssetCount: number
}

export interface DesktopExportDatabaseResult {
  path: string
}

export type DesktopNoteExportFormat = 'memo' | 'pdf'

export type DesktopNoteTransferPhase
  = | 'preparing'
    | 'markdown'
    | 'saved'
    | 'imported'
    | 'cancelled'
    | 'failed'

export interface DesktopNoteTransferError {
  code: string
  message: string
}

export type DesktopNoteTransferState
  = | {
    format: DesktopNoteExportFormat
    kind: 'export'
    operationId: string
    phase: 'preparing'
  }
  | {
    format: DesktopNoteExportFormat
    kind: 'export'
    operationId: string
    phase: 'saved'
    result: Extract<DesktopNoteExportResult, { status: 'saved' }>
  }
  | {
    error: DesktopNoteTransferError
    format: DesktopNoteExportFormat
    kind: 'export'
    operationId: string
    phase: 'failed'
  }
  | {
    format: DesktopNoteExportFormat
    kind: 'export'
    operationId: string
    phase: 'cancelled'
  }
  | {
    kind: 'import'
    operationId: string
    phase: 'preparing'
  }
  | {
    fileName: string
    kind: 'import'
    operationId: string
    phase: 'markdown'
    source: string
  }
  | {
    kind: 'import'
    operationId: string
    phase: 'imported'
    result: Extract<DesktopNoteImportResult, { status: 'imported' }>
  }
  | {
    error: DesktopNoteTransferError
    kind: 'import'
    operationId: string
    phase: 'failed'
  }
  | {
    kind: 'import'
    operationId: string
    phase: 'cancelled'
  }

export interface DesktopNoteTransferStart {
  operationId: string
}

export type DesktopNoteTransferDecision = { kind: 'cancel' } | { kind: 'acknowledge' }

export interface DesktopExportDiagnostic {
  code: string
  fallback?: string
  kind?: string
  message: string
  path?: string
  reason?: string
  severity: 'error' | 'warning'
}

export type DesktopNoteExportResult
  = | {
    diagnostics: readonly DesktopExportDiagnostic[]
    path: string
    status: 'saved'
  }
  | { status: 'cancelled' }

export type DesktopNoteImportResult
  = | {
    journalDate?: JournalDate
    kind: 'journal' | 'regular'
    noteId: string
    title: string
    status: 'imported'
  }
  | {
    fileName: string
    source: string
    status: 'markdown'
  }
  | { status: 'cancelled' }

export type DesktopRestoreDatabaseResult
  = | { status: 'cancelled' }
    | { status: 'restarting' }

export interface ReclaimDesktopAssetsInput {
  fileNames: readonly string[]
  mode: 'permanent' | 'trash'
}

export interface ReclaimDesktopAssetsResult {
  cancelled: boolean
  failedFileNames: readonly string[]
  reclaimedFileNames: readonly string[]
}

export interface DesktopReviewTarget {
  itemBlockId: string | null
  targetId: string
}

export interface DesktopReviewItem {
  card: ReviewCardProjection
  mainTargetId: string
  noteTitle: string
  queue: LearningQueueItem
  targets: readonly DesktopReviewTarget[]
  topicTitle: string
  updatedAt: number
}

export type GetNextDesktopReviewItemInput = Omit<ListLearningQueueInput, 'limit' | 'mode'>

export type DesktopTodoTaskStatus = TodoTaskStatus
export type DesktopTodoTask = TodoTask
export type DesktopTodoTaskPage = TodoTaskPage
export type DesktopTodoReminder = TodoReminder
export type DesktopTodoRepeatRule = TodoRepeatRule
export type DesktopTodoSchedule = TodoSchedule
export type DesktopTodoCalendarEvent = TodoCalendarEvent
export interface DesktopTodoCalendarSubscription extends TodoCalendarSubscription {
  builtIn: boolean
}
export type ListDesktopTodoTasksInput = ListTodoTasksInput

export interface UpdateDesktopTodoTaskInput {
  schedule?: DesktopTodoSchedule
  blockId: string
  nextDueDate?: string | null
  noteId: string
  onlyThis?: boolean
  reminderMinutes?: number | null
  reminders?: readonly DesktopTodoReminder[] | null
  repeatRule?: DesktopTodoRepeatRule | null
  status?: DesktopTodoTaskStatus
  text?: string
  topicId: string
}

export interface CreateDesktopTodoTaskInput {
  schedule?: DesktopTodoSchedule
  text: string
}

export interface SubscribeDesktopTodoCalendarInput {
  title: string
  url: string
}

export interface DesktopTodoCalendarFeed {
  expiresAt: number | null
  url: string | null
}

export interface RestoreDesktopReviewItemInput {
  cardId: string
  noteId: string
  presentation: LearningQueueItem['presentation']
  targetId: string
  topicId: string
}

interface DesktopLearningStorageApi {
  archiveOptimizer: LearningStorage['optimizers']['archive']
  assignNoteOptimizer: LearningStorage['optimizers']['assignToNote']
  createOptimizer: LearningStorage['optimizers']['create']
  getActivitySummary: LearningStorage['queue']['getActivitySummary']
  getDailyProgress: LearningStorage['queue']['getDailyProgress']
  getLearningState: LearningStorage['reviews']['getState']
  getMaintenanceEstimate: LearningStorage['maintenance']['getEstimate']
  getNextLearningKind: LearningStorage['queue']['nextKind']
  getNoteOptimizer: LearningStorage['optimizers']['getForNote']
  getOptimizer: LearningStorage['optimizers']['get']
  getOptimizerNoteCount: LearningStorage['optimizers']['getNoteCount']
  listNotesWithCards: LearningStorage['cards']['listNotesWithCards']
  listOptimizers: LearningStorage['optimizers']['list']
  listQueue: LearningStorage['queue']['list']
  listTargets: LearningStorage['cards']['listTargets']
  listReadingItems: LearningStorage['readingItems']['list']
  processReadingItem: LearningStorage['readingItems']['process']
  maintainDatabase: LearningStorage['maintenance']['maintain']
  optimizeOptimizer: LearningStorage['optimizers']['optimize']
  prepareReview: LearningStorage['reviews']['prepare']
  rateMultiLineCard: LearningStorage['reviews']['rateMultiLineCard']
  rateTarget: LearningStorage['reviews']['rateTarget']
  resetOptimizerDefaults: LearningStorage['optimizers']['resetDefaults']
  resetTarget: LearningStorage['reviews']['resetTarget']
  undoLastReview: LearningStorage['reviews']['undoLast']
  undoReviews: LearningStorage['reviews']['undoMany']
  saveOptimizer: LearningStorage['optimizers']['save']
}

export interface DesktopLearningApi extends DesktopLearningStorageApi {
  getNextItem: (input?: GetNextDesktopReviewItemInput) => Promise<DesktopReviewItem | null>
  getNextNewItem: (input?: GetNextDesktopReviewItemInput) => Promise<DesktopReviewItem | null>
  getNextReviewItem: (input?: GetNextDesktopReviewItemInput) => Promise<DesktopReviewItem | null>
  restoreReviewItem: (input: RestoreDesktopReviewItemInput) => Promise<DesktopReviewItem | null>
}

export interface DesktopTopicBlock {
  attributes: Readonly<Record<string, unknown>>
  id: string
  kind: string
  ordinal: number
  parentId: string | null
  text: string
}

export type JournalDate = string

export interface DesktopNoteBase {
  createdAt: number
  favorite: boolean
  id: string
  snapshot: Uint8Array
  title: string
  updatedAt: number
}

export interface DesktopRegularNote extends DesktopNoteBase {
  kind: 'regular'
}

export interface DesktopJournalNote extends DesktopNoteBase {
  journalDate: JournalDate
  kind: 'journal'
  topicId: string
}

export type DesktopNote = DesktopJournalNote | DesktopRegularNote

export interface DesktopTopicMark {
  attrs?: Readonly<Record<string, unknown>>
  type: string
}

export interface DesktopTopicNode {
  attrs?: Readonly<Record<string, unknown>>
  content?: readonly DesktopTopicNode[]
  marks?: readonly DesktopTopicMark[]
  text?: string
  type: string
}

export interface CreateDesktopTopicInput {
  initialContent: DesktopTopicNode
  mode: 0 | 1
  title: string
}

export interface DesktopBookTopicContextSummary {
  book: BookFileBinding
  noteId: string
  noteTitle: string
  topicId: string
  topicTitle: string
}

export interface DesktopBookTopicReadingContext {
  book: BookFileBinding
  note: DesktopNote
  readingState: BookReadingState
  topicId: string
  topicTitle: string
}

export type CreateDesktopBookContextResult
  = | {
    context: DesktopBookTopicReadingContext
    sessionId: string
    status: 'created'
  }
  | { status: 'duplicate-title' }

export interface OpenDesktopBookContextResult {
  context: DesktopBookTopicReadingContext
  sessionId: string
}

export interface CreateDesktopNoteInput {
  initialHeading?: string
  initialTopic?: CreateDesktopTopicInput
  title?: string
}

export interface GetDesktopNoteInput {
  noteId: string
}

export interface DeleteDesktopNoteImpact {
  assetCount: number
  assetReferenceCount: number
  cardCount: number
  noteId: string
  topicBlockCount: number
  topicCount: number
}

export interface ListDesktopNotesInput {
  page?: number
  pageSize?: number
  sortBy?: DesktopNoteSortField
  sortDirection?: DesktopNoteSortDirection
}

export type DesktopNoteSortDirection = 'asc' | 'desc'
export type DesktopNoteSortField = 'createdAt' | 'title' | 'updatedAt'

export interface RenameDesktopNoteInput {
  noteId: string
  title: string
}

export interface DesktopNoteSummaryBase {
  createdAt: number
  favorite: boolean
  id: string
  title: string
  updatedAt: number
}

export interface DesktopRegularNoteSummary extends DesktopNoteSummaryBase {
  kind: 'regular'
}

export interface DesktopJournalNoteSummary extends DesktopNoteSummaryBase {
  journalDate: JournalDate
  kind: 'journal'
}

export type DesktopNoteSummary = DesktopJournalNoteSummary | DesktopRegularNoteSummary

export interface OpenDesktopJournalInput {
  journalDate?: JournalDate
}

export interface ListDesktopPastJournalsInput {
  before?: JournalDate
  limit?: number
}

export interface ListDesktopJournalDatesInput {
  from: JournalDate
  through: JournalDate
}

export interface DesktopJournalSummary {
  createdAt: number
  journalDate: JournalDate
  kind: 'journal'
  noteId: string
  title: string
  topicId: string
  updatedAt: number
}

export interface DesktopJournalPage {
  items: readonly DesktopJournalSummary[]
  nextCursor: JournalDate | null
}

export interface PruneDesktopPastEmptyJournalsResult {
  deletedNoteIds: readonly string[]
}

interface DesktopFavoriteNoteItemBase {
  favoritedAt: number
  noteId: string
  noteTitle: string
  topicId: string
  topicTitle: string
}

export type DesktopFavoriteNoteItem = DesktopFavoriteNoteItemBase & (
  | { kind: 'regular' }
  | { journalDate: JournalDate, kind: 'journal' }
)

interface DesktopRecentNoteItemBase {
  noteId: string
  noteTitle: string
  openedAt: number
  topicId: string
  topicTitle: string
}

export type DesktopRecentNoteItem = DesktopRecentNoteItemBase & (
  | { kind: 'regular' }
  | { journalDate: JournalDate, kind: 'journal' }
)

export interface SetDesktopNoteFavoriteInput {
  favorite: boolean
  noteId: string
}

export type DesktopNoteFavoriteState = SetDesktopNoteFavoriteInput

export interface RecordDesktopNoteOpenedInput {
  noteId: string
  topicId: string
}

export type RenameDesktopNoteResult
  = | { note: DesktopNoteSummary, status: 'renamed' }
    | { status: 'duplicate-title' }
    | { journalDate: JournalDate, status: 'journal-title-immutable' }

export interface DesktopNotePage {
  items: readonly DesktopNoteSummary[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export interface DesktopColumnVisibilityMenuItem {
  canToggle: boolean
  id: string
  label: string
  visible: boolean
}

export interface ShowDesktopColumnVisibilityMenuInput {
  anchor: { x: number, y: number }
  columns: readonly DesktopColumnVisibilityMenuItem[]
}

export interface DesktopColumnVisibilityMenuSelection {
  columnId: string
}

export interface SaveDesktopNoteUpdatesInput {
  noteId: string
  updates: readonly Uint8Array[]
}

export interface DesktopNoteWriteReceipt {
  updatedAt: number
}

export interface DesktopNoteExternalUpdate {
  noteId: string
  update: Uint8Array
  updatedAt: number
}

export interface GenerateDesktopCardTopicInput {
  highlightId: string
  noteId: string
  sourceTopicId: string
}

export interface GenerateDesktopCardTopicResult extends DesktopNoteExternalUpdate {
  cardTopicId: string
}

export interface DesktopWhiteboardLibraryData {
  libraryItems: readonly WhiteboardLibraryItem[]
}

export interface DesktopStoredTopicBlock extends DesktopTopicBlock {
  contentHash: string
  noteId: string
  topicId: string
}

export interface DesktopTopicBlockSearchHit extends DesktopStoredTopicBlock {
  preview: string
  rank: number
}

export type DesktopTopicBlockSearchMode = 'hybrid' | 'lexical' | 'semantic'
export type DesktopNoteSearchMatch = 'content' | 'node-start' | 'semantic' | 'title'

type DesktopNoteSearchIdentity
  = | { noteKind: 'regular' }
    | { journalDate: JournalDate, noteKind: 'journal' }

interface DesktopNoteTitleSearchHitBase {
  kind: 'note'
  match: 'title'
  noteId: string
  noteTitle: string
  preview: string
  rank: number
}

export type DesktopNoteTitleSearchHit = DesktopNoteTitleSearchHitBase & DesktopNoteSearchIdentity

interface DesktopTopicSearchHitBase {
  blockId: string | null
  kind: 'topic'
  match: DesktopNoteSearchMatch
  noteId: string
  noteTitle: string
  preview: string
  rank: number
  topicId: string
  topicTitle: string
}

export type DesktopTopicSearchHit = DesktopTopicSearchHitBase & DesktopNoteSearchIdentity

export type DesktopNoteSearchHit = DesktopNoteTitleSearchHit | DesktopTopicSearchHit

export type DesktopApplicationMenu = 'file' | 'edit' | 'view' | 'window'

export interface ShowDesktopApplicationMenuInput {
  anchor: { x: number, y: number }
  menu: DesktopApplicationMenu
}

export interface DesktopTitlebarAppearance {
  backgroundColor: string
  symbolColor: string
}

export interface DesktopApi {
  addShelfSource: (input: AddShelfSourceInput) => Promise<ShelfSource>
  checkAssets: () => Promise<DesktopAssetCheckResult>
  captureReaderRegion: (input: CaptureDesktopReaderRegionInput) => Promise<Uint8Array>
  closeBookReadingSession: (sessionId: string) => Promise<boolean>
  createBookContext: (input: { noteTitle: string, readingId: string, topicTitle: string }) => Promise<CreateDesktopBookContextResult>
  createNote: (input?: CreateDesktopNoteInput) => Promise<DesktopNote>
  deleteNote: (input: GetDesktopNoteInput) => Promise<DeleteDesktopNoteImpact>
  getDeleteNoteImpact: (input: GetDesktopNoteInput) => Promise<DeleteDesktopNoteImpact>
  deleteShelfReading: (readingId: string) => Promise<boolean>
  exportDatabase: () => Promise<DesktopExportDatabaseResult | { status: 'cancelled' }>
  exportNoteMemo: (input: GetDesktopNoteInput) => Promise<DesktopNoteExportResult>
  exportNotePdf: (input: GetDesktopNoteInput) => Promise<DesktopNoteExportResult>
  startNoteExport: (input: { format: DesktopNoteExportFormat, noteId: string }) => Promise<DesktopNoteTransferStart>
  prepareNoteImport: () => Promise<DesktopNoteTransferStart>
  getNoteTransfer: (operationId: string) => Promise<DesktopNoteTransferState>
  continueNoteTransfer: (input: { decision: DesktopNoteTransferDecision, operationId: string }) => Promise<DesktopNoteTransferState>
  cancelNoteTransfer: (operationId: string) => Promise<DesktopNoteTransferState>
  getCachedShelfView: (input: BrowseShelfInput) => Promise<ShelfBrowseResult>
  getConfiguration: () => Promise<DesktopConfiguration>
  getNote: (input: GetDesktopNoteInput) => Promise<DesktopNote>
  generateCardTopic: (input: GenerateDesktopCardTopicInput) => Promise<GenerateDesktopCardTopicResult>
  getRuntimeInfo: () => Promise<RuntimeInfo>
  getShelfAsset: (input: ShelfAssetInput) => Promise<ShelfAssetResult>
  getShelfPublicationDetails: (input: ShelfPublicationDetailsInput) => Promise<ShelfPublicationDetails>
  getTopicBlock: (input: { blockId: string, noteId: string, topicId: string }) => Promise<DesktopStoredTopicBlock | null>
  importNetworkImage: (input: ImportDesktopNetworkImageInput) => Promise<SaveDesktopImageResult>
  importNote: () => Promise<DesktopNoteImportResult>
  isBookReadingAvailable: (readingId: string) => Promise<boolean>
  listBookContexts: (readingId: string) => Promise<readonly DesktopBookTopicContextSummary[]>
  listFavoriteNotes: (input?: { limit?: number }) => Promise<readonly DesktopFavoriteNoteItem[]>
  listJournalDates: (input: ListDesktopJournalDatesInput) => Promise<readonly JournalDate[]>
  listNotes: (input?: ListDesktopNotesInput) => Promise<DesktopNotePage>
  listPastJournals: (input?: ListDesktopPastJournalsInput) => Promise<DesktopJournalPage>
  listRecentNotes: (input?: { limit?: number }) => Promise<readonly DesktopRecentNoteItem[]>
  listTodoTasks: (input?: ListDesktopTodoTasksInput) => Promise<DesktopTodoTaskPage>
  createTodoTask: (input: CreateDesktopTodoTaskInput) => Promise<DesktopTodoTask>
  listTodoCalendarEvents: (input: { from: string, through: string }) => Promise<readonly DesktopTodoCalendarEvent[]>
  listTodoCalendarSubscriptions: () => Promise<readonly DesktopTodoCalendarSubscription[]>
  refreshTodoCalendar: (id: string) => Promise<DesktopTodoCalendarSubscription>
  removeTodoCalendar: (id: string) => Promise<void>
  subscribeTodoCalendar: (input: SubscribeDesktopTodoCalendarInput) => Promise<DesktopTodoCalendarSubscription>
  updateTodoTask: (input: UpdateDesktopTodoTaskInput) => Promise<DesktopNoteExternalUpdate>
  learning: DesktopLearningApi
  listShelfSources: () => Promise<readonly ShelfSource[]>
  openJournal: (input?: OpenDesktopJournalInput) => Promise<DesktopJournalNote>
  openMostRecentNote: () => Promise<DesktopNote>
  openShelfReading: (input: OpenShelfReadingInput) => Promise<ShelfReadingDocument>
  prepareShelfReading: (input: PrepareShelfReadingInput) => Promise<PreparedShelfReading>
  prunePastEmptyJournals: () => Promise<PruneDesktopPastEmptyJournalsResult>
  readShelfReadingRange: (input: ShelfReadingRangeInput) => Promise<Uint8Array>
  reclaimAssets: (input: ReclaimDesktopAssetsInput) => Promise<ReclaimDesktopAssetsResult>
  rebindBookContext: (input: { noteId: string, readingId: string, sessionId?: string, topicId: string }) => Promise<OpenDesktopBookContextResult>
  recordNoteOpened: (input: RecordDesktopNoteOpenedInput) => Promise<void>
  refreshShelfView: (input: BrowseShelfInput) => Promise<ShelfBrowseResult>
  removeShelfSource: (sourceId: string) => Promise<void>
  renameNote: (input: RenameDesktopNoteInput) => Promise<RenameDesktopNoteResult>
  restoreDatabase: () => Promise<DesktopRestoreDatabaseResult>
  saveImage: (input: SaveDesktopImageInput) => Promise<SaveDesktopImageResult>
  saveNoteUpdates: (input: SaveDesktopNoteUpdatesInput) => Promise<DesktopNoteWriteReceipt>
  searchNotes: (input: { limit?: number, query: string }) => Promise<readonly DesktopNoteSearchHit[]>
  searchTopicBlocks: (input: { limit?: number, mode?: DesktopTopicBlockSearchMode, noteId?: string, query: string }) => Promise<readonly DesktopTopicBlockSearchHit[]>
  setConfiguration: (configuration: DesktopConfiguration) => Promise<DesktopConfiguration>
  setConfigurationValue: (path: string, value: unknown) => Promise<DesktopConfiguration>
  setNoteFavorite: (input: SetDesktopNoteFavoriteInput) => Promise<DesktopNoteFavoriteState>
  selectBookContext: (input: { noteId: string, readingId: string, topicId: string }) => Promise<OpenDesktopBookContextResult>
  showColumnVisibilityMenu: (input: ShowDesktopColumnVisibilityMenuInput) => Promise<DesktopColumnVisibilityMenuSelection | null>
  showApplicationMenu: (input: ShowDesktopApplicationMenuInput) => Promise<null>
  setTitlebarAppearance: (input: DesktopTitlebarAppearance) => Promise<null>
  updateShelfSource: (input: UpdateShelfSourceInput) => Promise<ShelfSource>
}

export interface RuntimeInfo {
  applicationIcon?: string | null
  platform: string
  version: string
}
