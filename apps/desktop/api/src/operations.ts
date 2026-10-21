import type { Schema as EffectSchema } from 'effect'
import type {
  CaptureDesktopReaderRegionInput,
  CreateDesktopBookContextResult,
  CreateDesktopTopicInput,
  DesktopApi,
  DesktopAssetCheckResult,
  DesktopBookTopicContextSummary,
  DesktopColumnVisibilityMenuSelection,
  DesktopExportDatabaseResult,
  DesktopExportDiagnostic,
  DesktopNoteExportResult,
  DesktopNoteImportResult,
  DesktopNoteTransferDecision,
  DesktopNoteTransferStart,
  DesktopNoteTransferState,
  DesktopRestoreDatabaseResult,
  OpenDesktopBookContextResult,
  ReclaimDesktopAssetsInput,
  ReclaimDesktopAssetsResult,
  SaveDesktopImageInput,
  SaveDesktopImageResult,
  ShowDesktopColumnVisibilityMenuInput,
} from './contract'
import { Schema } from 'effect'
import {
  BookFileBindingSchema,
  BookReadingStateSchema,
  EmptyArgumentsSchema,
  jsonValue,
  nullable,
  NullResultSchema,
  optionalArgument,
  PositiveIntegerSchema,
  StringArgumentSchema,
} from './schemas/common'
import {
  DesktopReviewItemSchema,
  FsrsOptimizerSchema,
  LearningActivitySummarySchema,
  LearningDailyProgressSchema,
  LearningMaintenanceEstimateSchema,
  LearningMaintenanceResultSchema,
  LearningNoteSummarySchema,
  LearningSchemaArguments,
  LearningSessionQueueItemSchema,
  LearningStateSchema,
  LearningTargetSchema,
  MultiLineReviewResultSchema,
  PreparedLearningReviewSchema,
  ReadingItemSchema,
  ReviewResultSchema,
} from './schemas/learning'
import {
  CreateDesktopTodoTaskInputSchema,
  DeleteDesktopNoteImpactSchema,
  DesktopFavoriteNotesSchema,
  DesktopJournalNoteSchema,
  DesktopJournalPageSchema,
  DesktopNoteExternalUpdateSchema,
  DesktopNoteFavoriteStateSchema,
  DesktopNotePageSchema,
  DesktopNoteSchema,
  DesktopNoteSearchHitsSchema,
  DesktopNoteWriteReceiptSchema,
  DesktopRecentNotesSchema,
  DesktopStoredTopicBlockSchema,
  DesktopTodoCalendarEventsSchema,
  DesktopTodoCalendarSubscriptionSchema,
  DesktopTodoCalendarSubscriptionsSchema,
  DesktopTodoTaskPageSchema,
  DesktopTodoTaskSchema,
  DesktopTopicBlockSearchHitsSchema,
  GenerateDesktopCardTopicResultSchema,
  JournalDateSchema,
  PruneDesktopPastEmptyJournalsResultSchema,
  RenameDesktopNoteResultSchema,
  TaskReminderMinutesSchema,
  TaskReminderSchema,
  TaskScheduleSchema,
} from './schemas/notes'
import {
  AddShelfSourceInputSchema,
  BrowseShelfInputSchema,
  OpenShelfReadingInputSchema,
  PreparedShelfReadingSchema,
  PrepareShelfReadingInputSchema,
  ShelfAssetInputSchema,
  ShelfAssetResultSchema,
  ShelfBrowseResultSchema,
  ShelfPublicationDetailsInputSchema,
  ShelfPublicationDetailsSchema,
  ShelfReadingDocumentSchema,
  ShelfReadingRangeInputSchema,
  ShelfSourceSchema,
  UpdateShelfSourceInputSchema,
} from './schemas/shelf'

interface OperationDefinition<
  Arguments extends EffectSchema.Top,
  Result extends EffectSchema.Top,
  Contextual extends boolean,
> {
  readonly arguments: Arguments
  readonly contextual: Contextual
  readonly result: Result
}

function operation<Arguments extends EffectSchema.Top, Result extends EffectSchema.Top>(
  argumentsSchema: Arguments,
  result: Result,
): OperationDefinition<Arguments, Result, false> {
  return { arguments: argumentsSchema, contextual: false, result }
}

