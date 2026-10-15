import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoTask, DesktopTodoTaskStatus, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import * as stylex from '@stylexjs/stylex'
import { formatTaskDuration, groupTodoTasks, taskElapsedMs, todoStatuses, todoStatusLabelKeys, todoTaskKey } from '../todo-model'
import { TodoTaskActions } from '../todo-task-actions'
import { TodoTaskMetadata } from '../todo-task-metadata'
import { TodoTaskOccurrenceActions } from '../todo-task-occurrence-actions'
import { todoTaskStatusIcons } from '../todo-task-status'
import { todoBoardViewStyles as styles } from './todo-board-view.stylex'

function TaskStatusIcon({ status }: { status: DesktopTodoTaskStatus }) {
  const Icon = todoTaskStatusIcons[status]
  return <Icon {...stylex.props(styles.statusIcon, status === 'doing' && styles.statusDoing, status === 'done' && styles.statusDone)} aria-hidden="true" strokeWidth={status === 'todo' ? 1.7 : 1.8} />
}

export function TodoBoardView({
  calendarEvents,
  calendarSubscriptions,
  isFetchingMore,
  locale,
  now,
  onSelectTask,
  onUpdateTask,
  selectedTaskKey,
  t,
  tasks,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  isFetchingMore: boolean
  locale: string
  now: number
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selectedTaskKey: string | null
  t: TFunction
  tasks: readonly DesktopTodoTask[]
}) {
  const grouped = groupTodoTasks(tasks)
  return (
    <div {...stylex.props(styles.viewport)} data-todo-view="board">
      <div {...stylex.props(styles.grid)}>
        {todoStatuses.map((status) => {
          const columnTasks = grouped[status]
          return (
            <section
              key={status}
              {...stylex.props(
                styles.column,
                status === 'todo' && styles.columnTodo,
                status === 'doing' && styles.columnDoing,
                status === 'done' && styles.columnDone,
              )}
              aria-label={t(todoStatusLabelKeys[status])}
            >
              <header {...stylex.props(styles.columnHeader)}>
                <span {...stylex.props(styles.columnTitle)}>
                  <TaskStatusIcon status={status} />
                  {t(todoStatusLabelKeys[status])}
                </span>
                <span {...stylex.props(styles.columnCount)}>{columnTasks.length}</span>
              </header>
              <div {...stylex.props(styles.columnBody)}>
                {columnTasks.length === 0
                  ? <p {...stylex.props(styles.columnEmpty)}>{t('noTasksInColumn')}</p>
                  : columnTasks.map((task) => {
                      const elapsed = formatTaskDuration(taskElapsedMs(task, now))
                      const selected = todoTaskKey(task) === selectedTaskKey
                      return (
                        <div {...stylex.props(styles.cardShell)} key={todoTaskKey(task)}>
                          <div {...stylex.props(styles.cardOccurrence)}>
                            <TodoTaskOccurrenceActions
                              calendarEvents={calendarEvents}
                              onUpdateTask={onUpdateTask}
                              t={t}
                              task={task}
                              triggerContent={<TaskStatusIcon status={task.status} />}
                            />
                          </div>
                          <button
                            {...stylex.props(styles.card, selected && styles.cardSelected)}
                            aria-label={t('selectTask', { note: task.noteTitle, task: task.text })}
                            aria-pressed={selected}
                            title={t('selectTask', { note: task.noteTitle, task: task.text })}
                            type="button"
                            onClick={() => void onSelectTask(task)}
                          >
                            <span {...stylex.props(styles.cardText, task.status === 'done' && styles.taskDone)}>{task.text}</span>
                            <span {...stylex.props(styles.cardSource)}>{t('source', { note: task.noteTitle, topic: task.topicTitle })}</span>
                            <span {...stylex.props(styles.cardFooter)}>
                              <span aria-hidden="true">›</span>
                            </span>
                          </button>
                          <div {...stylex.props(styles.cardActions)}>
                            <TodoTaskActions calendarEvents={calendarEvents} calendarSubscriptions={calendarSubscriptions} onUpdateTask={onUpdateTask} t={t} task={task} triggerContent={<TodoTaskMetadata compact elapsed={elapsed} locale={locale} now={now} schedule={task.schedule} t={t} />} />
                          </div>
                        </div>
                      )
                    })}
                {isFetchingMore && <span {...stylex.props(styles.columnLoading)}>{t('loadingMore')}</span>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
