import type { TaskReminder, TaskRepeatRule, TaskSchedule, TaskStatus } from '../schema/task-schema'
import { parseTaskDate, parseTaskReminderMinutes, parseTaskReminders, parseTaskRepeatRule, parseTaskSchedule, transitionTaskAttrs } from '../schema/task-schema'
import { resetTaskForNextOccurrence } from './task-completion'

export interface TaskActionUpdate {
  schedule?: TaskSchedule
  nextDueDate?: string | null
  onlyThis?: boolean
  reminderMinutes?: number | null
  reminders?: readonly TaskReminder[] | null
  repeatRule?: TaskRepeatRule | null
  status?: TaskStatus
  text?: string
}

function taskSchedule(value: TaskSchedule): TaskSchedule {
  const parsed = parseTaskSchedule(value)
  if (parsed === null)
    throw new TypeError('Task schedule is invalid')
  return parsed
}

export interface TaskActionMutation {
  attrs: Readonly<Record<string, unknown>>
  text?: string
}

export interface TaskActionPlan {
  current: TaskActionMutation
  occurrence?: TaskActionMutation & { text: string }
}

function taskDate(value: string | null, name: string): string | null {
  return parseTaskValue(value, parseTaskDate, `${name} must use YYYY-MM-DD format`)
}

function taskReminderMinutes(value: number | null): number | null {
  return parseTaskValue(value, parseTaskReminderMinutes, 'Task reminder must be an integer from 0 to 10080 minutes')
}

function taskReminders(value: readonly TaskReminder[] | null): readonly TaskReminder[] | null {
  return parseTaskValue(value, parseTaskReminders, 'Task reminders must contain at most 8 valid unique reminders')
}

function parseTaskValue<Input, Output>(
  value: Input | null,
  parse: (value: Input) => Output | null,
  message: string,
): Output | null {
  if (value === null)
    return null
  const parsed = parse(value)
  if (parsed === null)
    throw new TypeError(message)
  return parsed
}

export function planTaskAction(
  sourceAttrs: Readonly<Record<string, unknown>>,
  sourceText: string,
  input: TaskActionUpdate,
): TaskActionPlan {
  const explicitSchedule = input.schedule === undefined ? undefined : taskSchedule(input.schedule)
  const sourceSchedule = parseTaskSchedule(sourceAttrs.schedule)
  if (sourceSchedule === null)
    throw new TypeError('Stored task schedule is invalid')
  const reminderMinutes = input.reminderMinutes === undefined ? undefined : taskReminderMinutes(input.reminderMinutes)
  const reminders = input.reminders === undefined ? undefined : taskReminders(input.reminders)
  const nextDueDate = input.nextDueDate === undefined
    ? undefined
    : taskDate(input.nextDueDate, 'Task next due date')
  const repeatRule = input.repeatRule === undefined || input.repeatRule === null
    ? input.repeatRule
    : parseTaskRepeatRule(input.repeatRule)
  if (input.repeatRule !== undefined && input.repeatRule !== null && repeatRule === null)
    throw new TypeError('Task repeat rule is invalid')
  const schedule = explicitSchedule ?? sourceSchedule
  const occurrenceDate = schedule.kind === 'deadline'
    ? schedule.date
    : schedule.kind === 'span' ? schedule.start.slice(0, 10) : null

  const nextAttrs = {
    ...sourceAttrs,
    schedule,
    ...(reminderMinutes === undefined ? {} : { reminderMinutes }),
    ...(reminders === undefined ? {} : { reminders }),
    ...(repeatRule === undefined ? {} : { repeatRule }),
    ...(input.status === undefined ? {} : transitionTaskAttrs(sourceAttrs, input.status)),
  }
  const sourceRepeatRule = sourceAttrs.repeatRule === undefined || sourceAttrs.repeatRule === null
    ? null
    : parseTaskRepeatRule(sourceAttrs.repeatRule)
  if (sourceAttrs.repeatRule !== undefined && sourceAttrs.repeatRule !== null && sourceRepeatRule === null)
    throw new TypeError('Stored task repeat rule is invalid')

  if (!input.onlyThis
    && input.status === 'done'
    && nextDueDate !== undefined
    && sourceRepeatRule !== null) {
    return {
      current: {
        attrs: resetTaskForNextOccurrence(nextAttrs, nextDueDate),
        ...(input.text === undefined ? {} : { text: input.text }),
      },
    }
  }

  if (input.onlyThis) {
    if (nextDueDate === undefined)
      throw new TypeError('Editing one task occurrence requires the next series due date')
    return {
      current: { attrs: resetTaskForNextOccurrence(nextAttrs, nextDueDate) },
      occurrence: {
        attrs: {
          ...resetTaskForNextOccurrence({
            ...sourceAttrs,
            schedule: nextAttrs.schedule,
            reminderMinutes: nextAttrs.reminderMinutes,
            reminders: nextAttrs.reminders,
          }, occurrenceDate),
          repeatRule: null,
        },
        text: input.text ?? sourceText,
      },
    }
  }

  return {
    current: {
      attrs: nextAttrs,
      ...(input.text === undefined ? {} : { text: input.text }),
    },
  }
}
