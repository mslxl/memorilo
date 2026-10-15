import type { EditorStorageDatabase, StorageOperationRunner } from './database-driver'
import type {
  EditorTodoStorage,
  ListTodoTasksInput,
  TodoReminder,
  TodoRepeatRule,
  TodoTask,
  TodoTaskPage,
  TodoTaskStatus,
} from './editor-storage-contracts'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { journals, noteFavorites, notes, topicBlocks, topics } from './drizzle-schema'
import { resolveLimit } from './editor-storage-shared'

interface TodoTaskProjectionRow {
  attributes_json: string
  block_id: string
  journal_date: string | null
  note_favorite_row_id: number | null
  note_id: string
  note_row_id: number
  note_title: string
  parent_block_id: string | null
  task_row_id: number
  text: string
  topic_id: string
  topic_title: string
}

interface TopicBlockParentRow {
  block_id: string
  kind: string
  note_row_id: number
  parent_block_id: string | null
  topic_id: string
}

interface TodoTaskRow {
  block_id: string
  elapsed_ms: number | null
  journal_date: string | null
  note_id: string
  note_favorite: number
  note_title: string
  parent_block_id: string | null
  repeat_rule: string | null
  schedule: string | null
  reminder_minutes: number | null
  reminders: string | null
  started_at: number | null
  status: string | null
  text: string
  topic_id: string
  topic_title: string
  task_row_id: number
  todo_parent_id: string | null
}

interface EditorTodoRepositoryOptions {
  database: EditorStorageDatabase
  runOperation: StorageOperationRunner
}

function resolveCursor(cursor: number | undefined): number | null {
  if (cursor === undefined)
    return null
  if (!Number.isSafeInteger(cursor) || cursor < 1)
    throw new RangeError('Todo task cursor must be a positive safe integer')
  return cursor
}

function resolveStatus(status: TodoTaskStatus | undefined): TodoTaskStatus | null {
  if (status === undefined)
    return null
  if (status !== 'todo' && status !== 'doing' && status !== 'done')
    throw new TypeError(`Unknown Todo task status: ${String(status)}`)
  return status
}

function readFiniteNumber(value: number | null, name: string, allowNull: true): number | null
function readFiniteNumber(value: number | null, name: string, allowNull: false): number
function readFiniteNumber(value: number | null, name: string, allowNull: boolean): number | null {
  if (value === null && allowNull)
    return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new TypeError(`Stored Todo task ${name} must be a non-negative finite number`)
  return value
}

function readReminders(value: string | null, blockId: string): readonly TodoReminder[] | null {
  if (value === null)
    return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  }
  catch (error) {
    throw new TypeError(`Stored Todo task ${blockId} has invalid reminders`, { cause: error })
  }
  if (!Array.isArray(parsed) || parsed.length > 8)
    throw new TypeError(`Stored Todo task ${blockId} has invalid reminders`)
  const reminders: TodoReminder[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null)
      throw new TypeError(`Stored Todo task ${blockId} has invalid reminders`)
    const candidate = item as Record<string, unknown>
    if (candidate.kind === 'offset'
      && typeof candidate.minutes === 'number'
      && Number.isSafeInteger(candidate.minutes)
      && candidate.minutes >= 0
      && candidate.minutes <= 10080) {
      reminders.push({ kind: 'offset', minutes: candidate.minutes })
      continue
    }
    if (candidate.kind === 'time'
      && typeof candidate.time === 'string'
      && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(candidate.time)) {
      reminders.push({ kind: 'time', time: candidate.time })
      continue
    }
    throw new TypeError(`Stored Todo task ${blockId} has invalid reminders`)
  }
  if (new Set(reminders.map(reminder => JSON.stringify(reminder))).size !== reminders.length)
    throw new TypeError(`Stored Todo task ${blockId} has duplicate reminders`)
  return reminders
}

function parseTaskAttributes(value: string, blockId: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  }
  catch (error) {
    throw new TypeError(`Stored Todo task ${blockId} has invalid attributes`, { cause: error })
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')
    throw new TypeError(`Stored Todo task ${blockId} has invalid attributes`)
  return parsed as Record<string, unknown>
}

function serializedAttribute(attributes: Record<string, unknown>, key: string): string | null {
  const value = attributes[key]
  return value === undefined || value === null ? null : JSON.stringify(value)
}

