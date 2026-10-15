import type { TFunction } from 'i18next'
import type { CSSProperties, Ref } from 'react'
import type { TaskRepeatRule } from '../schema/task-schema'
import type { TaskActionUpdate } from './task-action-model'
import type { TaskActionTask } from './task-action-panel'
import type { TaskCalendarEvent } from './task-calendar'
import { toError } from '@memorilo/effect-lifecycle'
import { Button, Surface, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import dayjs from 'dayjs'
import { useId, useState } from 'react'
import { editorPositionerAdapterStyles } from '../ui/floating-surface/editor-positioner-adapter.stylex'
import { taskActionPanelStyles as styles } from './task-action-panel.stylex'
import { nextTaskOccurrenceDate, taskRepeatBaseDate, taskRepeatContinuesOn } from './task-recurrence'

export interface TaskOccurrencePanelProps {
  calendarEvents: readonly TaskCalendarEvent[]
  id?: string
  panelRef?: Ref<HTMLDivElement>
  style?: CSSProperties
  t: TFunction
  task: TaskActionTask
  visible?: boolean
  onUpdate: (input: TaskActionUpdate) => Promise<void> | void
  onUpdated?: () => void
}

function requireRepeatRule(task: TaskActionTask, message: string): TaskRepeatRule {
  if (!task.repeatRule)
    throw new Error(message)
  return task.repeatRule
}

export function TaskOccurrencePanel({
  calendarEvents,
  id,
  onUpdate,
  onUpdated,
  panelRef,
  style,
  t,
  task,
  visible = true,
}: TaskOccurrencePanelProps) {
  const headingId = useId()
  const [text, setText] = useState(() => task.text)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  const update = async (input: TaskActionUpdate) => {
    setError(null)
    setUpdating(true)
    try {
      await onUpdate(input)
      onUpdated?.()
    }
    catch (cause) {
      setError(toError(cause).message)
    }
    finally {
      setUpdating(false)
    }
  }

  const run = (action: () => TaskActionUpdate) => {
    try {
      void update(action())
    }
    catch (cause) {
      setError(toError(cause).message)
    }
  }

  const skip = () => run(() => {
    const repeatRule = requireRepeatRule(task, 'Skipping an occurrence requires a repeat rule')
    const nextDate = nextTaskOccurrenceDate(task.occurrenceDate, repeatRule, calendarEvents)
    return taskRepeatContinuesOn(nextDate, repeatRule)
      ? { schedule: task.schedule.kind === 'deadline'
          ? { ...task.schedule, date: nextDate }
          : task.schedule.kind === 'span'
            ? { ...task.schedule, start: `${nextDate}${task.schedule.start.slice(10)}`, end: `${nextDate}${task.schedule.end.slice(10)}` }
            : task.schedule, repeatRule }
      : {
          repeatRule: null,
          status: 'done',
        }
  })

  const onlyThis = () => run(() => {
    const repeatRule = requireRepeatRule(task, 'Editing one occurrence requires a repeat rule')
    return {
      schedule: task.schedule,
      nextDueDate: nextTaskOccurrenceDate(task.occurrenceDate, repeatRule, calendarEvents),
      onlyThis: true,
      reminderMinutes: task.reminderMinutes,
      reminders: task.reminders,
      text,
    }
  })

  const complete = () => run(() => {
    const repeatRule = requireRepeatRule(task, 'Completing an occurrence requires a repeat rule')
    const completedOn = dayjs().format('YYYY-MM-DD')
    const baseDate = taskRepeatBaseDate(task.occurrenceDate, repeatRule, completedOn)
    const nextDate = nextTaskOccurrenceDate(baseDate, repeatRule, calendarEvents)
    return taskRepeatContinuesOn(nextDate, repeatRule)
      ? { nextDueDate: nextDate, status: 'done' }
      : { repeatRule: null, status: 'done' }
  })

  return (
    <Surface
      asChild
      variant="popover"
      xstyle={[editorPositionerAdapterStyles.motion, styles.panel]}
    >
      <div
        ref={panelRef}
        aria-labelledby={headingId}
        id={id}
        role="dialog"
        style={{ ...style, visibility: visible ? 'visible' : 'hidden' }}
      >
        <strong id={headingId} {...stylex.props(styles.heading)}>{t('occurrenceActions')}</strong>
        <label {...stylex.props(styles.field)}>
          {t('onlyThisTaskText')}
          <TextField xstyle={styles.textInput} disabled={updating} value={text} onChange={event => setText(event.target.value)} />
        </label>
        {error !== null ? <span {...stylex.props(styles.error)} role="alert">{error}</span> : null}
        <div {...stylex.props(styles.divider)} />
        <Button variant="plain" xstyle={styles.action} disabled={updating} type="button" onClick={skip}>{t('skipThis')}</Button>
        <Button variant="plain" xstyle={styles.action} disabled={updating} type="button" onClick={onlyThis}>{t('onlyThis')}</Button>
        <Button variant="primary" xstyle={[styles.action, styles.primaryAction]} disabled={updating} type="button" onClick={complete}>{t('completeAndRepeat')}</Button>
      </div>
    </Surface>
  )
}
