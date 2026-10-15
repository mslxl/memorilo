import type { OperationSupervisor } from '@memorilo/effect-lifecycle'
import type { BookFileBinding, BookFileDescriptor } from '@memorilo/reading-model'
import type { EditorStorageDatabase } from './database-driver'
import type { EmbeddingModel } from './embedding-model'
import type {
  LearningPracticeConfiguration,
  LearningStorage,
  LearningTopicCardProjection,
  ReadingItemProjection,
} from './learning'

export interface FolderProjection {
  id: string
  kind: 'folder'
  name: string
  ordinal: number
  parentId: string | null
}

export type TopicEditorMode = 0 | 1

export interface CardTopicSourceProjection {
  kind: 'basic' | 'cloze' | 'highlight' | 'list' | 'set'
  sourceId: string
  sourceTopicId: string
  syncStatus: 'detached' | 'synced'
}

interface TopicProjectionBase {
  id: string
  kind: 'topic'
  ordinal: number
  parentId: string | null
  title: string
}

export interface RegularTopicProjection extends TopicProjectionBase {
  cardSource?: CardTopicSourceProjection
  mode: TopicEditorMode
  topicType: 'regular'
}

export interface BookTopicProjection extends TopicProjectionBase {
  book: BookFileBinding
  mode: TopicEditorMode
  topicType: 'book'
}

export interface ImageOcclusionTopicProjection extends TopicProjectionBase {
  topicType: 'image-occlusion'
}

export interface WhiteboardTopicProjection extends TopicProjectionBase {
  topicType: 'whiteboard'
}

export interface SpreadsheetTopicEntryProjection extends TopicProjectionBase {
  topicType: 'spreadsheet'
}

export type TopicProjection
  = | BookTopicProjection
    | ImageOcclusionTopicProjection
    | RegularTopicProjection
    | SpreadsheetTopicEntryProjection
    | WhiteboardTopicProjection

export type NoteEntryProjection = FolderProjection | TopicProjection

export interface TopicBlockProjection {
  attributes: Readonly<Record<string, unknown>>
  id: string
  kind: string
  ordinal: number
  parentId: string | null
  text: string
}

export interface TopicContentProjection {
  blocks: readonly TopicBlockProjection[]
  title: string
  topicId: string
}

export interface SpreadsheetFormulaReferenceProjection {
  columnId: string
  rowId: string
  sheetId: string
  sourceEnd: number
  sourceStart: number
  topicId: string
}

export interface SpreadsheetCellProjection {
  columnId: string
  display: string
  format: Readonly<Record<string, unknown>>
  formulaReferences: readonly SpreadsheetFormulaReferenceProjection[]
  input: string
  rowId: string
}

export interface SpreadsheetSheetProjection {
  cells: readonly SpreadsheetCellProjection[]
  columnIds: readonly string[]
  id: string
  name: string
  rowIds: readonly string[]
}

export interface SpreadsheetProjection {
  sheets: readonly SpreadsheetSheetProjection[]
  topicId: string
}

export interface StoredNoteUpdate {
  sequence: number
  update: Uint8Array
}

export interface StoredNote {
  checkpointSequence: number
  createdAt: number
  id: string
  latestSequence: number
  snapshot: Uint8Array | null
  title: string
  updatedAt: number
  updates: readonly StoredNoteUpdate[]
}

export interface BookTopicContext {
  book: BookFileBinding
  noteId: string
  noteTitle: string
  topicId: string
  topicTitle: string
}

export type BookFileFingerprint = Pick<BookFileDescriptor, 'format' | 'sha256'>

export interface CreateNoteInput {
  title?: string
}

export interface CreateInitializedNoteInput {
  entries: readonly NoteEntryProjection[]
  id: string
  learningCards?: readonly LearningTopicCardProjection[]
  learningReadingItems?: readonly ReadingItemProjection[]
  snapshot: Uint8Array
  spreadsheets?: readonly SpreadsheetProjection[]
  title: string
  topics: readonly TopicContentProjection[]
}

export interface CreateImportedNoteInput extends CreateInitializedNoteInput {
  assetReferences?: readonly AssetReferenceProjection[]
  assets?: readonly RegisterAssetInput[]
  hasUserContent?: boolean
  journalDate?: JournalDate
  kind?: 'journal' | 'regular'
}

