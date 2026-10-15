import type { Schema as EffectSchema } from 'effect'
import type {
  DeleteDesktopNoteImpact,
  DesktopFavoriteNoteItem,
  DesktopJournalNote,
  DesktopJournalPage,
  DesktopNote,
  DesktopNoteExternalUpdate,
  DesktopNoteFavoriteState,
  DesktopNotePage,
  DesktopNoteSearchHit,
  DesktopNoteSummary,
  DesktopNoteWriteReceipt,
  DesktopRecentNoteItem,
  DesktopStoredTopicBlock,
  DesktopTodoCalendarEvent,
  DesktopTodoCalendarSubscription,
  DesktopTodoRepeatRule,
  DesktopTodoSchedule,
  DesktopTodoTask,
  DesktopTodoTaskPage,
  DesktopTopicBlockSearchHit,
  GenerateDesktopCardTopicResult,
  JournalDate,
  PruneDesktopPastEmptyJournalsResult,
  RenameDesktopNoteResult,
} from '../contract'
import { Schema } from 'effect'
import {
  NonNegativeIntegerSchema,
  nullable,
  PositiveIntegerSchema,
} from './common'

export const JournalDateSchema: EffectSchema.Codec<JournalDate> = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
)

export const TaskTimeSchema = Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u))
export const TaskDateTimeSchema = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/u))
export const TaskScheduleSchema: EffectSchema.Codec<DesktopTodoSchedule> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('none') }),
  Schema.Struct({ date: JournalDateSchema, kind: Schema.Literal('deadline'), time: nullable(TaskTimeSchema) }),
  Schema.Struct({ allDay: Schema.Boolean, end: TaskDateTimeSchema, kind: Schema.Literal('span'), start: TaskDateTimeSchema }),
]) as EffectSchema.Codec<DesktopTodoSchedule>
export const TaskReminderMinutesSchema = Schema.Int.check(Schema.isBetween({ maximum: 10080, minimum: 0 }))
export const TaskReminderSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('offset'), minutes: TaskReminderMinutesSchema }),
  Schema.Struct({ kind: Schema.Literal('time'), time: TaskTimeSchema }),
])

const DesktopNoteBaseFields = {
  createdAt: Schema.Number,
  favorite: Schema.Boolean,
  id: Schema.NonEmptyString,
  snapshot: Schema.Uint8ArrayFromBase64,
  title: Schema.String,
  updatedAt: Schema.Number,
} as const

const DesktopRegularNoteSchema = Schema.Struct({
  ...DesktopNoteBaseFields,
  kind: Schema.Literal('regular'),
})

export const DesktopJournalNoteSchema: EffectSchema.Codec<DesktopJournalNote, {
  readonly createdAt: number
  readonly favorite: boolean
  readonly id: string
  readonly journalDate: string
  readonly kind: 'journal'
  readonly snapshot: string
  readonly title: string
  readonly topicId: string
  readonly updatedAt: number
}> = Schema.Struct({
  ...DesktopNoteBaseFields,
  journalDate: JournalDateSchema,
  kind: Schema.Literal('journal'),
  topicId: Schema.NonEmptyString,
})

export const DesktopNoteSchema: EffectSchema.Codec<DesktopNote, unknown> = Schema.Union([
  DesktopRegularNoteSchema,
  DesktopJournalNoteSchema,
])

const DesktopNoteSummaryBaseFields = {
  createdAt: Schema.Number,
  favorite: Schema.Boolean,
  id: Schema.NonEmptyString,
  title: Schema.String,
  updatedAt: Schema.Number,
} as const

const DesktopRegularNoteSummarySchema = Schema.Struct({
  ...DesktopNoteSummaryBaseFields,
  kind: Schema.Literal('regular'),
})

const DesktopJournalNoteSummarySchema = Schema.Struct({
  ...DesktopNoteSummaryBaseFields,
  journalDate: JournalDateSchema,
  kind: Schema.Literal('journal'),
})

export const DesktopNoteSummarySchema: EffectSchema.Codec<DesktopNoteSummary> = Schema.Union([
  DesktopRegularNoteSummarySchema,
  DesktopJournalNoteSummarySchema,
])

export const DesktopNotePageSchema: EffectSchema.Codec<DesktopNotePage> = Schema.Struct({
  items: Schema.Array(DesktopNoteSummarySchema),
  page: PositiveIntegerSchema,
  pageSize: PositiveIntegerSchema,
  totalItems: NonNegativeIntegerSchema,
  totalPages: NonNegativeIntegerSchema,
})

const DesktopJournalSummarySchema = Schema.Struct({
  createdAt: Schema.Number,
  journalDate: JournalDateSchema,
  kind: Schema.Literal('journal'),
  noteId: Schema.NonEmptyString,
  title: Schema.String,
  topicId: Schema.NonEmptyString,
  updatedAt: Schema.Number,
})

