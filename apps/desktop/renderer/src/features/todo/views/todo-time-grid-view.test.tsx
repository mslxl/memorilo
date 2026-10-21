import type { DateSelectArg, EventChangeArg, EventClickArg } from '@fullcalendar/core'
import type { CreateDesktopTodoTaskInput, DesktopTodoTask, UpdateDesktopTodoTaskInput } from '@memorilo/desktop-api'
import type { DesktopTodoConfiguration } from '@memorilo/desktop-config'
import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TodoTimeGridView } from './todo-time-grid-view'

const taskFixture: DesktopTodoTask = {
  schedule: { allDay: false, end: '2026-08-20T10:00', kind: 'span', start: '2026-08-20T09:00' },
  blockId: 'task-a',
  elapsedMs: 0,
  journalDate: '2026-08-20',
  noteFavorite: false,
  noteId: 'note-a',
  noteTitle: 'Journal',
  parentId: null,
  reminderMinutes: null,
  reminders: null,
  repeatRule: null,
  startedAt: null,
  status: 'todo',
  text: 'Plan the day',
  topicId: 'topic-a',
  topicTitle: '2026-08-20',
}

const settings: DesktopTodoConfiguration = {
  autoCompleteParentTasks: true,
  blankTaskDurationMinutes: 30,
  calendarFeedAfterDays: 365,
  calendarFeedBeforeDays: 30,
  calendarFeedCompleted: 'hide',
  calendarFeedTimeZone: 'UTC',
  calendarFeedUndated: 'today',
  enabled: true,
  keepDetailOpenWhenTaskLeavesView: true,
  recurringTaskCompletionAction: 'archive-completed-to-today',
  timelineWorkdayEndMinutes: 21 * 60,
  timelineWorkdayStartMinutes: 7 * 60,
}

vi.mock('@fullcalendar/react', () => ({
  default: (props: {
    eventChange?: (info: EventChangeArg) => void
    eventClick?: (info: EventClickArg) => void
    events?: readonly unknown[]
    initialView: string
    scrollTime: string
    select?: (info: DateSelectArg) => void
    views?: { timeGridWeek?: { duration?: { days?: number } } }
  }) => {
    const draggedEvent = {
      allDay: false,
      end: new Date('2026-08-20T12:30:00'),
      extendedProps: { task: taskFixture },
      id: taskFixture.blockId,
      start: new Date('2026-08-20T11:00:00'),
    }
    const resizedEvent = {
      allDay: false,
      end: new Date('2026-08-20T13:00:00'),
      extendedProps: { task: taskFixture },
      id: taskFixture.blockId,
      start: new Date('2026-08-20T09:00:00'),
    }
    return (
      <div
        data-days={String(props.views?.timeGridWeek?.duration?.days ?? 1)}
        data-event-count={String(props.events?.length ?? 0)}
        data-initial-view={props.initialView}
        data-scroll-time={props.scrollTime}
        data-calendar=""
      >
        <button
          data-calendar-action="select"
          type="button"
          onClick={() => props.select?.({
            allDay: false,
            end: null,
            start: new Date('2026-08-20T13:15:00'),
          } as unknown as DateSelectArg)}
        >
          Select empty slot
        </button>
        <button
          data-calendar-action="event-click"
          type="button"
          onClick={() => props.eventClick?.({ event: draggedEvent } as unknown as EventClickArg)}
        >
          Open event
        </button>
        <button
          data-calendar-action="event-drag"
          type="button"
          onClick={() => props.eventChange?.({ event: draggedEvent } as unknown as EventChangeArg)}
        >
          Drag event
        </button>
        <button
          data-calendar-action="event-resize"
          type="button"
          onClick={() => props.eventChange?.({ event: resizedEvent } as unknown as EventChangeArg)}
        >
          Resize event
        </button>
      </div>
    )
  },
}))

function renderView(overrides: {
  onCreateTask?: (input: CreateDesktopTodoTaskInput) => Promise<DesktopTodoTask>
  onSelectTask?: (task: DesktopTodoTask) => Promise<void> | void
  onUpdateTask?: (input: UpdateDesktopTodoTaskInput) => Promise<void>
} = {}) {
  return render(
    <TodoTimeGridView
      calendarEvents={[]}
      locale="en"
      now={Date.parse('2026-08-20T12:00:00')}
      onCreateTask={overrides.onCreateTask ?? (async input => ({ ...taskFixture, ...input, blockId: 'created-task' }))}
      onSelectTask={overrides.onSelectTask ?? (() => undefined)}
      onUpdateTask={overrides.onUpdateTask ?? (async () => undefined)}
      settings={settings}
      tasks={[taskFixture]}
      weekStart="monday"
    />,
  )
}