export type JournalDate = string

export type GetOrCreateJournalInput = Omit<CreateInitializedNoteInput, 'id' | 'title'> & {
  hasUserContent: boolean
  journalDate: JournalDate
}

export type JournalCreationStatus = 'created' | 'existing'

export interface StoredJournal {
  journalDate: JournalDate
  note: StoredNote
  status: JournalCreationStatus
}

export interface JournalMetadata {
  hasUserContent: boolean
  journalDate: JournalDate
  noteId: string
}

export interface ListPastJournalsInput {
  before?: JournalDate
  limit?: number
  today: JournalDate
}

export interface StoredJournalSummary {
  createdAt: number
  journalDate: JournalDate
  noteId: string
  title: string
  topicId: string
  updatedAt: number
}

export interface StoredJournalPage {
  items: readonly StoredJournalSummary[]
  nextCursor: JournalDate | null
}

export interface ListJournalDatesInput {
  from: JournalDate
  through: JournalDate
}

export interface PrunePastEmptyJournalsInput {
  before: JournalDate
}

export interface PrunePastEmptyJournalsResult {
  deletedNoteIds: readonly string[]
}

export class DuplicateNoteTitleError extends Error {
  override readonly name = 'DuplicateNoteTitleError'

  constructor(readonly title: string) {
    super(`A Note named "${title}" already exists`)
  }
}

export interface GetNoteInput {
  noteId: string
}

export interface DeleteNoteImpact {
  assetCount: number
  assetReferenceCount: number
  cardCount: number
  noteId: string
  topicBlockCount: number
  topicCount: number
}

export interface ListNotesInput {
  page?: number
  pageSize?: number
  sortBy?: NoteSortField
  sortDirection?: NoteSortDirection
  today?: JournalDate
}

export type NoteSortDirection = 'asc' | 'desc'

export type NoteSortField = 'createdAt' | 'title' | 'updatedAt'

export interface NoteSummary {
  createdAt: number
  favorite: boolean
  id: string
  journalDate?: JournalDate
  title: string
  updatedAt: number
}

export interface ListNoteActivityInput {
  limit?: number
  today?: JournalDate
}

export interface NoteFavoriteState {
  favorite: boolean
  noteId: string
}

export type SetNoteFavoriteInput = NoteFavoriteState

export interface RecordNoteOpenedInput {
  noteId: string
  topicId: string
}

export interface FavoriteNoteItem {
  favoritedAt: number
  journalDate?: JournalDate
  noteId: string
  noteTitle: string
  topicId: string
  topicTitle: string
}

export interface RecentNoteItem {
  journalDate?: JournalDate
  noteId: string
  noteTitle: string
  openedAt: number
  topicId: string
  topicTitle: string
}