export const DesktopJournalPageSchema: EffectSchema.Codec<DesktopJournalPage> = Schema.Struct({
  items: Schema.Array(DesktopJournalSummarySchema),
  nextCursor: nullable(JournalDateSchema),
})

const FavoriteNoteBaseFields = {
  favoritedAt: Schema.Number,
  noteId: Schema.NonEmptyString,
  noteTitle: Schema.String,
  topicId: Schema.NonEmptyString,
  topicTitle: Schema.String,
} as const

export const DesktopFavoriteNotesSchema: EffectSchema.Codec<readonly DesktopFavoriteNoteItem[]> = Schema.Array(
  Schema.Union([
    Schema.Struct({ ...FavoriteNoteBaseFields, kind: Schema.Literal('regular') }),
    Schema.Struct({
      ...FavoriteNoteBaseFields,
      journalDate: JournalDateSchema,
      kind: Schema.Literal('journal'),
    }),
  ]),
)

const RecentNoteBaseFields = {
  noteId: Schema.NonEmptyString,
  noteTitle: Schema.String,
  openedAt: Schema.Number,
  topicId: Schema.NonEmptyString,
  topicTitle: Schema.String,
} as const

export const DesktopRecentNotesSchema: EffectSchema.Codec<readonly DesktopRecentNoteItem[]> = Schema.Array(
  Schema.Union([
    Schema.Struct({ ...RecentNoteBaseFields, kind: Schema.Literal('regular') }),
    Schema.Struct({
      ...RecentNoteBaseFields,
      journalDate: JournalDateSchema,
      kind: Schema.Literal('journal'),
    }),
  ]),
)

const DesktopTopicBlockFields = {
  attributes: Schema.Record(Schema.String, Schema.Json),
  id: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  ordinal: NonNegativeIntegerSchema,
  parentId: nullable(Schema.NonEmptyString),
  text: Schema.String,
} as const

export const DesktopStoredTopicBlockSchema: EffectSchema.Codec<DesktopStoredTopicBlock | null, unknown> = nullable(
  Schema.Struct({
    ...DesktopTopicBlockFields,
    contentHash: Schema.NonEmptyString,
    noteId: Schema.NonEmptyString,
    topicId: Schema.NonEmptyString,
  }),
)

export const DesktopTopicBlockSearchHitsSchema: EffectSchema.Codec<readonly DesktopTopicBlockSearchHit[]> = Schema.Array(
  Schema.Struct({
    ...DesktopTopicBlockFields,
    contentHash: Schema.NonEmptyString,
    noteId: Schema.NonEmptyString,
    preview: Schema.String,
    rank: Schema.Number,
    topicId: Schema.NonEmptyString,
  }),
)

export const DesktopTodoTaskSchema: EffectSchema.Codec<DesktopTodoTask> = Schema.Struct({
  schedule: TaskScheduleSchema,
  blockId: Schema.NonEmptyString,
  elapsedMs: NonNegativeIntegerSchema,
  journalDate: nullable(JournalDateSchema),
  noteId: Schema.NonEmptyString,
  noteFavorite: Schema.Boolean,
  noteTitle: Schema.String,
  parentId: nullable(Schema.NonEmptyString),
  todoParentId: Schema.optionalKey(nullable(Schema.NonEmptyString)),
  repeatRule: nullable(Schema.Struct({
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
  }) as EffectSchema.Codec<DesktopTodoRepeatRule | null>),
  reminderMinutes: nullable(TaskReminderMinutesSchema),
  reminders: nullable(Schema.Array(TaskReminderSchema)),
  startedAt: nullable(NonNegativeIntegerSchema),
  status: Schema.Literals(['todo', 'doing', 'done']),
  text: Schema.String,
  topicId: Schema.NonEmptyString,
  topicTitle: Schema.String,
})

export const DesktopTodoTaskPageSchema: EffectSchema.Codec<DesktopTodoTaskPage> = Schema.Struct({
  items: Schema.Array(DesktopTodoTaskSchema),
  nextCursor: nullable(PositiveIntegerSchema),
})

export const CreateDesktopTodoTaskInputSchema = Schema.Struct({
  schedule: Schema.optionalKey(TaskScheduleSchema),
  text: Schema.String,
})

export const DesktopTodoCalendarSubscriptionSchema: EffectSchema.Codec<DesktopTodoCalendarSubscription> = Schema.Struct({
  builtIn: Schema.Boolean,
  enabled: Schema.Boolean,
  etag: nullable(Schema.String),
  fetchedAt: nullable(NonNegativeIntegerSchema),
  id: Schema.NonEmptyString,
  lastModified: nullable(Schema.String),
  title: Schema.String,
  url: Schema.NonEmptyString,
  version: nullable(Schema.NonEmptyString),
})

