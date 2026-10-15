import type { DesktopTodoCalendarEvent, DesktopTodoCalendarSubscription, DesktopTodoTask, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { DesktopWeekStart } from '@memorilo/desktop-config'
import type { Dayjs } from 'dayjs'
import type { TFunction } from 'i18next'
import type { CSSProperties } from 'react'
import { projectTaskOccurrences } from '@memorilo/editor/task'
import * as stylex from '@stylexjs/stylex'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatTodoMonth } from '../todo-date-format'
import { taskPlanningDate, todoTaskKey } from '../todo-model'
import { TodoTaskActions } from '../todo-task-actions'
import { TodoTaskOccurrenceActions } from '../todo-task-occurrence-actions'
import { TodoCalendarEventItem } from './todo-calendar-event'
import { todoCalendarViewStyles as styles } from './todo-calendar-view.stylex'
import { todoPlanningViewStyles as planningStyles } from './todo-planning-view.stylex'

type CalendarItem
  = | { event: DesktopTodoCalendarEvent, kind: 'event' }
    | { date: string, kind: 'prediction', task: DesktopTodoTask }
    | { kind: 'task', task: DesktopTodoTask }

type CalendarSpanItem
  = | { endDate: string, event: DesktopTodoCalendarEvent, key: string, kind: 'event', startDate: string }
    | { endDate: string, key: string, kind: 'task', startDate: string, task: DesktopTodoTask }

interface CalendarSpanSegment {
  columnEnd: number
  columnStart: number
  item: CalendarSpanItem
  lane: number
  week: number
}

interface CalendarEventLayout {
  singles: readonly DesktopTodoCalendarEvent[]
  spans: readonly CalendarSpanItem[]
}

interface CalendarMonthView {
  days: readonly Dayjs[]
  eventsByDate: ReadonlyMap<string, readonly DesktopTodoCalendarEvent[]>
  grouped: ReadonlyMap<string, readonly CalendarItem[]>
  month: Dayjs
  spanLayout: ReturnType<typeof buildSpanSegments>
}

function formatDate(date: Dayjs, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', weekday: 'short' }).format(date.toDate())
}

function weekdayLabels(locale: string, weekStart: DesktopWeekStart): readonly { key: string, label: string }[] {
  const sunday = dayjs('2026-08-02')
  const offset = weekStart === 'monday' ? 1 : 0
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  return Array.from({ length: 7 }, (_, index) => {
    const day = sunday.add(offset + index, 'day')
    return { key: day.format('dd'), label: formatter.format(day.toDate()) }
  })
}

function calendarDays(month: Dayjs, weekStart: DesktopWeekStart): readonly Dayjs[] {
  const first = month.startOf('month')
  const firstWeekday = weekStart === 'monday' ? (first.day() + 6) % 7 : first.day()
  const start = first.subtract(firstWeekday, 'day')
  return Array.from({ length: 42 }, (_, index) => start.add(index, 'day'))
}

function calendarItemKey(item: CalendarItem): string {
  if (item.kind === 'task')
    return todoTaskKey(item.task)
  if (item.kind === 'prediction')
    return `${todoTaskKey(item.task)}:prediction:${item.date}`
  return `${item.event.subscriptionId}:${item.event.uid}:${item.event.startDate}`
}

function calendarItemDoneRank(item: CalendarItem): number {
  return item.kind === 'task' && item.task.status === 'done' ? 1 : 0
}

function calendarSpanDoneRank(item: CalendarSpanItem): number {
  return item.kind === 'task' && item.task.status === 'done' ? 1 : 0
}

function taskSpan(task: DesktopTodoTask): CalendarSpanItem | null {
  if (task.schedule?.kind === 'span') {
    const startDate = task.schedule.start.slice(0, 10)
    const endDate = task.schedule.end.slice(0, 10)
    if (endDate <= startDate)
      return null
    return {
      endDate,
      key: todoTaskKey(task),
      kind: 'task',
      startDate,
      task,
    }
  }
  return null
}

