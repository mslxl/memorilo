import type { TaskRepeatRule } from '../schema/task-schema'
import dayjs from 'dayjs'
import { parseTaskRepeatRule, parseTaskSchedule, transitionTaskAttrs } from '../schema/task-schema'

export type RecurringTaskCompletionAction
  = | 'archive-completed-to-today'
    | 'move-next-to-today'
    | 'move-next-to-due-date'
    | 'nest-completed-under-next'
    | 'place-next-after-completed'
    | 'replace-completed'

export interface RecurringTaskOccurrencePlan {
  completedAttrs: Readonly<Record<string, unknown>>
  nextAttrs: Readonly<Record<string, unknown>>
  repeatRule: TaskRepeatRule
}

export function resetTaskForNextOccurrence(
  attrs: Readonly<Record<string, unknown>>,
  occurrenceDate: string | null,
): Readonly<Record<string, unknown>> {
  const storedSchedule = parseTaskSchedule(attrs.schedule)
  if (storedSchedule === null)
    throw new TypeError('Recurring task has an invalid schedule')
  const schedule = occurrenceDate === null
    ? storedSchedule
    : storedSchedule.kind === 'none'
      ? storedSchedule
      : storedSchedule.kind === 'deadline'
        ? { ...storedSchedule, date: occurrenceDate }
        : (() => {
            const source = storedSchedule.start.slice(0, 10)
            const offset = dayjs(occurrenceDate).diff(dayjs(source), 'day')
            return {
              ...storedSchedule,
              end: dayjs(storedSchedule.end).add(offset, 'day').format('YYYY-MM-DDTHH:mm'),
              start: dayjs(storedSchedule.start).add(offset, 'day').format('YYYY-MM-DDTHH:mm'),
            }
          })()
  return {
    ...attrs,
    checked: false,
    elapsedMs: 0,
    startedAt: null,
    status: 'todo',
    schedule,
  }
}

export function planRecurringTaskOccurrences(
  sourceAttrs: Readonly<Record<string, unknown>>,
  nextDueDate: string,
): RecurringTaskOccurrencePlan {
  const repeatRule = parseTaskRepeatRule(sourceAttrs.repeatRule)
  if (repeatRule === null)
    throw new TypeError('Completing a recurring task requires a valid repeat rule')

  return {
    completedAttrs: {
      ...sourceAttrs,
      ...transitionTaskAttrs(sourceAttrs, 'done'),
      repeatRule: null,
    },
    nextAttrs: resetTaskForNextOccurrence(sourceAttrs, nextDueDate),
    repeatRule,
  }
}
