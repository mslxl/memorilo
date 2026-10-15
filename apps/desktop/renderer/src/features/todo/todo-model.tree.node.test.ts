import type { DesktopTodoTask } from '@memorilo/desktop-api'
import { describe, expect, it } from 'vitest'
import { buildTodoTaskTree, flattenTodoTaskTree, todoTaskKey, todoTasksForView } from './todo-model'

function task(
  blockId: string,
  options: Pick<DesktopTodoTask, 'parentId'> & Pick<Partial<DesktopTodoTask>, 'todoParentId'>,
): DesktopTodoTask {
  const result: DesktopTodoTask = {
    schedule: { kind: 'none' },
    blockId,
    elapsedMs: 0,
    journalDate: null,
    noteFavorite: false,
    noteId: 'note',
    noteTitle: 'Note',
    parentId: options.parentId,
    repeatRule: null,
    reminderMinutes: null,
    reminders: null,
    startedAt: null,
    status: 'todo',
    text: blockId,
    topicId: 'topic',
    topicTitle: 'Topic',
  }
  if ('todoParentId' in options)
    result.todoParentId = options.todoParentId
  return result
}

describe('todo list tree projection', () => {
  it('uses the nearest Todo ancestor and supports arbitrary nesting', () => {
    const roots = buildTodoTaskTree([
      task('grandchild', { parentId: 'non-todo', todoParentId: 'child' }),
      task('root', { parentId: null, todoParentId: null }),
      task('child', { parentId: 'non-todo', todoParentId: 'root' }),
    ])

    expect(roots.map(node => node.task.blockId)).toEqual(['root'])
    expect(roots[0]?.children.map(node => node.task.blockId)).toEqual(['child'])
    expect(roots[0]?.children[0]?.children.map(node => node.task.blockId)).toEqual(['grandchild'])
  })

  it('treats an explicit null Todo parent as a root even when the block parent is non-Todo', () => {
    const roots = buildTodoTaskTree([
      task('root', { parentId: null, todoParentId: null }),
      task('unrelated', { parentId: 'root', todoParentId: null }),
    ])

    expect(roots.map(node => node.task.blockId)).toEqual(['root', 'unrelated'])
  })

  it('flattens visible tasks with depth and omits collapsed descendants', () => {
    const roots = buildTodoTaskTree([
      task('root', { parentId: null, todoParentId: null }),
      task('child', { parentId: 'root', todoParentId: 'root' }),
      task('grandchild', { parentId: 'child', todoParentId: 'child' }),
    ])

    expect(flattenTodoTaskTree(roots, new Set()).map(item => [item.task.blockId, item.depth, item.hasChildren])).toEqual([
      ['root', 0, true],
      ['child', 1, true],
      ['grandchild', 2, false],
    ])
    expect(flattenTodoTaskTree(roots, new Set([todoTaskKey(task('child', { parentId: 'root', todoParentId: 'root' }))])).map(item => [item.task.blockId, item.depth])).toEqual([
      ['root', 0],
      ['child', 1],
    ])
  })

  it('shows subtasks only in the list view', () => {
    const tasks = [
      task('root', { parentId: null, todoParentId: null }),
      task('child', { parentId: 'root', todoParentId: 'root' }),
      task('legacy-child', { parentId: 'root' }),
      task('non-todo-child', { parentId: 'outline', todoParentId: null }),
    ]

    expect(todoTasksForView(tasks, 'list').map(item => item.blockId)).toEqual([
      'root',
      'child',
      'legacy-child',
      'non-todo-child',
    ])
    for (const view of ['board', 'timeline', 'calendar', 'quadrant'] as const) {
      expect(todoTasksForView(tasks, view).map(item => item.blockId)).toEqual([
        'root',
        'non-todo-child',
      ])
    }
  })
})
