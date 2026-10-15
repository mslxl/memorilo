import type { EmbeddingModel } from '@memorilo/editor-storage'
import type { BookFileBinding, ReadingAnnotation } from '@memorilo/reading-model'
import { SqliteEditorStorage } from '@memorilo/editor-storage'
import { createEditorNote } from '@memorilo/editor/note'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLearningReviewApplication } from '../learning/learning-review-application'
import { BetterSqliteDatabase } from '../storage/better-sqlite-database'
import { createNoteApplicationService, NoteApplicationServiceClosedError, NoteRevisionConflictError } from './note-application-service'

const embeddingModel: EmbeddingModel = {
  dimensions: 3,
  id: 'test/mcp-note-service',
  embedDocuments: async texts => texts.map(() => Float32Array.from([1, 0, 0])),
  embedQuery: async () => Float32Array.from([1, 0, 0]),
}

const databases: BetterSqliteDatabase[] = []
const storages: Awaited<ReturnType<typeof SqliteEditorStorage.open>>[] = []
const applications: ReturnType<typeof createNoteApplicationService>[] = []

async function openStorage(database: BetterSqliteDatabase) {
  const storage = await SqliteEditorStorage.open({ database, databaseOwnership: 'owned', embeddingModel })
  storages.push(storage)
  return storage
}

function createApplication(...args: Parameters<typeof createNoteApplicationService>) {
  const application = createNoteApplicationService(...args)
  applications.push(application)
  return application
}

async function createFixture() {
  const database = new BetterSqliteDatabase(':memory:')
  databases.push(database)
  const storage = await openStorage(database)
  const onExternalUpdate = vi.fn()
  const notes = createApplication(storage, onExternalUpdate)
  const created = await notes.createNote({ initialHeading: 'Initial Topic', title: 'MCP Note' })
  const tree = await notes.getNoteTree({ noteId: created.id })
  const topic = tree.entries.find(entry => entry.kind === 'topic')
  if (!topic)
    throw new Error('Created Note is missing its Topic')
  onExternalUpdate.mockClear()
  return { created, notes, onExternalUpdate, storage, topic, tree }
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(application => application.close()))
  await Promise.all(storages.splice(0).map(storage => storage.close()))
  await Promise.all(databases.splice(0).map(database => database.close()))
  vi.restoreAllMocks()
})