function todoParentKey(noteRowId: number, topicId: string, blockId: string): string {
  return `${noteRowId}\u0000${topicId}\u0000${blockId}`
}

function nearestTodoParent(
  task: Pick<TodoTaskProjectionRow, 'block_id' | 'note_row_id' | 'parent_block_id' | 'topic_id'>,
  blocks: ReadonlyMap<string, TopicBlockParentRow>,
): string | null {
  let ancestorId = task.parent_block_id
  const visited = new Set<string>([task.block_id])
  while (ancestorId !== null) {
    if (visited.has(ancestorId))
      throw new Error(`Todo task ${task.block_id} contains a cyclic parent chain`)
    visited.add(ancestorId)
    const ancestor = blocks.get(todoParentKey(task.note_row_id, task.topic_id, ancestorId))
    if (!ancestor)
      return null
    if (ancestor.kind === 'task')
      return ancestor.block_id
    ancestorId = ancestor.parent_block_id
  }
  return null
}

function projectTodoTaskRow(
  row: TodoTaskProjectionRow,
  attributes: Record<string, unknown>,
  todoParentId: string | null,
): TodoTaskRow {
  return {
    block_id: row.block_id,
    elapsed_ms: (attributes.elapsedMs ?? null) as number | null,
    journal_date: row.journal_date,
    note_favorite: row.note_favorite_row_id === null ? 0 : 1,
    note_id: row.note_id,
    note_title: row.note_title,
    parent_block_id: row.parent_block_id,
    reminder_minutes: (attributes.reminderMinutes ?? null) as number | null,
    reminders: serializedAttribute(attributes, 'reminders'),
    repeat_rule: serializedAttribute(attributes, 'repeatRule'),
    schedule: serializedAttribute(attributes, 'schedule'),
    started_at: (attributes.startedAt ?? null) as number | null,
    status: (attributes.status ?? null) as string | null,
    task_row_id: row.task_row_id,
    text: row.text,
    todo_parent_id: todoParentId,
    topic_id: row.topic_id,
    topic_title: row.topic_title,
  }
}