export interface NotePage {
  items: readonly NoteSummary[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export interface AssetReferenceProjection {
  count: number
  fileName: string
}

export interface AssetStatistics {
  managedAssetCount: number
  referenceCount: number
}

export interface StoredAsset {
  byteSize: number
  createdAt: number
  fileName: string
  mimeType: string
  originalFileName: string
}

export interface RegisterAssetInput {
  byteSize: number
  createdAt?: number
  fileName: string
  mimeType: string
  originalFileName: string
}

export interface AssetSyncManifest {
  contentHash: string | null
  contentLength: number | null
  contentType: string | null
  createdAt: number
  deviceId: string
  fileName: string
  id: string
  operation: 'put' | 'delete'
  originalFileName: string
  sequence: number
}

export interface AppendLocalAssetSyncManifestInput {
  contentHash: string | null
  contentLength: number | null
  contentType: string | null
  createdAt: number
  deviceId: string
  fileName: string
  operation: 'put' | 'delete'
  originalFileName: string
}

export interface ReconcileNoteAssetReferencesInput {
  allowedMissingAssetFileNames?: readonly string[]
  expectedLatestSequence: number
  noteId: string
  references: readonly AssetReferenceProjection[]
}

export interface SaveNoteUpdatesInput {
  allowedMissingAssetFileNames?: readonly string[]
  assetReferences?: readonly AssetReferenceProjection[]
  entries?: readonly NoteEntryProjection[]
  journalHasUserContent?: boolean
  learningCards?: readonly LearningTopicCardProjection[]
  learningReadingItems?: readonly ReadingItemProjection[]
  noteId: string
  spreadsheets?: readonly SpreadsheetProjection[]
  title?: string
  topics: readonly TopicContentProjection[]
  updates: readonly Uint8Array[]
}

export interface CheckpointNoteInput {
  noteId: string
  snapshot: Uint8Array
  throughSequence: number
}

export interface NoteWriteReceipt {
  acceptedUpdateHashes: readonly string[]
  latestSequence: number
  updatedAt: number
}

export interface GetTopicBlockInput {
  blockId: string
  noteId: string
  topicId: string
}

export type TopicBlockSearchMode = 'hybrid' | 'lexical' | 'semantic'

export interface SearchTopicBlocksInput {
  limit?: number
  mode?: TopicBlockSearchMode
  noteId?: string
  query: string
  today?: JournalDate
}

export interface SearchNotesInput {
  limit?: number
  query: string
  today?: JournalDate
}

export interface OpenMostRecentNoteInput {
  today?: JournalDate
}

export type NoteSearchMatch = 'content' | 'node-start' | 'semantic' | 'title'

export interface NoteTitleSearchHit {
  journalDate?: JournalDate
  kind: 'note'
  match: 'title'
  noteId: string
  noteTitle: string
  preview: string
  rank: number
}

export interface TopicSearchHit {
  blockId: string | null
  journalDate?: JournalDate
  kind: 'topic'
  match: NoteSearchMatch
  noteId: string
  noteTitle: string
  preview: string
  rank: number
  topicId: string
  topicTitle: string
}

export type NoteSearchHit = NoteTitleSearchHit | TopicSearchHit

export interface IndexPendingEmbeddingsInput {
  limit?: number
  noteId?: string
}

export interface IndexPendingEmbeddingsResult {
  hasPending: boolean
  indexed: number
}

export interface StoredTopicBlock extends TopicBlockProjection {
  contentHash: string
  noteId: string
  topicId: string
}

export type TodoTaskStatus = 'todo' | 'doing' | 'done'

export type TodoReminder
  = | { kind: 'offset', minutes: number }
    | { kind: 'time', time: string }

export type TodoSchedule
  = | { kind: 'none' }
    | { date: JournalDate, kind: 'deadline', time: string | null }
    | { allDay: boolean, end: string, kind: 'span', start: string }

export type TodoRepeatMode = 'due' | 'completion' | 'custom'
export type TodoRepeatUnit = 'day' | 'week' | 'month' | 'year' | 'holiday' | 'lunar'
export type TodoRepeatHolidayPolicy = 'allow' | 'skip' | 'next-workday'
export type TodoRepeatMonthMode = 'date' | 'weekday' | 'workday'
export type TodoRepeatYearMode = 'date' | 'weekday'
export type TodoRepeatOrdinal = -1 | 1 | 2 | 3 | 4 | 5
export type TodoRepeatDayOfMonth = number | 'last'

export interface TodoRepeatRule {
  anchorDate?: JournalDate
  calendarId?: string
  endDate?: JournalDate
  holidayPolicy?: TodoRepeatHolidayPolicy
  interval: number
  lunarDay?: number
  lunarMonth?: number
  mode: TodoRepeatMode
  monthDay?: TodoRepeatDayOfMonth
  monthMode?: TodoRepeatMonthMode
  monthOrdinal?: TodoRepeatOrdinal
  monthWeekday?: number
  skipHolidays?: boolean
  skipWeekends?: boolean
  unit: TodoRepeatUnit
  weekdays?: readonly number[]
  yearDay?: TodoRepeatDayOfMonth
  yearMode?: TodoRepeatYearMode
  yearMonth?: number
  yearOrdinal?: TodoRepeatOrdinal
  yearWeekday?: number
}

export interface ListTodoTasksInput {
  cursor?: number
  limit?: number
  status?: TodoTaskStatus
}

export interface UpdateTodoTaskInput {
  schedule?: TodoSchedule
  blockId: string
  noteId: string
  reminderMinutes?: number | null
  reminders?: readonly TodoReminder[] | null
  repeatRule?: TodoRepeatRule | null
  status?: TodoTaskStatus
  text?: string
  topicId: string
}

export interface TodoTask {
  schedule: TodoSchedule
  blockId: string
  elapsedMs: number
  journalDate: JournalDate | null
  noteId: string
  noteFavorite: boolean
  noteTitle: string
  parentId: string | null
  /** The nearest Todo ancestor, skipping non-Todo blocks. */
  todoParentId?: string | null
  repeatRule: TodoRepeatRule | null
  reminderMinutes: number | null
  reminders: readonly TodoReminder[] | null
  startedAt: number | null
  status: TodoTaskStatus
  text: string
  topicId: string
  topicTitle: string
}

export interface TodoTaskPage {
  items: readonly TodoTask[]
  nextCursor: number | null
}

export interface TodoCalendarSubscription {
  etag: string | null
  enabled: boolean
  fetchedAt: number | null
  id: string
  title: string
  url: string
  version: string | null
  lastModified: string | null
}

export interface TodoCalendarEvent {
  endDate: JournalDate | null
  startDate: JournalDate
  endAt?: string | null
  startAt?: string | null
  allDay?: boolean
  subscriptionId: string
  subscriptionTitle: string
  title: string
  uid: string
}

export interface SaveTodoCalendarSnapshotInput {
  etag?: string | null
  fetchedAt: number
  id: string
  lastModified?: string | null
  rawIcs: string
  title: string
  url: string
  version: string
  events: readonly Omit<TodoCalendarEvent, 'subscriptionId' | 'subscriptionTitle'>[]
}

export interface EnsureTodoCalendarSubscriptionInput {
  id: string
  title: string
  url: string
}

export interface EditorTodoCalendarStorage {
  listEvents: (input: { from: JournalDate, through: JournalDate }) => Promise<readonly TodoCalendarEvent[]>
  listSubscriptions: () => Promise<readonly TodoCalendarSubscription[]>
  ensureSubscription: (input: EnsureTodoCalendarSubscriptionInput) => Promise<void>
  markFetched: (id: string, fetchedAt: number) => Promise<void>
  remove: (id: string) => Promise<void>
  saveSnapshot: (input: SaveTodoCalendarSnapshotInput) => Promise<void>
}

export interface TopicBlockSearchHit extends StoredTopicBlock {
  preview: string
  rank: number
}

export interface EditorAssetStorage {
  appendLocalSyncManifest: (input: AppendLocalAssetSyncManifestInput) => Promise<AssetSyncManifest>
  claimUnreferenced: (input: { fileName: string, unreferencedBefore: number }) => Promise<StoredAsset | null>
  completeDeletion: (input: { fileName: string }) => Promise<void>
  getStatistics: () => Promise<AssetStatistics>
  getSyncFrontier: () => Promise<Readonly<Record<string, number>>>
  list: () => Promise<readonly StoredAsset[]>
  listClaimed: () => Promise<readonly StoredAsset[]>
  listUnreferenced: (input: { unreferencedBefore: number }) => Promise<readonly StoredAsset[]>
  listSyncManifests: (since: Readonly<Record<string, number>>) => Promise<readonly AssetSyncManifest[]>
  recordReceivedSyncManifests: (manifests: readonly AssetSyncManifest[]) => Promise<void>
  register: (input: RegisterAssetInput) => Promise<StoredAsset>
  releaseClaim: (input: { fileName: string }) => Promise<void>
}

export interface EditorBookTopicStorage {
  listByFile: (file: BookFileFingerprint) => Promise<readonly BookTopicContext[]>
  listByReadingId: (readingId: string) => Promise<readonly BookTopicContext[]>
}

export interface EditorJournalStorage {
  getMetadata: (input: GetNoteInput) => Promise<JournalMetadata | null>
  getOrCreate: (input: GetOrCreateJournalInput) => Promise<StoredJournal>
  listDates: (input: ListJournalDatesInput) => Promise<readonly JournalDate[]>
  listPast: (input: ListPastJournalsInput) => Promise<StoredJournalPage>
  prunePastEmpty: (input: PrunePastEmptyJournalsInput) => Promise<PrunePastEmptyJournalsResult>
}

export interface EditorNoteStorage {
  checkpointNote: (input: CheckpointNoteInput) => Promise<NoteWriteReceipt>
  createInitializedNote: (input: CreateInitializedNoteInput) => Promise<StoredNote>
  createImportedNote: (input: CreateImportedNoteInput) => Promise<StoredNote>
  createNote: (input?: CreateNoteInput) => Promise<StoredNote>
  deleteNote: (input: GetNoteInput) => Promise<DeleteNoteImpact>
  getDeleteNoteImpact: (input: GetNoteInput) => Promise<DeleteNoteImpact>
  getNote: (input: GetNoteInput) => Promise<StoredNote>
  getNoteFavorite: (input: GetNoteInput) => Promise<NoteFavoriteState>
  listFavoriteNotes: (input?: ListNoteActivityInput) => Promise<readonly FavoriteNoteItem[]>
  listNoteIds: () => Promise<readonly string[]>
  listNotes: (input?: ListNotesInput) => Promise<NotePage>
  listRecentNotes: (input?: ListNoteActivityInput) => Promise<readonly RecentNoteItem[]>
  openMostRecentNote: (input?: OpenMostRecentNoteInput) => Promise<StoredNote>
  reconcileNoteAssetReferences: (input: ReconcileNoteAssetReferencesInput) => Promise<boolean>
  recordNoteOpened: (input: RecordNoteOpenedInput) => Promise<void>
  saveNoteUpdates: (input: SaveNoteUpdatesInput) => Promise<NoteWriteReceipt>
  setNoteFavorite: (input: SetNoteFavoriteInput) => Promise<NoteFavoriteState>
}

export interface EditorSearchStorage {
  getTopicBlock: (input: GetTopicBlockInput) => Promise<StoredTopicBlock | null>
  indexPendingEmbeddings: (input?: IndexPendingEmbeddingsInput) => Promise<IndexPendingEmbeddingsResult>
  searchNotes: (input: SearchNotesInput) => Promise<readonly NoteSearchHit[]>
  searchTopicBlocks: (input: SearchTopicBlocksInput) => Promise<readonly TopicBlockSearchHit[]>
}

export interface EditorTodoStorage {
  list: (input?: ListTodoTasksInput) => Promise<TodoTaskPage>
}

export interface SaveUserDocumentInput {
  documentId: string
  snapshot: Uint8Array
}

export interface EditorUserDocumentStorage {
  load: (documentId: string) => Promise<Uint8Array | null>
  save: (input: SaveUserDocumentInput) => Promise<void>
}

/**
 * Owns the shared database operation lifecycle and exposes the storage package's
 * deep modules as named facets. Callers choose a domain facet instead of learning
 * a flat forwarding interface; concrete repository implementations remain private.
 */
export interface EditorStorage {
  readonly assets: EditorAssetStorage
  readonly bookTopics: EditorBookTopicStorage
  close: () => Promise<void>
  readonly journals: EditorJournalStorage
  readonly learning: LearningStorage
  readonly notes: EditorNoteStorage
  readonly search: EditorSearchStorage
  readonly tasks: EditorTodoStorage
  readonly todoCalendars: EditorTodoCalendarStorage
  readonly userDocuments: EditorUserDocumentStorage
}

export interface SqliteEditorStorageOptions {
  database: EditorStorageDatabase
  /**
   * Whether EditorStorage is responsible for closing the supplied database.
   * This must be explicit so a composition root cannot accidentally change
   * shutdown ownership by omitting an option. Shared roots should use
   * `borrowed` and close the database after every database-backed owner shuts
   * down.
   */
  databaseOwnership: 'borrowed' | 'owned'
  /**
   * Shared database admission supplied by a composition root. When present,
   * EditorStorage borrows this supervisor and never closes it; the composition
   * root must close it after every storage using the same database has drained.
   */
  operationSupervisor?: OperationSupervisor
  embeddingModel: EmbeddingModel
  learningConfiguration?: () => LearningPracticeConfiguration
}