export const DesktopTodoCalendarSubscriptionsSchema: EffectSchema.Codec<readonly DesktopTodoCalendarSubscription[]> = Schema.Array(DesktopTodoCalendarSubscriptionSchema)

export const DesktopTodoCalendarEventsSchema: EffectSchema.Codec<readonly DesktopTodoCalendarEvent[]> = Schema.Array(Schema.Struct({
  allDay: Schema.optionalKey(Schema.Boolean),
  endDate: nullable(JournalDateSchema),
  endAt: Schema.optionalKey(nullable(TaskDateTimeSchema)),
  startDate: JournalDateSchema,
  startAt: Schema.optionalKey(nullable(TaskDateTimeSchema)),
  subscriptionId: Schema.NonEmptyString,
  subscriptionTitle: Schema.String,
  title: Schema.String,
  uid: Schema.NonEmptyString,
}))

const SearchIdentityRegular = { noteKind: Schema.Literal('regular') } as const
const SearchIdentityJournal = {
  journalDate: JournalDateSchema,
  noteKind: Schema.Literal('journal'),
} as const
const NoteTitleSearchFields = {
  kind: Schema.Literal('note'),
  match: Schema.Literal('title'),
  noteId: Schema.NonEmptyString,
  noteTitle: Schema.String,
  preview: Schema.String,
  rank: Schema.Number,
} as const
const TopicSearchFields = {
  blockId: nullable(Schema.NonEmptyString),
  kind: Schema.Literal('topic'),
  match: Schema.Literals(['content', 'node-start', 'semantic', 'title']),
  noteId: Schema.NonEmptyString,
  noteTitle: Schema.String,
  preview: Schema.String,
  rank: Schema.Number,
  topicId: Schema.NonEmptyString,
  topicTitle: Schema.String,
} as const

export const DesktopNoteSearchHitsSchema: EffectSchema.Codec<readonly DesktopNoteSearchHit[]> = Schema.Array(
  Schema.Union([
    Schema.Struct({ ...NoteTitleSearchFields, ...SearchIdentityRegular }),
    Schema.Struct({ ...NoteTitleSearchFields, ...SearchIdentityJournal }),
    Schema.Struct({ ...TopicSearchFields, ...SearchIdentityRegular }),
    Schema.Struct({ ...TopicSearchFields, ...SearchIdentityJournal }),
  ]),
)

export const RenameDesktopNoteResultSchema: EffectSchema.Codec<RenameDesktopNoteResult> = Schema.Union([
  Schema.Struct({ note: DesktopNoteSummarySchema, status: Schema.Literal('renamed') }),
  Schema.Struct({ status: Schema.Literal('duplicate-title') }),
  Schema.Struct({
    journalDate: JournalDateSchema,
    status: Schema.Literal('journal-title-immutable'),
  }),
])

export const DesktopNoteFavoriteStateSchema: EffectSchema.Codec<DesktopNoteFavoriteState> = Schema.Struct({
  favorite: Schema.Boolean,
  noteId: Schema.NonEmptyString,
})

export const DeleteDesktopNoteImpactSchema: EffectSchema.Codec<DeleteDesktopNoteImpact> = Schema.Struct({
  assetCount: Schema.Int,
  assetReferenceCount: Schema.Int,
  cardCount: Schema.Int,
  noteId: Schema.NonEmptyString,
  topicBlockCount: Schema.Int,
  topicCount: Schema.Int,
})

export const DesktopNoteWriteReceiptSchema: EffectSchema.Codec<DesktopNoteWriteReceipt> = Schema.Struct({
  updatedAt: Schema.Number,
})

export const DesktopNoteExternalUpdateSchema: EffectSchema.Codec<DesktopNoteExternalUpdate, unknown> = Schema.Struct({
  noteId: Schema.NonEmptyString,
  update: Schema.Uint8ArrayFromBase64,
  updatedAt: Schema.Number,
})

export const GenerateDesktopCardTopicResultSchema: EffectSchema.Codec<GenerateDesktopCardTopicResult, unknown> = Schema.Struct({
  cardTopicId: Schema.NonEmptyString,
  noteId: Schema.NonEmptyString,
  update: Schema.Uint8ArrayFromBase64,
  updatedAt: Schema.Number,
})

export const PruneDesktopPastEmptyJournalsResultSchema: EffectSchema.Codec<PruneDesktopPastEmptyJournalsResult> = Schema.Struct({
  deletedNoteIds: Schema.Array(Schema.NonEmptyString),
})