describe('application service for MCP Notes', () => {
  it('opens a newly created Journal without a post-commit favorite read', async () => {
    const database = new BetterSqliteDatabase(':memory:')
    databases.push(database)
    const storage = await openStorage(database)
    const favorite = vi.spyOn(storage.notes, 'getNoteFavorite').mockRejectedValue(new Error('post-commit read failed'))
    const notes = createApplication(storage, undefined, {
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    })

    const opened = await notes.openJournal({ journalDate: '2026-08-07' })

    expect(opened).toMatchObject({ favorite: false, kind: 'journal', journalDate: '2026-08-07' })
    expect(favorite).not.toHaveBeenCalled()
    await expect(storage.journals.getMetadata({ noteId: opened.id })).resolves.toMatchObject({
      journalDate: '2026-08-07',
      noteId: opened.id,
    })
  })

  it('creates a regular Note through one initialized commit without a post-commit favorite read', async () => {
    const database = new BetterSqliteDatabase(':memory:')
    databases.push(database)
    const storage = await openStorage(database)
    const createPlaceholder = vi.spyOn(storage.notes, 'createNote')
    const createInitialized = vi.spyOn(storage.notes, 'createInitializedNote')
    const favorite = vi.spyOn(storage.notes, 'getNoteFavorite').mockRejectedValue(new Error('post-commit read failed'))
    const notes = createApplication(storage)

    const created = await notes.createNote({ initialHeading: 'Created atomically', title: 'Atomic Note' })

    expect(created).toMatchObject({ favorite: false, title: 'Atomic Note' })
    expect(createPlaceholder).not.toHaveBeenCalled()
    expect(createInitialized).toHaveBeenCalledOnce()
    expect(favorite).not.toHaveBeenCalled()
    const stored = await storage.notes.getNote({ noteId: created.id })
    expect(stored.snapshot).toBeInstanceOf(Uint8Array)
    expect(stored.updates).toEqual([])
  })

  it('creates a timed Todo in a future Journal and returns its projected identity', async () => {
    const database = new BetterSqliteDatabase(':memory:')
    databases.push(database)
    const storage = await openStorage(database)
    const notes = createApplication(storage, undefined, {
      now: () => new Date('2026-08-20T12:00:00.000Z'),
    })

    const created = await notes.createTodoTask({
      schedule: { allDay: false, end: '2026-08-23T10:00', kind: 'span', start: '2026-08-23T09:15' },
      text: '',
    })

    expect(created).toMatchObject({
      journalDate: '2026-08-23',
      noteId: expect.any(String),
      status: 'todo',
      text: '',
      topicId: expect.any(String),
    })
    expect(created.blockId).not.toBe('')
    await expect(storage.journals.getMetadata({ noteId: created.noteId })).resolves.toMatchObject({
      journalDate: '2026-08-23',
      noteId: created.noteId,
    })
  })

  it('persists structured edits, updates projections, and broadcasts the exact Loro update', async () => {
    const fixture = await createFixture()
    const before = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    const blockId = before.document.content?.[0]?.attrs?.blockId
    if (typeof blockId !== 'string')
      throw new Error('Initial Topic is missing its Block ID')

    const receipt = await fixture.notes.applyTopicEdits({
      edits: [{
        blockId,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Edited through MCP' }] }],
        operation: 'update-block-content',
      }],
      expectedRevision: before.revision,
      noteId: fixture.created.id,
      topicId: fixture.topic.id,
    })

    expect(receipt.revision).not.toBe(before.revision)
    expect(fixture.onExternalUpdate).toHaveBeenCalledTimes(1)
    expect(fixture.onExternalUpdate).toHaveBeenCalledWith({
      noteId: fixture.created.id,
      update: expect.any(Uint8Array),
      updatedAt: receipt.updatedAt,
    })
    const emitted = fixture.onExternalUpdate.mock.calls[0]?.[0]
    if (!emitted)
      throw new Error('MCP edit did not emit an external update')
    const rendererNote = createEditorNote({ id: fixture.created.id, snapshot: fixture.created.snapshot })
    rendererNote.importUpdates(emitted.update)
    const validation = rendererNote.getTopicValidationInput(fixture.topic.id)
    if (!('document' in validation))
      throw new TypeError(`Topic ${fixture.topic.id} does not contain editor Blocks`)
    expect(validation.document.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('Edited through MCP')

    const projected = await fixture.storage.search.getTopicBlock({ blockId, noteId: fixture.created.id, topicId: fixture.topic.id })
    expect(projected?.text).toBe('Edited through MCP')

    const restoredService = createApplication(fixture.storage)
    const restored = await restoredService.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    expect(restored.revision).toBe(receipt.revision)
    expect(restored.document.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('Edited through MCP')
  })

  it('rates an ImageOcclusionTopic Card and schedules it in the review queue', async () => {
    const fixture = await createFixture()
    const renderer = createEditorNote({ id: fixture.created.id, snapshot: fixture.created.snapshot })
    const sourceValidation = renderer.getTopicValidationInput(fixture.topic.id)
    if (!('document' in sourceValidation))
      throw new TypeError(`Topic ${fixture.topic.id} does not contain editor Blocks`)
    const sourceBlockId = sourceValidation.document.content?.[0]?.attrs?.blockId
    if (typeof sourceBlockId !== 'string')
      throw new Error('Initial Topic is missing its Block ID')
    const sourceImageId = 'source-image'
    const cardId = 'occlusion-group'
    const image = {
      height: 600,
      src: 'https://example.com/diagram.png',
      width: 800,
    }
    const version = renderer.getVersion()
    renderer.applyTopicBlockEdits({
      edits: [{
        blockId: sourceBlockId,
        content: [{ type: 'image', attrs: { ...image, imageId: sourceImageId } }],
        operation: 'update-block-content',
      }],
      topicId: fixture.topic.id,
    })
    const occlusionTopicId = await renderer.createImageOcclusionTopic({
      snapshot: async (source) => {
        if (source.kind !== 'topic-image')
          throw new TypeError('Expected a Topic image source')
        return { ...image, src: source.src }
      },
      source: { imageId: sourceImageId, kind: 'topic-image', topicId: fixture.topic.id },
      title: 'Image Occlusion',
    })
    const occlusionTopic = renderer.getImageOcclusionTopic(occlusionTopicId)
    occlusionTopic.setState({
      ...occlusionTopic.getState(),
      shapes: [{
        groupId: cardId,
        height: 0.25,
        id: 'occlusion-shape',
        kind: 'rectangle',
        width: 0.25,
        x: 0.25,
        y: 0.25,
      }],
    })
    await fixture.notes.saveNoteUpdates({
      noteId: fixture.created.id,
      updates: [renderer.exportUpdates(version)],
    })

    const reviewedAt = Date.now() + 1_000
    const reviews = createLearningReviewApplication(
      fixture.notes,
      fixture.storage.learning,
      () => reviewedAt,
    )
    const newItem = await reviews.getNextNewItem({
      noteId: fixture.created.id,
      now: reviewedAt,
      topicId: occlusionTopicId,
    })
    expect(newItem).toMatchObject({
      card: {
        id: cardId,
        kind: 'image-occlusion',
        targetGroupId: cardId,
      },
      queue: {
        cardId,
        phase: 'new',
        topicId: occlusionTopicId,
      },
    })
    if (!newItem)
      throw new Error('Expected the ImageOcclusionTopic Card in the new queue')

    const prepared = await fixture.storage.learning.reviews.prepare({
      reviewedAt,
      targetId: newItem.mainTargetId,
    })
    const { outcomes, ...preparation } = prepared
    const rated = await fixture.storage.learning.reviews.rateTarget({
      ...preparation,
      rating: 'easy',
    })

    expect(rated).toEqual({
      eventId: preparation.eventId,
      state: outcomes.easy.state,
    })
    expect(rated.state).toMatchObject({
      phase: 'review',
      reps: 1,
      targetId: newItem.mainTargetId,
    })
    expect(rated.state.dueAt).toBeGreaterThan(reviewedAt)
    expect(await fixture.storage.learning.queue.list({
      mode: 'review',
      noteId: fixture.created.id,
      now: rated.state.dueAt - 1,
      topicId: occlusionTopicId,
    })).not.toContainEqual(expect.objectContaining({ cardId }))
    expect(await fixture.storage.learning.queue.list({
      mode: 'review',
      noteId: fixture.created.id,
      now: rated.state.dueAt,
      topicId: occlusionTopicId,
    })).toEqual([
      expect.objectContaining({
        cardId,
        dueAt: rated.state.dueAt,
        phase: 'review',
        targetIds: [newItem.mainTargetId],
        topicId: occlusionTopicId,
      }),
    ])
    await expect(reviews.getNextReviewItem({
      noteId: fixture.created.id,
      now: rated.state.dueAt,
      topicId: occlusionTopicId,
    })).resolves.toMatchObject({
      card: { id: cardId, kind: 'image-occlusion' },
      mainTargetId: newItem.mainTargetId,
    })
  })

  it('reloads a Reader region ImageOcclusionTopic, rates its Card, and schedules review', async () => {
    const database = new BetterSqliteDatabase(':memory:')
    databases.push(database)
    const storage = await openStorage(database)
    const notes = createApplication(storage)
    const book: BookFileBinding = {
      book: { authors: ['Author'], title: 'Reader publication' },
      file: {
        byteLength: 42,
        format: 'txt',
        originalName: 'reader-publication.txt',
        sha256: 'a'.repeat(64),
      },
      retrievalHints: [{ kind: 'local', readingId: 'reader-review-reading' }],
    }
    const created = await notes.createBookNote({
      book,
      noteTitle: 'Reader region review Note',
      topicTitle: 'Reader publication',
    })
    if (created.status !== 'created')
      throw new Error('Expected the Reader Book Note to be created')
    const { note: storedNote, topicId: bookTopicId } = created.context
    const renderer = createEditorNote({ id: storedNote.id, snapshot: storedNote.snapshot })
    const annotation: ReadingAnnotation = {
      anchors: [{ end: 20, format: 'txt', start: 10, type: 'region' }],
      color: 'yellow',
      createdAt: 1,
      id: 'reader-review-region',
      style: 'highlight',
      updatedAt: 1,
    }
    const version = renderer.getVersion()
    renderer.getBookTopic(bookTopicId).setAnnotations([annotation])
    const cardId = 'reader-occlusion-group'
    const occlusionTopicId = await renderer.createImageOcclusionTopic({
      snapshot: async source => ({
        height: 300,
        src: `memorilo://asset/${source.kind}-${annotation.id}.png`,
        width: 400,
      }),
      source: {
        annotationId: annotation.id,
        kind: 'reader-region',
        topicId: bookTopicId,
      },
      title: 'Reader region image occlusion',
    })
    const occlusionTopic = renderer.getImageOcclusionTopic(occlusionTopicId)
    occlusionTopic.setState({
      ...occlusionTopic.getState(),
      shapes: [{
        groupId: cardId,
        height: 0.25,
        id: 'reader-occlusion-shape',
        kind: 'rectangle',
        width: 0.25,
        x: 0.25,
        y: 0.25,
      }],
    })
    await notes.saveNoteUpdates({
      noteId: storedNote.id,
      updates: [renderer.exportUpdates(version)],
    })

    const restoredNotes = createApplication(storage)
    const restoredTree = await restoredNotes.getNoteTree({ noteId: storedNote.id })
    expect(restoredTree.entries.find(entry => entry.id === occlusionTopicId)).toMatchObject({
      parentId: bookTopicId,
      topicType: 'image-occlusion',
    })

    const reviewedAt = Date.now() + 1_000
    const reviews = createLearningReviewApplication(restoredNotes, storage.learning, () => reviewedAt)
    const newItem = await reviews.getNextNewItem({
      noteId: storedNote.id,
      now: reviewedAt,
      topicId: occlusionTopicId,
    })
    expect(newItem).toMatchObject({
      card: {
        id: cardId,
        kind: 'image-occlusion',
        sourceBlockId: annotation.id,
        targetGroupId: cardId,
      },
      queue: {
        cardId,
        phase: 'new',
        topicId: occlusionTopicId,
      },
    })
    if (!newItem)
      throw new Error('Expected the Reader region ImageOcclusionTopic Card in the new queue')

    const prepared = await storage.learning.reviews.prepare({
      reviewedAt,
      targetId: newItem.mainTargetId,
    })
    const { outcomes, ...preparation } = prepared
    const rated = await storage.learning.reviews.rateTarget({
      ...preparation,
      rating: 'easy',
    })

    expect(rated).toEqual({
      eventId: preparation.eventId,
      state: outcomes.easy.state,
    })
    expect(rated.state).toMatchObject({
      phase: 'review',
      reps: 1,
      targetId: newItem.mainTargetId,
    })
    expect(rated.state.dueAt).toBeGreaterThan(reviewedAt)
    expect(await storage.learning.queue.list({
      mode: 'review',
      noteId: storedNote.id,
      now: rated.state.dueAt,
      topicId: occlusionTopicId,
    })).toEqual([
      expect.objectContaining({
        cardId,
        dueAt: rated.state.dueAt,
        phase: 'review',
        targetIds: [newItem.mainTargetId],
        topicId: occlusionTopicId,
      }),
    ])
    await expect(reviews.getNextReviewItem({
      noteId: storedNote.id,
      now: rated.state.dueAt,
      topicId: occlusionTopicId,
    })).resolves.toMatchObject({
      card: {
        id: cardId,
        kind: 'image-occlusion',
        sourceBlockId: annotation.id,
      },
      mainTargetId: newItem.mainTargetId,
    })
  })

  it('does not report a persisted edit as failed when renderer notification throws', async () => {
    const fixture = await createFixture()
    const before = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fixture.onExternalUpdate.mockImplementationOnce(() => {
      throw new Error('renderer destroyed')
    })

    const receipt = await fixture.notes.renameTopic({
      expectedRevision: before.revision,
      noteId: fixture.created.id,
      title: 'Persisted despite notification failure',
      topicId: fixture.topic.id,
    })

    expect(receipt.revision).not.toBe(before.revision)
    const restored = await createApplication(fixture.storage).getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    expect(restored.title).toBe('Persisted despite notification failure')
  })

  it('rejects stale revisions before mutation and reports the current revision', async () => {
    const fixture = await createFixture()
    const renamed = await fixture.notes.renameTopic({
      expectedRevision: fixture.tree.revision,
      noteId: fixture.created.id,
      title: 'Renamed Topic',
      topicId: fixture.topic.id,
    })

    await expect(fixture.notes.setTopicMode({
      expectedRevision: fixture.tree.revision,
      mode: 1,
      noteId: fixture.created.id,
      topicId: fixture.topic.id,
    })).rejects.toEqual(expect.objectContaining<Partial<NoteRevisionConflictError>>({
      currentRevision: renamed.revision,
      name: 'NoteRevisionConflictError',
    }))
    const topic = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    expect(topic.title).toBe('Renamed Topic')
    expect(topic.mode).toBe(0)
    expect(fixture.onExternalUpdate).toHaveBeenCalledTimes(1)
  })

  it('reloads the durable state after persistence rejects a CRDT mutation', async () => {
    const fixture = await createFixture()
    const before = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    vi.spyOn(fixture.storage.notes, 'saveNoteUpdates').mockRejectedValueOnce(new Error('disk full'))

    await expect(fixture.notes.renameTopic({
      expectedRevision: before.revision,
      noteId: fixture.created.id,
      title: 'Must not persist',
      topicId: fixture.topic.id,
    })).rejects.toThrow('disk full')

    const reloaded = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    expect(reloaded.title).toBe(before.title)
    expect(reloaded.revision).toBe(before.revision)
    expect(fixture.onExternalUpdate).not.toHaveBeenCalled()
  })

  it('waits for queued persistence and indexing work before closing', async () => {
    const fixture = await createFixture()
    const before = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    let releaseSave: (() => void) | undefined
    const originalSave = fixture.storage.notes.saveNoteUpdates.bind(fixture.storage.notes)
    vi.spyOn(fixture.storage.notes, 'saveNoteUpdates').mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      return originalSave(input)
    })

    const rename = fixture.notes.renameTopic({
      expectedRevision: before.revision,
      noteId: fixture.created.id,
      title: 'Drained before close',
      topicId: fixture.topic.id,
    })
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'))
    let closed = false
    const close = fixture.notes.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)

    releaseSave?.()
    await Promise.all([rename, close])
    expect(closed).toBe(true)
  })

  it('serializes concurrent writes so only one request with the same revision commits', async () => {
    const fixture = await createFixture()
    const results = await Promise.allSettled([
      fixture.notes.renameTopic({
        expectedRevision: fixture.tree.revision,
        noteId: fixture.created.id,
        title: 'First',
        topicId: fixture.topic.id,
      }),
      fixture.notes.renameTopic({
        expectedRevision: fixture.tree.revision,
        noteId: fixture.created.id,
        title: 'Second',
        topicId: fixture.topic.id,
      }),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected && rejected.status === 'rejected' ? rejected.reason : undefined).toBeInstanceOf(NoteRevisionConflictError)
    expect(fixture.onExternalUpdate).toHaveBeenCalledTimes(1)
  })

  it('checkpoints exactly at 32 durable updates and does not checkpoint at 31', async () => {
    const fixture = await createFixture()
    const checkpoint = vi.spyOn(fixture.storage.notes, 'checkpointNote')
    const renderer = createEditorNote({ id: fixture.created.id, snapshot: fixture.created.snapshot })

    for (let index = 1; index <= 31; index += 1) {
      const version = renderer.getVersion()
      renderer.renameEntry(fixture.topic.id, `Topic ${index}`)
      await fixture.notes.saveNoteUpdates({
        noteId: fixture.created.id,
        updates: [renderer.exportUpdates(version)],
      })
    }
    expect(checkpoint).not.toHaveBeenCalled()

    const version = renderer.getVersion()
    renderer.renameEntry(fixture.topic.id, 'Topic 32')
    await fixture.notes.saveNoteUpdates({
      noteId: fixture.created.id,
      updates: [renderer.exportUpdates(version)],
    })

    expect(checkpoint).toHaveBeenCalledOnce()
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      noteId: fixture.created.id,
      throughSequence: 32,
    }))
    const stored = await fixture.storage.notes.getNote({ noteId: fixture.created.id })
    expect(stored.checkpointSequence).toBe(stored.latestSequence)
    expect(stored.updates).toEqual([])
  })

  it('evicts and checkpoints the least recently used dirty Note after access refresh', async () => {
    const fixture = await createFixture()
    const created = [fixture.created]
    for (let index = 1; index < 65; index += 1)
      created.push(await fixture.notes.createNote({ title: `LRU Note ${index}` }))
    const checkpoint = vi.spyOn(fixture.storage.notes, 'checkpointNote')

    await fixture.notes.renameNote({ noteId: created[0]!.id, title: 'Recently used' })
    await fixture.notes.renameNote({ noteId: created[1]!.id, title: 'Least recently used and dirty' })
    for (const note of created.slice(2, 64))
      await fixture.notes.getNote({ noteId: note.id })
    await fixture.notes.getNote({ noteId: created[0]!.id })
    checkpoint.mockClear()

    await fixture.notes.getNote({ noteId: created[64]!.id })

    expect(checkpoint).toHaveBeenCalledOnce()
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ noteId: created[1]!.id }))
    const restored = await createApplication(fixture.storage).getNote({ noteId: created[1]!.id })
    expect(restored.title).toBe('Least recently used and dirty')
  })

  it('recovers an evicted Note from the update log when its checkpoint fails', async () => {
    const fixture = await createFixture()
    await fixture.notes.renameNote({ noteId: fixture.created.id, title: 'Durable update log title' })
    for (let index = 1; index < 64; index += 1)
      await fixture.notes.createNote({ title: `Cache filler ${index}` })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const originalCheckpoint = fixture.storage.notes.checkpointNote.bind(fixture.storage.notes)
    let failed = false
    vi.spyOn(fixture.storage.notes, 'checkpointNote').mockImplementation(async (input) => {
      if (!failed && input.noteId === fixture.created.id) {
        failed = true
        throw new Error('checkpoint unavailable')
      }
      return originalCheckpoint(input)
    })

    await fixture.notes.createNote({ title: 'Evict oldest' })

    const restored = await createApplication(fixture.storage).getNote({ noteId: fixture.created.id })
    expect(restored.title).toBe('Durable update log title')
  })

  it('broadcasts duplicate updates only once within one renderer batch', async () => {
    const fixture = await createFixture()
    const renderer = createEditorNote({ id: fixture.created.id, snapshot: fixture.created.snapshot })
    const version = renderer.getVersion()
    renderer.renameEntry(fixture.topic.id, 'One accepted update')
    const update = renderer.exportUpdates(version)
    fixture.onExternalUpdate.mockClear()

    await fixture.notes.saveNoteUpdates({ noteId: fixture.created.id, updates: [update, update] })

    expect(fixture.onExternalUpdate).toHaveBeenCalledOnce()
  })

  it('does not rebroadcast or reindex duplicate renderer retries', async () => {
    const fixture = await createFixture()
    await fixture.notes.close()
    const onExternalUpdate = vi.fn()
    const service = createApplication(fixture.storage, onExternalUpdate)
    const renderer = createEditorNote({ id: fixture.created.id, snapshot: fixture.created.snapshot })
    const version = renderer.getVersion()
    renderer.renameEntry(fixture.topic.id, 'One durable update')
    const update = renderer.exportUpdates(version)
    const index = vi.spyOn(fixture.storage.search, 'indexPendingEmbeddings')

    await service.saveNoteUpdates({ noteId: fixture.created.id, updates: [update] })
    await service.saveNoteUpdates({ noteId: fixture.created.id, updates: [update] })
    await service.close()

    expect(onExternalUpdate).toHaveBeenCalledOnce()
    expect(index).toHaveBeenCalledOnce()
    const stored = await fixture.storage.notes.getNote({ noteId: fixture.created.id })
    expect(stored.latestSequence - stored.checkpointSequence).toBe(0)
  })

  it('makes close idempotent, drains admitted work, and rejects later operations', async () => {
    const fixture = await createFixture()
    const before = await fixture.notes.getTopic({ noteId: fixture.created.id, topicId: fixture.topic.id })
    let releaseSave: (() => void) | undefined
    const originalSave = fixture.storage.notes.saveNoteUpdates.bind(fixture.storage.notes)
    vi.spyOn(fixture.storage.notes, 'saveNoteUpdates').mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      return originalSave(input)
    })
    const admitted = fixture.notes.renameTopic({
      expectedRevision: before.revision,
      noteId: fixture.created.id,
      title: 'Admitted before close',
      topicId: fixture.topic.id,
    })
    await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'))

    const firstClose = fixture.notes.close()
    const secondClose = fixture.notes.close()
    expect(secondClose).toBe(firstClose)
    await expect(fixture.notes.getNote({ noteId: fixture.created.id })).rejects.toBeInstanceOf(NoteApplicationServiceClosedError)
    releaseSave?.()
    await Promise.all([admitted, firstClose])

    const restored = await createApplication(fixture.storage).getTopic({
      noteId: fixture.created.id,
      topicId: fixture.topic.id,
    })
    expect(restored.title).toBe('Admitted before close')
  })

  it('retries cached checkpoints after a failed close while still closing indexing', async () => {
    const fixture = await createFixture()
    await fixture.notes.renameNote({ noteId: fixture.created.id, title: 'Dirty before close' })
    const originalCheckpoint = fixture.storage.notes.checkpointNote.bind(fixture.storage.notes)
    let attempts = 0
    vi.spyOn(fixture.storage.notes, 'checkpointNote').mockImplementation(async (input) => {
      attempts += 1
      if (attempts === 1)
        throw new Error('checkpoint unavailable')
      return originalCheckpoint(input)
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(fixture.notes.close()).rejects.toMatchObject({
      errors: [expect.objectContaining({
        cause: expect.objectContaining({ message: 'checkpoint unavailable' }),
        message: 'Failed to close Note cache',
      })],
      message: 'Note application service resource cleanup failed',
    })
    await expect(fixture.notes.getNote({ noteId: fixture.created.id })).rejects.toBeInstanceOf(NoteApplicationServiceClosedError)
    await fixture.notes.close()

    expect(attempts).toBe(2)
    const stored = await fixture.storage.notes.getNote({ noteId: fixture.created.id })
    expect(stored.latestSequence).toBe(stored.checkpointSequence)
  })
})