function contextualOperation<Arguments extends EffectSchema.Top, Result extends EffectSchema.Top>(
  argumentsSchema: Arguments,
  result: Result,
): OperationDefinition<Arguments, Result, true> {
  return { arguments: argumentsSchema, contextual: true, result }
}

const AssetCheckResultSchema: EffectSchema.Codec<DesktopAssetCheckResult> = Schema.Struct({
  candidates: Schema.Array(Schema.Struct({
    byteSize: PositiveIntegerSchema,
    fileName: Schema.NonEmptyString,
    originalFileName: Schema.String,
  })),
  managedAssetCount: Schema.Int,
  missingAssets: Schema.Array(Schema.Struct({
    fileName: Schema.NonEmptyString,
    originalFileName: Schema.String,
    referenceCount: Schema.Int,
  })),
  referencedAssetCount: Schema.Int,
})

const SaveImageInputSchema: EffectSchema.Codec<SaveDesktopImageInput, unknown> = Schema.Struct({
  data: Schema.Uint8ArrayFromBase64,
  fileName: Schema.NonEmptyString,
  mimeType: Schema.String,
})
const SaveImageResultSchema: EffectSchema.Codec<SaveDesktopImageResult> = Schema.Struct({
  src: Schema.NonEmptyString,
})
const ReclaimAssetsInputSchema: EffectSchema.Codec<ReclaimDesktopAssetsInput> = Schema.Struct({
  fileNames: Schema.Array(Schema.NonEmptyString),
  mode: Schema.Literals(['permanent', 'trash']),
})
const ReclaimAssetsResultSchema: EffectSchema.Codec<ReclaimDesktopAssetsResult> = Schema.Struct({
  cancelled: Schema.Boolean,
  failedFileNames: Schema.Array(Schema.NonEmptyString),
  reclaimedFileNames: Schema.Array(Schema.NonEmptyString),
})

const BackupExportResultSchema: EffectSchema.Codec<DesktopExportDatabaseResult | { status: 'cancelled' }> = Schema.Union([
  Schema.Struct({ path: Schema.NonEmptyString }),
  Schema.Struct({ status: Schema.Literal('cancelled') }),
])
const BackupRestoreResultSchema: EffectSchema.Codec<DesktopRestoreDatabaseResult> = Schema.Union([
  Schema.Struct({ status: Schema.Literal('cancelled') }),
  Schema.Struct({ status: Schema.Literal('restarting') }),
])

const NoteExportDiagnosticSchema: EffectSchema.Codec<DesktopExportDiagnostic> = Schema.Struct({
  code: Schema.NonEmptyString,
  fallback: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  message: Schema.String,
  path: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  severity: Schema.Literals(['error', 'warning']),
})
const NoteExportResultSchema: EffectSchema.Codec<DesktopNoteExportResult> = Schema.Union([
  Schema.Struct({
    diagnostics: Schema.Array(NoteExportDiagnosticSchema),
    path: Schema.NonEmptyString,
    status: Schema.Literal('saved'),
  }),
  Schema.Struct({ status: Schema.Literal('cancelled') }),
])
const NoteImportResultSchema: EffectSchema.Codec<DesktopNoteImportResult> = Schema.Union([
  Schema.Struct({
    journalDate: Schema.optionalKey(JournalDateSchema),
    kind: Schema.Literals(['journal', 'regular']),
    noteId: Schema.NonEmptyString,
    title: Schema.String,
    status: Schema.Literal('imported'),
  }),
  Schema.Struct({
    fileName: Schema.NonEmptyString,
    source: Schema.String,
    status: Schema.Literal('markdown'),
  }),
  Schema.Struct({ status: Schema.Literal('cancelled') }),
])

