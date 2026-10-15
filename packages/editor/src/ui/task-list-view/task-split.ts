import type { Command, EditorState, Transaction } from 'prosekit/pm/state'
import type { TaskTimingAttrs } from './task-status'
import { createSplitListCommand } from 'prosemirror-flat-list'
import { effectiveStatus } from './task-status'

export const EMPTY_TASK_ATTRS: TaskTimingAttrs = {
  status: 'todo',
  elapsedMs: 0,
  startedAt: null,
  checked: false,
}

interface SelectedTask {
  position: number
}

const splitList = createSplitListCommand()

function selectedTask(state: EditorState): SelectedTask | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'list')
      continue
    if (node.attrs.kind !== 'task')
      return null
    effectiveStatus(node.attrs)
    return { position: $from.before(depth) }
  }
  return null
}

function selectedListPosition(transaction: Transaction): number | null {
  const { $from } = transaction.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'list')
      return $from.before(depth)
  }
  return null
}

function initializeTaskAt(transaction: Transaction, position: number): boolean {
  const node = transaction.doc.nodeAt(position)
  if (!node || node.type.name !== 'list' || node.attrs.kind !== 'task')
    return false
  if (node.attrs.status !== null) {
    effectiveStatus(node.attrs)
    return false
  }

  transaction.setNodeMarkup(position, undefined, {
    ...node.attrs,
    ...EMPTY_TASK_ATTRS,
    schedule: { kind: 'none' },
    reminderMinutes: null,
    reminders: null,
    repeatRule: null,
  })
  return true
}

export function initializeTaskSplit(transaction: Transaction, sourcePosition: number): void {
  if (initializeTaskAt(transaction, sourcePosition))
    return
  const selectionPosition = selectedListPosition(transaction)
  if (selectionPosition !== null)
    initializeTaskAt(transaction, selectionPosition)
}

export function createTaskSplitCommand(): Command {
  return (state, dispatch, view) => {
    const task = selectedTask(state)
    if (!task)
      return false
    if (!dispatch)
      return splitList(state, undefined, view)

    let splitTransaction: Transaction | null = null
    const split = splitList(state, (transaction) => {
      splitTransaction = transaction
    }, view)
    if (!split)
      return false
    if (!splitTransaction)
      throw new Error('Task list split succeeded without producing a transaction')

    const transaction: Transaction = splitTransaction
    initializeTaskSplit(transaction, task.position)
    dispatch(transaction)
    return true
  }
}
