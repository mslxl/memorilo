/// <reference path="../lunar-javascript.d.ts" />

import type { Dayjs } from 'dayjs'
import type {
  TaskRepeatDayOfMonth,
  TaskRepeatOrdinal,
  TaskRepeatRule,
} from '../schema/task-schema'
import type { TaskCalendarEvent } from './task-calendar'
import dayjs from 'dayjs'
import { Solar } from 'lunar-javascript'

const maxPreviewOccurrences = 2048

function dateValue(date: string): Dayjs {
  const parsed = dayjs(date)
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== date)
    throw new TypeError(`Invalid task date: ${date}`)
  return parsed.startOf('day')
}

function dateKey(date: Dayjs): string {
  return date.format('YYYY-MM-DD')
}

function calendarDates(
  rule: TaskRepeatRule,
  calendarEvents: readonly TaskCalendarEvent[],
): readonly string[] {
  const needsCalendar = rule.unit === 'holiday'
    || rule.skipHolidays === true
    || (rule.holidayPolicy !== undefined && rule.holidayPolicy !== 'allow')
  if (!needsCalendar)
    return []
  if (rule.calendarId === undefined)
    return []
  return [...new Set(calendarEvents
    .filter(event => event.subscriptionId === rule.calendarId)
    .map(event => event.startDate))]
    .sort()
}

function ordinalDate(month: Dayjs, ordinal: TaskRepeatOrdinal, weekday: number): Dayjs {
  if (ordinal === -1) {
    const end = month.endOf('month').startOf('day')
    return end.subtract((end.day() - weekday + 7) % 7, 'day')
  }
  const first = month.startOf('month')
  const offset = (weekday - first.day() + 7) % 7
  const candidate = first.add(offset + (ordinal - 1) * 7, 'day')
  return candidate.month() === month.month() ? candidate : ordinalDate(month, -1, weekday)
}

function dayOfMonth(month: Dayjs, value: TaskRepeatDayOfMonth | undefined, fallback: number): Dayjs {
  if (value === 'last')
    return month.endOf('month').startOf('day')
  const day = value ?? fallback
  return month.date(Math.min(day, month.daysInMonth())).startOf('day')
}

function workdayDate(month: Dayjs, ordinal: TaskRepeatOrdinal): Dayjs {
  const wanted = ordinal === -1 ? -1 : ordinal
  if (wanted === -1) {
    let current = month.endOf('month').startOf('day')
    while (current.day() === 0 || current.day() === 6)
      current = current.subtract(1, 'day')
    return current
  }
  let count = 0
  for (let offset = 0; offset < month.daysInMonth(); offset += 1) {
    const current = month.startOf('month').add(offset, 'day')
    if (current.day() === 0 || current.day() === 6)
      continue
    count += 1
    if (count === wanted)
      return current
  }
  return month.endOf('month').startOf('day')
}

function nextWeeklyOccurrence(current: Dayjs, interval: number, weekdays: readonly number[]): Dayjs {
  const selected = [...new Set(weekdays)].sort((left, right) => left - right)
  if (selected.length === 0)
    return current.add(interval, 'week')
  const weekStart = current.startOf('week')
  for (const weekday of selected) {
    const candidate = weekStart.add(weekday, 'day')
    if (candidate.isAfter(current, 'day'))
      return candidate
  }
  return weekStart.add(interval, 'week').add(selected[0] ?? 0, 'day')
}

function lunarDateMatches(date: Dayjs, rule: TaskRepeatRule): boolean {
  if (rule.lunarMonth === undefined || rule.lunarDay === undefined)
    return false
  const lunar = Solar.fromYmd(date.year(), date.month() + 1, date.date()).getLunar()
  return lunar.getMonth() === rule.lunarMonth && lunar.getDay() === rule.lunarDay
}

export function lunarDateForGregorian(date: string): { day: number, month: number } {
  const value = dateValue(date)
  const lunar = Solar.fromYmd(value.year(), value.month() + 1, value.date()).getLunar()
  return { day: lunar.getDay(), month: lunar.getMonth() }
}

function nextLunarOccurrence(current: Dayjs, rule: TaskRepeatRule): Dayjs {
  const interval = Math.max(1, rule.interval)
  let found = 0
  let candidate = current.add(1, 'day')
  const limit = current.add(Math.max(3, interval + 2) * 370, 'day')
  while (!candidate.isAfter(limit, 'day')) {
    if (lunarDateMatches(candidate, rule)) {
      found += 1
      if (found === interval)
        return candidate
    }
    candidate = candidate.add(1, 'day')
  }
  throw new RangeError('Lunar task recurrence has no future occurrence in the supported range')
}

function nextRegularOccurrence(current: Dayjs, rule: TaskRepeatRule): Dayjs {
  if (rule.unit === 'day')
    return current.add(rule.interval, 'day')
  if (rule.unit === 'week') {
    return rule.weekdays
      ? nextWeeklyOccurrence(current, rule.interval, rule.weekdays)
      : current.add(rule.interval, 'week')
  }
  if (rule.unit === 'month') {
    const month = current.startOf('month').add(rule.interval, 'month')
    if (rule.monthMode === 'weekday')
      return ordinalDate(month, rule.monthOrdinal ?? 1, rule.monthWeekday ?? current.day())
    if (rule.monthMode === 'workday')
      return workdayDate(month, rule.monthOrdinal ?? 1)
    return dayOfMonth(month, rule.monthDay, current.date())
  }
  if (rule.unit === 'year') {
    const month = current.startOf('year').add(rule.interval, 'year').month((rule.yearMonth ?? current.month() + 1) - 1)
    if (rule.yearMode === 'weekday')
      return ordinalDate(month, rule.yearOrdinal ?? 1, rule.yearWeekday ?? current.day())
    return dayOfMonth(month, rule.yearDay, current.date())
  }
  if (rule.unit === 'lunar')
    return nextLunarOccurrence(current, rule)
  throw new TypeError('Holiday task recurrence requires calendar events')
}

