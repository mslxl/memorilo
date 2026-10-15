import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoRepeatRule, DesktopTodoTask, DesktopTodoTaskPage, DesktopTodoTaskStatus } from '@memorilo/desktop-api'
import type { InfiniteData } from 'effect-query'
import type { DesktopClientError } from '../../shared/effect-query'
import { nextTaskOccurrenceDate, taskRepeatBaseDate as repeatBaseDate } from '@memorilo/editor/task'
import dayjs from 'dayjs'
import { desktopRequests } from '../../shared/desktop-requests'
import { desktopEffect, desktopEffectQuery } from '../../shared/effect-query'
import { loadTodoCalendarSnapshot, todoCalendarAutoRefreshIntervalMs } from '../../shared/todo-calendar-cache'
import { todoQueryKeys } from './query-keys'

export const todoViews = ['list', 'board', 'agenda', 'timeline', 'calendar', 'quadrant'] as const
export type TodoView = typeof todoViews[number]

export const todoListScopeIds = ['all', 'today', 'tomorrow', 'overdue', 'next7', 'undated', 'todo', 'doing', 'done'] as const

export type TodoListScopeId = typeof todoListScopeIds[number]

export type TodoListSelection
  = | { kind: 'note', noteId: string }
    | { id: TodoListScopeId, kind: 'scope' }

export interface TodoListNoteSummary {
  count: number
  favorite: boolean
  noteId: string
  title: string
}

export interface TodoListSummary {
  counts: Readonly<Record<TodoListScopeId, number>>
  notes: readonly TodoListNoteSummary[]
}

export type TodoQuadrant = 'importantUrgent' | 'importantNotUrgent' | 'notImportantUrgent' | 'notImportantNotUrgent'

export interface TodoTaskTreeNode {
  children: readonly TodoTaskTreeNode[]
  task: DesktopTodoTask
}

export const todoStatuses: readonly DesktopTodoTaskStatus[] = ['todo', 'doing', 'done']

export const todoStatusLabelKeys: Readonly<Record<DesktopTodoTaskStatus, string>> = {
  doing: 'statusDoing',
  done: 'statusDone',
  todo: 'statusTodo',
}

const nextTodoStatusByStatus: Readonly<Record<DesktopTodoTaskStatus, DesktopTodoTaskStatus>> = {
  doing: 'done',
  done: 'todo',
  todo: 'doing',
}

export function nextTodoStatus(status: DesktopTodoTaskStatus): DesktopTodoTaskStatus {
  return nextTodoStatusByStatus[status]
}

export const todoTaskPageSize = 100

export function todoTaskKey(task: Pick<DesktopTodoTask, 'blockId' | 'noteId' | 'topicId'>): string {
  return `${task.noteId}\0${task.topicId}\0${task.blockId}`
}

function todoTaskParentId(task: DesktopTodoTask): string | null {
  return 'todoParentId' in task ? task.todoParentId ?? null : task.parentId
}

function todoTaskParentKey(task: DesktopTodoTask): string | null {
  const parentId = todoTaskParentId(task)
  return parentId === null ? null : `${task.noteId}\0${task.topicId}\0${parentId}`
}

/** Subtasks belong exclusively to the list tree; other views show top-level Todos. */
export function todoTasksForView(tasks: readonly DesktopTodoTask[], view: TodoView): readonly DesktopTodoTask[] {
  return view === 'list' ? tasks : tasks.filter(task => todoTaskParentId(task) === null)
}

/** Projects the persisted block tree into a Todo-only tree for the list view. */
export function buildTodoTaskTree(tasks: readonly DesktopTodoTask[]): readonly TodoTaskTreeNode[] {
  const nodes = tasks.map(task => ({ children: [] as TodoTaskTreeNode[], task }))
  const byKey = new Map(nodes.map(node => [todoTaskKey(node.task), node]))
  const roots: TodoTaskTreeNode[] = []
  for (const node of nodes) {
    const parentKey = todoTaskParentKey(node.task)
    const parent = parentKey === null ? undefined : byKey.get(parentKey)
    if (!parent || parent === node)
      roots.push(node)
    else
      parent.children.push(node)
  }
  return roots
}