function calendarEventLayout(events: readonly DesktopTodoCalendarEvent[]): CalendarEventLayout {
  const grouped = new Map<string, DesktopTodoCalendarEvent[]>()
  for (const event of events) {
    const groupKey = `${event.subscriptionId}\0${event.title}`
    const current = grouped.get(groupKey)
    if (current)
      current.push(event)
    else
      grouped.set(groupKey, [event])
  }

  const singles: DesktopTodoCalendarEvent[] = []
  const spans: CalendarSpanItem[] = []
  for (const group of grouped.values()) {
    group.sort((left, right) => left.startDate.localeCompare(right.startDate) || (left.endDate ?? left.startDate).localeCompare(right.endDate ?? right.startDate))
    let cluster: DesktopTodoCalendarEvent[] = []
    let clusterStart = ''
    let clusterEnd = ''
    const flush = () => {
      if (cluster.length === 0)
        return
      if (clusterEnd > clusterStart) {
        const event = cluster[0]
        if (!event)
          throw new Error('Calendar event cluster lost its representative')
        spans.push({
          endDate: clusterEnd,
          event: { ...event, endDate: clusterEnd, startDate: clusterStart },
          key: `${event.subscriptionId}:${event.title}:${clusterStart}:${clusterEnd}`,
          kind: 'event',
          startDate: clusterStart,
        })
      }
      else {
        singles.push(...cluster)
      }
      cluster = []
      clusterStart = ''
      clusterEnd = ''
    }

    for (const event of group) {
      const eventEnd = event.endDate ?? event.startDate
      if (cluster.length === 0) {
        cluster = [event]
        clusterStart = event.startDate
        clusterEnd = eventEnd
        continue
      }
      if (!dayjs(event.startDate).isAfter(dayjs(clusterEnd).add(1, 'day'), 'day')) {
        cluster.push(event)
        if (eventEnd > clusterEnd)
          clusterEnd = eventEnd
        continue
      }
      flush()
      cluster = [event]
      clusterStart = event.startDate
      clusterEnd = eventEnd
    }
    flush()
  }
  return { singles, spans }
}

