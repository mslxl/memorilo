import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoTask, DesktopTodoTaskStatus, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import type { CSSProperties } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { todoCalendarColor } from '../../../shared/todo-calendar-color'
import { buildTodoTaskTree, flattenTodoTaskTree, formatTaskDuration, taskElapsedMs, todoStatusLabelKeys, todoTaskKey } from '../todo-model'
import { TodoTaskActions } from '../todo-task-actions'
import { TodoTaskMetadata } from '../todo-task-metadata'
import { TodoTaskOccurrenceActions } from '../todo-task-occurrence-actions'
import { todoTaskStatusIcons } from '../todo-task-status'
import { todoListViewStyles as styles } from './todo-list-view.stylex'

const rowHeight = 58
function estimateRowSize() {
  return rowHeight
}

function TaskStatusIcon({ status }: { status: DesktopTodoTaskStatus }) {
  const Icon = todoTaskStatusIcons[status]
  return <Icon {...stylex.props(styles.statusIcon, status === 'doing' && styles.statusDoing, status === 'done' && styles.statusDone)} aria-hidden="true" strokeWidth={status === 'todo' ? 1.7 : 1.8} />
}

function CalendarEventRow({ event, transform }: { event: DesktopTodoCalendarEvent, transform: string }) {
  const colorStyle = { '--todo-calendar-color': todoCalendarColor(event.subscriptionId) } as CSSProperties
  return (
    <li {...stylex.props(styles.row)} style={{ transform }}>
      <div {...stylex.props(styles.rowShell)}>
        <div
          {...stylex.props(styles.rowButton, styles.calendarEventButton)}
          style={colorStyle}
          title={`${event.title} - ${event.subscriptionTitle}`}
        >
          <span {...stylex.props(styles.calendarEventDot)} aria-hidden="true" />
          <span {...stylex.props(styles.taskContent)}>
            <span {...stylex.props(styles.taskText)}>{event.title}</span>
            <span {...stylex.props(styles.source)}>{event.subscriptionTitle}</span>
          </span>
        </div>
      </div>
    </li>
  )
}

