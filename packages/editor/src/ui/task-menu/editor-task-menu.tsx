import type { BasicExtension } from 'prosekit/basic'
import type { Editor } from 'prosekit/core'
import type { Node as ProseMirrorNode } from 'prosekit/pm/model'
import type { Transaction } from 'prosekit/pm/state'
import type { EditorAdapters } from '../../adapters/editor-adapters'
import type { TaskActionUpdate } from '../../task/task-action-model'
import type { TaskActionTask } from '../../task/task-action-panel'
import type { TaskCalendarSnapshot } from '../../task/task-calendar'
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating, useMergeRefs } from '@floating-ui/react'
import dayjs from 'dayjs'
import { TextSelection } from 'prosekit/pm/state'
import { useEditor } from 'prosekit/react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseTaskDate, parseTaskReminderMinutes, parseTaskReminders, parseTaskRepeatRule, parseTaskSchedule } from '../../schema'
import { planTaskAction } from '../../task/task-action-model'
import { TaskActionPanel } from '../../task/task-action-panel'
import { TaskOccurrencePanel } from '../../task/task-occurrence-panel'
import { floatingTransformOrigin } from '../floating-surface/floating-position'

interface TaskMenuTarget {
  blockId: string
  kind: 'occurrence' | 'schedule'
  trigger: HTMLButtonElement
}

interface TaskNodeSnapshot {
  node: ProseMirrorNode
  position: number
  task: TaskActionTask
  text: string
}

const emptyCalendarSnapshot: TaskCalendarSnapshot = {
  events: [],
  subscriptions: [],
}

function taskNodeAt(editor: Editor<BasicExtension>, blockId: string, defaultDate: string): TaskNodeSnapshot {
  let snapshot: TaskNodeSnapshot | null = null
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'list' || node.attrs.kind !== 'task' || node.attrs.blockId !== blockId)
      return true
    const schedule = parseTaskSchedule(node.attrs.schedule)
    if (schedule === null)
      throw new TypeError(`Task ${blockId} has an invalid schedule`)
    const repeatRule = node.attrs.repeatRule === null ? null : parseTaskRepeatRule(node.attrs.repeatRule)
    if (node.attrs.repeatRule !== null && repeatRule === null)
      throw new TypeError(`Task ${blockId} has an invalid repeat rule`)
    const reminderMinutes = node.attrs.reminderMinutes === null ? null : parseTaskReminderMinutes(node.attrs.reminderMinutes)
    if (node.attrs.reminderMinutes !== null && reminderMinutes === null)
      throw new TypeError(`Task ${blockId} has an invalid reminder`)
    const reminders = node.attrs.reminders === null ? null : parseTaskReminders(node.attrs.reminders)
    if (node.attrs.reminders !== null && reminders === null)
      throw new TypeError(`Task ${blockId} has invalid reminders`)
    if (node.attrs.status !== 'todo' && node.attrs.status !== 'doing' && node.attrs.status !== 'done')
      throw new TypeError(`Task ${blockId} has an invalid status`)
    const text = node.firstChild?.textContent ?? ''
    snapshot = {
      node,
      position,
      task: {
        occurrenceDate: schedule.kind === 'deadline' ? schedule.date : schedule.kind === 'span' ? schedule.start.slice(0, 10) : defaultDate,
        reminderMinutes,
        reminders,
        repeatRule,
        schedule,
        status: node.attrs.status,
        text,
      },
      text,
    }
    return false
  })
  if (!snapshot)
    throw new Error(`Task ${blockId} is no longer present in the editor`)
  return snapshot
}

function replaceTaskText(transaction: Transaction, position: number, text: string): void {
  const body = transaction.doc.nodeAt(position + 1)
  if (!body || !body.isTextblock)
    throw new Error('Todo task content is missing its text block')
  const from = position + 2
  const to = from + body.content.size
  if (text.length === 0)
    transaction.delete(from, to)
  else
    transaction.replaceWith(from, to, body.type.schema.text(text))
}