export function flattenTodoTaskTree(
  roots: readonly TodoTaskTreeNode[],
  collapsedKeys: ReadonlySet<string>,
): readonly { depth: number, hasChildren: boolean, task: DesktopTodoTask }[] {
  const flattened: { depth: number, hasChildren: boolean, task: DesktopTodoTask }[] = []
  const visit = (nodes: readonly TodoTaskTreeNode[], depth: number): void => {
    for (const node of nodes) {
      flattened.push({ depth, hasChildren: node.children.length > 0, task: node.task })
      if (node.children.length > 0 && !collapsedKeys.has(todoTaskKey(node.task)))
        visit(node.children, depth + 1)
    }
  }
  visit(roots, 0)
  return flattened
}

/** Keep the source order for active tasks while placing completed tasks last. */
export function sortTodoTasks(tasks: readonly DesktopTodoTask[]): readonly DesktopTodoTask[] {
  return [...tasks].sort((left, right) => Number(left.status === 'done') - Number(right.status === 'done'))
}

export function todoTaskQueryOptions() {
  return desktopEffectQuery.infiniteQueryOptions<
    DesktopTodoTaskPage,
    DesktopClientError,
    never,
    InfiniteData<DesktopTodoTaskPage>,
    number | null
  >({
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: null,
    queryFn: ({ pageParam }) => desktopEffect('notes.list-todo-tasks', () => (
      desktopRequests.listTodoTasks({
        ...(pageParam === null ? {} : { cursor: pageParam }),
        limit: todoTaskPageSize,
      })
    )),
    queryKey: todoQueryKeys.list('all'),
  })
}

export function isTodoListScopeId(value: unknown): value is TodoListScopeId {
  return typeof value === 'string' && (todoListScopeIds as readonly string[]).includes(value)
}

export function isTodoStatus(value: unknown): value is DesktopTodoTaskStatus {
  return typeof value === 'string' && (todoStatuses as readonly string[]).includes(value)
}

export function isTodoView(value: unknown): value is TodoView {
  return typeof value === 'string' && (todoViews as readonly string[]).includes(value)
}

export function todoListSelectionKey(selection: TodoListSelection): string {
  return selection.kind === 'note' ? `note:${selection.noteId}` : `scope:${selection.id}`
}

export function todoCalendarQueryOptions() {
  return desktopEffectQuery.queryOptions<{
    events: readonly DesktopTodoCalendarEvent[]
    subscriptions: readonly DesktopTodoCalendarSubscription[]
  }, DesktopClientError, never>({
    queryFn: () => desktopEffect('notes.listTodoCalendarEvents', loadTodoCalendarSnapshot),
    queryKey: todoQueryKeys.calendars,
    refetchInterval: todoCalendarAutoRefreshIntervalMs,
  })
}

export function taskElapsedMs(
  task: { elapsedMs: number, startedAt: number | null, status: DesktopTodoTaskStatus },
  now: number,
): number {
  if (!Number.isFinite(now))
    throw new TypeError('Todo clock must be a finite number')
  if (task.status === 'doing' && task.startedAt !== null)
    return task.elapsedMs + Math.max(0, now - task.startedAt)
  return task.elapsedMs
}

export function formatTaskDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    throw new TypeError('Todo duration must be a non-negative finite number')
  const totalMinutes = Math.floor(milliseconds / 60_000)
  if (totalMinutes < 1)
    return '<1m'
  if (totalMinutes < 60)
    return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

function taskDateValue(date: string): Date {
  const value = dayjs(date)
  if (!value.isValid() || value.format('YYYY-MM-DD') !== date)
    throw new TypeError(`Todo date must be a valid ISO date: ${date}`)
  return value.startOf('day').toDate()
}

export type TodoTaskScheduleState = 'overdue' | 'upcoming'

export function taskScheduleState(scheduleDate: string, now: number): TodoTaskScheduleState {
  if (!Number.isFinite(now))
    throw new TypeError('Todo clock must be a finite number')
  const scheduled = taskDateValue(scheduleDate)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return scheduled.getTime() < today.getTime() ? 'overdue' : 'upcoming'
}

export function formatTaskScheduleDate(scheduleDate: string, locale: string, now: number): string {
  const scheduled = taskDateValue(scheduleDate)
  const today = new Date(now)
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    ...(scheduled.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  }
  return new Intl.DateTimeFormat(locale, options).format(scheduled)
}

export function groupTodoTasks(tasks: readonly DesktopTodoTask[]): Readonly<Record<DesktopTodoTaskStatus, readonly DesktopTodoTask[]>> {
  const grouped: Record<DesktopTodoTaskStatus, DesktopTodoTask[]> = {
    doing: [],
    done: [],
    todo: [],
  }
  for (const task of tasks)
    grouped[task.status].push(task)
  return grouped
}

