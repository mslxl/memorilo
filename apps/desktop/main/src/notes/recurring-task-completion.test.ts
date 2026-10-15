import type { TopicBlockEdit, TopicBlockProjection } from '@memorilo/editor/note'
import type { RecurringTaskCompletionAction } from '@memorilo/editor/task'
import type { TaskNodeJSON } from './recurring-task-completion'
import { describe, expect, it } from 'vitest'
import { planRecurringTaskPlacement } from './recurring-task-completion'

const repeatRule = {
  interval: 1,
  mode: 'due',
  unit: 'day',
} as const

function paragraph(text: string): TaskNodeJSON {
  return { content: [{ text, type: 'text' }], type: 'paragraph' }
}

function sourceNode(): TaskNodeJSON {
  return {
    attrs: {
      blockId: 'source',
      checked: false,
      collapsed: false,
      schedule: { date: '2026-08-18', kind: 'deadline', time: null },
      elapsedMs: 25,
      kind: 'task',
      order: null,
      repeatRule,
      startedAt: null,
      status: 'todo',
    },
    content: [
      paragraph('Recurring source'),
      {
        attrs: {
          blockId: 'child',
          checked: false,
          collapsed: false,
          kind: 'outline',
          order: null,
        },
        content: [paragraph('Preserved child')],
        type: 'list',
      },
    ],
    type: 'list',
  }
}

const sourceBlock: TopicBlockProjection = {
  attributes: sourceNode().attrs ?? {},
  id: 'source',
  kind: 'task',
  ordinal: 1,
  parentId: 'parent',
  text: 'Recurring source',
}

function editSignature(edit: TopicBlockEdit): string {
  switch (edit.operation) {
    case 'insert-block': {
      const status = edit.attributes?.status ?? '-'
      const recurrence = edit.attributes?.repeatRule === null
        ? 'none'
        : edit.attributes?.repeatRule === undefined ? '-' : 'repeat'
      return [
        edit.operation,
        edit.blockId,
        edit.parentId ?? 'root',
        edit.index ?? 'append',
        status,
        recurrence,
      ].join(':')
    }
    case 'update-block-attributes':
      return [
        edit.operation,
        edit.blockId,
        edit.attributes.status,
        edit.attributes.repeatRule === null ? 'none' : 'repeat',
      ].join(':')
    case 'move-block':
      return [edit.operation, edit.blockId, edit.parentId ?? 'root', edit.index ?? 'append'].join(':')
    case 'delete-block':
      return [edit.operation, edit.blockId, edit.strategy].join(':')
    case 'update-block-content':
      return [edit.operation, edit.blockId].join(':')
  }
}

const placementCases: readonly {
  action: RecurringTaskCompletionAction
  source: readonly string[]
  target: readonly string[] | null
  targetDate: string | null
}[] = [
  {
    action: 'archive-completed-to-today',
    source: [
      'insert-block:next-1:parent:1:todo:repeat',
      'delete-block:source:delete-subtree',
    ],
    target: [
      'insert-block:source:root:append:done:none',
      'insert-block:child:source:0:-:-',
    ],
    targetDate: '2026-08-18',
  },
  {
    action: 'move-next-to-today',
    source: ['update-block-attributes:source:done:none'],
    target: ['insert-block:next-1:root:append:todo:repeat'],
    targetDate: '2026-08-18',
  },
  {
    action: 'move-next-to-due-date',
    source: ['update-block-attributes:source:done:none'],
    target: ['insert-block:next-1:root:append:todo:repeat'],
    targetDate: '2026-08-19',
  },
  {
    action: 'nest-completed-under-next',
    source: [
      'insert-block:next-1:parent:1:todo:repeat',
      'update-block-attributes:source:done:none',
      'move-block:source:next-1:append',
    ],
    target: null,
    targetDate: null,
  },
  {
    action: 'place-next-after-completed',
    source: [
      'update-block-attributes:source:done:none',
      'insert-block:next-1:parent:2:todo:repeat',
    ],
    target: null,
    targetDate: null,
  },
  {
    action: 'replace-completed',
    source: [
      'insert-block:next-1:parent:1:todo:repeat',
      'delete-block:source:delete-subtree',
    ],
    target: null,
    targetDate: null,
  },
]

describe('recurring task completion placement', () => {
  it.each(placementCases)('plans $action', ({ action, source, target, targetDate }) => {
    let nextId = 0
    const placement = planRecurringTaskPlacement({
      action,
      generateId: () => `next-${++nextId}`,
      nextDueDate: '2026-08-19',
      sourceBlock,
      sourceNode: sourceNode(),
      today: '2026-08-18',
    })

    expect(placement.nextBlockId).toBe('next-1')
    expect(placement.sourceEdits.map(editSignature)).toEqual(source)
    expect(placement.target?.date ?? null).toBe(targetDate)
    expect(placement.target?.edits.map(editSignature) ?? null).toEqual(target)
  })

  it('copies the full subtree with new block IDs when a descendant is a recurring template', () => {
    const recurringChildRule = { interval: 2, mode: 'completion', unit: 'week' } as const
    const tree = sourceNode()
    tree.content = [
      paragraph('Recurring source'),
      {
        attrs: {
          blockId: 'recurring-child',
          checked: true,
          collapsed: false,
          schedule: { date: '2026-08-22', kind: 'deadline', time: null },
          elapsedMs: 500,
          kind: 'task',
          order: null,
          repeatRule: recurringChildRule,
          startedAt: 123,
          status: 'done',
        },
        content: [
          paragraph('Recurring child'),
          {
            attrs: {
              blockId: 'grandchild',
              checked: false,
              collapsed: false,
              kind: 'outline',
              order: null,
            },
            content: [paragraph('Grandchild')],
            type: 'list',
          },
        ],
        type: 'list',
      },
    ]
    let nextId = 0

    const placement = planRecurringTaskPlacement({
      action: 'move-next-to-today',
      generateId: () => `clone-${++nextId}`,
      nextDueDate: '2026-08-19',
      sourceBlock,
      sourceNode: tree,
      today: '2026-08-18',
    })

    expect(placement.target?.edits).toMatchObject([
      {
        attributes: {
          checked: false,
          schedule: { date: '2026-08-19', kind: 'deadline', time: null },
          elapsedMs: 0,
          repeatRule,
          startedAt: null,
          status: 'todo',
        },
        blockId: 'clone-1',
        parentId: null,
      },
      {
        attributes: {
          checked: false,
          schedule: { date: '2026-08-22', kind: 'deadline', time: null },
          elapsedMs: 0,
          repeatRule: recurringChildRule,
          startedAt: null,
          status: 'todo',
        },
        blockId: 'clone-2',
        index: 0,
        parentId: 'clone-1',
      },
      {
        blockId: 'clone-3',
        index: 0,
        parentId: 'clone-2',
      },
    ])
    expect(placement.target?.edits.map(edit => edit.blockId)).toEqual(['clone-1', 'clone-2', 'clone-3'])
    expect(placement.target?.edits.map(edit => edit.blockId)).not.toContain('source')
    expect(placement.target?.edits.map(edit => edit.blockId)).not.toContain('recurring-child')
    expect(placement.target?.edits.map(edit => edit.blockId)).not.toContain('grandchild')
  })
})
