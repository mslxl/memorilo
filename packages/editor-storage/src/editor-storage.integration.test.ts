import type { EmbeddingModel } from './index'
import { createOperationSupervisor } from '@memorilo/effect-lifecycle'
import { deferred } from '@memorilo/effect-lifecycle/testing'
import { afterEach, describe, expect, it } from 'vitest'

import { DuplicateNoteTitleError, SqliteEditorStorage, SqliteShelfStorage } from './index'
import { SqliteTestDatabase } from './sqlite-test-database'

const embeddingModel: EmbeddingModel = {
  dimensions: 3,
  id: 'test/three-dimensional',
  embedDocuments: async texts => texts.map(() => Float32Array.from([1, 0, 0])),
  embedQuery: async () => Float32Array.from([1, 0, 0]),
}

const databases: SqliteTestDatabase[] = []

class FlakyCloseDatabase extends SqliteTestDatabase {
  closeAttempts = 0

  override async close(): Promise<void> {
    this.closeAttempts += 1
    if (this.closeAttempts === 1)
      throw new Error('Injected database close failure')
    await super.close()
  }
}

async function createStorage(model: EmbeddingModel = embeddingModel) {
  const database = new SqliteTestDatabase()
  databases.push(database)
  return SqliteEditorStorage.open({ database, databaseOwnership: 'owned', embeddingModel: model })
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(database => database.close()))
})