afterEach(() => {
  window.localStorage.clear()
})

describe('todoTimeGridView', () => {
  it('switches day spans and remembers multi-day and multi-week ranges', async () => {
    const first = renderView()
    const calendar = first.container.querySelector<HTMLElement>('[data-calendar]')
    if (!calendar)
      throw new Error('Todo calendar was not rendered')
    expect(calendar).toHaveAttribute('data-initial-view', 'timeGridDay')

    fireEvent.click(first.getByRole('button', { name: 'Multi-day' }))
    const multiDay = first.getByRole('combobox', { name: 'Multi-day' })
    expect(multiDay).toHaveValue('3')
    expect(within(multiDay).getAllByRole('option')).toHaveLength(7)
    fireEvent.change(multiDay, { target: { value: '5' } })
    await waitFor(() => expect(calendar).toHaveAttribute('data-days', '5'))

    fireEvent.click(first.getByRole('button', { name: 'Week' }))
    expect(calendar).toHaveAttribute('data-days', '7')

    fireEvent.click(first.getByRole('button', { name: 'Multi-week' }))
    const multiWeek = first.getByRole('combobox', { name: 'Multi-week' })
    expect(multiWeek).toHaveValue('2')
    expect(calendar).toHaveAttribute('data-days', '14')
    expect(within(multiWeek).getAllByRole('option')).toHaveLength(4)
    fireEvent.change(multiWeek, { target: { value: '4' } })
    await waitFor(() => expect(calendar).toHaveAttribute('data-days', '28'))
    first.unmount()

    const second = renderView()
    fireEvent.click(second.getByRole('button', { name: 'Multi-day' }))
    expect(second.getByRole('combobox', { name: 'Multi-day' })).toHaveValue('5')
    fireEvent.click(second.getByRole('button', { name: 'Multi-week' }))
    expect(second.getByRole('combobox', { name: 'Multi-week' })).toHaveValue('4')
  })

  it('creates a timed task from an empty slot using the configured duration', async () => {
    const onCreateTask = vi.fn(async (input: CreateDesktopTodoTaskInput) => ({ ...taskFixture, ...input, blockId: 'created-task' }))
    const rendered = renderView({ onCreateTask })

    const calendar = rendered.container.querySelector<HTMLElement>('[data-calendar]')
    if (!calendar)
      throw new Error('Todo calendar was not rendered')
    expect(calendar).toHaveAttribute('data-scroll-time', '07:00:00')
    const selectButton = calendar.querySelector<HTMLButtonElement>('[data-calendar-action="select"]')
    if (!selectButton)
      throw new Error('Todo calendar select action was not rendered')
    fireEvent.click(selectButton)

    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith({
      schedule: { allDay: false, end: '2026-08-20T13:45', kind: 'span', start: '2026-08-20T13:15' },
      text: '',
    }))
  })

  it('forwards event selection and drag changes through public callbacks', async () => {
    const onSelectTask = vi.fn()
    const onUpdateTask = vi.fn(async () => undefined)
    const rendered = renderView({ onSelectTask, onUpdateTask })

    const eventClickButton = rendered.container.querySelector<HTMLButtonElement>('[data-calendar-action="event-click"]')
    if (!eventClickButton)
      throw new Error('Todo calendar event click action was not rendered')
    fireEvent.click(eventClickButton)
    expect(onSelectTask).toHaveBeenCalledWith(taskFixture)

    const eventDragButton = rendered.container.querySelector<HTMLButtonElement>('[data-calendar-action="event-drag"]')
    if (!eventDragButton)
      throw new Error('Todo calendar event drag action was not rendered')
    fireEvent.click(eventDragButton)
    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith({
      blockId: taskFixture.blockId,
      noteId: taskFixture.noteId,
      schedule: { allDay: false, end: '2026-08-20T12:30', kind: 'span', start: '2026-08-20T11:00' },
      text: taskFixture.text,
      topicId: taskFixture.topicId,
    }))
  })

  it('forwards resize changes with the updated end time', async () => {
    const onUpdateTask = vi.fn(async () => undefined)
    const rendered = renderView({ onUpdateTask })

    const eventResizeButton = rendered.container.querySelector<HTMLButtonElement>('[data-calendar-action="event-resize"]')
    if (!eventResizeButton)
      throw new Error('Todo calendar event resize action was not rendered')
    fireEvent.click(eventResizeButton)
    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith({
      blockId: taskFixture.blockId,
      noteId: taskFixture.noteId,
      schedule: { allDay: false, end: '2026-08-20T13:00', kind: 'span', start: '2026-08-20T09:00' },
      text: taskFixture.text,
      topicId: taskFixture.topicId,
    }))
  })
})