export function taskPlanningDate(task: Pick<DesktopTodoTask, 'schedule' | 'journalDate' | 'startedAt'>): string | null {
  if (task.schedule.kind === 'deadline')
    return task.schedule.date
  if (task.schedule.kind === 'span')
    return task.schedule.start.slice(0, 10)
  if (task.startedAt === null)
    return null
  return dayjs(task.startedAt).format('YYYY-MM-DD')
}

function taskMatchesListScope(task: DesktopTodoTask, scope: TodoListScopeId, today: string): boolean {
  const active = task.status !== 'done'
  const date = taskPlanningDate(task)
  switch (scope) {
    case 'all':
      return active
    case 'today':
      return active && date === today
    case 'tomorrow':
      return active && date === dayjs(today).add(1, 'day').format('YYYY-MM-DD')
    case 'overdue':
      return active && date !== null && date < today
    case 'next7': {
      const lastDay = dayjs(today).add(6, 'day').format('YYYY-MM-DD')
      return active && date !== null && date >= today && date <= lastDay
    }
    case 'undated':
      return active && date === null
    case 'todo':
    case 'doing':
    case 'done':
      return task.status === scope
  }
}

export function filterTodoListTasks(
  tasks: readonly DesktopTodoTask[],
  selection: TodoListSelection,
  today: string,
): readonly DesktopTodoTask[] {
  if (selection.kind === 'note')
    return tasks.filter(task => task.status !== 'done' && task.noteId === selection.noteId)
  return tasks.filter(task => taskMatchesListScope(task, selection.id, today))
}

export function summarizeTodoListTasks(tasks: readonly DesktopTodoTask[], today: string): TodoListSummary {
  const counts: Record<TodoListScopeId, number> = {
    all: 0,
    doing: 0,
    done: 0,
    next7: 0,
    overdue: 0,
    today: 0,
    todo: 0,
    tomorrow: 0,
    undated: 0,
  }
  const notes = new Map<string, TodoListNoteSummary>()

  for (const task of tasks) {
    for (const scope of todoListScopeIds) {
      if (taskMatchesListScope(task, scope, today))
        counts[scope] += 1
    }
    if (task.status === 'done')
      continue
    const note = notes.get(task.noteId)
    if (note) {
      note.count += 1
      note.favorite ||= task.noteFavorite
    }
    else {
      notes.set(task.noteId, {
        count: 1,
        favorite: task.noteFavorite,
        noteId: task.noteId,
        title: task.noteTitle,
      })
    }
  }

  return { counts, notes: [...notes.values()] }
}

export function taskOccurrenceDate(task: Pick<DesktopTodoTask, 'schedule' | 'journalDate' | 'startedAt'>, today = dayjs().format('YYYY-MM-DD')): string {
  return taskPlanningDate(task) ?? today
}

export function taskRepeatBaseDate(
  task: Pick<DesktopTodoTask, 'schedule' | 'journalDate' | 'startedAt'>,
  rule: DesktopTodoRepeatRule,
  completedOn: string,
): string {
  return repeatBaseDate(taskOccurrenceDate(task, completedOn), rule, completedOn)
}

export function nextTodoOccurrenceDate(
  currentDate: string,
  rule: DesktopTodoRepeatRule,
  calendarEvents: readonly DesktopTodoCalendarEvent[] = [],
): string {
  return nextTaskOccurrenceDate(currentDate, rule, calendarEvents)
}

export function groupTodoTasksByDate(tasks: readonly DesktopTodoTask[]): ReadonlyMap<string, readonly DesktopTodoTask[]> {
  const grouped = new Map<string, DesktopTodoTask[]>()
  for (const task of tasks) {
    const date = taskPlanningDate(task)
    if (date === null)
      continue
    const dateTasks = grouped.get(date)
    if (dateTasks)
      dateTasks.push(task)
    else
      grouped.set(date, [task])
  }
  for (const [date, dateTasks] of grouped)
    grouped.set(date, [...sortTodoTasks(dateTasks)])
  return grouped
}

export function classifyTodoQuadrant(task: DesktopTodoTask, today: string): TodoQuadrant {
  const date = taskPlanningDate(task)
  const urgent = task.status !== 'done' && date !== null && date <= today
  if (task.noteFavorite)
    return urgent ? 'importantUrgent' : 'importantNotUrgent'
  return urgent ? 'notImportantUrgent' : 'notImportantNotUrgent'
}
