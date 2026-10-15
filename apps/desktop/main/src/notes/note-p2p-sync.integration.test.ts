import type { SyncChange, VersionVector } from '@memorilo/sync'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteEditorStorage } from '@memorilo/editor-storage'
import { createEditorNote } from '@memorilo/editor/note'
import { decodeMemoriloProto, encodeMemoriloProto } from '@memorilo/sync-protocol'
import { createP2pNode, MemoryPairingStore, PairingManager, ProtobufSyncJournal } from '@memorilo/sync/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BetterSqliteDatabase } from '../storage/better-sqlite-database'
import { createNoteApplicationService } from './note-application-service'
import { ensureNoteP2pBaselines } from './note-p2p-baselines'

const embeddingModel = {
  dimensions: 3,
  id: 'test/p2p-note-sync',
  embedDocuments: async (texts: readonly string[]) => texts.map(() => Float32Array.from([1, 0, 0])),
  embedQuery: async () => Float32Array.from([1, 0, 0]),
}

describe('p2p Note synchronization', () => {
  const handles: Array<{ close: () => Promise<void> }> = []
  const applications: Array<{ close: () => Promise<void> }> = []
  const storages: Array<Awaited<ReturnType<typeof SqliteEditorStorage.open>>> = []
  const databases: BetterSqliteDatabase[] = []
  const temporaryDirectories: string[] = []

  async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate() && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10))
    if (!predicate())
      throw new Error('Timed out waiting for P2P Note synchronization')
  }

  async function openStorage(): Promise<Awaited<ReturnType<typeof SqliteEditorStorage.open>>> {
    const database = new BetterSqliteDatabase(':memory:')
    databases.push(database)
    const storage = await SqliteEditorStorage.open({ database, databaseOwnership: 'owned', embeddingModel })
    storages.push(storage)
    return storage
  }

  afterEach(async () => {
    await Promise.all(handles.splice(0).map(handle => handle.close()))
    await Promise.all(applications.splice(0).map(application => application.close()))
    await Promise.all(storages.splice(0).map(storage => storage.close()))
    await Promise.all(databases.splice(0).map(database => database.close()))
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
    vi.restoreAllMocks()
  })

  it('creates and updates a missing Note received from a peer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-note-p2p-sync-'))
    temporaryDirectories.push(directory)
    const sourceJournal = new ProtobufSyncJournal(join(directory, 'source-journal.bin'))
    const destinationJournal = new ProtobufSyncJournal(join(directory, 'destination-journal.bin'))
    await sourceJournal.load()
    await destinationJournal.load()
    await sourceJournal.setDeviceId('source')
    await destinationJournal.setDeviceId('destination')

    const sourceStorage = await openStorage()
    const destinationStorage = await openStorage()
    const sourceJournalWrites: Promise<void>[] = []
    const sourceNotes = createNoteApplicationService(sourceStorage, ({ noteId, update }) => {
      const updateId = createHash('sha256').update(noteId).update('\0').update(update).digest('hex')
      sourceJournalWrites.push(sourceJournal.appendLocal({
        id: `note:${noteId}:${updateId}`,
        kind: 'note-update',
        payload: encodeMemoriloProto('NoteUpdate', { noteId, loroUpdate: update }),
      }).then(() => undefined))
    })
    const destinationNotes = createNoteApplicationService(destinationStorage)
    applications.push(sourceNotes, destinationNotes)

    const destinationLoad = vi.spyOn(destinationStorage.notes, 'getNote')
    let receivedNote = false
    const sourcePairing = new PairingManager(
      { deviceId: 'source', deviceName: 'Source', peerId: '' },
      new MemoryPairingStore(),
    )
    const destinationPairing = new PairingManager(
      { deviceId: 'destination', deviceName: 'Destination', peerId: '' },
      new MemoryPairingStore(),
    )
    await sourcePairing.load()
    await destinationPairing.load()
    const source = await createP2pNode({
      identity: sourcePairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: sourcePairing,
      provider: {
        applyChanges: async () => undefined,
        getChanges: async (namespace, since: VersionVector) => sourceJournal.listChanges(since, namespace),
        getMembershipEpoch: () => 1,
        getVersionVector: namespace => sourceJournal.getVersionVector(namespace),
      },
    })
    const destination = await createP2pNode({
      identity: destinationPairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: destinationPairing,
      provider: {
        applyChanges: async (_namespace, changes: readonly SyncChange[]) => {
          for (const change of changes) {
            if (change.kind !== 'note-update')
              continue
            const payload = decodeMemoriloProto('NoteUpdate', change.payload)
            await destinationNotes.saveNoteUpdates({
              noteId: String(payload.noteId),
              updates: [new Uint8Array(payload.loroUpdate as Uint8Array)],
            })
            receivedNote = true
          }
          await destinationJournal.recordReceived(changes)
        },
        getChanges: async (namespace, since: VersionVector) => destinationJournal.listChanges(since, namespace),
        getMembershipEpoch: () => 1,
        getVersionVector: namespace => destinationJournal.getVersionVector(namespace),
      },
    })
    handles.push(source, destination)
    const sourcePeerId = source.status().peerId
    const destinationPeerId = destination.status().peerId
    if (sourcePeerId === null || destinationPeerId === null)
      throw new Error('P2P peers did not start')
    sourcePairing.identity.peerId = sourcePeerId
    destinationPairing.identity.peerId = destinationPeerId
    const accepted = await destinationPairing.acceptInvitation(sourcePairing.createInvitation())
    await sourcePairing.completeInvitation(accepted.response)

    const destinationAddress = destination.node.getMultiaddrs()[0]
    if (destinationAddress === undefined)
      throw new Error('Destination peer did not expose a listen address')
    await source.node.dial(destinationAddress as never)
    await source.syncPeer(destinationPeerId)
    const created = await sourceNotes.createNote({ initialHeading: 'Initial heading', title: 'P2P Note' })
    const baseline = createEditorNote({ id: created.id, snapshot: created.snapshot })
    const entries = baseline.getEntries()
    const before = await sourceNotes.getTopic({ noteId: created.id, topicId: entries.find(entry => entry.kind === 'topic')?.id ?? '' })
    const topicId = before.topicId
    const blockId = before.document.content?.[0]?.attrs?.blockId
    if (typeof blockId !== 'string')
      throw new Error('Initial Topic is missing its Block ID')
    await sourceNotes.applyTopicEdits({
      edits: [{
        blockId,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Received while unopened' }] }],
        operation: 'update-block-content',
      }],
      expectedRevision: before.revision,
      noteId: created.id,
      topicId,
    })
    await Promise.all(sourceJournalWrites)

    await source.notifyChangesAvailable()
    await waitFor(() => receivedNote)

    expect(destinationLoad).toHaveBeenCalledWith({ noteId: created.id })
    await destinationNotes.close()
    applications.splice(applications.indexOf(destinationNotes), 1)
    const reopenedDestinationNotes = createNoteApplicationService(destinationStorage)
    applications.push(reopenedDestinationNotes)
    const restoredNote = await reopenedDestinationNotes.getNote({ noteId: created.id })
    expect(restoredNote.title).toBe('P2P Note')
    const restored = await reopenedDestinationNotes.getTopic({ noteId: created.id, topicId })
    expect(restored.document.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('Received while unopened')
  })

  it('merges same-date Journals as one Journal aggregate', async () => {
    const sourceStorage = await openStorage()
    const destinationStorage = await openStorage()
    const sourceUpdates: Uint8Array[] = []
    const sourceNotes = createNoteApplicationService(sourceStorage, ({ update }) => {
      sourceUpdates.push(new Uint8Array(update))
    })
    const destinationNotes = createNoteApplicationService(destinationStorage)
    applications.push(sourceNotes, destinationNotes)
    const journalDate = '2026-08-22' as const

    const [source, destination] = await Promise.all([
      sourceNotes.openJournal({ journalDate }),
      destinationNotes.openJournal({ journalDate }),
    ])
    expect(source.id).toBe(destination.id)
    expect(source.id).toBe('journal:2026-08-22')

    const sourceTopic = await sourceNotes.getTopic({ noteId: source.id, topicId: source.topicId })
    const blockId = sourceTopic.document.content?.[0]?.attrs?.blockId
    if (typeof blockId !== 'string')
      throw new Error('Journal Topic is missing its canonical Block')
    await sourceNotes.applyTopicEdits({
      edits: [{
        blockId,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synced Journal content' }] }],
        operation: 'update-block-content',
      }],
      expectedRevision: sourceTopic.revision,
      noteId: source.id,
      topicId: source.topicId,
    })

    await destinationNotes.saveNoteUpdates({ noteId: source.id, updates: sourceUpdates })

    await expect(destinationNotes.getNote({ noteId: source.id })).resolves.toMatchObject({
      id: source.id,
      journalDate,
      kind: 'journal',
    })
    await expect(destinationStorage.journals.getMetadata({ noteId: source.id })).resolves.toMatchObject({
      journalDate,
      noteId: source.id,
    })
    const destinationTopic = await destinationNotes.getTopic({ noteId: source.id, topicId: source.topicId })
    expect(destinationTopic.document.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('Synced Journal content')
  })

  it('seeds a complete baseline for Notes that predate the P2P journal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-note-p2p-baseline-'))
    temporaryDirectories.push(directory)
    const sourceJournal = new ProtobufSyncJournal(join(directory, 'source-journal.bin'))
    await sourceJournal.load()
    await sourceJournal.setDeviceId('source')

    const source = createEditorNote({
      id: 'existing-note',
      initialTopicHeading: 'Initial',
      title: 'Existing Note',
    })
    const initialSnapshot = source.exportSnapshot()
    const version = source.getVersion()
    source.renameNote('Edited Existing Note')
    const edit = source.exportUpdates(version)
    await sourceJournal.appendLocal({
      id: 'source:note:rename',
      kind: 'note-update',
      payload: encodeMemoriloProto('NoteUpdate', { noteId: source.id, loroUpdate: edit }),
    })

    const seedBaselines = () => ensureNoteP2pBaselines({
      defaultNoteLearningEnabled: () => true,
      deviceId: 'source',
      getNote: async (noteId) => {
        expect(noteId).toBe(source.id)
        return {
          checkpointSequence: 0,
          createdAt: 1,
          id: source.id,
          latestSequence: 1,
          snapshot: initialSnapshot,
          title: 'Existing Note',
          updatedAt: 2,
          updates: [{ sequence: 1, update: edit }],
        }
      },
      journal: sourceJournal,
      listNoteIds: async () => [source.id],
    })
    await seedBaselines()
    await seedBaselines()

    const changes = sourceJournal.listChanges({})
    expect(changes).toHaveLength(2)
    expect(changes.map(change => change.id)).toEqual([
      'source:note:rename',
      'source:note-baseline:existing-note',
    ])

    const destinationStorage = await openStorage()
    const destinationNotes = createNoteApplicationService(destinationStorage)
    applications.push(destinationNotes)
    const updatesByNoteId = new Map<string, Uint8Array[]>()
    for (const change of changes) {
      const payload = decodeMemoriloProto('NoteUpdate', change.payload)
      const noteId = String(payload.noteId)
      const updates = updatesByNoteId.get(noteId) ?? []
      updates.push(new Uint8Array(payload.loroUpdate as Uint8Array))
      updatesByNoteId.set(noteId, updates)
    }
    for (const [noteId, updates] of updatesByNoteId)
      await destinationNotes.saveNoteUpdates({ noteId, updates })

    await expect(destinationNotes.getNote({ noteId: source.id })).resolves.toMatchObject({
      id: source.id,
      title: 'Edited Existing Note',
    })
  })
})