function toTodoTask(row: TodoTaskRow): TodoTask {
  if (row.status !== 'todo' && row.status !== 'doing' && row.status !== 'done')
    throw new TypeError(`Stored Todo task ${row.block_id} has an invalid status`)
  if (row.block_id.length === 0 || row.note_id.length === 0 || row.topic_id.length === 0)
    throw new TypeError(`Stored Todo task ${row.block_id} has an invalid identity`)
  if (row.note_favorite !== 0 && row.note_favorite !== 1)
    throw new TypeError(`Stored Todo task ${row.block_id} has an invalid note favorite flag`)
  if (row.journal_date !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(row.journal_date))
    throw new TypeError(`Stored Todo task ${row.block_id} has an invalid journal date`)
  if (row.reminder_minutes !== null
    && (!Number.isSafeInteger(row.reminder_minutes) || row.reminder_minutes < 0 || row.reminder_minutes > 10080)) {
    throw new TypeError(`Stored Todo task ${row.block_id} has an invalid reminder`)
  }
  let repeatRule: TodoRepeatRule | null = null
  if (row.repeat_rule !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.repeat_rule)
    }
    catch (error) {
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat metadata`, { cause: error })
    }
    if (parsed === null || typeof parsed !== 'object')
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat metadata`)
    const candidate = parsed as Record<string, unknown>
    if ((candidate.mode !== 'due' && candidate.mode !== 'completion' && candidate.mode !== 'custom')
      || (candidate.unit !== 'day' && candidate.unit !== 'week' && candidate.unit !== 'month' && candidate.unit !== 'year' && candidate.unit !== 'holiday' && candidate.unit !== 'lunar')
      || typeof candidate.interval !== 'number'
      || !Number.isSafeInteger(candidate.interval)
      || candidate.interval < 1
      || candidate.interval > 999) {
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat metadata`)
    }
    if (candidate.calendarId !== undefined && (typeof candidate.calendarId !== 'string' || candidate.calendarId.length === 0))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat calendar`)
    if (candidate.anchorDate !== undefined && (typeof candidate.anchorDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(candidate.anchorDate)))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat anchor date`)
    if (candidate.mode === 'custom' && candidate.anchorDate === undefined)
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid custom repeat anchor date`)
    if (candidate.endDate !== undefined && (typeof candidate.endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(candidate.endDate)))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat end date`)
    if (candidate.holidayPolicy !== undefined
      && candidate.holidayPolicy !== 'allow'
      && candidate.holidayPolicy !== 'skip'
      && candidate.holidayPolicy !== 'next-workday') {
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid holiday policy`)
    }
    if (candidate.weekdays !== undefined
      && (!Array.isArray(candidate.weekdays)
        || candidate.weekdays.some(day => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6))) {
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat weekdays`)
    }
    if (candidate.monthMode !== undefined && candidate.monthMode !== 'date' && candidate.monthMode !== 'weekday' && candidate.monthMode !== 'workday')
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat month mode`)
    if (candidate.yearMode !== undefined && candidate.yearMode !== 'date' && candidate.yearMode !== 'weekday')
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat year mode`)
    const validOrdinal = (value: unknown): boolean => value === -1 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5
    if (candidate.monthOrdinal !== undefined && !validOrdinal(candidate.monthOrdinal))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat month ordinal`)
    if (candidate.yearOrdinal !== undefined && !validOrdinal(candidate.yearOrdinal))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat year ordinal`)
    const validDay = (value: unknown): boolean => value === 'last' || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 31)
    if (candidate.monthDay !== undefined && !validDay(candidate.monthDay))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat month day`)
    if (candidate.yearDay !== undefined && !validDay(candidate.yearDay))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat year day`)
    const validMonth = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 12
    if (candidate.yearMonth !== undefined && !validMonth(candidate.yearMonth))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat year month`)
    if (candidate.lunarMonth !== undefined && !validMonth(candidate.lunarMonth))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat lunar month`)
    if (candidate.lunarDay !== undefined && (typeof candidate.lunarDay !== 'number' || !Number.isSafeInteger(candidate.lunarDay) || candidate.lunarDay < 1 || candidate.lunarDay > 30))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat lunar day`)
    if (candidate.unit === 'lunar' && (candidate.lunarMonth === undefined || candidate.lunarDay === undefined))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid lunar repeat date`)
    if (candidate.monthWeekday !== undefined && (typeof candidate.monthWeekday !== 'number' || !Number.isInteger(candidate.monthWeekday) || candidate.monthWeekday < 0 || candidate.monthWeekday > 6))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat month weekday`)
    if (candidate.yearWeekday !== undefined && (typeof candidate.yearWeekday !== 'number' || !Number.isInteger(candidate.yearWeekday) || candidate.yearWeekday < 0 || candidate.yearWeekday > 6))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat year weekday`)
    if (candidate.skipHolidays !== undefined && typeof candidate.skipHolidays !== 'boolean')
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat holiday skip`)
    if (candidate.skipWeekends !== undefined && typeof candidate.skipWeekends !== 'boolean')
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid repeat weekend skip`)
    if ((candidate.unit === 'holiday' || candidate.skipHolidays === true || (candidate.holidayPolicy !== undefined && candidate.holidayPolicy !== 'allow'))
      && typeof candidate.calendarId !== 'string') {
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid holiday repeat calendar`)
    }
    repeatRule = structuredClone(candidate) as unknown as TodoRepeatRule
  }
  let schedule: TodoTask['schedule']
  if (row.schedule !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.schedule)
    }
    catch (error) {
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid schedule`, { cause: error })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid schedule`)
    const candidate = parsed as Record<string, unknown>
    if (candidate.kind === 'none') {
      schedule = { kind: 'none' }
    }
    else if (candidate.kind === 'deadline'
      && typeof candidate.date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/u.test(candidate.date)
      && (candidate.time === null || (typeof candidate.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(candidate.time)))) {
      schedule = { date: candidate.date, kind: 'deadline', time: candidate.time as string | null }
    }
    else if (candidate.kind === 'span'
      && typeof candidate.start === 'string'
      && typeof candidate.end === 'string'
      && typeof candidate.allDay === 'boolean'
      && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/u.test(candidate.start)
      && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/u.test(candidate.end)
      && candidate.end > candidate.start) {
      schedule = { allDay: candidate.allDay, end: candidate.end, kind: 'span', start: candidate.start }
    }
    else {
      throw new TypeError(`Stored Todo task ${row.block_id} has invalid schedule`)
    }
  }
  else {
    throw new TypeError(`Stored Todo task ${row.block_id} is missing a schedule`)
  }
  return {
    blockId: row.block_id,
    elapsedMs: readFiniteNumber(row.elapsed_ms, 'elapsedMs', false),
    journalDate: row.journal_date,
    noteId: row.note_id,
    noteFavorite: row.note_favorite === 1,
    noteTitle: row.note_title,
    parentId: row.parent_block_id,
    todoParentId: row.todo_parent_id,
    repeatRule,
    schedule,
    reminderMinutes: row.reminder_minutes,
    reminders: readReminders(row.reminders, row.block_id),
    startedAt: readFiniteNumber(row.started_at, 'startedAt', true),
    status: row.status,
    text: row.text,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
  }
}

