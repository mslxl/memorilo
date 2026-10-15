import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoTask, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { Dayjs } from 'dayjs'
import type { TFunction } from 'i18next'
import * as stylex from '@stylexjs/stylex'
import { useVirtualizer } from '@tanstack/react-virtual'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatTodoMonth } from '../todo-date-format'
import { groupTodoTasksByDate, taskPlanningDate, todoTaskKey } from '../todo-model'
import { TodoCalendarEventItem } from './todo-calendar-event'
import { TodoPlanningTask } from './todo-planning-task'
import { todoPlanningViewStyles as planningStyles } from './todo-planning-view.stylex'
import { todoTimelineViewStyles as styles } from './todo-timeline-view.stylex'

interface ScheduleItem {
  endMinutes: number | null
  event?: DesktopTodoCalendarEvent
  kind: 'event' | 'task'
  startMinutes: number | null
  task?: DesktopTodoTask
}

interface ScheduleGroupData {
  date: string
  events: readonly DesktopTodoCalendarEvent[]
  tasks: readonly DesktopTodoTask[]
}

function formatScheduleDate(date: Dayjs, locale: string): { day: string, weekday: string } {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  return { day: `${date.date()}`, weekday: formatter.format(date.toDate()) }
}

function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60).toString().padStart(2, '0')
  const minute = (minutes % 60).toString().padStart(2, '0')
  return `${hour}:${minute}`
}

function timeMinutes(value: string | null | undefined): number | null {
  if (!value)
    return null
  const match = /(?:T|\s)(\d{2}):(\d{2})/u.exec(value) ?? /^(\d{2}):(\d{2})$/u.exec(value)
  if (!match)
    return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59)
    return null
  return hours * 60 + minutes
}

function taskScheduleItem(task: DesktopTodoTask): ScheduleItem {
  const startMinutes = task.schedule.kind === 'span' && !task.schedule.allDay
    ? timeMinutes(task.schedule.start)
    : task.schedule.kind === 'deadline' ? timeMinutes(task.schedule.time) : null
  const endMinutes = task.schedule.kind === 'span' && !task.schedule.allDay
    ? timeMinutes(task.schedule.end) ?? (startMinutes === null ? null : startMinutes + 60)
    : (startMinutes === null ? null : startMinutes + 60)
  return { endMinutes, kind: 'task', startMinutes, task }
}

function itemSort(left: ScheduleItem, right: ScheduleItem): number {
  if (left.startMinutes === null && right.startMinutes !== null)
    return -1
  if (left.startMinutes !== null && right.startMinutes === null)
    return 1
  return (left.startMinutes ?? 0) - (right.startMinutes ?? 0)
}

function PeriodButton({
  direction,
  label,
  onClick,
}: {
  direction: 'next' | 'previous'
  label: string
  onClick: () => void
}) {
  return (
    <button
      {...stylex.props(planningStyles.iconButton)}
      aria-label={label}
      title={label}
      type="button"
      onClick={onClick}
    >
      {direction === 'previous'
        ? <ChevronLeft aria-hidden="true" size={15} strokeWidth={1.9} />
        : <ChevronRight aria-hidden="true" size={15} strokeWidth={1.9} />}
    </button>
  )
}

function ScheduleEntry({
  calendarEvents,
  calendarSubscriptions,
  item,
  locale,
  now,
  onSelectTask,
  onUpdateTask,
  selectedTaskKey,
  t,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  item: ScheduleItem
  locale: string
  now: number
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selectedTaskKey: string | null
  t: TFunction
}) {
  const timeLabel = item.startMinutes === null
    ? t('allDay')
    : `${formatTime(item.startMinutes)}${item.endMinutes === null ? '' : ` - ${formatTime(item.endMinutes)}`}`
  return (
    <div {...stylex.props(styles.entry)}>
      <span {...stylex.props(styles.time)}>{timeLabel}</span>
      <span {...stylex.props(styles.entryRail)} aria-hidden="true">
        <span {...stylex.props(styles.entryDot)} />
      </span>
      <div {...stylex.props(styles.entryContent)}>
        {item.kind === 'event' && item.event
          ? <TodoCalendarEventItem event={item.event} locale={locale} variant="timeline" />
          : item.task
            ? <TodoPlanningTask calendarEvents={calendarEvents} calendarSubscriptions={calendarSubscriptions} locale={locale} now={now} onSelectTask={onSelectTask} onUpdateTask={onUpdateTask} selected={todoTaskKey(item.task) === selectedTaskKey} t={t} task={item.task} />
            : null}
      </div>
    </div>
  )
}

