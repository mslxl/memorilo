import type { CreateDesktopTodoTaskInput, DesktopTodoTask, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { TFunction } from 'i18next'
import type { LucideIcon } from 'lucide-react'
import type { TodoListScopeId, TodoListSelection, TodoView } from './todo-model'
import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Columns3,
  Grid2X2,
  List,
  ListTodo,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  TriangleAlert,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDesktopConfiguration } from '../../shared/configuration'
import { desktopRequests } from '../../shared/desktop-requests'
import { usePageTitlebar } from '../../shared/page-titlebar'
import { subscribeTodoCalendarSnapshot } from '../../shared/todo-calendar-cache'
import { todoQueryKeys } from './query-keys'
import { TodoDetailSidebar } from './todo-detail-sidebar'
import { TodoListSidebar } from './todo-list-sidebar'
import { filterTodoListTasks, sortTodoTasks, summarizeTodoListTasks, todoCalendarQueryOptions, todoListSelectionKey, todoStatusLabelKeys, todoTaskKey, todoTaskQueryOptions, todoTasksForView } from './todo-model'
import { todoPageStyles } from './todo-page.stylex'
import { TodoBoardView } from './views/todo-board-view'
import { TodoCalendarView } from './views/todo-calendar-view'
import { TodoListView } from './views/todo-list-view'
import { TodoQuadrantView } from './views/todo-quadrant-view'
import { TodoTimeGridView } from './views/todo-time-grid-view'
import { TodoTimelineView } from './views/todo-timeline-view'

const viewOptions: readonly { descriptionKey: string, id: TodoView, labelKey: string }[] = [
  { descriptionKey: 'switchToList', id: 'list', labelKey: 'listView' },
  { descriptionKey: 'switchToBoard', id: 'board', labelKey: 'boardView' },
  { descriptionKey: 'switchToAgenda', id: 'agenda', labelKey: 'agendaView' },
  { descriptionKey: 'switchToTimeline', id: 'timeline', labelKey: 'timelineView' },
  { descriptionKey: 'switchToCalendar', id: 'calendar', labelKey: 'calendarView' },
  { descriptionKey: 'switchToQuadrant', id: 'quadrant', labelKey: 'quadrantView' },
]

const viewIcons: Readonly<Record<TodoView, LucideIcon>> = {
  agenda: CalendarRange,
  board: Columns3,
  calendar: CalendarDays,
  list: List,
  quadrant: Grid2X2,
  timeline: CalendarClock,
}

const listSidebarSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.32,
} as const

type SelectedTaskAction
  = | { task: DesktopTodoTask, type: 'select' }
    | { task: DesktopTodoTask, type: 'sync' }
    | { type: 'close' }
    | { input: UpdateDesktopTodoTaskInput, type: 'update' }

function selectedTaskReducer(
  current: DesktopTodoTask | null,
  action: SelectedTaskAction,
): DesktopTodoTask | null {
  if (action.type === 'close')
    return null
  if (action.type === 'select' || action.type === 'sync')
    return current === action.task ? current : action.task
  if (current === null
    || current.blockId !== action.input.blockId
    || current.noteId !== action.input.noteId
    || current.topicId !== action.input.topicId) {
    return current
  }

  const input = action.input
  return {
    ...current,
    ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
    ...(input.reminderMinutes === undefined ? {} : { reminderMinutes: input.reminderMinutes }),
    ...(input.reminders === undefined ? {} : { reminders: input.reminders }),
    ...(input.repeatRule === undefined ? {} : { repeatRule: input.repeatRule }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.text === undefined ? {} : { text: input.text }),
  }
}

function viewLabel(view: TodoView, t: TFunction): string {
  const option = viewOptions.find(item => item.id === view)
  if (!option)
    throw new Error(`Unknown Todo view: ${view}`)
  return t(option.labelKey)
}

