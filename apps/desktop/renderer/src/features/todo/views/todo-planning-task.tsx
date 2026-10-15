import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoTask, DesktopTodoTaskStatus, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import * as stylex from '@stylexjs/stylex'
import { formatTaskDuration, taskElapsedMs } from '../todo-model'
import { TodoTaskActions } from '../todo-task-actions'
import { TodoTaskMetadata } from '../todo-task-metadata'
import { TodoTaskOccurrenceActions } from '../todo-task-occurrence-actions'
import { todoTaskStatusIcons } from '../todo-task-status'
import { todoPlanningTaskStyles as styles } from './todo-planning-task.stylex'

function TaskStatusIcon({ status }: { status: DesktopTodoTaskStatus }) {
  const Icon = todoTaskStatusIcons[status]
  return <Icon {...stylex.props(styles.icon, status === 'doing' && styles.doing, status === 'done' && styles.doneIcon)} aria-hidden="true" strokeWidth={1.8} />
}

export function TodoPlanningTask({
  calendarEvents,
  calendarSubscriptions,
  locale,
  now,
  onSelectTask,
  onUpdateTask,
  selected,
  t,
  task,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  locale: string
  now: number
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selected: boolean
  t: TFunction
  task: DesktopTodoTask
}) {
  const elapsed = formatTaskDuration(taskElapsedMs(task, now))
  return (
    <div {...stylex.props(styles.shell)}>
      <button
        {...stylex.props(styles.task, selected && styles.taskSelected)}
        aria-label={t('selectTask', { note: task.noteTitle, task: task.text })}
        aria-pressed={selected}
        title={t('selectTask', { note: task.noteTitle, task: task.text })}
        type="button"
        onClick={() => void onSelectTask(task)}
      >
        <TodoTaskOccurrenceActions
          calendarEvents={calendarEvents}
          onUpdateTask={onUpdateTask}
          t={t}
          task={task}
          triggerContent={<TaskStatusIcon status={task.status} />}
        />
        <span {...stylex.props(styles.content)}>
          <span {...stylex.props(styles.title, task.status === 'done' && styles.done)}>{task.text}</span>
          <span {...stylex.props(styles.meta)}>{t('source', { note: task.noteTitle, topic: task.topicTitle })}</span>
        </span>
      </button>
      <div {...stylex.props(styles.actions)}>
        <TodoTaskActions calendarEvents={calendarEvents} calendarSubscriptions={calendarSubscriptions} onUpdateTask={onUpdateTask} t={t} task={task} triggerContent={<TodoTaskMetadata compact elapsed={elapsed} locale={locale} now={now} schedule={task.schedule} t={t} />} />
      </div>
    </div>
  )
}
