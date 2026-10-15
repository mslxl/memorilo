import type { TaskRepeatRule, TaskSchedule } from '../schema/task-schema'
import type { TaskCalendarEvent } from './task-calendar'
import dayjs from 'dayjs'
import { previewTaskRecurrenceDates } from './task-recurrence'

export interface TaskOccurrence {
  allDay: boolean
  end: string | null
  key: string
  occurrenceDate: string
  schedule: TaskSchedule
  source: 'persisted' | 'preview'
  start: string
}

export interface TaskOccurrenceProjectionOptions {
  calendarEvents?: readonly TaskCalendarEvent[]
  from: string
  through: string
  undatedDate?: string
}

function scheduleDate(schedule: TaskSchedule, undatedDate?: string): string | null {
  if (schedule.kind === 'none')
    return undatedDate ?? null
  return schedule.kind === 'deadline' ? schedule.date : schedule.start.slice(0, 10)
}

function shiftSchedule(schedule: TaskSchedule, date: string, sourceDate: string): TaskSchedule {
  if (schedule.kind === 'none')
    return { kind: 'none' }
  const offset = dayjs(date).diff(dayjs(sourceDate), 'day')
  if (schedule.kind === 'deadline')
    return { ...schedule, date }
  return {
    ...schedule,
    end: dayjs(schedule.end).add(offset, 'day').format('YYYY-MM-DDTHH:mm'),
    start: dayjs(schedule.start).add(offset, 'day').format('YYYY-MM-DDTHH:mm'),
  }
}

function occurrenceFor(schedule: TaskSchedule, occurrenceDate: string, source: TaskOccurrence['source']): TaskOccurrence {
  if (schedule.kind === 'none') {
    return {
      allDay: true,
      end: null,
      key: `${occurrenceDate}:none`,
      occurrenceDate,
      schedule,
      source,
      start: occurrenceDate,
    }
  }
  if (schedule.kind === 'deadline') {
    const start = schedule.time === null ? schedule.date : `${schedule.date}T${schedule.time}`
    return {
      allDay: schedule.time === null,
      end: null,
      key: `${occurrenceDate}:deadline:${schedule.time ?? 'all-day'}`,
      occurrenceDate,
      schedule,
      source,
      start,
    }
  }
  return {
    allDay: schedule.allDay,
    end: schedule.end,
    key: `${occurrenceDate}:span:${schedule.start}:${schedule.end}`,
    occurrenceDate,
    schedule,
    source,
    start: schedule.start,
  }
}

/**
 * Projects one persisted Todo occurrence and all calculable previews in a
 * bounded range. Completion anchored rules intentionally return no previews:
 * the next occurrence does not exist until completion persists it.
 */
export function projectTaskOccurrences(
  schedule: TaskSchedule,
  repeatRule: TaskRepeatRule | null,
  options: TaskOccurrenceProjectionOptions,
): readonly TaskOccurrence[] {
  const from = dayjs(options.from)
  const through = dayjs(options.through)
  if (!from.isValid() || !through.isValid() || through.isBefore(from, 'day'))
    return []
  const persistedDate = scheduleDate(schedule, options.undatedDate)
  if (persistedDate === null)
    return []
  const result: TaskOccurrence[] = []
  if (persistedDate >= options.from && persistedDate <= options.through)
    result.push(occurrenceFor(schedule, persistedDate, 'persisted'))
  if (repeatRule === null || repeatRule.mode === 'completion')
    return result
  const dates = previewTaskRecurrenceDates(persistedDate, repeatRule, {
    calendarEvents: options.calendarEvents,
    from: options.from,
    through: options.through,
  })
  for (const date of dates) {
    const projected = occurrenceFor(shiftSchedule(schedule, date, persistedDate), date, 'preview')
    if (!result.some(item => item.key === projected.key))
      result.push(projected)
  }
  return result.sort((left, right) => left.start.localeCompare(right.start) || left.key.localeCompare(right.key))
}