const selectionLabelKeys: Readonly<Record<TodoListScopeId, string>> = {
  all: 'sidebarAll',
  doing: todoStatusLabelKeys.doing,
  done: todoStatusLabelKeys.done,
  next7: 'sidebarNext7',
  overdue: 'sidebarOverdue',
  today: 'sidebarToday',
  todo: todoStatusLabelKeys.todo,
  tomorrow: 'sidebarTomorrow',
  undated: 'sidebarUndated',
}

function selectionLabel(selection: TodoListSelection, tasks: readonly DesktopTodoTask[], t: TFunction): string {
  if (selection.kind === 'note')
    return tasks.find(task => task.noteId === selection.noteId)?.noteTitle ?? t('sidebarNotes')
  return t(selectionLabelKeys[selection.id])
}

function ViewIcon({ view }: { view: TodoView }) {
  const Icon = viewIcons[view]
  return <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
}

function TodoStatus({
  kind,
  onRetry,
  t,
}: {
  kind: 'empty' | 'error' | 'loading'
  onRetry: () => Promise<unknown>
  t: TFunction
}) {
  return (
    <div {...stylex.props(todoPageStyles.status)}>
      <div {...stylex.props(todoPageStyles.statusContent)}>
        {kind === 'loading'
          ? <LoaderCircle {...stylex.props(todoPageStyles.statusGlyph, todoPageStyles.loadingIcon)} aria-hidden="true" strokeWidth={1.7} />
          : kind === 'error'
            ? <TriangleAlert {...stylex.props(todoPageStyles.statusGlyph, todoPageStyles.errorIcon)} aria-hidden="true" strokeWidth={1.7} />
            : <ListTodo {...stylex.props(todoPageStyles.statusGlyph)} aria-hidden="true" strokeWidth={1.6} />}
        <span role={kind === 'loading' ? 'status' : undefined}>
          {kind === 'loading' ? t('loading') : kind === 'error' ? t('couldNotLoad') : t('noTasks')}
        </span>
        {kind === 'error' && (
          <button {...stylex.props(todoPageStyles.retryButton)} type="button" onClick={() => void onRetry()}>
            {t('tryAgain')}
          </button>
        )}
      </div>
    </div>
  )
}