const NoteTransferStartSchema: EffectSchema.Codec<DesktopNoteTransferStart> = Schema.Struct({
  operationId: Schema.NonEmptyString,
})
const NoteTransferErrorSchema = Schema.Struct({
  code: Schema.NonEmptyString,
  message: Schema.String,
})
const NoteTransferStateSchema: EffectSchema.Codec<DesktopNoteTransferState> = Schema.Union([
  Schema.Struct({
    format: Schema.Literals(['memo', 'pdf']),
    kind: Schema.Literal('export'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('preparing'),
  }),
  Schema.Struct({
    format: Schema.Literals(['memo', 'pdf']),
    kind: Schema.Literal('export'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('saved'),
    result: Schema.Struct({
      diagnostics: Schema.Array(NoteExportDiagnosticSchema),
      path: Schema.NonEmptyString,
      status: Schema.Literal('saved'),
    }),
  }),
  Schema.Struct({
    error: NoteTransferErrorSchema,
    format: Schema.Literals(['memo', 'pdf']),
    kind: Schema.Literal('export'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('failed'),
  }),
  Schema.Struct({
    format: Schema.Literals(['memo', 'pdf']),
    kind: Schema.Literal('export'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('cancelled'),
  }),
  Schema.Struct({
    kind: Schema.Literal('import'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('preparing'),
  }),
  Schema.Struct({
    fileName: Schema.NonEmptyString,
    kind: Schema.Literal('import'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('markdown'),
    source: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('import'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('imported'),
    result: Schema.Struct({
      journalDate: Schema.optionalKey(JournalDateSchema),
      kind: Schema.Literals(['journal', 'regular']),
      noteId: Schema.NonEmptyString,
      title: Schema.String,
      status: Schema.Literal('imported'),
    }),
  }),
  Schema.Struct({
    error: NoteTransferErrorSchema,
    kind: Schema.Literal('import'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('failed'),
  }),
  Schema.Struct({
    kind: Schema.Literal('import'),
    operationId: Schema.NonEmptyString,
    phase: Schema.Literal('cancelled'),
  }),
])
const NoteTransferDecisionSchema: EffectSchema.Codec<DesktopNoteTransferDecision> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('cancel') }),
  Schema.Struct({ kind: Schema.Literal('acknowledge') }),
])

const BookContextSummarySchema: EffectSchema.Codec<DesktopBookTopicContextSummary> = Schema.Struct({
  book: BookFileBindingSchema,
  noteId: Schema.NonEmptyString,
  noteTitle: Schema.String,
  topicId: Schema.NonEmptyString,
  topicTitle: Schema.String,
})
const BookReadingContextSchema = Schema.Struct({
  book: BookFileBindingSchema,
  note: DesktopNoteSchema,
  readingState: BookReadingStateSchema,
  topicId: Schema.NonEmptyString,
  topicTitle: Schema.String,
})
const CreateBookContextResultSchema: EffectSchema.Codec<CreateDesktopBookContextResult, unknown> = Schema.Union([
  Schema.Struct({
    context: BookReadingContextSchema,
    sessionId: Schema.NonEmptyString,
    status: Schema.Literal('created'),
  }),
  Schema.Struct({ status: Schema.Literal('duplicate-title') }),
])
const OpenBookContextResultSchema: EffectSchema.Codec<OpenDesktopBookContextResult, unknown> = Schema.Struct({
  context: BookReadingContextSchema,
  sessionId: Schema.NonEmptyString,
})

const CreateDesktopTopicInputSchema: EffectSchema.Codec<CreateDesktopTopicInput, unknown> = Schema.Struct({
  initialContent: jsonValue<CreateDesktopTopicInput['initialContent']>(),
  mode: Schema.Literals([0, 1]),
  title: Schema.String,
})

const CaptureReaderRegionInputSchema: EffectSchema.Codec<CaptureDesktopReaderRegionInput> = Schema.Struct({
  height: PositiveIntegerSchema,
  width: PositiveIntegerSchema,
  x: Schema.Int,
  y: Schema.Int,
})
const ShowColumnVisibilityMenuInputSchema: EffectSchema.Codec<ShowDesktopColumnVisibilityMenuInput> = Schema.Struct({
  anchor: Schema.Struct({ x: Schema.Int, y: Schema.Int }),
  columns: Schema.NonEmptyArray(Schema.Struct({
    canToggle: Schema.Boolean,
    id: Schema.NonEmptyString,
    label: Schema.NonEmptyString,
    visible: Schema.Boolean,
  })),
})
const ColumnVisibilityMenuResultSchema: EffectSchema.Codec<DesktopColumnVisibilityMenuSelection | null> = nullable(
  Schema.Struct({ columnId: Schema.NonEmptyString }),
)

export const desktopOperationSchemas = {
  assets: {
    check: operation(EmptyArgumentsSchema, AssetCheckResultSchema),
    importNetworkImage: operation(
      Schema.Tuple([Schema.Struct({ source: Schema.NonEmptyString })]),
      SaveImageResultSchema,
    ),
    reclaim: contextualOperation(Schema.Tuple([ReclaimAssetsInputSchema]), ReclaimAssetsResultSchema),
    saveImage: operation(Schema.Tuple([SaveImageInputSchema]), SaveImageResultSchema),
  },
  backup: {
    exportDatabase: contextualOperation(EmptyArgumentsSchema, BackupExportResultSchema),
    restoreDatabase: contextualOperation(EmptyArgumentsSchema, BackupRestoreResultSchema),
  },
  books: {
    closeReadingSession: contextualOperation(StringArgumentSchema, Schema.Boolean),
    createContext: contextualOperation(Schema.Tuple([Schema.Struct({
      noteTitle: Schema.String,
      readingId: Schema.NonEmptyString,
      topicTitle: Schema.String,
    })]), CreateBookContextResultSchema),
    isReadingAvailable: operation(StringArgumentSchema, Schema.Boolean),
    listContexts: operation(StringArgumentSchema, Schema.Array(BookContextSummarySchema)),
    rebindContext: contextualOperation(Schema.Tuple([Schema.Struct({
      noteId: Schema.NonEmptyString,
      readingId: Schema.NonEmptyString,
      sessionId: Schema.optionalKey(Schema.NonEmptyString),
      topicId: Schema.NonEmptyString,
    })]), OpenBookContextResultSchema),
    selectContext: contextualOperation(Schema.Tuple([Schema.Struct({
      noteId: Schema.NonEmptyString,
      readingId: Schema.NonEmptyString,
      topicId: Schema.NonEmptyString,
    })]), OpenBookContextResultSchema),
  },
  journals: {
    listJournalDates: operation(Schema.Tuple([Schema.Struct({
      from: JournalDateSchema,
      through: JournalDateSchema,
    })]), Schema.Array(JournalDateSchema)),
    listPastJournals: operation(optionalArgument(Schema.Struct({
      before: Schema.optionalKey(JournalDateSchema),
      limit: Schema.optionalKey(PositiveIntegerSchema),
    })), DesktopJournalPageSchema),
    openJournal: operation(optionalArgument(Schema.Struct({
      journalDate: Schema.optionalKey(JournalDateSchema),
    })), DesktopJournalNoteSchema),
    prunePastEmptyJournals: operation(EmptyArgumentsSchema, PruneDesktopPastEmptyJournalsResultSchema),
  },
  learning: {
    archiveOptimizer: operation(LearningSchemaArguments.archiveOptimizer, NullResultSchema),
    assignNoteOptimizer: operation(LearningSchemaArguments.assignNoteOptimizer, NullResultSchema),
    createOptimizer: operation(LearningSchemaArguments.createOptimizer, FsrsOptimizerSchema),
    getActivitySummary: operation(LearningSchemaArguments.getActivitySummary, LearningActivitySummarySchema),
    getDailyProgress: operation(LearningSchemaArguments.getDailyProgress, LearningDailyProgressSchema),
    getLearningState: operation(LearningSchemaArguments.getLearningState, LearningStateSchema),
    getMaintenanceEstimate: operation(LearningSchemaArguments.getMaintenanceEstimate, LearningMaintenanceEstimateSchema),
    getNextLearningKind: operation(LearningSchemaArguments.getNextLearningKind, Schema.Union([Schema.Literals(['reading', 'review']), Schema.Null])),
    getNextItem: operation(LearningSchemaArguments.getNextItem, DesktopReviewItemSchema),
    getNextNewItem: operation(LearningSchemaArguments.getNextNewItem, DesktopReviewItemSchema),
    getNextReviewItem: operation(LearningSchemaArguments.getNextReviewItem, DesktopReviewItemSchema),
    getNoteOptimizer: operation(LearningSchemaArguments.getNoteOptimizer, FsrsOptimizerSchema),
    getOptimizer: operation(LearningSchemaArguments.getOptimizer, FsrsOptimizerSchema),
    getOptimizerNoteCount: operation(LearningSchemaArguments.getOptimizerNoteCount, Schema.Int),
    listNotesWithCards: operation(LearningSchemaArguments.listNotesWithCards, Schema.Array(LearningNoteSummarySchema)),
    listOptimizers: operation(LearningSchemaArguments.listOptimizers, Schema.Array(FsrsOptimizerSchema)),
    listQueue: operation(LearningSchemaArguments.listQueue, Schema.Array(LearningSessionQueueItemSchema)),
    listTargets: operation(LearningSchemaArguments.listTargets, Schema.Array(LearningTargetSchema)),
    listReadingItems: operation(LearningSchemaArguments.listReadingItems, Schema.Array(ReadingItemSchema)),
    processReadingItem: operation(LearningSchemaArguments.processReadingItem, ReadingItemSchema),
    maintainDatabase: operation(LearningSchemaArguments.maintainDatabase, LearningMaintenanceResultSchema),
    optimizeOptimizer: operation(LearningSchemaArguments.optimizeOptimizer, FsrsOptimizerSchema),
    prepareReview: operation(LearningSchemaArguments.prepareReview, PreparedLearningReviewSchema),
    rateMultiLineCard: operation(LearningSchemaArguments.rateMultiLineCard, MultiLineReviewResultSchema),
    rateTarget: operation(LearningSchemaArguments.rateTarget, ReviewResultSchema),
    resetOptimizerDefaults: operation(LearningSchemaArguments.resetOptimizerDefaults, FsrsOptimizerSchema),
    resetTarget: operation(LearningSchemaArguments.resetTarget, LearningStateSchema),
    restoreReviewItem: operation(LearningSchemaArguments.restoreReviewItem, DesktopReviewItemSchema),
    saveOptimizer: operation(LearningSchemaArguments.saveOptimizer, FsrsOptimizerSchema),
    undoLastReview: operation(LearningSchemaArguments.undoLastReview, LearningStateSchema),
    undoReviews: operation(LearningSchemaArguments.undoReviews, Schema.Array(LearningStateSchema)),
  },
  notes: {
    createNote: operation(optionalArgument(Schema.Struct({
      initialHeading: Schema.optionalKey(Schema.String),
      initialTopic: Schema.optionalKey(CreateDesktopTopicInputSchema),
      title: Schema.optionalKey(Schema.String),
    })), DesktopNoteSchema),
    getNote: operation(Schema.Tuple([Schema.Struct({ noteId: Schema.NonEmptyString })]), DesktopNoteSchema),
    generateCardTopic: operation(Schema.Tuple([Schema.Struct({
      highlightId: Schema.NonEmptyString,
      noteId: Schema.NonEmptyString,
      sourceTopicId: Schema.NonEmptyString,
    })]), GenerateDesktopCardTopicResultSchema),
    getDeleteNoteImpact: operation(Schema.Tuple([Schema.Struct({ noteId: Schema.NonEmptyString })]), DeleteDesktopNoteImpactSchema),
    getTopicBlock: operation(Schema.Tuple([Schema.Struct({
      blockId: Schema.NonEmptyString,
      noteId: Schema.NonEmptyString,
      topicId: Schema.NonEmptyString,
    })]), DesktopStoredTopicBlockSchema),
    listFavoriteNotes: operation(optionalArgument(Schema.Struct({
      limit: Schema.optionalKey(PositiveIntegerSchema),
    })), DesktopFavoriteNotesSchema),
    listNotes: operation(optionalArgument(Schema.Struct({
      page: Schema.optionalKey(PositiveIntegerSchema),
      pageSize: Schema.optionalKey(PositiveIntegerSchema),
      sortBy: Schema.optionalKey(Schema.Literals(['createdAt', 'title', 'updatedAt'])),
      sortDirection: Schema.optionalKey(Schema.Literals(['asc', 'desc'])),
    })), DesktopNotePageSchema),
    listRecentNotes: operation(optionalArgument(Schema.Struct({
      limit: Schema.optionalKey(PositiveIntegerSchema),
    })), DesktopRecentNotesSchema),
    listTodoTasks: operation(optionalArgument(Schema.Struct({
      cursor: Schema.optionalKey(PositiveIntegerSchema),
      limit: Schema.optionalKey(PositiveIntegerSchema),
      status: Schema.optionalKey(Schema.Literals(['todo', 'doing', 'done'])),
    })), DesktopTodoTaskPageSchema),
    createTodoTask: operation(Schema.Tuple([CreateDesktopTodoTaskInputSchema]), DesktopTodoTaskSchema),
    listTodoCalendarEvents: operation(Schema.Tuple([Schema.Struct({
      from: JournalDateSchema,
      through: JournalDateSchema,
    })]), DesktopTodoCalendarEventsSchema),
    listTodoCalendarSubscriptions: operation(EmptyArgumentsSchema, DesktopTodoCalendarSubscriptionsSchema),
    refreshTodoCalendar: operation(StringArgumentSchema, DesktopTodoCalendarSubscriptionSchema),
    removeTodoCalendar: operation(StringArgumentSchema, NullResultSchema),
    subscribeTodoCalendar: operation(Schema.Tuple([Schema.Struct({
      title: Schema.String,
      url: Schema.NonEmptyString,
    })]), DesktopTodoCalendarSubscriptionSchema),
    updateTodoTask: operation(Schema.Tuple([Schema.Struct({
      blockId: Schema.NonEmptyString,
      schedule: Schema.optionalKey(TaskScheduleSchema),
      nextDueDate: Schema.optionalKey(nullable(JournalDateSchema)),
      noteId: Schema.NonEmptyString,
      onlyThis: Schema.optionalKey(Schema.Boolean),
      reminderMinutes: Schema.optionalKey(nullable(TaskReminderMinutesSchema)),
      reminders: Schema.optionalKey(nullable(Schema.Array(TaskReminderSchema))),
      repeatRule: Schema.optionalKey(nullable(Schema.Struct({
        anchorDate: Schema.optionalKey(JournalDateSchema),
        calendarId: Schema.optionalKey(Schema.NonEmptyString),
        endDate: Schema.optionalKey(JournalDateSchema),
        holidayPolicy: Schema.optionalKey(Schema.Literals(['allow', 'skip', 'next-workday'])),
        interval: PositiveIntegerSchema,
        lunarDay: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 }))),
        lunarMonth: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }))),
        mode: Schema.Literals(['due', 'completion', 'custom']),
        monthDay: Schema.optionalKey(Schema.Union([Schema.Literal('last'), Schema.Int.check(Schema.isBetween({ maximum: 31, minimum: 1 }))])),
        monthMode: Schema.optionalKey(Schema.Literals(['date', 'weekday', 'workday'])),
        monthOrdinal: Schema.optionalKey(Schema.Literals([-1, 1, 2, 3, 4, 5])),
        monthWeekday: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 }))),
        skipHolidays: Schema.optionalKey(Schema.Boolean),
        skipWeekends: Schema.optionalKey(Schema.Boolean),
        unit: Schema.Literals(['day', 'week', 'month', 'year', 'holiday', 'lunar']),
        weekdays: Schema.optionalKey(Schema.Array(Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })))),
        yearDay: Schema.optionalKey(Schema.Union([Schema.Literal('last'), Schema.Int.check(Schema.isBetween({ maximum: 31, minimum: 1 }))])),
        yearMode: Schema.optionalKey(Schema.Literals(['date', 'weekday'])),
        yearMonth: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }))),
        yearOrdinal: Schema.optionalKey(Schema.Literals([-1, 1, 2, 3, 4, 5])),
        yearWeekday: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 }))),
      }))),
      status: Schema.optionalKey(Schema.Literals(['todo', 'doing', 'done'])),
      text: Schema.optionalKey(Schema.String),
      topicId: Schema.NonEmptyString,
    })]), DesktopNoteExternalUpdateSchema),
    openMostRecentNote: operation(EmptyArgumentsSchema, DesktopNoteSchema),
    recordNoteOpened: operation(Schema.Tuple([Schema.Struct({
      noteId: Schema.NonEmptyString,
      topicId: Schema.NonEmptyString,
    })]), NullResultSchema),
    renameNote: operation(Schema.Tuple([Schema.Struct({
      noteId: Schema.NonEmptyString,
      title: Schema.String,
    })]), RenameDesktopNoteResultSchema),
    saveNoteUpdates: operation(Schema.Tuple([Schema.Struct({
      noteId: Schema.NonEmptyString,
      updates: Schema.Array(Schema.Uint8ArrayFromBase64),
    })]), DesktopNoteWriteReceiptSchema),
    searchNotes: operation(Schema.Tuple([Schema.Struct({
      limit: Schema.optionalKey(PositiveIntegerSchema),
      query: Schema.String,
    })]), DesktopNoteSearchHitsSchema),
    searchTopicBlocks: operation(Schema.Tuple([Schema.Struct({
      limit: Schema.optionalKey(PositiveIntegerSchema),
      mode: Schema.optionalKey(Schema.Literals(['hybrid', 'lexical', 'semantic'])),
      noteId: Schema.optionalKey(Schema.NonEmptyString),
      query: Schema.String,
    })]), DesktopTopicBlockSearchHitsSchema),
    setNoteFavorite: operation(Schema.Tuple([Schema.Struct({
      favorite: Schema.Boolean,
      noteId: Schema.NonEmptyString,
    })]), DesktopNoteFavoriteStateSchema),
    deleteNote: operation(Schema.Tuple([Schema.Struct({ noteId: Schema.NonEmptyString })]), DeleteDesktopNoteImpactSchema),
    exportNoteMemo: contextualOperation(
      Schema.Tuple([Schema.Struct({ noteId: Schema.NonEmptyString })]),
      NoteExportResultSchema,
    ),
    exportNotePdf: contextualOperation(
      Schema.Tuple([Schema.Struct({ noteId: Schema.NonEmptyString })]),
      NoteExportResultSchema,
    ),
    importNote: contextualOperation(EmptyArgumentsSchema, NoteImportResultSchema),
    startNoteExport: contextualOperation(
      Schema.Tuple([Schema.Struct({
        format: Schema.Literals(['memo', 'pdf']),
        noteId: Schema.NonEmptyString,
      })]),
      NoteTransferStartSchema,
    ),
    prepareNoteImport: contextualOperation(EmptyArgumentsSchema, NoteTransferStartSchema),
    getNoteTransfer: contextualOperation(Schema.Tuple([Schema.NonEmptyString]), NoteTransferStateSchema),
    continueNoteTransfer: contextualOperation(
      Schema.Tuple([Schema.Struct({
        decision: NoteTransferDecisionSchema,
        operationId: Schema.NonEmptyString,
      })]),
      NoteTransferStateSchema,
    ),
    cancelNoteTransfer: contextualOperation(Schema.Tuple([Schema.NonEmptyString]), NoteTransferStateSchema),
  },
  shelf: {
    addSource: operation(Schema.Tuple([AddShelfSourceInputSchema]), ShelfSourceSchema),
    deleteReading: contextualOperation(StringArgumentSchema, Schema.Boolean),
    getAsset: operation(Schema.Tuple([ShelfAssetInputSchema]), ShelfAssetResultSchema),
    getCachedView: operation(Schema.Tuple([BrowseShelfInputSchema]), ShelfBrowseResultSchema),
    getPublicationDetails: operation(Schema.Tuple([ShelfPublicationDetailsInputSchema]), ShelfPublicationDetailsSchema),
    listSources: operation(EmptyArgumentsSchema, Schema.Array(ShelfSourceSchema)),
    openReading: operation(Schema.Tuple([OpenShelfReadingInputSchema]), ShelfReadingDocumentSchema),
    prepareReading: operation(Schema.Tuple([PrepareShelfReadingInputSchema]), PreparedShelfReadingSchema),
    readReadingRange: operation(Schema.Tuple([ShelfReadingRangeInputSchema]), Schema.Uint8ArrayFromBase64),
    refreshView: operation(Schema.Tuple([BrowseShelfInputSchema]), ShelfBrowseResultSchema),
    removeSource: operation(StringArgumentSchema, NullResultSchema),
    updateSource: operation(Schema.Tuple([UpdateShelfSourceInputSchema]), ShelfSourceSchema),
  },
  window: {
    showApplicationMenu: contextualOperation(Schema.Tuple([Schema.Struct({
      anchor: Schema.Struct({ x: Schema.Int, y: Schema.Int }),
      menu: Schema.Literals(['file', 'edit', 'view', 'window']),
    })]), NullResultSchema),
    setTitlebarAppearance: contextualOperation(Schema.Tuple([Schema.Struct({
      backgroundColor: Schema.String.check(Schema.isPattern(/^#[\da-f]{6}$/i)),
      symbolColor: Schema.String.check(Schema.isPattern(/^#[\da-f]{6}$/i)),
    })]), NullResultSchema),
    captureReaderRegion: contextualOperation(Schema.Tuple([CaptureReaderRegionInputSchema]), Schema.Uint8ArrayFromBase64),
    showColumnVisibilityMenu: contextualOperation(
      Schema.Tuple([ShowColumnVisibilityMenuInputSchema]),
      ColumnVisibilityMenuResultSchema,
    ),
  },
} as const

export type DesktopOperationSchemas = typeof desktopOperationSchemas
export type DesktopOperationGroup = keyof DesktopOperationSchemas
export type DesktopOperationMethod<Group extends DesktopOperationGroup> = keyof DesktopOperationSchemas[Group]
export type DesktopOperationArguments<
  Group extends DesktopOperationGroup,
  Method extends DesktopOperationMethod<Group>,
> = DesktopOperationSchemas[Group][Method] extends OperationDefinition<infer Arguments, infer _Result, infer _Contextual>
  ? Arguments['Type'] extends readonly unknown[] ? Arguments['Type'] : never
  : never
export type DesktopOperationResult<
  Group extends DesktopOperationGroup,
  Method extends DesktopOperationMethod<Group>,
> = DesktopOperationSchemas[Group][Method] extends OperationDefinition<infer _Arguments, infer Result, infer _Contextual>
  ? Result['Type']
  : never

type Awaitable<Value> = Promise<Value> | Value
type HandlerArguments<Arguments extends EffectSchema.Top> = Arguments['Type'] extends readonly unknown[]
  ? [...Arguments['Type']]
  : never
type HandlerFor<Definition, RequestContext> = Definition extends OperationDefinition<
  infer Arguments,
  infer Result,
  infer Contextual
> ? Contextual extends true
    ? { invoke: (context: RequestContext, ...args: HandlerArguments<Arguments>) => Awaitable<Result['Type']> }
    : (...args: HandlerArguments<Arguments>) => Awaitable<Result['Type']>
  : never

export type DesktopOperationHandlers<RequestContext = unknown> = {
  readonly [Group in DesktopOperationGroup]: {
    readonly [Method in DesktopOperationMethod<Group>]: HandlerFor<DesktopOperationSchemas[Group][Method], RequestContext>
  }
}

export interface DesktopHonoRequestContextHandler<Arguments extends readonly unknown[], Result, RequestContext> {
  invoke: (context: RequestContext, ...args: Arguments) => Awaitable<Result>
}

export function withDesktopHonoRequestContext<Arguments extends readonly unknown[], Result, RequestContext>(
  invoke: (context: RequestContext, ...args: Arguments) => Awaitable<Result>,
): DesktopHonoRequestContextHandler<Arguments, Result, RequestContext> {
  return { invoke }
}

export type PortableDesktopApi = Omit<DesktopApi, | 'captureReaderRegion'
  | 'closeBookReadingSession'
  | 'createBookContext'
  | 'deleteShelfReading'
  | 'exportDatabase'
  | 'rebindBookContext'
  | 'reclaimAssets'
  | 'restoreDatabase'
  | 'selectBookContext'
  | 'showColumnVisibilityMenu'>