function applyTaskAction(
  editor: Editor<BasicExtension>,
  blockId: string,
  defaultDate: string,
  input: TaskActionUpdate,
): void {
  const current = taskNodeAt(editor, blockId, defaultDate)
  const plan = planTaskAction(current.node.attrs, current.text, input)
  const transaction = editor.state.tr
  transaction.setNodeMarkup(current.position, undefined, plan.current.attrs)
  if (plan.current.text !== undefined)
    replaceTaskText(transaction, current.position, plan.current.text)

  if (plan.occurrence) {
    const body = current.node.firstChild
    if (!body)
      throw new Error('Todo task content is missing its text block')
    const occurrenceBody = plan.occurrence.text === current.text
      ? body.copy(body.content)
      : body.type.create(
          body.attrs,
          plan.occurrence.text.length > 0 ? body.type.schema.text(plan.occurrence.text) : null,
          body.marks,
        )
    const occurrence = current.node.type.create(
      {
        ...plan.occurrence.attrs,
        blockId: crypto.randomUUID(),
        kind: 'task',
      },
      occurrenceBody,
    )
    const parentPosition = transaction.doc.resolve(current.position)
    const insertionPosition = parentPosition.end(parentPosition.depth)
    transaction.insert(insertionPosition, occurrence)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertionPosition + 1), 1))
  }

  editor.view.dispatch(transaction.scrollIntoView())
}

function taskTriggerFromTarget(target: EventTarget | null, editor: Editor<BasicExtension>, selector: string): HTMLButtonElement | null {
  if (!(target instanceof Element))
    return null
  const trigger = target.closest<HTMLButtonElement>(selector)
  if (!(trigger instanceof HTMLButtonElement) || !editor.view.dom.contains(trigger))
    return null
  return trigger
}

function eventBelongsToNestedTaskAction(event: Event, ownerId: string): boolean {
  return event.composedPath().some((target) => {
    return target instanceof HTMLElement && target.dataset.taskActionFloatingOwner === ownerId
  })
}