function ScheduleGroup({
  calendarEvents,
  calendarSubscriptions,
  date,
  events,
  isToday,
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
  date: Dayjs
  events: readonly DesktopTodoCalendarEvent[]
  isToday: boolean
  locale: string
  now: number
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selectedTaskKey: string | null
  t: TFunction
  tasks: readonly DesktopTodoTask[]
}) {
  const labels = formatScheduleDate(date, locale)
  const items = useMemo(() => [
    ...events.map(event => ({ endMinutes: null, event, kind: 'event' as const, startMinutes: null })),
    ...tasks.map(taskScheduleItem),
  ].sort(itemSort), [events, tasks])
  return (
    <section {...stylex.props(styles.group)}>
      <div {...stylex.props(styles.date)}>
        <span {...stylex.props(styles.dateNumber, isToday && styles.dateToday)}>{labels.day}</span>
        <span {...stylex.props(styles.dateWeekday, isToday && styles.dateToday)}>{labels.weekday}</span>
      </div>
      <div {...stylex.props(styles.entries)}>
        <span {...stylex.props(styles.dateRail)} aria-hidden="true" />
        {items.map((item, index) => (
          <ScheduleEntry
            calendarEvents={calendarEvents}
            calendarSubscriptions={calendarSubscriptions}
            item={item}
            key={item.kind === 'task' && item.task ? todoTaskKey(item.task) : `${item.event?.subscriptionId}:${item.event?.uid}:${item.event?.startDate}:${index}`}
            locale={locale}
            now={now}
            onSelectTask={onSelectTask}
            onUpdateTask={onUpdateTask}
            selectedTaskKey={selectedTaskKey}
            t={t}
          />
        ))}
      </div>
    </section>
  )
}

