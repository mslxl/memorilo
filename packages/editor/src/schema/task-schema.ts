import type { Extension } from 'prosekit/core'
import { defineNodeAttr, union } from 'prosekit/core'

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface TaskTimingAttrs {
  checked: boolean
  elapsedMs: number
  startedAt: number | null
  status: TaskStatus
}

export interface TaskScheduleAttrs {
  schedule: TaskSchedule
  reminderMinutes: number | null
  reminders: readonly TaskReminder[] | null
}

/**
 * The explicit schedule carried by a Todo. `none` means that the Todo has no
 * user supplied calendar placement; consumers may apply their own policy for
 * displaying it (the ICS feed uses its request day when configured to do so).
 */
export type TaskSchedule
  = | { kind: 'none' }
    | { date: string, kind: 'deadline', time: string | null }
    | { allDay: boolean, end: string, kind: 'span', start: string }

export type TaskReminder
  = | { kind: 'offset', minutes: number }
    | { kind: 'time', time: string }

export function readTaskStatus(value: unknown): TaskStatus {
  if (value === 'todo' || value === 'doing' || value === 'done')
    return value
  throw new TypeError('Task status must be todo, doing, or done')
}

/** Settle a running span and return the complete timing state for a status change. */
export function transitionTaskAttrs(
  attrs: Readonly<Record<string, unknown>>,
  next: TaskStatus,
  now = Date.now(),
): TaskTimingAttrs {
  if (!Number.isFinite(now))
    throw new TypeError('Task transition time must be finite')
  const current = readTaskStatus(attrs.status)
  const elapsedValue = attrs.elapsedMs
  if (elapsedValue !== undefined && (typeof elapsedValue !== 'number' || !Number.isFinite(elapsedValue) || elapsedValue < 0))
    throw new TypeError('Task elapsedMs must be a non-negative finite number')
  const startedValue = attrs.startedAt
  if (startedValue !== undefined && startedValue !== null && (typeof startedValue !== 'number' || !Number.isFinite(startedValue) || startedValue < 0))
    throw new TypeError('Task startedAt must be a non-negative finite number or null')

  let elapsedMs = typeof elapsedValue === 'number' ? elapsedValue : 0
  let startedAt = typeof startedValue === 'number' ? startedValue : null
  if (current === 'doing' && startedAt !== null) {
    elapsedMs += Math.max(0, now - startedAt)
    startedAt = null
  }
  if (next === 'doing')
    startedAt = now

  return { checked: next === 'done', elapsedMs, startedAt, status: next }
}

export type TaskRepeatMode = 'due' | 'completion' | 'custom'
export type TaskRepeatUnit = 'day' | 'week' | 'month' | 'year' | 'holiday' | 'lunar'
export type TaskRepeatHolidayPolicy = 'allow' | 'skip' | 'next-workday'
export type TaskRepeatMonthMode = 'date' | 'weekday' | 'workday'
export type TaskRepeatYearMode = 'date' | 'weekday'
export type TaskRepeatOrdinal = -1 | 1 | 2 | 3 | 4 | 5
export type TaskRepeatDayOfMonth = number | 'last'

export interface TaskRepeatRule {
  /** A fixed date used when mode is `custom`. */
  anchorDate?: string
  endDate?: string
  holidayPolicy?: TaskRepeatHolidayPolicy
  interval: number
  mode: TaskRepeatMode
  monthDay?: TaskRepeatDayOfMonth
  monthMode?: TaskRepeatMonthMode
  monthOrdinal?: TaskRepeatOrdinal
  monthWeekday?: number
  lunarDay?: number
  lunarMonth?: number
  unit: TaskRepeatUnit
  weekdays?: readonly number[]
  skipHolidays?: boolean
  skipWeekends?: boolean
  yearDay?: TaskRepeatDayOfMonth
  yearMode?: TaskRepeatYearMode
  yearMonth?: number
  yearOrdinal?: TaskRepeatOrdinal
  yearWeekday?: number
  /** The subscribed ICS calendar used by holiday repeats. */
  calendarId?: string
}

const journalDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const taskTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u
const taskDateTimePattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/u

export function parseTaskTime(value: unknown): string | null {
  return typeof value === 'string' && taskTimePattern.test(value) ? value : null
}

export function parseTaskSchedule(value: unknown): TaskSchedule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'none')
    return Object.keys(candidate).length === 1 ? { kind: 'none' } : null
  if (candidate.kind === 'deadline') {
    const date = parseTaskDate(candidate.date)
    const time = candidate.time === null ? null : parseTaskTime(candidate.time)
    if (date === null || (candidate.time !== null && time === null))
      return null
    return { date, kind: 'deadline', time }
  }
  if (candidate.kind === 'span') {
    const start = parseTaskDateTime(candidate.start)
    const end = parseTaskDateTime(candidate.end)
    if (start === null || end === null || end <= start || typeof candidate.allDay !== 'boolean')
      return null
    return { allDay: candidate.allDay, end, kind: 'span', start }
  }
  return null
}

export function parseTaskDateTime(value: unknown): string | null {
  return typeof value === 'string' && taskDateTimePattern.test(value) ? value : null
}

export function parseTaskReminderMinutes(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 10080
    ? value
    : null
}

function parseTaskReminder(value: unknown): TaskReminder | null {
  if (typeof value !== 'object' || value === null)
    return null
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'offset') {
    const minutes = parseTaskReminderMinutes(candidate.minutes)
    return minutes === null ? null : { kind: 'offset', minutes }
  }
  if (candidate.kind === 'time') {
    const time = parseTaskTime(candidate.time)
    return time === null ? null : { kind: 'time', time }
  }
  return null
}

export function parseTaskReminders(value: unknown): readonly TaskReminder[] | null {
  if (value === null || value === undefined)
    return null
  if (typeof value === 'number') {
    const minutes = parseTaskReminderMinutes(value)
    return minutes === null ? null : [{ kind: 'offset', minutes }]
  }
  if (!Array.isArray(value) || value.length > 8)
    return null
  const reminders: TaskReminder[] = []
  for (const item of value) {
    const reminder = parseTaskReminder(item)
    if (reminder === null)
      return null
    if (!reminders.some(current => JSON.stringify(current) === JSON.stringify(reminder)))
      reminders.push(reminder)
  }
  return reminders.sort((left, right) => {
    if (left.kind !== right.kind)
      return left.kind === 'offset' ? -1 : 1
    return left.kind === 'offset'
      ? left.minutes - (right.kind === 'offset' ? right.minutes : 0)
      : left.time.localeCompare(right.kind === 'time' ? right.time : '')
  })
}

