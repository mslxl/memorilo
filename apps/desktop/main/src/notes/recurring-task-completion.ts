import type { TopicBlockEdit, TopicBlockProjection } from '@memorilo/editor/note'
import type { RecurringTaskCompletionAction } from '@memorilo/editor/task'
import { parseTaskRepeatRule, parseTaskSchedule } from '@memorilo/editor/schema'
import { planRecurringTaskOccurrences, resetTaskForNextOccurrence } from '@memorilo/editor/task'

export interface TaskNodeJSON {
  attrs?: Record<string, unknown>
  content?: TaskNodeJSON[]
  text?: string
  type: string
}

export interface RecurringTaskTargetPlan {
  date: string
  edits: readonly TopicBlockEdit[]
}

export interface RecurringTaskPlacementPlan {
  nextBlockId: string
  sourceEdits: readonly TopicBlockEdit[]
  target?: RecurringTaskTargetPlan
}

function blockId(node: TaskNodeJSON): string {
  const value = node.attrs?.blockId
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('Recurring task subtree contains a Block without an id')
  return value
}

function blockKind(node: TaskNodeJSON): string {
  const value = node.attrs?.kind
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`Recurring task Block ${blockId(node)} does not have a kind`)
  return value
}

function blockChildren(node: TaskNodeJSON): readonly TaskNodeJSON[] {
  return (node.content ?? []).filter(child => child.type === 'list')
}

function blockContent(node: TaskNodeJSON): readonly TaskNodeJSON[] {
  return structuredClone((node.content ?? []).filter(child => child.type !== 'list'))
}

function hasRecurringDescendant(node: TaskNodeJSON): boolean {
  return blockChildren(node).some(child => (
    parseTaskRepeatRule(child.attrs?.repeatRule) !== null || hasRecurringDescendant(child)
  ))
}

function nextDescendantAttrs(node: TaskNodeJSON): Readonly<Record<string, unknown>> {
  const attrs = node.attrs ?? {}
  if (blockKind(node) !== 'task')
    return structuredClone(attrs)
  const schedule = parseTaskSchedule(attrs.schedule)
  if (schedule === null)
    throw new TypeError(`Recurring task descendant ${blockId(node)} has an invalid schedule`)
  const date = schedule.kind === 'deadline'
    ? schedule.date
    : schedule.kind === 'span' ? schedule.start.slice(0, 10) : null
  return resetTaskForNextOccurrence(attrs, date)
}

function insertSubtree(
  root: TaskNodeJSON,
  input: {
    attrs: Readonly<Record<string, unknown>>
    blockId: string
    cloneDescendants: boolean
    generateId: () => string
    index?: number
    parentId: string | null
  },
): readonly TopicBlockEdit[] {
  const edits: TopicBlockEdit[] = [{
    attributes: input.attrs,
    blockId: input.blockId,
    content: blockContent(root),
    ...(input.index === undefined ? {} : { index: input.index }),
    kind: blockKind(root),
    operation: 'insert-block',
    parentId: input.parentId,
  }]
  if (!input.cloneDescendants)
    return edits

  const cloneChildren = (node: TaskNodeJSON, parentId: string): void => {
    blockChildren(node).forEach((child, index) => {
      const childId = input.generateId()
      edits.push({
        attributes: nextDescendantAttrs(child),
        blockId: childId,
        content: blockContent(child),
        index,
        kind: blockKind(child),
        operation: 'insert-block',
        parentId,
      })
      cloneChildren(child, childId)
    })
  }
  cloneChildren(root, input.blockId)
  return edits
}

function insertCompletedSubtree(
  root: TaskNodeJSON,
  completedAttrs: Readonly<Record<string, unknown>>,
): readonly TopicBlockEdit[] {
  const edits: TopicBlockEdit[] = []
  const insert = (
    node: TaskNodeJSON,
    parentId: string | null,
    index: number | undefined,
    attrs: Readonly<Record<string, unknown>>,
  ): void => {
    const id = blockId(node)
    edits.push({
      attributes: attrs,
      blockId: id,
      content: blockContent(node),
      ...(index === undefined ? {} : { index }),
      kind: blockKind(node),
      operation: 'insert-block',
      parentId,
    })
    blockChildren(node).forEach((child, childIndex) => {
      insert(child, id, childIndex, structuredClone(child.attrs ?? {}))
    })
  }
  insert(root, null, undefined, completedAttrs)
  return edits
}

export function planRecurringTaskPlacement(input: {
  action: RecurringTaskCompletionAction
  generateId: () => string
  nextDueDate: string
  sourceBlock: TopicBlockProjection
  sourceNode: TaskNodeJSON
  today: string
}): RecurringTaskPlacementPlan {
  const occurrences = planRecurringTaskOccurrences(input.sourceNode.attrs ?? {}, input.nextDueDate)
  const nextBlockId = input.generateId()
  const cloneDescendants = hasRecurringDescendant(input.sourceNode)
  const nextAtSource = (index: number, parentId = input.sourceBlock.parentId) => insertSubtree(input.sourceNode, {
    attrs: occurrences.nextAttrs,
    blockId: nextBlockId,
    cloneDescendants,
    generateId: input.generateId,
    index,
    parentId,
  })
  const nextAtJournal = () => insertSubtree(input.sourceNode, {
    attrs: occurrences.nextAttrs,
    blockId: nextBlockId,
    cloneDescendants,
    generateId: input.generateId,
    parentId: null,
  })
  const completeSource: TopicBlockEdit = {
    attributes: occurrences.completedAttrs,
    blockId: input.sourceBlock.id,
    operation: 'update-block-attributes',
  }

  switch (input.action) {
    case 'archive-completed-to-today':
      return {
        nextBlockId,
        sourceEdits: [
          ...nextAtSource(input.sourceBlock.ordinal),
          { blockId: input.sourceBlock.id, operation: 'delete-block', strategy: 'delete-subtree' },
        ],
        target: {
          date: input.today,
          edits: insertCompletedSubtree(input.sourceNode, occurrences.completedAttrs),
        },
      }
    case 'move-next-to-today':
      return {
        nextBlockId,
        sourceEdits: [completeSource],
        target: { date: input.today, edits: nextAtJournal() },
      }
    case 'move-next-to-due-date':
      return {
        nextBlockId,
        sourceEdits: [completeSource],
        target: { date: input.nextDueDate, edits: nextAtJournal() },
      }
    case 'nest-completed-under-next':
      return {
        nextBlockId,
        sourceEdits: [
          ...nextAtSource(input.sourceBlock.ordinal),
          completeSource,
          { blockId: input.sourceBlock.id, operation: 'move-block', parentId: nextBlockId },
        ],
      }
    case 'place-next-after-completed':
      return {
        nextBlockId,
        sourceEdits: [completeSource, ...nextAtSource(input.sourceBlock.ordinal + 1)],
      }
    case 'replace-completed':
      return {
        nextBlockId,
        sourceEdits: [
          ...nextAtSource(input.sourceBlock.ordinal),
          { blockId: input.sourceBlock.id, operation: 'delete-block', strategy: 'delete-subtree' },
        ],
      }
  }
}
