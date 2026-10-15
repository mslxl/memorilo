import type { EmbeddingModel } from '@memorilo/editor-storage'
import type { RecurringTaskCompletionAction } from '@memorilo/editor/task'
import { SqliteEditorStorage } from '@memorilo/editor-storage'
import { afterEach, describe, expect, it } from 'vitest'
import { BetterSqliteDatabase } from '../storage/better-sqlite-database'
import { createNoteApplicationService } from './note-application-service'

const embeddingModel: EmbeddingModel = {
  dimensions: 3,
  id: 'test/recurring-task-completion',
  embedDocuments: async texts => texts.map(() => Float32Array.from([1, 0, 0])),
  embedQuery: async () => Float32Array.from([1, 0, 0]),
}

const repeatRule = {
  interval: 1,
  mode: 'due',
  unit: 'day',
} as const

const databases: BetterSqliteDatabase[] = []
const storages: Awaited<ReturnType<typeof SqliteEditorStorage.open>>[] = []
const applications: ReturnType<typeof createNoteApplicationService>[] = []

interface TestNodeJSON {
  attrs?: Record<string, unknown>
  content?: TestNodeJSON[]
  text?: string
  type: string
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(application => application.close()))
  await Promise.all(storages.splice(0).map(storage => storage.close()))
  await Promise.all(databases.splice(0).map(database => database.close()))
})

function paragraph(text: string): TestNodeJSON {
  return { content: [{ text, type: 'text' }], type: 'paragraph' }
}

function findBlock(document: TestNodeJSON, blockId: string): TestNodeJSON {
  const visit = (nodes: readonly TestNodeJSON[]): TestNodeJSON | undefined => {
    for (const node of nodes) {
      if (node.attrs?.blockId === blockId)
        return node
      const found = visit(node.content ?? [])
      if (found)
        return found
    }
  }
  const found = visit(document.content ?? [])
  if (!found)
    throw new Error(`Missing Block ${blockId}`)
  return found
}

function childBlockIds(node: TestNodeJSON): unknown[] {
  return (node.content ?? [])
    .filter(child => child.type === 'list')
    .map(child => child.attrs?.blockId)
}

async function createFixture(action?: RecurringTaskCompletionAction) {
  const database = new BetterSqliteDatabase(':memory:')
  databases.push(database)
  const storage = await SqliteEditorStorage.open({
    database,
    databaseOwnership: 'owned',
    embeddingModel,
  })
  storages.push(storage)
  const notes = createNoteApplicationService(storage, undefined, {
    now: () => new Date(2026, 7, 18, 12),
    ...(action === undefined ? {} : { recurringTaskCompletionAction: () => action }),
  })
  applications.push(notes)
  const created = await notes.createNote({ initialHeading: 'Recurring source', title: 'Recurring tasks' })
  const tree = await notes.getNoteTree({ noteId: created.id })
  const topic = tree.entries.find(entry => entry.kind === 'topic')
  if (!topic)
    throw new Error('Recurring task Note is missing its Topic')
  const before = await notes.getTopic({ noteId: created.id, topicId: topic.id })
  const sourceId = before.document.content?.[0]?.attrs?.blockId
  if (typeof sourceId !== 'string')
    throw new Error('Recurring task Note is missing its initial Block')
  await notes.applyTopicEdits({
    edits: [
      {
        attributes: {
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
        blockId: sourceId,
        operation: 'update-block-attributes',
      },
      {
        attributes: { checked: false, collapsed: false, order: null },
        blockId: 'preserved-child',
        content: [paragraph('Preserved child')],
        kind: 'outline',
        operation: 'insert-block',
        parentId: sourceId,
      },
    ],
    expectedRevision: before.revision,
    noteId: created.id,
    topicId: topic.id,
  })
  return { created, notes, sourceId, storage, topicId: topic.id }
}

async function journalTopic(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  journalDate: string,
) {
  const noteIds = await fixture.storage.notes.listNoteIds()
  for (const noteId of noteIds) {
    const metadata = await fixture.storage.journals.getMetadata({ noteId })
    if (metadata?.journalDate !== journalDate)
      continue
    const tree = await fixture.notes.getNoteTree({ noteId })
    const topic = tree.entries.find(entry => entry.kind === 'topic')
    if (!topic)
      throw new Error(`Journal ${journalDate} is missing its Topic`)
    return fixture.notes.getTopic({ noteId, topicId: topic.id })
  }
  throw new Error(`Journal ${journalDate} was not created`)
}

describe('recurring task completion persistence', () => {
  it('defaults to archiving the completed subtree in an automatically created today Journal', async () => {
    const fixture = await createFixture()

    await fixture.notes.updateTodoTask({
      blockId: fixture.sourceId,
      noteId: fixture.created.id,
      status: 'done',
      topicId: fixture.topicId,
    })

    const source = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topicId })
    const sourceRoot = source.document.content?.[0]
    expect(sourceRoot?.attrs).toMatchObject({
      blockId: expect.not.stringMatching(fixture.sourceId),
      checked: false,
      schedule: { date: '2026-08-19', kind: 'deadline', time: null },
      repeatRule,
      status: 'todo',
    })
    expect(childBlockIds(sourceRoot ?? { type: 'missing' })).toEqual([])
    expect(() => findBlock(source.document, fixture.sourceId)).toThrow(`Missing Block ${fixture.sourceId}`)

    await expect(fixture.storage.journals.listDates({
      from: '2026-08-18',
      through: '2026-08-18',
    })).resolves.toEqual(['2026-08-18'])
    const journal = await journalTopic(fixture, '2026-08-18')
    const completed = findBlock(journal.document, fixture.sourceId)
    expect(completed.attrs).toMatchObject({
      checked: true,
      repeatRule: null,
      status: 'done',
    })
    expect(childBlockIds(completed)).toEqual(['preserved-child'])
    expect(findBlock(journal.document, 'preserved-child').content?.[0]?.content?.[0]?.text).toBe('Preserved child')
  })

  it('creates the future due-date Journal for the next task and keeps the completed subtree in place', async () => {
    const fixture = await createFixture('move-next-to-due-date')

    await fixture.notes.updateTodoTask({
      blockId: fixture.sourceId,
      noteId: fixture.created.id,
      status: 'done',
      topicId: fixture.topicId,
    })

    const source = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topicId })
    const completed = findBlock(source.document, fixture.sourceId)
    expect(completed.attrs).toMatchObject({
      checked: true,
      repeatRule: null,
      status: 'done',
    })
    expect(childBlockIds(completed)).toEqual(['preserved-child'])

    await expect(fixture.storage.journals.listDates({
      from: '2026-08-19',
      through: '2026-08-19',
    })).resolves.toEqual(['2026-08-19'])
    const journal = await journalTopic(fixture, '2026-08-19')
    const [next] = journal.document.content ?? []
    expect(next?.attrs).toMatchObject({
      blockId: expect.not.stringMatching(fixture.sourceId),
      checked: false,
      schedule: { date: '2026-08-19', kind: 'deadline', time: null },
      repeatRule,
      status: 'todo',
    })
    expect(childBlockIds(next ?? { type: 'missing' })).toEqual([])
  })
})