export function parseTaskRepeatRule(value: unknown): TaskRepeatRule | null {
  if (typeof value !== 'object' || value === null)
    return null
  const candidate = value as Record<string, unknown>
  const {
    anchorDate,
    calendarId,
    endDate,
    holidayPolicy,
    interval,
    lunarDay,
    lunarMonth,
    mode,
    monthDay,
    monthMode,
    monthOrdinal,
    monthWeekday,
    skipHolidays,
    skipWeekends,
    unit,
    weekdays,
    yearDay,
    yearMode,
    yearMonth,
    yearOrdinal,
    yearWeekday,
  } = candidate
  if (mode !== 'due' && mode !== 'completion' && mode !== 'custom')
    return null
  if (unit !== 'day' && unit !== 'week' && unit !== 'month' && unit !== 'year' && unit !== 'holiday' && unit !== 'lunar')
    return null
  if (typeof interval !== 'number' || !Number.isSafeInteger(interval) || interval < 1 || interval > 999)
    return null
  if (calendarId !== undefined && (typeof calendarId !== 'string' || calendarId.length === 0))
    return null
  const parsedAnchorDate = anchorDate === undefined ? undefined : parseTaskDate(anchorDate)
  if (parsedAnchorDate === null)
    return null
  const parsedEndDate = endDate === undefined ? undefined : parseTaskDate(endDate)
  if (parsedEndDate === null)
    return null
  if (holidayPolicy !== undefined && holidayPolicy !== 'allow' && holidayPolicy !== 'skip' && holidayPolicy !== 'next-workday')
    return null
  if (weekdays !== undefined && (!Array.isArray(weekdays) || weekdays.some(day => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6)))
    return null
  if (mode === 'custom' && parsedAnchorDate === undefined)
    return null
  if (monthMode !== undefined && monthMode !== 'date' && monthMode !== 'weekday' && monthMode !== 'workday')
    return null
  if (yearMode !== undefined && yearMode !== 'date' && yearMode !== 'weekday')
    return null
  const validOrdinal = (value: unknown): value is TaskRepeatOrdinal => value === -1 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5
  if (monthOrdinal !== undefined && !validOrdinal(monthOrdinal))
    return null
  if (yearOrdinal !== undefined && !validOrdinal(yearOrdinal))
    return null
  const validDay = (value: unknown): value is TaskRepeatDayOfMonth => value === 'last' || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 31)
  if (monthDay !== undefined && !validDay(monthDay))
    return null
  if (yearDay !== undefined && !validDay(yearDay))
    return null
  const validMonth = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 12
  if (yearMonth !== undefined && !validMonth(yearMonth))
    return null
  const validWeekday = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
  if (monthWeekday !== undefined && !validWeekday(monthWeekday))
    return null
  if (yearWeekday !== undefined && !validWeekday(yearWeekday))
    return null
  if (skipHolidays !== undefined && typeof skipHolidays !== 'boolean')
    return null
  if (skipWeekends !== undefined && typeof skipWeekends !== 'boolean')
    return null
  if (lunarMonth !== undefined && !validMonth(lunarMonth))
    return null
  if (lunarDay !== undefined && (typeof lunarDay !== 'number' || !Number.isSafeInteger(lunarDay) || lunarDay < 1 || lunarDay > 30))
    return null
  if (unit === 'lunar' && (lunarMonth === undefined || lunarDay === undefined))
    return null
  if ((unit === 'holiday' || skipHolidays === true || (holidayPolicy !== undefined && holidayPolicy !== 'allow'))
    && (typeof calendarId !== 'string' || calendarId.length === 0)) {
    return null
  }
  return {
    ...(typeof parsedAnchorDate === 'string' ? { anchorDate: parsedAnchorDate } : {}),
    ...(calendarId === undefined ? {} : { calendarId }),
    ...(typeof parsedEndDate === 'string' ? { endDate: parsedEndDate } : {}),
    ...(holidayPolicy === undefined ? {} : { holidayPolicy }),
    interval,
    mode,
    ...(lunarDay === undefined ? {} : { lunarDay }),
    ...(lunarMonth === undefined ? {} : { lunarMonth }),
    ...(monthDay === undefined ? {} : { monthDay }),
    ...(monthMode === undefined ? {} : { monthMode }),
    ...(monthOrdinal === undefined ? {} : { monthOrdinal }),
    ...(monthWeekday === undefined ? {} : { monthWeekday }),
    ...(skipHolidays === undefined ? {} : { skipHolidays }),
    ...(skipWeekends === undefined ? {} : { skipWeekends }),
    unit,
    ...(weekdays === undefined ? {} : { weekdays: [...weekdays] }),
    ...(yearDay === undefined ? {} : { yearDay }),
    ...(yearMode === undefined ? {} : { yearMode }),
    ...(yearMonth === undefined ? {} : { yearMonth }),
    ...(yearOrdinal === undefined ? {} : { yearOrdinal }),
    ...(yearWeekday === undefined ? {} : { yearWeekday }),
  }
}

export function parseTaskDate(value: unknown): string | null {
  return typeof value === 'string' && journalDatePattern.test(value) ? value : null
}

export interface TaskHistory {
  status: TaskStatus
  elapsedMs: number
}

export function parseTaskHistory(value: unknown): TaskHistory | null {
  if (typeof value !== 'object' || value === null)
    return null

  const { status, elapsedMs } = value as Record<string, unknown>
  if (status !== 'todo' && status !== 'doing' && status !== 'done')
    return null
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0)
    return null

  return { status, elapsedMs }
}

