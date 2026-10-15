import type { DesktopTodoTask } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import * as stylex from '@stylexjs/stylex'
import { formatTaskScheduleDate, taskScheduleState } from './todo-model'
import { todoTaskMetadataStyles as styles } from './todo-task-metadata.stylex'

export function TodoTaskMetadata({
  schedule,
  compact = false,
  elapsed,
  locale,
  now,
  t,
}: {
  schedule: DesktopTodoTask['schedule']
  compact?: boolean
  elapsed: string
  locale: string
  now: number
  t: TFunction
}) {
  const scheduleDate = schedule.kind === 'deadline' ? schedule.date : schedule.kind === 'span' ? schedule.start.slice(0, 10) : null
  const scheduleState = scheduleDate === null ? null : taskScheduleState(scheduleDate, now)
  const formattedScheduleDate = scheduleDate === null ? null : formatTaskScheduleDate(scheduleDate, locale, now)
  const scheduleTime = schedule.kind === 'span' && !schedule.allDay
    ? `${schedule.start.slice(11)}–${schedule.end.slice(11)}`
    : schedule.kind === 'deadline' ? schedule.time : null
  const scheduleLabel = formattedScheduleDate === null
    ? null
    : t(scheduleState === 'overdue' ? 'overdue' : 'scheduledDate', { date: scheduleTime === null ? formattedScheduleDate : `${formattedScheduleDate} ${scheduleTime}` })

  return (
    <span {...stylex.props(styles.metadata, compact && styles.metadataCompact)}>
      {scheduleLabel !== null && (
        <span
          {...stylex.props(styles.due, compact && styles.dueCompact, scheduleState === 'overdue' && styles.overdue)}
          title={scheduleLabel}
        >
          {scheduleLabel}
        </span>
      )}
      <span {...stylex.props(styles.elapsed, !compact && styles.elapsedDefault)} title={t('elapsed', { duration: elapsed })}>
        {t('elapsed', { duration: elapsed })}
      </span>
    </span>
  )
}