export function TodoTimelineView({
  calendarEvents,
  calendarSubscriptions,
  hasNextPage = false,
  isFetchNextPageError = false,
  isFetchingNextPage = false,
  locale,
  now,
  onFetchNextPage,
  onSelectTask,
  onUpdateTask,
  selectedTaskKey,
  t,
  tasks,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  hasNextPage?: boolean
  isFetchNextPageError?: boolean
  isFetchingNextPage?: boolean
  locale: string
  now: number
  onFetchNextPage?: () => Promise<unknown>
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selectedTaskKey: string | null
  t: TFunction
  tasks: readonly DesktopTodoTask[]
}) {
  const today = dayjs(now).startOf('day')
  const [activeMonth, setActiveMonth] = useState(() => today.startOf('month'))
  const viewportRef = useRef<HTMLDivElement>(null)
  const grouped = useMemo(() => groupTodoTasksByDate(tasks), [tasks])
  const eventsByDate = useMemo(() => {
    const result = new Map<string, DesktopTodoCalendarEvent[]>()
    for (const event of calendarEvents) {
      let date = dayjs(event.startDate)
      const through = dayjs(event.endDate ?? event.startDate)
      while (!date.isAfter(through, 'day')) {
        const key = date.format('YYYY-MM-DD')
        const current = result.get(key)
        if (current)
          current.push(event)
        else
          result.set(key, [event])
        date = date.add(1, 'day')
      }
    }
    return result
  }, [calendarEvents])
  const groups = useMemo<readonly ScheduleGroupData[]>(() => [...grouped.entries()]
    .filter(([date]) => dayjs(date).isSame(activeMonth, 'month'))
    .map(([date, dateTasks]) => ({ date, events: eventsByDate.get(date) ?? [], tasks: dateTasks }))
    .concat([...eventsByDate.entries()]
      .filter(([date]) => dayjs(date).isSame(activeMonth, 'month') && !grouped.has(date))
      .map(([date, dateEvents]) => ({ date, events: dateEvents, tasks: [] })))
    .sort((left, right) => left.date.localeCompare(right.date)), [activeMonth, eventsByDate, grouped])
  const unscheduled = useMemo(() => tasks.filter(task => taskPlanningDate(task) === null), [tasks])
  const virtualizer = useVirtualizer({
    count: groups.length,
    estimateSize: () => 128,
    getItemKey: index => groups[index]?.date ?? index,
    getScrollElement: () => viewportRef.current,
    measureElement: element => element.getBoundingClientRect().height,
    overscan: 5,
  })
  const virtualGroups = virtualizer.getVirtualItems()
  const lastVirtualGroup = virtualGroups.at(-1)
  const fetchMore = useCallback(() => {
    if (onFetchNextPage)
      void onFetchNextPage()
  }, [onFetchNextPage])

  useEffect(() => {
    if (!lastVirtualGroup || lastVirtualGroup.index < groups.length - 2 || !hasNextPage || isFetchingNextPage || isFetchNextPageError)
      return
    fetchMore()
  }, [fetchMore, groups.length, hasNextPage, isFetchNextPageError, isFetchingNextPage, lastVirtualGroup])

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 })
  }, [activeMonth])

  return (
    <div {...stylex.props(planningStyles.root)} data-todo-view="timeline">
      <div {...stylex.props(planningStyles.toolbar)}>
        <div {...stylex.props(planningStyles.toolbarTitle)}>
          <span {...stylex.props(planningStyles.title)}>{t('timelineView')}</span>
          <span {...stylex.props(planningStyles.subtitle)}>{t('timelineSubtitle')}</span>
        </div>
        <div {...stylex.props(planningStyles.toolbarActions)}>
          <div {...stylex.props(planningStyles.periodControl)}>
            <PeriodButton direction="previous" label={t('previousMonth')} onClick={() => setActiveMonth(current => current.subtract(1, 'month'))} />
            <span {...stylex.props(planningStyles.periodLabel)}>{formatTodoMonth(activeMonth, locale)}</span>
            <PeriodButton direction="next" label={t('nextMonth')} onClick={() => setActiveMonth(current => current.add(1, 'month'))} />
          </div>
          <button {...stylex.props(planningStyles.todayButton)} type="button" onClick={() => setActiveMonth(today.startOf('month'))}>{t('today')}</button>
        </div>
      </div>
      <div ref={viewportRef} {...stylex.props(styles.viewport)}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualGroups.map((virtualGroup) => {
            const group = groups[virtualGroup.index]
            if (!group)
              return null
            return (
              <div
                data-index={virtualGroup.index}
                key={group.date}
                ref={virtualizer.measureElement}
                style={{ left: 0, position: 'absolute', top: 0, transform: `translateY(${virtualGroup.start}px)`, width: '100%' }}
              >
                <ScheduleGroup
                  calendarEvents={calendarEvents}
                  calendarSubscriptions={calendarSubscriptions}
                  date={dayjs(group.date)}
                  events={group.events}
                  isToday={group.date === today.format('YYYY-MM-DD')}
                  locale={locale}
                  now={now}
                  onSelectTask={onSelectTask}
                  onUpdateTask={onUpdateTask}
                  selectedTaskKey={selectedTaskKey}
                  t={t}
                  tasks={group.tasks}
                />
              </div>
            )
          })}
        </div>
        {unscheduled.length > 0 && (
          <section {...stylex.props(styles.unscheduled)}>
            <div {...stylex.props(styles.unscheduledLabel)}>{t('unscheduled')}</div>
            <div {...stylex.props(styles.entries)}>
              {unscheduled.map(task => (
                <TodoPlanningTask
                  calendarEvents={calendarEvents}
                  calendarSubscriptions={calendarSubscriptions}
                  key={todoTaskKey(task)}
                  locale={locale}
                  now={now}
                  onSelectTask={onSelectTask}
                  onUpdateTask={onUpdateTask}
                  selected={todoTaskKey(task) === selectedTaskKey}
                  t={t}
                  task={task}
                />
              ))}
            </div>
          </section>
        )}
        {isFetchingNextPage && (
          <div {...stylex.props(styles.loadingMore)} role="status">
            <LoaderCircle aria-hidden="true" size={14} />
            <span>{t('loadingMore')}</span>
          </div>
        )}
        {isFetchNextPageError && <button {...stylex.props(styles.loadMoreButton)} type="button" onClick={fetchMore}>{t('tryAgain')}</button>}
        {groups.length === 0 && unscheduled.length === 0 && !isFetchingNextPage && <div {...stylex.props(planningStyles.empty)}>{t('noTasksInPeriod')}</div>}
      </div>
    </div>
  )
}