function nextWorkday(date: Dayjs, holidays: ReadonlySet<string>): Dayjs {
  let next = date
  while (holidays.has(dateKey(next)) || next.day() === 0 || next.day() === 6)
    next = next.add(1, 'day')
  return next
}

function shouldSkip(date: Dayjs, rule: TaskRepeatRule, holidays: ReadonlySet<string>): boolean {
  if (rule.skipWeekends === true && (date.day() === 0 || date.day() === 6))
    return true
  if (rule.skipHolidays === true && holidays.has(dateKey(date)))
    return true
  return false
}

function advanceUntilAllowed(date: Dayjs, rule: TaskRepeatRule, holidays: ReadonlySet<string>): Dayjs {
  let next = date
  for (let attempts = 0; attempts < maxPreviewOccurrences; attempts += 1) {
    if (!shouldSkip(next, rule, holidays))
      return next
    next = next.add(1, 'day')
  }
  throw new RangeError('Task recurrence could not find an allowed occurrence')
}

export function taskRepeatBaseDate(
  occurrenceDate: string,
  rule: TaskRepeatRule,
  completedOn: string,
): string {
  dateValue(occurrenceDate)
  dateValue(completedOn)
  if (rule.mode === 'custom') {
    if (rule.anchorDate === undefined)
      throw new TypeError('Custom task repeat rule requires an anchor date')
    return dateValue(rule.anchorDate).format('YYYY-MM-DD')
  }
  return rule.mode === 'completion' ? completedOn : occurrenceDate
}

export function taskRepeatContinuesOn(nextDate: string, rule: TaskRepeatRule): boolean {
  dateValue(nextDate)
  return rule.endDate === undefined || nextDate <= rule.endDate
}

export function nextTaskOccurrenceDate(
  currentDate: string,
  rule: TaskRepeatRule,
  calendarEvents: readonly TaskCalendarEvent[] = [],
): string {
  const current = dateValue(currentDate)
  const holidayDates = calendarDates(rule, calendarEvents)
  const holidays = new Set(holidayDates)
  if (rule.unit === 'holiday') {
    const next = holidayDates
      .filter(date => date > currentDate)
      .at(rule.interval - 1)
    if (!next)
      throw new RangeError(`No future holiday occurrence is available for ${rule.calendarId}`)
    const occurrence = dateValue(next)
    return (rule.holidayPolicy === 'next-workday'
      ? nextWorkday(occurrence, holidays)
      : occurrence).format('YYYY-MM-DD')
  }
  let next = nextRegularOccurrence(current, rule)
  if (rule.holidayPolicy === 'next-workday')
    next = nextWorkday(next, holidays)
  if (rule.holidayPolicy === 'skip') {
    for (let attempts = 0; attempts < maxPreviewOccurrences && holidays.has(dateKey(next)); attempts += 1)
      next = nextRegularOccurrence(next, rule)
  }
  return advanceUntilAllowed(next, rule, holidays).format('YYYY-MM-DD')
}

export interface TaskRecurrencePreviewOptions {
  calendarEvents?: readonly TaskCalendarEvent[]
  from: string
  through: string
}

/**
 * Expands a repeat rule into read-only calendar markers. It never mutates the
 * task and deliberately omits the persisted occurrence itself.
 */
export function previewTaskRecurrenceDates(
  occurrenceDate: string,
  rule: TaskRepeatRule,
  options: TaskRecurrencePreviewOptions,
): readonly string[] {
  const from = dateValue(options.from)
  const through = dateValue(options.through)
  if (through.isBefore(from, 'day'))
    return []
  const events = options.calendarEvents ?? []
  // Completion anchored rules do not have a future occurrence until the
  // current item is completed and the next item is persisted.
  if (rule.mode === 'completion')
    return []
  const occurrence = dateValue(occurrenceDate)
  const start = rule.mode === 'custom' && rule.anchorDate !== undefined
    ? dateValue(rule.anchorDate)
    : occurrence
  const results: string[] = []
  let cursor = start
  if (rule.mode === 'custom'
    && cursor.isAfter(occurrence, 'day')
    && !cursor.isBefore(from, 'day')
    && !cursor.isAfter(through, 'day')
    && (rule.endDate === undefined || dateKey(cursor) <= rule.endDate)) {
    results.push(dateKey(cursor))
  }
  for (let index = 0; index < maxPreviewOccurrences; index += 1) {
    let next: string
    try {
      next = nextTaskOccurrenceDate(dateKey(cursor), rule, events)
    }
    catch {
      break
    }
    const nextDate = dateValue(next)
    if (rule.endDate !== undefined && next > rule.endDate)
      break
    if (nextDate.isAfter(through, 'day'))
      break
    if (!nextDate.isBefore(from, 'day'))
      results.push(next)
    cursor = nextDate
  }
  return [...new Set(results)]
}
