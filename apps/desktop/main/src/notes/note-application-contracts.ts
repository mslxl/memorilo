import type { CreateDesktopTopicInput } from '@memorilo/desktop-api'
import type { JournalDate, TodoReminder, TodoRepeatRule, TodoSchedule, TodoTaskStatus } from '@memorilo/editor-storage'
import type { ReviewCardProjection } from '@memorilo/editor/card'
import type { TopicBlockEdit } from '@memorilo/editor/note'
import type { RecurringTaskCompletionAction } from '@memorilo/editor/task'
import type { BookFileBinding } from '@memorilo/reading-model'
import type { BookTopicReadingContext } from './note-application-projection'

export type { ApplicationNoteDocument, BookTopicReadingContext } from './note-application-projection'

export interface CreateNoteInput {
  initialHeading?: string
  initialTopic?: CreateDesktopTopicInput
  title?: string
}

export interface CreateBookNoteInput {
  book: BookFileBinding
  noteTitle: string
  topicTitle: string
}

export type CreateBookNoteResult
  = | { context: BookTopicReadingContext, status: 'created' }
    | { status: 'duplicate-title' }

export interface RenameNoteInput {
  noteId: string
  title: string
}

export interface DeleteNoteInput {
  noteId: string
}

export interface OpenJournalInput {
  journalDate?: JournalDate
}

export interface ListPastJournalsInput {
  before?: JournalDate
  limit?: number
}

export interface ListJournalDatesInput {
  from: JournalDate
  through: JournalDate
}

export interface NoteApplicationServiceOptions {
  autoCompleteTodoParents?: () => boolean
  defaultNoteLearningEnabled?: () => boolean
  now?: () => Date
  recurringTaskCompletionAction?: () => RecurringTaskCompletionAction
}

export interface ApplyTopicEditsInput {
  edits: readonly TopicBlockEdit[]
  expectedRevision: string
  noteId: string
  topicId: string
}

export interface RenameTopicInput {
  expectedRevision: string
  noteId: string
  title: string
  topicId: string
}

export interface SetTopicModeInput {
  expectedRevision: string
  mode: 0 | 1
  noteId: string
  topicId: string
}

export interface RebindBookTopicInput {
  book: BookFileBinding
  noteId: string
  topicId: string
}

export interface NoteExternalUpdate {
  noteId: string
  update: Uint8Array
  updatedAt: number
}

export interface GenerateCardTopicInput {
  highlightId: string
  noteId: string
  sourceTopicId: string
}

export interface GenerateCardTopicResult extends NoteExternalUpdate {
  cardTopicId: string
}

export interface SaveNoteUpdatesInput {
  noteId: string
  updates: readonly Uint8Array[]
}

export interface UpdateTodoTaskInput {
  schedule?: TodoSchedule
  blockId: string
  nextDueDate?: JournalDate | null
  noteId: string
  onlyThis?: boolean
  reminderMinutes?: number | null
  reminders?: readonly TodoReminder[] | null
  repeatRule?: TodoRepeatRule | null
  status?: TodoTaskStatus
  text?: string
  topicId: string
}

export interface CreateTodoTaskInput {
  schedule?: TodoSchedule
  text: string
}

export interface GetNoteCardProjectionInput {
  cardId: string
  noteId: string
  topicId: string
}

export interface NoteCardProjection {
  card: ReviewCardProjection
  noteTitle: string
  topicTitle: string
  updatedAt: number
}

export class NoteRevisionConflictError extends Error {
  override readonly name = 'NoteRevisionConflictError'

  constructor(readonly currentRevision: string) {
    super('The Note changed after it was read')
  }
}

export class NoteCardProjectionNotFoundError extends Error {
  override readonly name = 'NoteCardProjectionNotFoundError'

  constructor(
    readonly noteId: string,
    readonly topicId: string,
    readonly cardId: string,
  ) {
    super(`Note ${noteId} Topic ${topicId} does not contain Card ${cardId}`)
  }
}