describe('editor storage with an in-memory SQLite database', () => {
  it('closes its owned database when startup validation fails', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)

    await expect(SqliteEditorStorage.open({
      database,
      databaseOwnership: 'owned',
      embeddingModel: { ...embeddingModel, dimensions: 0 },
    })).rejects.toThrow('Embedding model dimensions must be a positive integer')

    await expect(database.exec('SELECT 1')).rejects.toThrow('database connection is not open')
  })

  it('does not close a borrowed database when EditorStorage closes', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const storage = await SqliteEditorStorage.open({
      database,
      databaseOwnership: 'borrowed',
      embeddingModel,
    })

    await storage.close()

    await expect(database.exec('SELECT 1')).resolves.toBeUndefined()
  })

  it('serializes borrowed Editor and Shelf owners through one shared database supervisor', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const operations = createOperationSupervisor('shared database test')
    const blockerStarted = deferred<void>()
    const releaseBlocker = deferred<void>()
    let blocker: Promise<void> | undefined
    let editor: SqliteEditorStorage | undefined
    let shelf: SqliteShelfStorage | undefined
    try {
      const currentEditor = await SqliteEditorStorage.open({
        database,
        databaseOwnership: 'borrowed',
        embeddingModel,
        operationSupervisor: operations,
      })
      editor = currentEditor
      const currentShelf = await SqliteShelfStorage.open({
        database,
        databaseOwnership: 'borrowed',
        operationSupervisor: operations,
      })
      shelf = currentShelf
      blocker = operations.run(async () => {
        blockerStarted.resolve()
        await releaseBlocker.promise
      })
      await blockerStarted.promise

      let editorFinished = false
      let shelfFinished = false
      const editorRead = currentEditor.notes.listNoteIds().then(() => {
        editorFinished = true
      })
      const shelfRead = currentShelf.sources.list().then(() => {
        shelfFinished = true
      })
      await Promise.resolve()
      expect(editorFinished).toBe(false)
      expect(shelfFinished).toBe(false)

      releaseBlocker.resolve()
      await blocker
      await Promise.all([editorRead, shelfRead])
    }
    finally {
      releaseBlocker.resolve()
      if (blocker)
        await blocker.catch(() => undefined)
      await shelf?.close()
      await editor?.close()
      await operations.close()
    }
  })

  it('keeps Shelf usable when its borrowed Editor owner closes', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const operations = createOperationSupervisor('shared database test')
    const editor = await SqliteEditorStorage.open({
      database,
      databaseOwnership: 'borrowed',
      embeddingModel,
      operationSupervisor: operations,
    })
    const shelf = await SqliteShelfStorage.open({
      database,
      databaseOwnership: 'borrowed',
      operationSupervisor: operations,
    })

    await editor.close()
    await expect(shelf.sources.list()).resolves.toEqual([])

    await shelf.close()
    await operations.close()
    await expect(database.exec('SELECT 1')).resolves.toBeUndefined()
  })

  it('rejects both borrowed storage owners after the shared supervisor closes', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const operations = createOperationSupervisor('shared database test')
    const editor = await SqliteEditorStorage.open({
      database,
      databaseOwnership: 'borrowed',
      embeddingModel,
      operationSupervisor: operations,
    })
    const shelf = await SqliteShelfStorage.open({
      database,
      databaseOwnership: 'borrowed',
      operationSupervisor: operations,
    })

    await operations.close()
    await expect(editor.notes.listNoteIds()).rejects.toThrow('shared database test is closed')
    await expect(shelf.sources.list()).rejects.toThrow('shared database test is closed')
    await expect(editor.close()).resolves.toBeUndefined()
    await expect(shelf.close()).resolves.toBeUndefined()
  })

  it('does not close a borrowed supervisor when Editor startup fails', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const operations = createOperationSupervisor('shared database test')

    await expect(SqliteEditorStorage.open({
      database,
      databaseOwnership: 'borrowed',
      embeddingModel: { ...embeddingModel, dimensions: 0 },
      operationSupervisor: operations,
    })).rejects.toThrow('Embedding model dimensions must be a positive integer')

    await expect(operations.run(async () => 'still open')).resolves.toBe('still open')
    await operations.close()
  })

  it('closes an owned database after its learning and editor operations drain', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const storage = await SqliteEditorStorage.open({ database, databaseOwnership: 'owned', embeddingModel })

    await storage.close()

    await expect(database.exec('SELECT 1')).rejects.toThrow('database connection is not open')
  })

  it('returns an initialized Note receipt without a fallible read after the commit', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const storage = await SqliteEditorStorage.open({ database, databaseOwnership: 'owned', embeddingModel })
    database.beforeGet = async (sql) => {
      if (sql.includes('checkpoint_snapshot'))
        throw new Error('post-commit read failed')
    }

    const created = await storage.notes.createInitializedNote({
      entries: [],
      id: 'initialized-without-read',
      snapshot: Uint8Array.from([1, 2, 3]),
      title: 'Initialized Note',
      topics: [],
    })

    expect(created).toEqual({
      checkpointSequence: 0,
      createdAt: expect.any(Number),
      id: 'initialized-without-read',
      latestSequence: 0,
      snapshot: Uint8Array.from([1, 2, 3]),
      title: 'Initialized Note',
      updatedAt: created.createdAt,
      updates: [],
    })
  })

  it('creates a Journal atomically and returns the existing winner on retries', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const storage = await SqliteEditorStorage.open({ database, databaseOwnership: 'owned', embeddingModel })
    let journalLookupCount = 0
    database.beforeGet = async (sql) => {
      if (sql.includes('FROM journals AS journal')) {
        journalLookupCount += 1
        if (journalLookupCount > 1)
          throw new Error('Journal lookup after commit must not occur')
      }
    }
    const first = await storage.journals.getOrCreate({
      entries: [{
        id: 'journal-topic',
        kind: 'topic',
        mode: 0,
        ordinal: 0,
        parentId: null,
        title: '',
        topicType: 'regular',
      }],
      hasUserContent: true,
      journalDate: '2026-08-07',
      snapshot: Uint8Array.from([1, 2, 3]),
      topics: [{ blocks: [], title: '', topicId: 'journal-topic' }],
    })

    expect(first.status).toBe('created')
    expect(first.note.id).toBe('journal:2026-08-07')
    expect(journalLookupCount).toBe(1)
    await expect(storage.journals.getMetadata({ noteId: first.note.id })).resolves.toMatchObject({
      hasUserContent: true,
    })

    database.beforeGet = undefined
    await storage.notes.saveNoteUpdates({
      entries: [{
        id: 'journal-topic',
        kind: 'topic',
        mode: 0,
        ordinal: 0,
        parentId: null,
        title: '',
        topicType: 'regular',
      }],
      journalHasUserContent: true,
      noteId: first.note.id,
      title: '2026-08-07',
      topics: [{ blocks: [], title: '', topicId: 'journal-topic' }],
      updates: [Uint8Array.from([4])],
    })
    const second = await storage.journals.getOrCreate({
      entries: [{
        id: 'different-topic',
        kind: 'topic',
        mode: 0,
        ordinal: 0,
        parentId: null,
        title: '',
        topicType: 'regular',
      }],
      hasUserContent: true,
      journalDate: '2026-08-07',
      snapshot: Uint8Array.from([9, 9, 9]),
      topics: [{ blocks: [], title: '', topicId: 'different-topic' }],
    })

    expect(second.status).toBe('existing')
    expect(second.note.id).toBe(first.note.id)
    expect(second.note.snapshot).toEqual(first.note.snapshot)
    expect(second.note).toMatchObject({
      latestSequence: 1,
      updates: [{ sequence: 1, update: Uint8Array.from([4]) }],
    })
  })

  it('resolves concurrent Journal creation to one durable winner', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const firstStorage = await SqliteEditorStorage.open({ database, databaseOwnership: 'borrowed', embeddingModel })
    const secondStorage = await SqliteEditorStorage.open({ database, databaseOwnership: 'borrowed', embeddingModel })
    const input = (topicId: string) => ({
      entries: [{
        id: topicId,
        kind: 'topic' as const,
        mode: 0 as const,
        ordinal: 0,
        parentId: null,
        title: '',
        topicType: 'regular' as const,
      }],
      hasUserContent: false,
      journalDate: '2026-08-06' as const,
      snapshot: Uint8Array.from([1, 2, 3]),
      topics: [{ blocks: [], title: '', topicId }],
    })

    const results = await Promise.all([
      firstStorage.journals.getOrCreate(input('concurrent-topic-1')),
      secondStorage.journals.getOrCreate(input('concurrent-topic-2')),
    ])

    expect(results.map(result => result.status).sort()).toEqual(['created', 'existing'])
    expect(results[0]?.note.id).toBe(results[1]?.note.id)
    expect(results[0]?.note.id).toBe('journal:2026-08-06')
  })

  it('enforces regular Note title uniqueness across independent storage owners', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const firstStorage = await SqliteEditorStorage.open({
      database,
      databaseOwnership: 'borrowed',
      embeddingModel,
    })
    const secondStorage = await SqliteEditorStorage.open({
      database,
      databaseOwnership: 'borrowed',
      embeddingModel,
    })
    const bothChecksStarted = deferred<void>()
    let titleCheckCount = 0
    database.beforeGet = async (sql) => {
      if (!sql.includes('WHERE kind = \'regular\' AND title'))
        return
      titleCheckCount += 1
      if (titleCheckCount === 2)
        bothChecksStarted.resolve()
      await bothChecksStarted.promise
    }

    const outcomes = await Promise.allSettled([
      firstStorage.notes.createNote({ title: 'Concurrent Title' }),
      secondStorage.notes.createNote({ title: 'concurrent title' }),
    ])
    database.beforeGet = undefined

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const failure = outcomes.find(outcome => outcome.status === 'rejected')
    expect(failure?.status === 'rejected' ? failure.reason : null).toBeInstanceOf(DuplicateNoteTitleError)
    await expect(firstStorage.notes.listNotes()).resolves.toMatchObject({ totalItems: 1 })

    await Promise.all([firstStorage.close(), secondStorage.close()])
  })

  it('shares concurrent close calls and drains all owned layers', async () => {
    const storage = await createStorage()
    const first = storage.close()
    expect(storage.close()).toBe(first)
    await first
  })

  it('keeps successful shutdown steps closed while retrying a failed database close', async () => {
    const database = new FlakyCloseDatabase()
    databases.push(database)
    const storage = await SqliteEditorStorage.open({ database, databaseOwnership: 'owned', embeddingModel })

    const first = storage.close()
    expect(storage.close()).toBe(first)
    await expect(first).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Injected database close failure' }),
      message: 'Failed to close Editor database',
    })
    expect(database.closeAttempts).toBe(1)
    await expect(storage.notes.listNoteIds()).rejects.toThrow('Editor storage is closed')

    await expect(storage.close()).resolves.toBeUndefined()
    expect(database.closeAttempts).toBe(2)
  })

  it('rejects book context reads after the storage lifecycle closes', async () => {
    const storage = await createStorage()
    await storage.close()

    await expect(storage.bookTopics.listByFile({
      format: 'epub',
      sha256: '0'.repeat(64),
    })).rejects.toThrow('Editor storage is closed')
    await expect(
      storage.bookTopics.listByReadingId('reading-id'),
    ).rejects.toThrow('Editor storage is closed')
    await expect(storage.search.getTopicBlock({
      blockId: 'block-id',
      noteId: 'note-id',
      topicId: 'topic-id',
    })).rejects.toThrow('Editor storage is closed')
    await expect(
      storage.search.searchNotes({ query: 'query' }),
    ).rejects.toThrow('Editor storage is closed')
    await expect(
      storage.search.searchTopicBlocks({ query: 'query' }),
    ).rejects.toThrow('Editor storage is closed')
  })

  it('lists BookTopic contexts by file fingerprint and retrieval hint', async () => {
    const storage = await createStorage()
    const sha256 = 'a'.repeat(64)
    await storage.notes.createInitializedNote({
      entries: [{
        book: {
          book: { authors: ['Author'], title: 'Publication' },
          file: {
            byteLength: 42,
            format: 'epub',
            originalName: 'publication.epub',
            sha256,
          },
          retrievalHints: [{ kind: 'local', readingId: 'reading-1' }],
        },
        id: 'book-topic',
        kind: 'topic',
        mode: 0,
        ordinal: 0,
        parentId: null,
        title: 'Book topic',
        topicType: 'book',
      }],
      id: 'book-note',
      snapshot: Uint8Array.from([1]),
      title: 'Book note',
      topics: [{ blocks: [], title: 'Book topic', topicId: 'book-topic' }],
    })

    const byFile = await storage.bookTopics.listByFile({ format: 'epub', sha256 })
    expect(byFile).toHaveLength(1)
    expect(byFile[0]?.noteId).toBe('book-note')
    expect(byFile[0]?.book.file.originalName).toBe('publication.epub')

    const byReadingId = await storage.bookTopics.listByReadingId('reading-1')
    expect(byReadingId).toEqual(byFile)
    await expect(storage.bookTopics.listByFile({ format: 'pdf', sha256 })).resolves.toEqual([])
    await expect(storage.bookTopics.listByReadingId('missing-reading')).resolves.toEqual([])
  })

  it('reconciles BookTopic metadata and blocks when a Topic changes subtype', async () => {
    const storage = await createStorage()
    const sha256 = 'b'.repeat(64)
    await storage.notes.createInitializedNote({
      entries: [{
        id: 'topic',
        kind: 'topic',
        mode: 0,
        ordinal: 0,
        parentId: null,
        title: 'Reading notes',
        topicType: 'regular',
      }],
      id: 'changing-topic-note',
      snapshot: Uint8Array.from([1]),
      title: 'Changing topic',
      topics: [{ blocks: [], title: 'Reading notes', topicId: 'topic' }],
    })

    await storage.notes.saveNoteUpdates({
      entries: [{
        book: {
          book: { authors: ['Author'], title: 'Publication' },
          file: {
            byteLength: 42,
            format: 'epub',
            originalName: 'publication.epub',
            sha256,
          },
          retrievalHints: [{ kind: 'local', readingId: 'reading-1' }],
        },
        id: 'topic',
        kind: 'topic',
        mode: 0,
        ordinal: 0,
        parentId: null,
        title: 'Reading notes',
        topicType: 'book',
      }],
      noteId: 'changing-topic-note',
      topics: [{
        blocks: [{
          attributes: { page: 3 },
          id: 'highlight',
          kind: 'paragraph',
          ordinal: 0,
          parentId: null,
          text: 'Projected book highlight',
        }],
        title: 'Reading notes',
        topicId: 'topic',
      }],
      updates: [Uint8Array.from([2])],
    })

    await expect(storage.bookTopics.listByFile({ format: 'epub', sha256 })).resolves.toMatchObject([
      { noteId: 'changing-topic-note', topicId: 'topic' },
    ])
    await expect(storage.search.getTopicBlock({
      blockId: 'highlight',
      noteId: 'changing-topic-note',
      topicId: 'topic',
    })).resolves.toMatchObject({
      attributes: { page: 3 },
      text: 'Projected book highlight',
    })

    await storage.notes.saveNoteUpdates({
      entries: [{
        id: 'topic',
        kind: 'topic',
        mode: 0,
        ordinal: 0,
        parentId: null,
        title: 'Reading notes',
        topicType: 'regular',
      }],
      noteId: 'changing-topic-note',
      topics: [{ blocks: [], title: 'Reading notes', topicId: 'topic' }],
      updates: [Uint8Array.from([3])],
    })

    await expect(storage.bookTopics.listByFile({ format: 'epub', sha256 })).resolves.toEqual([])
    await expect(storage.bookTopics.listByReadingId('reading-1')).resolves.toEqual([])
    await expect(storage.search.getTopicBlock({
      blockId: 'highlight',
      noteId: 'changing-topic-note',
      topicId: 'topic',
    })).resolves.toBeNull()
  })

  it('reports only newly accepted update hashes for idempotent retries', async () => {
    const storage = await createStorage()
    const created = await storage.notes.createNote({ title: 'Receipts' })
    const update = Uint8Array.from([1, 2, 3])

    const first = await storage.notes.saveNoteUpdates({ noteId: created.id, topics: [], updates: [update, update] })
    const retry = await storage.notes.saveNoteUpdates({ noteId: created.id, topics: [], updates: [update] })

    expect(first.acceptedUpdateHashes).toHaveLength(1)
    expect(first.latestSequence).toBe(1)
    expect(retry).toEqual({ acceptedUpdateHashes: [], latestSequence: 1, updatedAt: first.updatedAt })
  })

  it('commits Note updates and learning Cards in one database batch', async () => {
    const storage = await createStorage()
    const created = await storage.notes.createNote({ title: 'Atomic learning projection' })

    const receipt = await storage.notes.saveNoteUpdates({
      learningCards: [{
        cards: [{
          cardId: 'atomic-card',
          direction: 'forward',
          itemBlockIds: [],
          kind: 'basic',
          sourceBlockId: 'source-block',
        }],
        topicId: 'topic',
        topicOrder: 0,
      }],
      noteId: created.id,
      title: 'Committed with Card',
      topics: [],
      updates: [Uint8Array.from([4, 5, 6])],
    })

    expect(receipt.latestSequence).toBe(1)
    await expect(storage.notes.getNote({ noteId: created.id })).resolves.toMatchObject({
      latestSequence: 1,
      title: 'Committed with Card',
    })
    await expect(storage.learning.cards.listTargets('atomic-card')).resolves.toEqual([
      expect.objectContaining({ active: true, cardId: 'atomic-card' }),
    ])
  })

  it('does not partially commit a Note when learning Card planning fails', async () => {
    const storage = await createStorage()
    const owner = await storage.notes.createNote({ title: 'Card owner' })
    await storage.learning.cards.reconcileTopicCards({
      cards: [{
        cardId: 'owned-card',
        direction: 'forward',
        itemBlockIds: [],
        kind: 'basic',
        sourceBlockId: 'owner-source',
      }],
      noteId: owner.id,
      topicId: 'owner-topic',
      topicOrder: 0,
    })
    const target = await storage.notes.createNote({ title: 'Unchanged Note' })

    await expect(storage.notes.saveNoteUpdates({
      learningCards: [{
        cards: [{
          cardId: 'owned-card',
          direction: 'forward',
          itemBlockIds: [],
          kind: 'basic',
          sourceBlockId: 'conflicting-source',
        }],
        topicId: 'target-topic',
        topicOrder: 0,
      }],
      noteId: target.id,
      title: 'Must not commit',
      topics: [],
      updates: [Uint8Array.from([7, 8, 9])],
    })).rejects.toThrow(`CardID owned-card already belongs to Note ${owner.id}`)

    await expect(storage.notes.getNote({ noteId: target.id })).resolves.toMatchObject({
      latestSequence: 0,
      title: 'Unchanged Note',
      updates: [],
    })
    await expect(storage.notes.listNoteIds()).resolves.toContain(target.id)
  })

  it('moves a Card across projected Topics without deactivating it later in the batch', async () => {
    const storage = await createStorage()
    const note = await storage.notes.createNote({ title: 'Moved Card' })
    const card = {
      cardId: 'moved-card',
      direction: 'forward' as const,
      itemBlockIds: [],
      kind: 'basic' as const,
      sourceBlockId: 'source',
    }
    await storage.learning.cards.reconcileTopicCards({
      cards: [card],
      noteId: note.id,
      topicId: 'old-topic',
      topicOrder: 0,
    })

    await storage.notes.saveNoteUpdates({
      learningCards: [
        { cards: [card], topicId: 'new-topic', topicOrder: 0 },
        { cards: [], topicId: 'old-topic', topicOrder: 1 },
      ],
      noteId: note.id,
      topics: [],
      updates: [Uint8Array.from([10])],
    })

    await expect(storage.learning.cards.listTargets(card.cardId)).resolves.toEqual([
      expect.objectContaining({ active: true, cardId: card.cardId }),
    ])
    await expect(storage.learning.cards.listNoteTopicIds(note.id)).resolves.toEqual(['new-topic'])
  })

  it('atomically grants an asset deletion claim to only one storage instance', async () => {
    const database = new SqliteTestDatabase()
    databases.push(database)
    const first = await SqliteEditorStorage.open({ database, databaseOwnership: 'borrowed', embeddingModel })
    const second = await SqliteEditorStorage.open({ database, databaseOwnership: 'borrowed', embeddingModel })
    const fileName = '0f1e2d3c-4b5a-4678-9abc-0d1e2f3a4b5c.png'
    await first.assets.register({
      byteSize: 8,
      createdAt: 1,
      fileName,
      mimeType: 'image/png',
      originalFileName: 'photo.png',
    })

    let waiting = 0
    let release!: () => void
    const bothClaimsReadEligibility = new Promise<void>((resolve) => {
      release = resolve
    })
    database.beforeGet = async (sql) => {
      if (!sql.includes('deletion_claimed_at IS NULL'))
        return
      waiting += 1
      if (waiting === 2)
        release()
      await bothClaimsReadEligibility
    }

    const claims = await Promise.all([
      first.assets.claimUnreferenced({ fileName, unreferencedBefore: 2 }),
      second.assets.claimUnreferenced({ fileName, unreferencedBefore: 2 }),
    ])

    expect(claims.filter(claim => claim !== null)).toHaveLength(1)
  })

  it('stores asset sync manifests with durable device frontiers and idempotency', async () => {
    const storage = await createStorage()
    const first = await storage.assets.appendLocalSyncManifest({
      contentHash: 'a'.repeat(64),
      contentLength: 8,
      contentType: 'image/png',
      createdAt: 1,
      deviceId: 'local-device',
      fileName: '00000000-0000-0000-0000-000000000001.png',
      operation: 'put',
      originalFileName: 'photo.png',
    })
    const second = await storage.assets.appendLocalSyncManifest({
      contentHash: null,
      contentLength: null,
      contentType: null,
      createdAt: 2,
      deviceId: 'local-device',
      fileName: first.fileName,
      operation: 'delete',
      originalFileName: first.originalFileName,
    })
    expect([first.sequence, second.sequence]).toEqual([1, 2])
    await expect(storage.assets.getSyncFrontier()).resolves.toEqual({ 'local-device': 2 })
    await expect(storage.assets.listSyncManifests({ 'local-device': 1 })).resolves.toEqual([second])

    const remote = { ...first, deviceId: 'remote-device', id: 'remote-device:asset:1' }
    await storage.assets.recordReceivedSyncManifests([remote, remote])
    await expect(storage.assets.getSyncFrontier()).resolves.toEqual({ 'local-device': 2, 'remote-device': 1 })
    const conflictingManifest = storage.assets.recordReceivedSyncManifests([{ ...remote, originalFileName: 'different.png' }])
    await expect(conflictingManifest).rejects.toThrow('idempotency conflict')
  })
})