export function EditorTaskMenu({ adapters, taskDate }: {
  adapters: EditorAdapters
  taskDate?: string
}) {
  const editor = useEditor<BasicExtension>()
  const { t } = useTranslation('todo')
  const menuId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const calendarLoadRef = useRef<Promise<void> | null>(null)
  const mountedRef = useRef(true)
  const targetRef = useRef<TaskMenuTarget | null>(null)
  const [target, setTarget] = useState<TaskMenuTarget | null>(null)
  const [calendarSnapshot, setCalendarSnapshot] = useState<TaskCalendarSnapshot | null>(null)
  const defaultDate = taskDate === undefined ? dayjs().format('YYYY-MM-DD') : parseTaskDate(taskDate)
  if (defaultDate === null)
    throw new TypeError('Editor taskDate must use YYYY-MM-DD format')
  const {
    floatingStyles,
    isPositioned,
    placement,
    refs,
  } = useFloating({
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`
        },
      }),
    ],
    open: target !== null,
    placement: target?.kind === 'occurrence' ? 'bottom-start' : 'bottom-end',
    strategy: 'fixed',
    transform: false,
    whileElementsMounted: autoUpdate,
  })
  const floatingRef = useMergeRefs([panelRef, refs.setFloating])
  const loadCalendars = useCallback(() => {
    if (calendarSnapshot !== null || calendarLoadRef.current !== null)
      return
    const adapter = adapters.taskCalendar
    if (!adapter) {
      setCalendarSnapshot(emptyCalendarSnapshot)
      return
    }
    const operation = Promise.resolve()
      .then(() => adapter.load())
      .then((snapshot) => {
        if (mountedRef.current)
          setCalendarSnapshot(snapshot)
      })
      .catch(() => undefined)
      .finally(() => {
        calendarLoadRef.current = null
      })
    calendarLoadRef.current = operation
  }, [adapters.taskCalendar, calendarSnapshot])
  const setTriggerOpen = useCallback((nextTarget: TaskMenuTarget | null) => {
    const previous = targetRef.current
    if (previous && previous !== nextTarget) {
      previous.trigger.removeAttribute('aria-controls')
      previous.trigger.setAttribute('aria-expanded', 'false')
      if (!previous.trigger.matches(':hover') && document.activeElement !== previous.trigger)
        previous.trigger.dataset.visible = 'false'
    }
    targetRef.current = nextTarget
    setTarget(nextTarget)
    if (nextTarget) {
      nextTarget.trigger.dataset.visible = 'true'
      nextTarget.trigger.setAttribute('aria-controls', menuId)
      nextTarget.trigger.setAttribute('aria-expanded', 'true')
    }
  }, [menuId])

  useLayoutEffect(() => {
    refs.setReference(target?.trigger ?? null)
  }, [refs, target])

  useEffect(() => {
    const editorElement = editor.view.dom
    const handleClick = (event: MouseEvent) => {
      const trigger = taskTriggerFromTarget(event.target, editor, '[data-task-menu-trigger]')
      if (!trigger)
        return
      const block = trigger.closest<HTMLElement>('[data-block-id]')
      const blockId = block?.dataset.blockId
      if (!blockId)
        throw new Error('Todo task menu trigger is missing its block id')
      event.preventDefault()
      if (targetRef.current?.trigger === trigger) {
        setTriggerOpen(null)
        editor.view.focus()
        return
      }
      loadCalendars()
      setTriggerOpen({ blockId, kind: 'schedule', trigger })
    }
    editorElement.addEventListener('click', handleClick)
    const handleContextMenu = (event: MouseEvent) => {
      const trigger = taskTriggerFromTarget(event.target, editor, '[data-task-occurrence-trigger]')
      if (!trigger)
        return
      const block = trigger.closest<HTMLElement>('[data-block-id]')
      const blockId = block?.dataset.blockId
      if (!blockId)
        throw new Error('Recurring task trigger is missing its block id')
      event.preventDefault()
      event.stopPropagation()
      if (targetRef.current?.trigger === trigger) {
        setTriggerOpen(null)
        editor.view.focus()
        return
      }
      loadCalendars()
      setTriggerOpen({ blockId, kind: 'occurrence', trigger })
    }
    editorElement.addEventListener('contextmenu', handleContextMenu)
    return () => {
      editorElement.removeEventListener('click', handleClick)
      editorElement.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [editor, loadCalendars, setTriggerOpen])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!target)
      return
    const close = (restoreFocus: boolean) => {
      const trigger = targetRef.current?.trigger
      setTriggerOpen(null)
      if (restoreFocus)
        trigger?.focus()
    }
    const handlePointerDown = (event: PointerEvent) => {
      const eventTarget = event.target
      if (eventTarget instanceof Node
        && (target.trigger.contains(eventTarget)
          || panelRef.current?.contains(eventTarget)
          || eventBelongsToNestedTaskAction(event, menuId))) {
        return
      }
      close(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape')
        return
      event.preventDefault()
      close(true)
    }
    const handleViewportChange = () => close(false)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleViewportChange)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [menuId, setTriggerOpen, target])

  useLayoutEffect(() => {
    if (!target || !isPositioned || !panelRef.current)
      return
    panelRef.current.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')?.focus()
  }, [isPositioned, target])

  if (!target)
    return null

  const task = taskNodeAt(editor, target.blockId, defaultDate).task
  const snapshot = calendarSnapshot ?? emptyCalendarSnapshot

  return (
    <FloatingPortal>
      {target.kind === 'schedule'
        ? (
            <TaskActionPanel
              key={`${target.blockId}:${JSON.stringify(task.schedule)}:${task.reminderMinutes ?? ''}:${JSON.stringify(task.reminders)}:${JSON.stringify(task.repeatRule)}`}
              calendarEvents={snapshot.events}
              calendarSubscriptions={snapshot.subscriptions}
              id={menuId}
              panelRef={floatingRef}
              style={{
                ...floatingStyles,
                transformOrigin: floatingTransformOrigin(placement),
              }}
              t={t}
              task={task}
              visible={isPositioned}
              onUpdate={(input) => {
                if (input.status === 'done' && task.repeatRule && adapters.taskActions)
                  return adapters.taskActions.completeRecurring({ blockId: target.blockId })
                applyTaskAction(editor, target.blockId, defaultDate, input)
              }}
              onUpdated={() => {
                setTriggerOpen(null)
                editor.view.focus()
              }}
            />
          )
        : (
            <TaskOccurrencePanel
              key={`${target.blockId}:${JSON.stringify(task.schedule)}:${JSON.stringify(task.repeatRule)}:${task.text}`}
              calendarEvents={snapshot.events}
              id={menuId}
              panelRef={floatingRef}
              style={{
                ...floatingStyles,
                transformOrigin: floatingTransformOrigin(placement),
              }}
              t={t}
              task={task}
              visible={isPositioned}
              onUpdate={(input) => {
                if (input.status === 'done' && task.repeatRule && adapters.taskActions)
                  return adapters.taskActions.completeRecurring({ blockId: target.blockId })
                applyTaskAction(editor, target.blockId, defaultDate, input)
              }}
              onUpdated={() => {
                setTriggerOpen(null)
                editor.view.focus()
              }}
            />
          )}
    </FloatingPortal>
  )
}
