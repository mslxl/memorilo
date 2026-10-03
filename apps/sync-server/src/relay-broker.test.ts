import type { PairedDevice, SyncAssetManifest, SyncChange } from '@memorilo/sync'
import { encodeMemoriloProto } from '@memorilo/sync-protocol'
import { Duration, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { createRelayBroker, createRelayBytePipe } from '../infrastructure/p2p/server-peer'

function change(deviceId: string, sequence: number): SyncChange {
  return {
    deviceId,
    id: `${deviceId}:change:${sequence}`,
    kind: 'note-update',
    payload: encodeMemoriloProto('NoteUpdate', { noteId: `${deviceId}:note`, loroUpdate: Uint8Array.from([sequence]) }),
    sequence,
  }
}

function manifest(deviceId: string, sequence: number): SyncAssetManifest {
  return {
    contentHash: null,
    contentLength: null,
    contentType: null,
    createdAt: sequence,
    deviceId,
    fileName: `${deviceId}-${sequence}.bin`,
    id: `${deviceId}:asset:${sequence}`,
    operation: 'delete',
    originalFileName: `${deviceId}-${sequence}.bin`,
    sequence,
  }
}

function device(deviceId: string, peerId: string): PairedDevice {
  return {
    addedAt: 1,
    deviceId,
    deviceName: deviceId,
    lastSeenAt: 1,
    pairingId: `${deviceId}-pairing`,
    peerId,
    role: 'device',
    sharedSecret: `${deviceId}-shared-secret`,
    signingPublicKey: `${deviceId}-signing-key`,
  }
}

describe('relay broker', () => {
  it('retains changes and manifests until the destination frontier confirms them', () => {
    const broker = createRelayBroker()
    const sender = broker.open('account-1', device('device-a', 'peer-a'))
    const receiver = broker.open('account-1', device('device-b', 'peer-b'))
    const nextChange = change('device-a', 1)
    const nextManifest = manifest('device-a', 1)

    sender.publish('notes', [nextChange])
    sender.publishAssets([nextManifest])

    expect(receiver.pull('notes', {})).toEqual([nextChange])
    expect(receiver.pull('notes', {})).toEqual([nextChange])
    expect(receiver.pullAssets({})).toEqual([nextManifest])
    expect(receiver.pullAssets({})).toEqual([nextManifest])
    expect(receiver.pull('notes', { 'device-a': 1 })).toEqual([])
    expect(receiver.pullAssets({ 'device-a': 1 })).toEqual([])
    expect(receiver.pull('notes', {})).toEqual([])
    expect(receiver.pullAssets({})).toEqual([])

    sender.release()
    receiver.release()
  })

  it('isolates accounts, survives stream completion and clears a destination inbox on disconnect', () => {
    const broker = createRelayBroker()
    const sender = broker.open('account-1', device('device-a', 'peer-a'))
    const receiver = broker.open('account-1', device('device-b', 'peer-b'))
    const otherAccount = broker.open('account-2', device('device-b', 'other-peer-b'))

    sender.publish('learning', [change('device-a', 1)])
    expect(otherAccount.pull('learning', {})).toEqual([])

    receiver.release()
    const sameConnection = broker.open('account-1', device('device-b', 'peer-b'))
    expect(sameConnection.pull('learning', {})).toEqual([change('device-a', 1)])

    broker.disconnectPeer('peer-b')
    const replacement = broker.open('account-1', device('device-b', 'peer-b-2'))
    expect(replacement.pull('learning', {})).toEqual([])

    sender.release()
    replacement.release()
    otherAccount.release()
  })

  it('discards a participant when admission rejects a session', () => {
    const broker = createRelayBroker()
    const participant = device('device-a', 'peer-a')
    broker.open('account-1', participant)
    expect(broker.peers('account-1', 'device-b')).toEqual([participant])
    broker.discard('account-1', participant)
    expect(broker.peers('account-1', 'device-b')).toEqual([])
  })
})

describe('relay byte pipe', () => {
  it('releases a blocked producer when a destination completes without consuming', async () => {
    const pipe = createRelayBytePipe()
    await pipe.push(new Uint8Array([1]))
    const blocked = pipe.push(new Uint8Array([2]))
    const timedOut = await Effect.runPromise(Effect.promise(() => blocked).pipe(
      Effect.timeout(Duration.millis(20)),
      Effect.exit,
    ))
    expect(Exit.isFailure(timedOut)).toBe(true)
    pipe.stop()
    await blocked

    const received: Uint8Array[] = []
    for await (const chunk of pipe.body)
      received.push(chunk)
    expect(received).toEqual([])
  })
})
