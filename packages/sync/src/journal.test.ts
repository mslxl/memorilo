import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeMemoriloProto } from '@memorilo/sync-protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { ProtobufSyncJournal } from './journal'
import { encodeLearningMutation } from './protobuf-codec'

const notePayload = encodeMemoriloProto('NoteUpdate', { noteId: 'note', loroUpdate: Uint8Array.from([1]) })
const learningPayload = encodeLearningMutation({ createdAt: 1, entityId: 'entity', entityKind: 'tombstone', mutationId: 'mutation', operation: 'delete', payload: { generation: 0, scopeId: 'scope', scopeKind: 'card', tombstoneId: 'tombstone' } })

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('durable sync journal', () => {
  it('persists local changes and only advances remote vectors contiguously', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-p2p-journal-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'sync.json')
    const journal = new ProtobufSyncJournal(path)
    await journal.load()
    await journal.setDeviceId('local')
    await journal.appendLocal({ id: 'local-change', kind: 'note-update', payload: notePayload })

    await journal.recordReceived([{ deviceId: 'remote', id: 'remote-2', kind: 'learning-mutation', payload: learningPayload, sequence: 2 }])
    expect(journal.getVersionVector()).toEqual({ local: 1 })
    await journal.recordReceived([{ deviceId: 'remote', id: 'remote-1', kind: 'learning-mutation', payload: learningPayload, sequence: 1 }])
    expect(journal.getVersionVector()).toEqual({ local: 1, remote: 2 })

    const reopened = new ProtobufSyncJournal(path)
    await reopened.load()
    expect(reopened.deviceId).toBe('local')
    const reopenedChanges = reopened.listChanges({})
    expect(reopenedChanges).toEqual([
      {
        deviceId: 'local',
        id: 'local-change',
        kind: 'note-update',
        payload: expect.any(Uint8Array),
        sequence: 1,
      },
      {
        deviceId: 'remote',
        id: 'remote-1',
        kind: 'learning-mutation',
        payload: expect.any(Uint8Array),
        sequence: 1,
      },
      {
        deviceId: 'remote',
        id: 'remote-2',
        kind: 'learning-mutation',
        payload: expect.any(Uint8Array),
        sequence: 2,
      },
    ])
    expect(reopenedChanges.map(change => Array.from(change.payload))).toEqual([
      Array.from(notePayload),
      Array.from(learningPayload),
      Array.from(learningPayload),
    ])
    expect(reopened.getVersionVector()).toEqual({ local: 1, remote: 2 })
  })
})