function buildSpanSegments(items: readonly CalendarSpanItem[], days: readonly Dayjs[]): {
  laneCounts: readonly number[]
  segments: readonly CalendarSpanSegment[]
  spansByDate: ReadonlyMap<string, number>
} {
  const firstDay = days[0]
  const lastDay = days.at(-1)
  if (!firstDay || !lastDay)
    return { laneCounts: [], segments: [], spansByDate: new Map() }

  const segmentsByWeek = Array.from({ length: 6 }, () => [] as Omit<CalendarSpanSegment, 'lane'>[])
  const spansByDate = new Map<string, number>()
  for (const item of items) {
    const itemStart = dayjs(item.startDate)
    const itemEnd = dayjs(item.endDate)
    const visibleStart = itemStart.isBefore(firstDay, 'day') ? firstDay : itemStart
    const visibleEnd = itemEnd.isAfter(lastDay, 'day') ? lastDay : itemEnd
    if (visibleEnd.isBefore(visibleStart, 'day'))
      continue

    let coveredDate = visibleStart
    while (!coveredDate.isAfter(visibleEnd, 'day')) {
      const dateKey = coveredDate.format('YYYY-MM-DD')
      spansByDate.set(dateKey, (spansByDate.get(dateKey) ?? 0) + 1)
      coveredDate = coveredDate.add(1, 'day')
    }

    const startOffset = visibleStart.diff(firstDay, 'day')
    const endOffset = visibleEnd.diff(firstDay, 'day')
    const firstWeek = Math.floor(startOffset / 7)
    const lastWeek = Math.floor(endOffset / 7)
    for (let week = firstWeek; week <= lastWeek; week += 1) {
      const weekStartOffset = week * 7
      const segmentStart = Math.max(startOffset, weekStartOffset)
      const segmentEnd = Math.min(endOffset, weekStartOffset + 6)
      segmentsByWeek[week]?.push({
        columnEnd: segmentEnd - weekStartOffset + 2,
        columnStart: segmentStart - weekStartOffset + 1,
        item,
        week,
      })
    }
  }

  const laneCounts = Array.from({ length: 6 }, () => 0)
  const segments: CalendarSpanSegment[] = []
  for (const [week, weekSegments] of segmentsByWeek.entries()) {
    const laneEnds: number[] = []
    weekSegments.sort((left, right) => left.columnStart - right.columnStart
      || calendarSpanDoneRank(left.item) - calendarSpanDoneRank(right.item)
      || right.columnEnd - left.columnEnd
      || left.item.key.localeCompare(right.item.key))
    for (const segment of weekSegments) {
      let lane = laneEnds.findIndex(end => end < segment.columnStart)
      if (lane === -1)
        lane = laneEnds.length
      laneEnds[lane] = segment.columnEnd - 1
      segments.push({ ...segment, lane })
    }
    laneCounts[week] = laneEnds.length
  }
  return { laneCounts, segments, spansByDate }
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

function CalendarTaskItem({
  calendarEvents,
  calendarSubscriptions,
  compactAlignment,
  onSelectTask,
  onUpdateTask,
  selectedTaskKey,
  t,
  task,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  compactAlignment: 'left' | 'right'
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selectedTaskKey: string | null
  t: TFunction
  task: DesktopTodoTask
}) {
  const selected = todoTaskKey(task) === selectedTaskKey
  return (
    <div {...stylex.props(styles.taskShell)}>
      <button
        {...stylex.props(styles.taskButton, selected && styles.taskButtonSelected)}
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
          triggerContent={(
            <span
              {...stylex.props(
                styles.taskStatus,
                task.status === 'doing' && styles.taskStatusDoing,
                task.status === 'done' && styles.taskStatusDone,
              )}
              aria-hidden="true"
            />
          )}
        />
        <span {...stylex.props(styles.taskText, task.status === 'done' && styles.taskTextDone)}>{task.text}</span>
      </button>
      <div {...stylex.props(styles.taskActions)}>
        <TodoTaskActions compact calendarEvents={calendarEvents} calendarSubscriptions={calendarSubscriptions} compactAlignment={compactAlignment} onUpdateTask={onUpdateTask} t={t} task={task} triggerContent={<span>{task.schedule.kind === 'span' ? (task.schedule.allDay ? t('allDay') : task.schedule.start.slice(11)) : task.schedule.kind === 'deadline' ? task.schedule.time ?? '' : ''}</span>} />
      </div>
    </div>
  )
}

function CalendarPredictionItem({ task, t }: { task: DesktopTodoTask, t: TFunction }) {
  return (
    <div {...stylex.props(styles.predictionShell)} title={t('repeatPrediction', { task: task.text })}>
      <div {...stylex.props(styles.predictionPreview)}>
        <span {...stylex.props(styles.predictionStatus)} aria-hidden="true" />
        <span {...stylex.props(styles.predictionText)}>{task.text}</span>
      </div>
    </div>
  )
}

function CalendarItemRow({
  calendarEvents,
  calendarSubscriptions,
  compactAlignment,
  item,
  locale,
  onSelectTask,
  onUpdateTask,
  selectedTaskKey,
  t,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  compactAlignment: 'left' | 'right'
  item: CalendarItem
  locale: string
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selectedTaskKey: string | null
  t: TFunction
}) {
  if (item.kind === 'event')
    return <TodoCalendarEventItem event={item.event} locale={locale} variant="calendar" />
  if (item.kind === 'prediction')
    return <CalendarPredictionItem t={t} task={item.task} />
  return <CalendarTaskItem calendarEvents={calendarEvents} calendarSubscriptions={calendarSubscriptions} compactAlignment={compactAlignment} onSelectTask={onSelectTask} onUpdateTask={onUpdateTask} selectedTaskKey={selectedTaskKey} t={t} task={item.task} />
}

export function TodoCalendarView({
  calendarEvents,
  calendarSubscriptions,
  locale,
  now,
  onSelectTask,
  onSelectedDateChange,
  onUpdateTask,
  selectedDate,
  selectedTaskKey,
  t,
  tasks,
  weekStart,
}: {
  calendarEvents: readonly DesktopTodoCalendarEvent[]
  calendarSubscriptions: readonly DesktopTodoCalendarSubscription[]
  locale: string
  now: number
  onSelectTask: (task: DesktopTodoTask) => Promise<void> | void
  onSelectedDateChange: (date: string) => void
  onUpdateTask: (input: UpdateDesktopTodoTaskInput) => Promise<void>
  selectedDate: string
  selectedTaskKey: string | null
  t: TFunction
  tasks: readonly DesktopTodoTask[]
  weekStart: DesktopWeekStart
}) {
  const today = dayjs(now).startOf('day')
  const [activeMonth, setActiveMonth] = useState(() => dayjs(selectedDate).startOf('month'))
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const monthViews = useMemo<readonly CalendarMonthView[]>(() => {
    const eventLayout = calendarEventLayout(calendarEvents)
    return [-1, 0, 1].map((offset) => {
      const month = activeMonth.add(offset, 'month')
      const days = calendarDays(month, weekStart)
      const grouped = new Map<string, CalendarItem[]>()
      const add = (date: string, item: CalendarItem) => {
        const current = grouped.get(date)
        if (current)
          current.push(item)
        else
          grouped.set(date, [item])
      }
      for (const task of tasks) {
        const date = task.schedule?.kind === 'deadline'
          ? task.schedule.date
          : task.schedule?.kind === 'span'
            ? task.schedule.start.slice(0, 10)
            : task.schedule?.kind === 'none'
              ? today.format('YYYY-MM-DD')
              : taskPlanningDate(task)
        if (date !== null && taskSpan(task) === null)
          add(date, { kind: 'task', task })
        if (!task.repeatRule || date === null)
          continue
        const schedule = task.schedule
        const occurrences = projectTaskOccurrences(schedule, task.repeatRule, {
          calendarEvents,
          from: days[0]?.format('YYYY-MM-DD') ?? month.startOf('month').format('YYYY-MM-DD'),
          through: days.at(-1)?.format('YYYY-MM-DD') ?? month.endOf('month').format('YYYY-MM-DD'),
          undatedDate: today.format('YYYY-MM-DD'),
        })
        for (const occurrence of occurrences) {
          if (occurrence.source === 'preview')
            add(occurrence.occurrenceDate, { date: occurrence.occurrenceDate, kind: 'prediction', task })
        }
      }
      const spanLayout = buildSpanSegments([
        ...eventLayout.spans,
        ...tasks.map(taskSpan).filter((item): item is CalendarSpanItem => item !== null),
      ], days)
      const eventsByDate = new Map<string, DesktopTodoCalendarEvent[]>()
      for (const event of eventLayout.singles) {
        const current = eventsByDate.get(event.startDate)
        if (current)
          current.push(event)
        else
          eventsByDate.set(event.startDate, [event])
      }
      return { days, eventsByDate, grouped, month, spanLayout }
    })
  }, [activeMonth, calendarEvents, tasks, today, weekStart])
  const labels = weekdayLabels(locale, weekStart)

  useLayoutEffect(() => {
    const container = scrollRef.current
    const middleMonth = container?.querySelector<HTMLElement>('[data-calendar-month="current"]')
    if (!container || !middleMonth)
      return
    container.scrollTo({ top: middleMonth.offsetTop, behavior: 'auto' })
  }, [activeMonth])

  useEffect(() => () => {
    if (scrollSettleTimerRef.current)
      clearTimeout(scrollSettleTimerRef.current)
  }, [])

  const settleScroll = () => {
    const container = scrollRef.current
    if (!container)
      return
    const panels = Array.from(container.querySelectorAll<HTMLElement>('[data-calendar-month]'))
    const nearestIndex = panels.reduce((best, panel, index) => {
      const bestDistance = Math.abs((panels[best]?.offsetTop ?? 0) - container.scrollTop)
      const distance = Math.abs(panel.offsetTop - container.scrollTop)
      return distance < bestDistance ? index : best
    }, 1)
    if (nearestIndex !== 1) {
      const nextMonth = activeMonth.add(nearestIndex - 1, 'month')
      setActiveMonth(nextMonth)
    }
  }

  const handleScroll = () => {
    if (scrollSettleTimerRef.current)
      clearTimeout(scrollSettleTimerRef.current)
    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null
      settleScroll()
    }, 90)
  }

  const selectMonth = (month: Dayjs) => {
    setActiveMonth(month)
    onSelectedDateChange(month.startOf('month').format('YYYY-MM-DD'))
  }

  const chooseDate = (date: Dayjs) => {
    onSelectedDateChange(date.format('YYYY-MM-DD'))
    if (!date.isSame(activeMonth, 'month'))
      setActiveMonth(date.startOf('month'))
  }

  return (
    <div {...stylex.props(planningStyles.root)} data-todo-view="calendar">
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.toolbarLeading)}>
          <button
            {...stylex.props(styles.todayButton)}
            type="button"
            onClick={() => {
              setActiveMonth(today.startOf('month'))
              onSelectedDateChange(today.format('YYYY-MM-DD'))
            }}
          >
            {t('today')}
          </button>
          <div {...stylex.props(styles.navigationControl)}>
            <PeriodButton direction="previous" label={t('previousMonth')} onClick={() => selectMonth(activeMonth.subtract(1, 'month'))} />
            <PeriodButton direction="next" label={t('nextMonth')} onClick={() => selectMonth(activeMonth.add(1, 'month'))} />
          </div>
          <h1 {...stylex.props(styles.monthTitle)}>{formatTodoMonth(activeMonth, locale)}</h1>
        </div>
      </div>
      <div {...stylex.props(styles.layout)}>
        <section ref={scrollRef} {...stylex.props(styles.surface)} aria-label={t('calendarView')} onScroll={handleScroll}>
          {monthViews.map((monthView, monthIndex) => (
            <div
              key={monthView.month.format('YYYY-MM')}
              {...stylex.props(styles.monthPanel)}
              data-calendar-month={monthIndex === 1 ? 'current' : monthView.month.format('YYYY-MM')}
            >
              <div {...stylex.props(styles.weekdays)} aria-hidden="true">
                {labels.map(item => <span key={item.key} {...stylex.props(styles.weekday)}>{item.label}</span>)}
              </div>
              <div {...stylex.props(styles.grid)} role="grid" aria-label={formatTodoMonth(monthView.month, locale)}>
                {monthView.days.map((date, dayIndex) => {
                  const dateKey = date.format('YYYY-MM-DD')
                  const dateItems = monthView.grouped.get(dateKey) ?? []
                  const dateEvents = monthView.eventsByDate.get(dateKey) ?? []
                  const items: readonly CalendarItem[] = [
                    ...dateItems,
                    ...dateEvents.map(event => ({ event, kind: 'event' as const })),
                  ].sort((left, right) => calendarItemDoneRank(left) - calendarItemDoneRank(right))
                  const visibleItems = items.slice(0, 3)
                  const inMonth = date.isSame(monthView.month, 'month')
                  const isToday = dateKey === today.format('YYYY-MM-DD')
                  const isSelected = dateKey === selectedDate
                  const compactAlignment = dayIndex % 7 < 2 ? 'left' : 'right'
                  const week = Math.floor(dayIndex / 7)
                  const itemCount = items.length + (monthView.spanLayout.spansByDate.get(dateKey) ?? 0)
                  return (
                    <div
                      key={dateKey}
                      {...stylex.props(styles.cell, !inMonth && styles.cellNeighbor)}
                      aria-label={t('calendarDay', { date: formatDate(date, locale), count: itemCount })}
                      aria-selected={isSelected}
                      role="gridcell"
                      style={{ gridColumn: dayIndex % 7 + 1, gridRow: week + 1 }}
                    >
                      <button
                        {...stylex.props(
                          styles.dayButton,
                          !inMonth && styles.dayButtonNeighbor,
                          isSelected && styles.dayButtonSelected,
                          isToday && styles.dayButtonToday,
                        )}
                        aria-label={formatDate(date, locale)}
                        type="button"
                        onClick={() => chooseDate(date)}
                      >
                        {date.date()}
                      </button>
                      <div {...stylex.props(styles.taskList)} style={{ paddingTop: (monthView.spanLayout.laneCounts[week] ?? 0) * 22 }}>
                        {visibleItems.map(item => (
                          <CalendarItemRow
                            calendarEvents={calendarEvents}
                            calendarSubscriptions={calendarSubscriptions}
                            compactAlignment={compactAlignment}
                            item={item}
                            key={calendarItemKey(item)}
                            locale={locale}
                            onSelectTask={onSelectTask}
                            onUpdateTask={onUpdateTask}
                            selectedTaskKey={selectedTaskKey}
                            t={t}
                          />
                        ))}
                        {items.length > 3 && (
                          <details {...stylex.props(styles.overflow)}>
                            <summary {...stylex.props(styles.taskMore)}>{t('moreTasks', { count: items.length - 3 })}</summary>
                            <div {...stylex.props(styles.overflowPopover)}>
                              <strong {...stylex.props(styles.overflowTitle)}>{formatDate(date, locale)}</strong>
                              <div {...stylex.props(styles.overflowList)}>
                                {items.map(item => (
                                  <CalendarItemRow
                                    calendarEvents={calendarEvents}
                                    calendarSubscriptions={calendarSubscriptions}
                                    compactAlignment={compactAlignment}
                                    item={item}
                                    key={calendarItemKey(item)}
                                    locale={locale}
                                    onSelectTask={onSelectTask}
                                    onUpdateTask={onUpdateTask}
                                    selectedTaskKey={selectedTaskKey}
                                    t={t}
                                  />
                                ))}
                              </div>
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  )
                })}
                {monthView.spanLayout.segments.map((segment) => {
                  const segmentStyle = {
                    gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
                    gridRow: segment.week + 1,
                    marginTop: 34 + segment.lane * 22,
                  } satisfies CSSProperties
                  const compactAlignment = segment.columnStart < 3 ? 'left' : 'right'
                  return (
                    <div
                      key={`${segment.item.key}:${segment.week}`}
                      {...stylex.props(styles.spanSegment)}
                      style={segmentStyle}
                    >
                      {segment.item.kind === 'event'
                        ? <TodoCalendarEventItem event={segment.item.event} locale={locale} variant="calendar" />
                        : (
                            <CalendarTaskItem
                              calendarEvents={calendarEvents}
                              calendarSubscriptions={calendarSubscriptions}
                              compactAlignment={compactAlignment}
                              onSelectTask={onSelectTask}
                              onUpdateTask={onUpdateTask}
                              selectedTaskKey={selectedTaskKey}
                              t={t}
                              task={segment.item.task}
                            />
                          )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