export class EditorTodoRepository implements EditorTodoStorage {
  readonly #options: EditorTodoRepositoryOptions

  constructor(options: EditorTodoRepositoryOptions) {
    this.#options = options
  }

  readonly list = (input: ListTodoTasksInput = {}): Promise<TodoTaskPage> => {
    const cursor = resolveCursor(input.cursor)
    const limit = resolveLimit(input.limit, 100, 500)
    const status = resolveStatus(input.status)

    return this.#options.runOperation(async () => {
      const candidates = this.#options.database.drizzle.select({
        attributes_json: topicBlocks.attributesJson,
        block_id: topicBlocks.blockId,
        journal_date: journals.journalDate,
        note_favorite_row_id: noteFavorites.noteRowId,
        note_id: notes.id,
        note_row_id: topicBlocks.noteRowId,
        note_title: notes.title,
        parent_block_id: topicBlocks.parentBlockId,
        task_row_id: topicBlocks.rowId,
        text: topicBlocks.text,
        topic_id: topicBlocks.topicId,
        topic_title: topics.title,
      }).from(topicBlocks).innerJoin(notes, eq(notes.rowId, topicBlocks.noteRowId)).leftJoin(journals, eq(journals.noteRowId, notes.rowId)).leftJoin(noteFavorites, eq(noteFavorites.noteRowId, notes.rowId)).innerJoin(topics, and(eq(topics.noteRowId, topicBlocks.noteRowId), eq(topics.topicId, topicBlocks.topicId))).where(and(eq(topicBlocks.kind, 'task'), cursor === null ? undefined : lt(topicBlocks.rowId, cursor))).orderBy(desc(topicBlocks.rowId)).all() as TodoTaskProjectionRow[]
      const matching = candidates.map(row => ({
        attributes: parseTaskAttributes(row.attributes_json, row.block_id),
        row,
      })).filter(candidate => status === null || candidate.attributes.status === status)
      const hasMore = matching.length > limit
      const pageCandidates = hasMore ? matching.slice(0, limit) : matching
      const noteRowIds = [...new Set(pageCandidates.map(candidate => candidate.row.note_row_id))]
      const parentRows = noteRowIds.length === 0
        ? []
        : this.#options.database.drizzle.select({
          block_id: topicBlocks.blockId,
          kind: topicBlocks.kind,
          note_row_id: topicBlocks.noteRowId,
          parent_block_id: topicBlocks.parentBlockId,
          topic_id: topicBlocks.topicId,
        }).from(topicBlocks).where(inArray(topicBlocks.noteRowId, noteRowIds)).all() as TopicBlockParentRow[]
      const parentByKey = new Map(parentRows.map(row => [
        todoParentKey(row.note_row_id, row.topic_id, row.block_id),
        row,
      ]))
      const pageRows = pageCandidates.map(candidate => projectTodoTaskRow(
        candidate.row,
        candidate.attributes,
        nearestTodoParent(candidate.row, parentByKey),
      ))
      const items = pageRows.map(toTodoTask)
      const lastRow = pageRows.at(-1)
      if (hasMore && lastRow && !Number.isSafeInteger(lastRow.task_row_id))
        throw new RangeError('Stored Todo task row id exceeds the safe cursor range')
      return {
        items,
        nextCursor: hasMore
          ? (() => {
              if (!lastRow)
                throw new Error('Todo task page marked as continuing without a last row')
              return lastRow.task_row_id
            })()
          : null,
      }
    })
  }
}