export function TodoListView({
  calendarEvents,
  calendarSubscriptions,
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  locale,
  now,
  onFetchNextPage,
  onSelectTask,
  onUpdateTask,
  resetKey,
  selectedDateEvents,
  selectedTaskKey,
  t,
  tasks,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  hasNextPage: boolean
  isFetchNextPageError: boolean
  isFetchingNextPage: boolean
  locale: string
  now: number
  onFetchNextPage: () => Promise<unknown>
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  resetKey: string
  selectedDateEvents: readonly DesktopTodoCalendarEvent[]
  selectedTaskKey: string | null
  t: TFunction
  tasks: readonly DesktopTodoTask[]
}) {
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const tree = useMemo(() => buildTodoTaskTree(tasks), [tasks])
  const visibleTasks = useMemo(() => flattenTodoTaskTree(tree, collapsedKeys), [collapsedKeys, tree])
  const virtualCount = visibleTasks.length + (hasNextPage ? 1 : 0)
  const calendarEventOffset = selectedDateEvents.length * rowHeight
  const getVirtualRowKey = useCallback((index: number) => {
    const visibleTask = visibleTasks[index]
    const task = visibleTask?.task
    if (task)
      return todoTaskKey(task)
    if (index === visibleTasks.length && hasNextPage)
      return 'load-next-todo-page'
    throw new RangeError(`Virtual Todo row ${index} is outside the list`)
  }, [hasNextPage, visibleTasks])
  const rowVirtualizer = useVirtualizer({
    count: virtualCount,
    estimateSize: estimateRowSize,
    getItemKey: getVirtualRowKey,
    getScrollElement: () => scrollElementRef.current,
    overscan: 10,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const lastVirtualRow = virtualRows.at(-1)

  useEffect(() => {
    const scrollElement = scrollElementRef.current
    if (scrollElement)
      scrollElement.scrollTop = 0
  }, [resetKey])

  useEffect(() => {
    if (!lastVirtualRow
      || lastVirtualRow.index !== visibleTasks.length
      || !hasNextPage
      || isFetchingNextPage
      || isFetchNextPageError) {
      return
    }
    void onFetchNextPage()
  }, [
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    lastVirtualRow,
    onFetchNextPage,
    visibleTasks.length,
  ])

  const toggleCollapsed = useCallback((task: DesktopTodoTask) => {
    const key = todoTaskKey(task)
    setCollapsedKeys((previous) => {
      const next = new Set(previous)
      if (next.has(key))
        next.delete(key)
      else
        next.add(key)
      return next
    })
  }, [])

  return (
    <div {...stylex.props(styles.root)} data-todo-view="list">
      <div ref={scrollElementRef} {...stylex.props(styles.viewport)}>
        <ul
          {...stylex.props(styles.list)}
          aria-busy={isFetchingNextPage}
          style={{ height: calendarEventOffset + rowVirtualizer.getTotalSize() }}
        >
          {selectedDateEvents.map((event, index) => (
            <CalendarEventRow
              event={event}
              key={`${event.subscriptionId}:${event.uid}:${event.startDate}`}
              transform={`translateY(${index * rowHeight}px)`}
            />
          ))}
          {virtualRows.map((virtualRow) => {
            const visibleTask = visibleTasks[virtualRow.index]
            const task = visibleTask?.task
            if (!task) {
              if (virtualRow.index !== visibleTasks.length || !hasNextPage)
                throw new RangeError(`Virtual Todo row ${virtualRow.index} is outside the list`)
              return (
                <li
                  key={virtualRow.key}
                  {...stylex.props(styles.row)}
                  style={{ transform: `translateY(${calendarEventOffset + virtualRow.start}px)` }}
                >
                  <div {...stylex.props(styles.loadingMore)}>
                    {isFetchNextPageError
                      ? (
                          <button {...stylex.props(styles.retryButton)} type="button" onClick={() => void onFetchNextPage()}>
                            {t('tryAgain')}
                          </button>
                        )
                      : (
                          <>
                            <LoaderCircle {...stylex.props(styles.loadingMoreIcon, styles.loadingIcon)} aria-hidden="true" strokeWidth={1.8} />
                            <span>{t('loadingMore')}</span>
                          </>
                        )}
                  </div>
                </li>
              )
            }
            const elapsed = formatTaskDuration(taskElapsedMs(task, now))
            const hasChildren = visibleTask.hasChildren
            const isCollapsed = collapsedKeys.has(todoTaskKey(task))
            const selected = todoTaskKey(task) === selectedTaskKey
            return (
              <li
                key={todoTaskKey(task)}
                {...stylex.props(styles.row)}
                style={{ transform: `translateY(${calendarEventOffset + virtualRow.start}px)` }}
              >
                <div {...stylex.props(styles.rowShell, selected && styles.rowShellSelected)}>
                  {hasChildren
                    ? (
                        <button
                          {...stylex.props(styles.treeToggle)}
                          style={{ marginLeft: visibleTask.depth * 20 }}
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? t('expandSubtasks') : t('collapseSubtasks')}
                          title={isCollapsed ? t('expandSubtasks') : t('collapseSubtasks')}
                          type="button"
                          onClick={() => toggleCollapsed(task)}
                        >
                          {isCollapsed
                            ? <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
                            : <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />}
                        </button>
                      )
                    : (
                        <span
                          {...stylex.props(styles.treeTogglePlaceholder)}
                          style={{ marginLeft: visibleTask.depth * 20 }}
                          aria-hidden="true"
                        />
                      )}
                  <button
                    {...stylex.props(styles.rowButton, selected && styles.rowButtonSelected)}
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
                      triggerContent={<span title={t(todoStatusLabelKeys[task.status])}><TaskStatusIcon status={task.status} /></span>}
                    />
                    <span {...stylex.props(styles.taskContent)}>
                      <span {...stylex.props(styles.taskText, task.status === 'done' && styles.taskDone)}>
                        {task.text}
                      </span>
                      <span {...stylex.props(styles.source)}>
                        {t('source', { note: task.noteTitle, topic: task.topicTitle })}
                      </span>
                    </span>
                  </button>
                  <TodoTaskActions
                    calendarEvents={calendarEvents}
                    calendarSubscriptions={calendarSubscriptions}
                    triggerContent={<TodoTaskMetadata elapsed={elapsed} locale={locale} now={now} schedule={task.schedule} t={t} />}
                    onUpdateTask={onUpdateTask}
                    t={t}
                    task={task}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