export function TodoPage({
  onSelectionChange,
  onViewChange,
  selection,
  view,
}: {
  onSelectionChange: (selection: TodoListSelection) => Promise<void> | void
  onViewChange: (view: TodoView) => Promise<void> | void
  selection: TodoListSelection
  view: TodoView
}) {
  const { i18n, t } = useTranslation('todo')
  const configuration = useDesktopConfiguration()
  const queryClient = useQueryClient()
  const tasksQuery = useInfiniteQuery(todoTaskQueryOptions())
  const calendarQuery = useQuery(todoCalendarQueryOptions())
  const shouldReduceMotion = useReducedMotion()
  const { fetchNextPage } = tasksQuery
  const tasks = useMemo(() => sortTodoTasks(tasksQuery.data
    ? tasksQuery.data.pages.flatMap(page => [...page.items])
    : []), [tasksQuery.data])
  const viewTasks = useMemo(() => todoTasksForView(tasks, view), [tasks, view])
  const calendarEvents = useMemo(() => calendarQuery.data?.events ?? [], [calendarQuery.data?.events])
  const calendarSubscriptions = calendarQuery.data?.subscriptions ?? []
  const hasRunningTasks = viewTasks.some(task => task.status === 'doing' && task.startedAt !== null)
  const [now, setNow] = useState(() => Date.now())
  const [selectedTask, dispatchSelectedTask] = useReducer(selectedTaskReducer, null)
  const [selectedDate, setSelectedDate] = useState(() => dayjs(now).format('YYYY-MM-DD'))
  const selectedTaskKey = selectedTask === null ? null : todoTaskKey(selectedTask)
  const selectedDateEvents = useMemo(() => calendarEvents.filter(event => (
    event.startDate <= selectedDate && (event.endDate ?? event.startDate) >= selectedDate
  )), [calendarEvents, selectedDate])
  const visibleCalendarEvents = view === 'list'
    ? selectedDateEvents
    : view === 'quadrant' || view === 'board'
      ? []
      : calendarEvents
  const [listSidebarVisible, setListSidebarVisible] = useState(true)
  const today = dayjs(now).format('YYYY-MM-DD')
  const listSummary = useMemo(() => summarizeTodoListTasks(tasks, today), [tasks, today])
  const visibleListTasks = useMemo(
    () => filterTodoListTasks(tasks, selection, today),
    [selection, tasks, today],
  )
  const currentSelectionLabel = selectionLabel(selection, tasks, t)
  useEffect(() => subscribeTodoCalendarSnapshot((next) => {
    queryClient.setQueryData(todoQueryKeys.calendars, next)
  }), [queryClient])
  const updateTodoTask = useCallback(async (input: UpdateDesktopTodoTaskInput) => {
    await desktopRequests.updateTodoTask(input)
    dispatchSelectedTask({ input, type: 'update' })
    await queryClient.invalidateQueries({ queryKey: todoQueryKeys.all })
    await calendarQuery.refetch()
  }, [calendarQuery, queryClient])
  const createTodoTask = useCallback(async (input: CreateDesktopTodoTaskInput) => {
    const task = await desktopRequests.createTodoTask(input)
    dispatchSelectedTask({ task, type: 'select' })
    await queryClient.invalidateQueries({ queryKey: todoQueryKeys.all })
    return task
  }, [queryClient])
  const selectTask = useCallback((task: DesktopTodoTask) => dispatchSelectedTask({ task, type: 'select' }), [])
  const closeTaskDetail = useCallback(() => dispatchSelectedTask({ type: 'close' }), [])
  const loadNextPage = useCallback(async () => {
    await fetchNextPage()
  }, [fetchNextPage])
  const selectListScope = useCallback(async (nextSelection: TodoListSelection) => {
    await onSelectionChange(nextSelection)
    if (window.matchMedia('(max-width: 980px)').matches)
      setListSidebarVisible(false)
  }, [onSelectionChange])

  useEffect(() => {
    if (!hasRunningTasks)
      return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [hasRunningTasks])

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: todoQueryKeys.all })
    return window.desktop.subscribeNoteUpdates(() => {
      void queryClient.invalidateQueries({ queryKey: todoQueryKeys.all })
    })
  }, [queryClient])

  useEffect(() => {
    if (selectedTaskKey === null)
      return
    const freshTask = tasks.find(task => todoTaskKey(task) === selectedTaskKey)
    if (freshTask) {
      dispatchSelectedTask({ task: freshTask, type: 'sync' })
      return
    }
    if (!configuration.todo.keepDetailOpenWhenTaskLeavesView
      && tasksQuery.data !== undefined
      && !tasksQuery.isFetching) {
      dispatchSelectedTask({ type: 'close' })
    }
  }, [configuration.todo.keepDetailOpenWhenTaskLeavesView, selectedTaskKey, tasks, tasksQuery.data, tasksQuery.isFetching])

  useEffect(() => {
    if (view === 'list'
      || !tasksQuery.hasNextPage
      || tasksQuery.isFetchingNextPage
      || tasksQuery.isFetchNextPageError) {
      return
    }
    void loadNextPage()
  }, [
    loadNextPage,
    tasksQuery.hasNextPage,
    tasksQuery.isFetchNextPageError,
    tasksQuery.isFetchingNextPage,
    view,
  ])

  const titlebar = useMemo(() => ({
    title: t('title'),
    trailingAppearance: 'plain' as const,
    trailing: (
      <div {...stylex.props(todoPageStyles.titlebarViews)} aria-label={t('viewLabel')} role="group">
        {viewOptions.map(option => (
          <button
            key={option.id}
            {...stylex.props(todoPageStyles.titlebarViewOption, view === option.id && todoPageStyles.titlebarViewOptionSelected)}
            aria-label={t(option.descriptionKey)}
            aria-pressed={view === option.id}
            title={t(option.descriptionKey)}
            type="button"
            onClick={() => void onViewChange(option.id)}
          >
            <ViewIcon view={option.id} />
          </button>
        ))}
      </div>
    ),
  }), [onViewChange, t, view])
  usePageTitlebar(titlebar)

  let viewContent
  if (view === 'calendar') {
    viewContent = (
      <TodoCalendarView
        calendarEvents={calendarEvents}
        calendarSubscriptions={calendarSubscriptions}
        locale={i18n.language}
        now={now}
        onSelectTask={selectTask}
        onSelectedDateChange={setSelectedDate}
        onUpdateTask={updateTodoTask}
        selectedDate={selectedDate}
        selectedTaskKey={selectedTaskKey}
        t={t}
        tasks={viewTasks}
        weekStart={configuration.weekStart}
      />
    )
  }
  else if (view === 'list') {
    const listPending = tasksQuery.isPending || (visibleListTasks.length === 0 && Boolean(tasksQuery.hasNextPage) && !tasksQuery.isFetchNextPageError)
    const listError = (tasksQuery.isError && tasks.length === 0) || (visibleListTasks.length === 0 && tasksQuery.isFetchNextPageError)
    const listBody = listPending
      ? <TodoStatus kind="loading" onRetry={tasksQuery.refetch} t={t} />
      : listError
        ? <TodoStatus kind="error" onRetry={tasks.length === 0 ? tasksQuery.refetch : loadNextPage} t={t} />
        : visibleListTasks.length === 0
          ? <TodoStatus kind="empty" onRetry={tasksQuery.refetch} t={t} />
          : (
              <TodoListView
                calendarEvents={calendarEvents}
                calendarSubscriptions={calendarSubscriptions}
                hasNextPage={Boolean(tasksQuery.hasNextPage)}
                isFetchNextPageError={tasksQuery.isFetchNextPageError}
                isFetchingNextPage={tasksQuery.isFetchingNextPage}
                locale={i18n.language}
                now={now}
                onFetchNextPage={loadNextPage}
                onSelectTask={selectTask}
                onUpdateTask={updateTodoTask}
                resetKey={todoListSelectionKey(selection)}
                selectedDateEvents={selectedDateEvents}
                selectedTaskKey={selectedTaskKey}
                t={t}
                tasks={visibleListTasks}
              />
            )

    viewContent = (
      <div {...stylex.props(todoPageStyles.listLayout)}>
        <AnimatePresence initial={false}>
          {listSidebarVisible
            ? (
                <>
                  <motion.button
                    {...stylex.props(todoPageStyles.listSidebarScrim)}
                    animate={{ opacity: 1 }}
                    aria-label={t('hideListSidebar')}
                    exit={{ opacity: 0 }}
                    initial={{ opacity: 0 }}
                    key="todo-list-sidebar-scrim"
                    transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16 }}
                    type="button"
                    onClick={() => setListSidebarVisible(false)}
                  />
                  <motion.aside
                    {...stylex.props(todoPageStyles.listSidebarMotion)}
                    animate={{ opacity: 1, width: 224, x: 0 }}
                    exit={{ opacity: 0, width: 0, x: -12 }}
                    initial={{ opacity: 0, width: 0, x: -12 }}
                    key="todo-list-sidebar"
                    transition={shouldReduceMotion ? { duration: 0 } : listSidebarSpring}
                  >
                    <TodoListSidebar
                      locale={i18n.language}
                      selection={selection}
                      summary={listSummary}
                      t={t}
                      onSelectionChange={selectListScope}
                    />
                  </motion.aside>
                </>
              )
            : null}
        </AnimatePresence>
        <div {...stylex.props(todoPageStyles.listMain)}>
          <div {...stylex.props(todoPageStyles.controls)} data-todo-list-controls="">
            <div {...stylex.props(todoPageStyles.listControlsTitle)}>
              <button
                {...stylex.props(todoPageStyles.listSidebarToggle)}
                aria-label={listSidebarVisible ? t('hideListSidebar') : t('showListSidebar')}
                aria-pressed={listSidebarVisible}
                data-todo-list-sidebar-toggle=""
                title={listSidebarVisible ? t('hideListSidebar') : t('showListSidebar')}
                type="button"
                onClick={() => setListSidebarVisible(current => !current)}
              >
                {listSidebarVisible
                  ? <PanelLeftClose aria-hidden="true" size={16} strokeWidth={2} />
                  : <PanelLeftOpen aria-hidden="true" size={16} strokeWidth={2} />}
              </button>
              <h2 {...stylex.props(todoPageStyles.listTitle)}>{currentSelectionLabel}</h2>
            </div>
            <p {...stylex.props(todoPageStyles.count)} aria-live="polite">
              {tasksQuery.hasNextPage || tasksQuery.isFetchingNextPage
                ? <LoaderCircle {...stylex.props(todoPageStyles.countLoadingIcon, todoPageStyles.loadingIcon)} aria-hidden="true" strokeWidth={1.8} />
                : null}
              <span>{t('taskCount', { count: visibleListTasks.length })}</span>
            </p>
          </div>
          <div {...stylex.props(todoPageStyles.viewRegion)}>{listBody}</div>
        </div>
      </div>
    )
  }
  else if (tasksQuery.isPending && visibleCalendarEvents.length === 0) {
    viewContent = <TodoStatus kind="loading" onRetry={tasksQuery.refetch} t={t} />
  }
  else if (tasksQuery.isError && tasks.length === 0 && visibleCalendarEvents.length === 0) {
    viewContent = <TodoStatus kind="error" onRetry={tasksQuery.refetch} t={t} />
  }
  else if (view === 'board') {
    viewContent = (
      <TodoBoardView
        calendarEvents={calendarEvents}
        calendarSubscriptions={calendarSubscriptions}
        isFetchingMore={tasksQuery.isFetchingNextPage}
        locale={i18n.language}
        now={now}
        onSelectTask={selectTask}
        onUpdateTask={updateTodoTask}
        t={t}
        tasks={viewTasks}
        selectedTaskKey={selectedTaskKey}
      />
    )
  }
  else if (view === 'agenda') {
    viewContent = (
      <TodoTimelineView
        calendarEvents={calendarEvents}
        calendarSubscriptions={calendarSubscriptions}
        hasNextPage={Boolean(tasksQuery.hasNextPage)}
        isFetchNextPageError={tasksQuery.isFetchNextPageError}
        isFetchingNextPage={tasksQuery.isFetchingNextPage}
        locale={i18n.language}
        now={now}
        onFetchNextPage={loadNextPage}
        onSelectTask={selectTask}
        onUpdateTask={updateTodoTask}
        t={t}
        tasks={viewTasks}
        selectedTaskKey={selectedTaskKey}
      />
    )
  }
  else if (view === 'timeline') {
    viewContent = (
      <TodoTimeGridView
        calendarEvents={calendarEvents}
        locale={i18n.language}
        now={now}
        onCreateTask={createTodoTask}
        onSelectTask={selectTask}
        onUpdateTask={updateTodoTask}
        settings={configuration.todo}
        tasks={viewTasks}
        weekStart={configuration.weekStart}
      />
    )
  }
  else {
    viewContent = (
      <TodoQuadrantView
        calendarEvents={calendarEvents}
        calendarSubscriptions={calendarSubscriptions}
        locale={i18n.language}
        now={now}
        onSelectTask={selectTask}
        onUpdateTask={updateTodoTask}
        t={t}
        tasks={viewTasks}
        selectedTaskKey={selectedTaskKey}
      />
    )
  }

  return (
    <main {...stylex.props(todoPageStyles.page)} aria-label={t('title')}>
      <section {...stylex.props(todoPageStyles.content)} aria-label={viewLabel(view, t)}>
        <div {...stylex.props(todoPageStyles.viewRegion)}>{viewContent}</div>
      </section>
      <TodoDetailSidebar
        calendarEvents={calendarEvents}
        calendarSubscriptions={calendarSubscriptions}
        onClose={closeTaskDetail}
        onUpdateTask={updateTodoTask}
        task={selectedTask}
      />
    </main>
  )
}