export function defineTaskAttrs(): Extension {
  return union(
    defineNodeAttr<'list', 'status', TaskStatus | null>({
      type: 'list',
      attr: 'status',
      default: null,
      splittable: false,
      toDOM: value => (value ? ['data-task-status', value] : null),
      parseDOM: (element) => {
        const value = element.getAttribute('data-task-status')
        return value === 'todo' || value === 'doing' || value === 'done' ? value : null
      },
    }),
    defineNodeAttr({
      type: 'list',
      attr: 'elapsedMs',
      default: 0,
      splittable: false,
      toDOM: value => (value ? ['data-task-elapsed', String(value)] : null),
      parseDOM: (element) => {
        const raw = element.getAttribute('data-task-elapsed')
        const parsed = raw == null ? 0 : Number.parseInt(raw, 10)
        return Number.isFinite(parsed) ? parsed : 0
      },
    }),
    defineNodeAttr<'list', 'startedAt', number | null>({
      type: 'list',
      attr: 'startedAt',
      default: null,
      splittable: false,
      toDOM: value => (value != null ? ['data-task-started-at', String(value)] : null),
      parseDOM: (element) => {
        const raw = element.getAttribute('data-task-started-at')
        if (raw == null)
          return null
        const parsed = Number.parseInt(raw, 10)
        return Number.isFinite(parsed) ? parsed : null
      },
    }),
    defineNodeAttr<'list', 'schedule', TaskSchedule>({
      type: 'list',
      attr: 'schedule',
      default: { kind: 'none' },
      splittable: false,
      toDOM: value => ['data-task-schedule', JSON.stringify(value)],
      parseDOM: (element) => {
        const raw = element.getAttribute('data-task-schedule')
        if (raw === null)
          return { kind: 'none' }
        try {
          return parseTaskSchedule(JSON.parse(raw)) ?? { kind: 'none' }
        }
        catch {
          return { kind: 'none' }
        }
      },
    }),
    defineNodeAttr<'list', 'reminderMinutes', number | null>({
      type: 'list',
      attr: 'reminderMinutes',
      default: null,
      splittable: false,
      toDOM: value => (value != null ? ['data-task-reminder-minutes', String(value)] : null),
      parseDOM: (element) => {
        const raw = element.getAttribute('data-task-reminder-minutes')
        return raw === null ? null : parseTaskReminderMinutes(Number.parseInt(raw, 10))
      },
    }),
    defineNodeAttr<'list', 'reminders', readonly TaskReminder[] | null>({
      type: 'list',
      attr: 'reminders',
      default: null,
      splittable: false,
      toDOM: value => (value !== null ? ['data-task-reminders', JSON.stringify(value)] : null),
      parseDOM: (element) => {
        const raw = element.getAttribute('data-task-reminders')
        if (raw === null)
          return null
        try {
          return parseTaskReminders(JSON.parse(raw))
        }
        catch {
          return null
        }
      },
    }),
    defineNodeAttr<'list', 'repeatRule', TaskRepeatRule | null>({
      type: 'list',
      attr: 'repeatRule',
      default: null,
      splittable: false,
      toDOM: value => (value ? ['data-task-repeat', JSON.stringify(value)] : null),
      parseDOM: (element) => {
        const raw = element.getAttribute('data-task-repeat')
        if (raw === null)
          return null
        try {
          return parseTaskRepeatRule(JSON.parse(raw))
        }
        catch {
          return null
        }
      },
    }),
    defineNodeAttr<'paragraph', 'taskHistory', TaskHistory | null>({
      type: 'paragraph',
      attr: 'taskHistory',
      default: null,
      splittable: false,
      toDOM: value => (value ? ['data-task-history', JSON.stringify(value)] : null),
      parseDOM: (element) => {
        const raw = element.getAttribute('data-task-history')
        if (raw == null)
          return null
        try {
          return parseTaskHistory(JSON.parse(raw))
        }
        catch {
          return null
        }
      },
    }),
  )
}
