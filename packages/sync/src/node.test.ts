import type { SyncAssetManifest, SyncChange, VersionVector } from './model'
import type { P2pNodeHandle, SyncObjectTransferStore, SyncSessionHooks, SyncStateProvider } from './node'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keys } from '@libp2p/crypto'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'
import { Deferred, Duration, Effect, Exit, Schedule } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { ProtobufSyncJournal } from './journal'
import { createP2pNode } from './node'
import { MemoryPairingStore, PairingManager } from './pairing'
import { encodeLearningMutation } from './protobuf-codec'

function learningMutationPayload(): Uint8Array {
  return encodeLearningMutation({
    createdAt: 1,
    entityId: 'test-entity',
    entityKind: 'tombstone',
    mutationId: 'test-mutation',
    operation: 'delete',
    payload: { generation: 0, scopeId: 'test-scope', scopeKind: 'card', tombstoneId: 'test-tombstone' },
  })
}

describe('p2p communication', () => {
  const handles: Array<{ close: () => Promise<void> }> = []
  const temporaryDirectories: string[] = []

  async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
    await Effect.runPromise(Effect.sync(predicate).pipe(
      Effect.flatMap(ready => ready ? Effect.void : Effect.fail(new Error('P2P state is not ready'))),
      Effect.retry(Schedule.spaced(Duration.millis(10))),
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        onTimeout: () => Effect.fail(new Error(`Timed out waiting ${timeoutMs}ms for P2P state`)),
      }),
    ))
  }

  async function connectPairedNodes(
    firstProvider: SyncStateProvider,
    secondProvider: SyncStateProvider,
    secondSessionHooks?: SyncSessionHooks,
    syncImmediately = true,
    secondObjectStore?: SyncObjectTransferStore,
  ): Promise<{ first: P2pNodeHandle, second: P2pNodeHandle }> {
    const firstPairing = new PairingManager({ deviceId: 'first', deviceName: 'First', peerId: '' }, new MemoryPairingStore())
    const secondPairing = new PairingManager({ deviceId: 'second', deviceName: 'Second', peerId: '' }, new MemoryPairingStore())
    await firstPairing.load()
    await secondPairing.load()
    const first = await createP2pNode({
      identity: firstPairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: firstPairing,
      provider: firstProvider,
      reconnectIntervalMs: 60_000,
    })
    const second = await createP2pNode({
      identity: secondPairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: secondPairing,
      provider: secondProvider,
      objectStore: secondObjectStore,
      sessionHooks: secondSessionHooks,
      reconnectIntervalMs: 60_000,
    })
    handles.push(first, second)
    const firstPeerId = first.status().peerId
    const secondPeerId = second.status().peerId
    if (firstPeerId === null || secondPeerId === null)
      throw new Error('P2P peers did not start')
    firstPairing.identity.peerId = firstPeerId
    secondPairing.identity.peerId = secondPeerId
    const accepted = await secondPairing.acceptInvitation(firstPairing.createInvitation())
    await firstPairing.completeInvitation(accepted.response)
    const secondAddress = second.node.getMultiaddrs()[0]
    if (secondAddress === undefined)
      throw new Error('Second peer has no listen address')
    await first.node.dial(multiaddr(secondAddress.toString()))
    if (syncImmediately)
      await first.syncPeer(secondPeerId)
    return { first, second }
  }

  afterEach(async () => {
    await Promise.all(handles.splice(0).map(handle => handle.close()))
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  it('starts a TCP node with Noise, Yamux and mDNS and exposes a stable peer id', async () => {
    const pairing = new PairingManager(
      { deviceId: 'device', deviceName: 'Device', peerId: 'peer' },
      new MemoryPairingStore(),
    )
    await pairing.load()
    const handle = await createP2pNode({
      identity: { deviceId: 'device', deviceName: 'Device' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing,
    })
    handles.push(handle)
    expect(handle.status()).toMatchObject({ state: 'ready' })
    expect(handle.status().peerId).toEqual(expect.any(String))
    expect(handle.status().connectedPeers).toEqual([])
  })

  it('keeps a previously paired offline peer silent during startup synchronization', async () => {
    const offlinePairing = new PairingManager(
      { deviceId: 'offline', deviceName: 'Offline', peerId: '' },
      new MemoryPairingStore(),
    )
    await offlinePairing.load()
    const offline = await createP2pNode({
      identity: offlinePairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: offlinePairing,
    })
    const offlinePeerId = offline.status().peerId
    if (offlinePeerId === null)
      throw new Error('Offline peer did not start')
    await offline.close()

    const pairing = new PairingManager(
      { deviceId: 'local', deviceName: 'Local', peerId: '' },
      new MemoryPairingStore([{
        addedAt: 1,
        deviceId: 'offline',
        deviceName: 'Offline',
        lastSeenAt: 2,
        pairingId: 'pairing-id',
        peerId: offlinePeerId,
        role: 'device',
        sharedSecret: 'shared-secret',
        signingPublicKey: offlinePairing.signer.publicKey,
      }]),
    )
    await pairing.load()
    const observedDevices: string[][] = []
    const handle = await createP2pNode({
      identity: pairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      onStatus: status => observedDevices.push(status.devices.map(device => device.peerId)),
      pairing,
      provider: {
        applyChanges: async () => undefined,
        getChanges: async () => [],
        getMembershipEpoch: () => 1,
        getVersionVector: () => ({}),
      },
      reconnectIntervalMs: 60_000,
    })
    handles.push(handle)

    await expect(handle.notifyChangesAvailable()).resolves.toBeUndefined()
    expect(handle.status().devices).toEqual([])
    expect(observedDevices.every(devices => devices.length === 0)).toBe(true)
  })

  it('connects paired peers and applies a change over the authenticated sync stream', async () => {
    const firstPairing = new PairingManager({ deviceId: 'first', deviceName: 'First', peerId: '' }, new MemoryPairingStore())
    const secondPairing = new PairingManager({ deviceId: 'second', deviceName: 'Second', peerId: '' }, new MemoryPairingStore())
    await firstPairing.load()
    await secondPairing.load()
    const received: string[] = []
    const observedEpochs: number[] = []
    const first = await createP2pNode({
      identity: { deviceId: 'first', deviceName: 'First' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: firstPairing,
      provider: {
        applyChanges: async () => undefined,
        getChanges: async (namespace, since) => namespace === 'learning' && since.first !== 1 ? [{ deviceId: 'first', id: 'change-1', kind: 'learning-mutation', payload: learningMutationPayload(), sequence: 1 }] : [],
        getMembershipEpoch: () => 1,
        getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: 1 } : {},
      },
    })
    const second = await createP2pNode({
      identity: { deviceId: 'second', deviceName: 'Second' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: secondPairing,
      provider: {
        applyChanges: async (_namespace, changes) => {
          received.push(...changes.map(change => change.id))
        },
        observeMembershipEpoch: async (epoch) => {
          observedEpochs.push(epoch)
        },
        getChanges: async () => [],
        getMembershipEpoch: () => 3,
        getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: received.length > 0 ? 1 : 0 } : {},
      },
    })
    handles.push(first, second)
    firstPairing.identity.peerId = first.status().peerId ?? ''
    secondPairing.identity.peerId = second.status().peerId ?? ''
    const accepted = await secondPairing.acceptInvitation(firstPairing.createInvitation())
    await firstPairing.completeInvitation(accepted.response)
    const secondListenAddress = second.node.getMultiaddrs()[0]
    if (secondListenAddress === undefined)
      throw new Error('Second peer has no listen address')
    const secondAddress = multiaddr(secondListenAddress.toString())
    await first.node.dial(secondAddress)
    const secondPeerId = second.status().peerId
    if (secondPeerId === null)
      throw new Error('Second peer did not start')
    await waitFor(() => received.length === 1)
    expect(received).toEqual(['change-1'])
    expect(observedEpochs).toContain(1)
  })

  it('synchronizes a change immediately after a connected peer is notified', async () => {
    const sourceChanges: SyncChange[] = []
    const received: SyncChange[] = []
    const { first } = await connectPairedNodes({
      applyChanges: async () => undefined,
      getChanges: async (namespace, since) => namespace === 'learning' ? sourceChanges.filter(change => change.sequence > (since.first ?? 0)) : [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: sourceChanges.length } : {},
    }, {
      applyChanges: async (_namespace, changes) => {
        received.push(...changes)
      },
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: received.length } : {},
    })
    sourceChanges.push({
      deviceId: 'first',
      id: 'change-after-connect',
      kind: 'learning-mutation',
      payload: learningMutationPayload(),
      sequence: 1,
    })

    await first.notifyChangesAvailable()

    expect(received.map(change => change.id)).toEqual(['change-after-connect'])
  })

  it('coordinates named session barriers before applying and acknowledging a batch', async () => {
    const barriers = await Effect.runPromise(Effect.all({
      afterHello: Deferred.make<void>(),
      afterHelloReached: Deferred.make<void>(),
      beforeApplyBatch: Deferred.make<void>(),
      beforeApplyBatchReached: Deferred.make<void>(),
      beforeAck: Deferred.make<void>(),
      beforeAckReached: Deferred.make<void>(),
    }))
    const received: string[] = []
    const change: SyncChange = {
      deviceId: 'first',
      id: 'barrier-change',
      kind: 'learning-mutation',
      payload: learningMutationPayload(),
      sequence: 1,
    }
    const hooks: SyncSessionHooks = {
      afterHello: async () => {
        await Effect.runPromise(Deferred.succeed(barriers.afterHelloReached, undefined))
        await Effect.runPromise(Deferred.await(barriers.afterHello))
      },
      beforeAck: async (message) => {
        if (message.type !== 'ack' || message.namespace !== 'learning' || message.acceptedChangeIds.length === 0)
          return
        await Effect.runPromise(Deferred.succeed(barriers.beforeAckReached, undefined))
        await Effect.runPromise(Deferred.await(barriers.beforeAck))
      },
      beforeApplyBatch: async (message) => {
        if (message.type !== 'changes' || message.namespace !== 'learning' || message.changes.length === 0)
          return
        await Effect.runPromise(Deferred.succeed(barriers.beforeApplyBatchReached, undefined))
        await Effect.runPromise(Deferred.await(barriers.beforeApplyBatch))
      },
    }
    const connected = await connectPairedNodes({
      applyChanges: async () => undefined,
      getChanges: async (namespace, since) => namespace === 'learning' && (since.first ?? 0) < 1 ? [change] : [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: 1 } : {},
    }, {
      applyChanges: async (_namespace, changes) => {
        for (const item of changes) {
          if (!received.includes(item.id))
            received.push(item.id)
        }
      },
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: received.length } : {},
    }, hooks, false)
    const secondPeerId = connected.second.status().peerId
    if (secondPeerId === null)
      throw new Error('Second peer did not start')
    await waitFor(() => connected.first.status().devices.some(device => device.peerId === secondPeerId && device.state === 'connecting'))
    const syncing = connected.first.syncPeer(secondPeerId).catch(() => undefined)
    await Effect.runPromise(Deferred.await(barriers.afterHelloReached))
    expect(received).toEqual([])
    await Effect.runPromise(Deferred.succeed(barriers.afterHello, undefined))
    await Effect.runPromise(Deferred.await(barriers.beforeApplyBatchReached))
    expect(received).toEqual([])
    await Effect.runPromise(Deferred.succeed(barriers.beforeApplyBatch, undefined))
    await Effect.runPromise(Deferred.await(barriers.beforeAckReached))
    expect(received).toEqual(['barrier-change'])
    await Effect.runPromise(Deferred.succeed(barriers.beforeAck, undefined))
    await syncing
    await waitFor(() => connected.first.status().devices.some(device => device.state === 'synced'))
  }, 15_000)

  it('holds object completion at the afterObjectPut barrier until the receiver is durable', async () => {
    const reached = await Effect.runPromise(Deferred.make<void>())
    const release = await Effect.runPromise(Deferred.make<void>())
    const received: Uint8Array[] = []
    const objectStore: SyncObjectTransferStore = {
      has: async () => false,
      put: async (_manifest, body) => {
        for await (const chunk of body)
          received.push(chunk)
      },
    }
    const hooks: SyncSessionHooks = {
      afterObjectPut: async () => {
        await Effect.runPromise(Deferred.succeed(reached, undefined))
        await Effect.runPromise(Deferred.await(release))
      },
    }
    const connected = await connectPairedNodes({
      applyChanges: async () => undefined,
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: () => ({}),
    }, {
      applyChanges: async () => undefined,
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: () => ({}),
    }, hooks, false, objectStore)
    const peerId = connected.second.status().peerId
    if (peerId === null)
      throw new Error('Second peer did not start')
    const bytes = new TextEncoder().encode('barrier-object')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const manifest: SyncAssetManifest = {
      contentHash,
      contentLength: bytes.byteLength,
      contentType: 'text/plain',
      createdAt: 1,
      deviceId: 'first',
      fileName: 'barrier.txt',
      id: 'barrier-object',
      operation: 'put',
      originalFileName: 'barrier.txt',
      sequence: 1,
    }
    const transfer = connected.first.putObject(peerId, manifest, (async function* () {
      yield bytes
    })())
    try {
      await Effect.runPromise(Deferred.await(reached))
      expect(received).toHaveLength(1)
      expect([...received[0]!]).toEqual([...bytes])
      const completion = await Effect.runPromise(Effect.promise(() => transfer).pipe(
        Effect.timeout(Duration.millis(20)),
        Effect.exit,
      ))
      expect(Exit.isFailure(completion)).toBe(true)
      await Effect.runPromise(Deferred.succeed(release, undefined))
      await transfer
    }
    finally {
      await Effect.runPromise(Deferred.succeed(release, undefined))
      await transfer.catch(() => undefined)
    }
  })

  it('aborts a barrier wait when the remote sync stream disconnects', async () => {
    const reached = await Effect.runPromise(Deferred.make<void>())
    const aborted = await Effect.runPromise(Deferred.make<void>())
    const hooks: SyncSessionHooks = {
      afterHello: async (_hello, _peer, context) => {
        await Effect.runPromise(Deferred.succeed(reached, undefined))
        await Effect.runPromise(Effect.callback<void>((resume, signal) => {
          const finish = (): void => {
            void Effect.runPromise(Deferred.succeed(aborted, undefined)).catch(() => undefined)
            resume(Effect.void)
          }
          if (context.signal.aborted || signal.aborted) {
            finish()
            return
          }
          context.signal.addEventListener('abort', finish, { once: true })
          return Effect.sync(() => context.signal.removeEventListener('abort', finish))
        }))
      },
    }
    const connected = await connectPairedNodes({
      applyChanges: async () => undefined,
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: () => ({}),
    }, {
      applyChanges: async () => undefined,
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: () => ({}),
    }, hooks, false)
    const secondPeerId = connected.second.status().peerId
    if (secondPeerId === null)
      throw new Error('Second peer did not start')
    const syncing = connected.first.syncPeer(secondPeerId).catch(() => undefined)
    await Effect.runPromise(Deferred.await(reached))
    await connected.first.node.hangUp(secondPeerId as never)
    await Effect.runPromise(Deferred.await(aborted).pipe(
      Effect.timeout(Duration.seconds(2)),
    ))
    await syncing
  })

  it('does not report syncing for a fallback pass without changes', async () => {
    const firstPairing = new PairingManager({ deviceId: 'first', deviceName: 'First', peerId: '' }, new MemoryPairingStore())
    const secondPairing = new PairingManager({ deviceId: 'second', deviceName: 'Second', peerId: '' }, new MemoryPairingStore())
    await firstPairing.load()
    await secondPairing.load()
    let synchronizationChecks = 0
    const observedStates: string[] = []
    const provider = (): SyncStateProvider => ({
      applyChanges: async () => undefined,
      getChanges: async () => {
        synchronizationChecks += 1
        return []
      },
      getMembershipEpoch: () => 1,
      getVersionVector: () => ({}),
    })
    const first = await createP2pNode({
      identity: firstPairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      onStatus: status => observedStates.push(...status.devices.map(device => device.state)),
      pairing: firstPairing,
      provider: provider(),
      reconnectIntervalMs: 25,
    })
    const second = await createP2pNode({
      identity: secondPairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      onStatus: status => observedStates.push(...status.devices.map(device => device.state)),
      pairing: secondPairing,
      provider: provider(),
      reconnectIntervalMs: 25,
    })
    handles.push(first, second)
    const firstPeerId = first.status().peerId
    const secondPeerId = second.status().peerId
    if (firstPeerId === null || secondPeerId === null)
      throw new Error('P2P peers did not start')
    firstPairing.identity.peerId = firstPeerId
    secondPairing.identity.peerId = secondPeerId
    const accepted = await secondPairing.acceptInvitation(firstPairing.createInvitation())
    await firstPairing.completeInvitation(accepted.response)
    const initiator = firstPeerId < secondPeerId ? first : second
    const responder = firstPeerId < secondPeerId ? second : first
    const initiatorAddress = initiator.node.getMultiaddrs()[0]
    const initiatorPeerId = initiator.status().peerId
    const responderPeerId = responder.status().peerId
    if (initiatorAddress === undefined || initiatorPeerId === null || responderPeerId === null)
      throw new Error('Sync peers did not start')
    await responder.node.dial(multiaddr(initiatorAddress.toString()))
    await waitFor(() => initiator.status().connectedPeers.includes(responderPeerId))
    await initiator.syncPeer(responderPeerId)
    await waitFor(() => initiator.status().devices.some(device => device.state === 'synced'))

    const checksAfterInitialSync = synchronizationChecks
    observedStates.length = 0
    await waitFor(() => synchronizationChecks > checksAfterInitialSync)

    expect(observedStates).not.toContain('syncing')
  })

  it('runs another synchronization pass when a change arrives during an active pass', async () => {
    const sourceChanges: SyncChange[] = []
    const received: SyncChange[] = []
    let first: P2pNodeHandle | undefined
    let queuedSecondPass = false
    const connected = await connectPairedNodes({
      applyChanges: async () => undefined,
      getChanges: async (namespace, since) => namespace === 'learning' ? sourceChanges.filter(change => change.sequence > (since.first ?? 0)) : [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: sourceChanges.length } : {},
    }, {
      applyChanges: async (_namespace, changes) => {
        received.push(...changes)
        if (!queuedSecondPass && changes.some(change => change.id === 'first-change')) {
          queuedSecondPass = true
          sourceChanges.push({
            deviceId: 'first',
            id: 'second-change',
            kind: 'learning-mutation',
            payload: learningMutationPayload(),
            sequence: 2,
          })
          void first?.notifyChangesAvailable()
        }
      },
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace): VersionVector => namespace === 'learning' ? { first: received.length } : {},
    })
    first = connected.first
    sourceChanges.push({
      deviceId: 'first',
      id: 'first-change',
      kind: 'learning-mutation',
      payload: learningMutationPayload(),
      sequence: 1,
    })

    await first.notifyChangesAvailable()

    expect(received.map(change => change.id)).toEqual(['first-change', 'second-change'])
  })

  it('never synchronizes changes with an unpaired mDNS peer', async () => {
    const firstPairing = new PairingManager({ deviceId: 'first', deviceName: 'First', peerId: '' }, new MemoryPairingStore())
    const secondPairing = new PairingManager({ deviceId: 'second', deviceName: 'Second', peerId: '' }, new MemoryPairingStore())
    await firstPairing.load()
    await secondPairing.load()
    let requestedChanges = 0
    let appliedChanges = 0
    const first = await createP2pNode({
      identity: { deviceId: 'first', deviceName: 'First' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: firstPairing,
      pairingAvailability: () => Date.now() + 5 * 60 * 1000,
      provider: {
        applyChanges: async () => {
          appliedChanges += 1
        },
        getChanges: async () => {
          requestedChanges += 1
          return [{ deviceId: 'first', id: 'private-change', kind: 'learning-mutation', payload: learningMutationPayload(), sequence: 1 }]
        },
        getMembershipEpoch: () => 1,
        getVersionVector: () => ({ first: 1 }),
      },
    })
    const second = await createP2pNode({
      identity: { deviceId: 'second', deviceName: 'Second' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: secondPairing,
      provider: {
        applyChanges: async () => {
          appliedChanges += 1
        },
        getChanges: async () => {
          requestedChanges += 1
          return []
        },
        getMembershipEpoch: () => 1,
        getVersionVector: () => ({}),
      },
    })
    handles.push(first, second)
    const firstPeerId = first.status().peerId
    if (firstPeerId === null)
      throw new Error('First peer did not start')

    await waitFor(() => second.status().discoveredPeers.some(peer => peer.peerId === firstPeerId), 2_000)
    await Effect.runPromise(Effect.sleep(Duration.millis(100)))
    expect(requestedChanges).toBe(0)
    expect(appliedChanges).toBe(0)
    expect(first.status().connectedPeers).toEqual([])
    expect(second.status().connectedPeers).toEqual([])
    expect(firstPairing.list()).toEqual([])
    expect(secondPairing.list()).toEqual([])
  })

  it('reports a paired peer as paused before reconnecting after the connection closes', async () => {
    const firstPairing = new PairingManager({ deviceId: 'first', deviceName: 'First', peerId: '' }, new MemoryPairingStore())
    const secondPairing = new PairingManager({ deviceId: 'second', deviceName: 'Second', peerId: '' }, new MemoryPairingStore())
    await firstPairing.load()
    await secondPairing.load()
    const first = await createP2pNode({
      identity: { deviceId: 'first', deviceName: 'First' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: firstPairing,
      reconnectIntervalMs: 100,
    })
    const second = await createP2pNode({
      identity: { deviceId: 'second', deviceName: 'Second' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: secondPairing,
      reconnectIntervalMs: 100,
    })
    handles.push(first, second)
    const firstPeerId = first.status().peerId
    const secondPeerId = second.status().peerId
    if (firstPeerId === null || secondPeerId === null)
      throw new Error('Peers did not start')
    firstPairing.identity.peerId = firstPeerId
    secondPairing.identity.peerId = secondPeerId
    const accepted = await secondPairing.acceptInvitation(firstPairing.createInvitation())
    await firstPairing.completeInvitation(accepted.response)

    const initiator = firstPeerId < secondPeerId ? first : second
    const responder = firstPeerId < secondPeerId ? second : first
    const responderPeerId = responder.status().peerId
    const responderAddress = responder.node.getMultiaddrs()[0]
    if (responderPeerId === null || responderAddress === undefined)
      throw new Error('Responder did not start')
    await initiator.node.dial(multiaddr(responderAddress.toString()))
    await waitFor(() => initiator.status().connectedPeers.includes(responderPeerId))
    await initiator.node.hangUp(responderPeerId as never)
    await waitFor(() => !initiator.status().connectedPeers.includes(responderPeerId))
    await waitFor(() => initiator.status().devices.some(device => device.peerId === responderPeerId && device.state === 'paused'))
    await waitFor(() => initiator.status().connectedPeers.includes(responderPeerId))
  })

  it('reconnects a configured WebSocket server target after the server restarts', async () => {
    const firstKey = await keys.generateKeyPair('Ed25519')
    const secondKey = await keys.generateKeyPair('Ed25519')
    const keyed = [firstKey, secondKey]
      .map(privateKey => ({ peerId: peerIdFromPrivateKey(privateKey).toString(), privateKey }))
      .sort((left, right) => left.peerId.localeCompare(right.peerId))
    const serverKey = keyed[0]!
    const clientKey = keyed[1]!
    const serverPairing = new PairingManager(
      { deviceId: 'server', deviceName: 'Server', peerId: serverKey.peerId, role: 'server' },
      new MemoryPairingStore(),
    )
    const clientPairing = new PairingManager(
      { deviceId: 'client', deviceName: 'Client', peerId: clientKey.peerId },
      new MemoryPairingStore(),
    )
    await Promise.all([serverPairing.load(), clientPairing.load()])
    await Promise.all([
      serverPairing.completeGrant({
        deviceId: 'client',
        deviceName: 'Client',
        pairingId: 'server-restart-pairing',
        peerId: clientKey.peerId,
        role: 'device',
        sharedSecret: 'server-restart-secret',
        signingPublicKey: clientPairing.signer.publicKey,
      }),
      clientPairing.completeGrant({
        deviceId: 'server',
        deviceName: 'Server',
        pairingId: 'server-restart-pairing',
        peerId: serverKey.peerId,
        role: 'server',
        sharedSecret: 'server-restart-secret',
        signingPublicKey: serverPairing.signer.publicKey,
      }),
    ])
    const provider = (): SyncStateProvider => ({
      applyChanges: async () => undefined,
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: () => ({}),
    })
    let server = await createP2pNode({
      discovery: false,
      identity: serverPairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0/ws'],
      pairing: serverPairing,
      privateKey: serverKey.privateKey,
      provider: provider(),
      role: 'server',
      transport: 'websocket',
    })
    handles.push(server)
    const serverAddress = server.multiaddrs()[0]?.toString()
    const serverPort = serverAddress?.match(/\/tcp\/(\d+)/u)?.[1]
    if (serverPort === undefined)
      throw new Error('WebSocket server did not expose a TCP port')
    const client = await createP2pNode({
      dialTargets: new Map([[serverKey.peerId, `ws://127.0.0.1:${serverPort}`]]),
      discovery: false,
      identity: clientPairing.identity,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0/ws'],
      maxReconnectAttempts: 2,
      pairing: clientPairing,
      privateKey: clientKey.privateKey,
      provider: provider(),
      reconnectIntervalMs: 25,
      reconnectJitter: () => 0,
      server: {
        credential: 'test-credential',
        generation: 0,
        membershipEpoch: 1,
        modes: ['authoritative'],
        peerId: serverKey.peerId,
        policyEpoch: 0,
      },
      transport: 'websocket',
    })
    handles.push(client)
    await waitFor(() => client.status().devices.some(device => device.peerId === serverKey.peerId && device.state === 'synced'), 30_000)

    handles.splice(handles.indexOf(server), 1)
    await server.close()
    await waitFor(() => client.status().devices.some(device => device.peerId === serverKey.peerId && device.state === 'paused'), 30_000)
    await Effect.runPromise(Effect.sleep(Duration.millis(250)))
    server = await createP2pNode({
      discovery: false,
      identity: serverPairing.identity,
      listenAddresses: [`/ip4/127.0.0.1/tcp/${serverPort}/ws`],
      pairing: serverPairing,
      privateKey: serverKey.privateKey,
      provider: provider(),
      role: 'server',
      transport: 'websocket',
    })
    handles.push(server)

    await client.notifyChangesAvailable()
    // A restarted WebSocket listener may spend several seconds rebinding on a busy CI runner.
    await waitFor(() => client.status().devices.some(device => device.peerId === serverKey.peerId && device.state === 'synced'), 30_000)
  }, 90_000)

  it('discovers a paired peer without a user-provided multiaddress', async () => {
    const firstPairing = new PairingManager({ deviceId: 'first', deviceName: 'First', peerId: '' }, new MemoryPairingStore())
    const secondPairing = new PairingManager({ deviceId: 'second', deviceName: 'Second', peerId: '' }, new MemoryPairingStore())
    await firstPairing.load()
    await secondPairing.load()
    const received: string[] = []
    const firstProvider = {
      applyChanges: async () => undefined,
      getChanges: async (namespace: 'notes' | 'learning', since: VersionVector) => namespace === 'learning' && since.first !== 1 ? [{ deviceId: 'first', id: 'mdns-change', kind: 'learning-mutation' as const, payload: learningMutationPayload(), sequence: 1 }] : [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace: 'notes' | 'learning'): VersionVector => namespace === 'learning' ? { first: 1 } : {},
    }
    const secondProvider = {
      applyChanges: async (_namespace: 'notes' | 'learning', changes: readonly SyncChange[]) => {
        received.push(...changes.map(change => change.id))
      },
      getChanges: async () => [],
      getMembershipEpoch: () => 1,
      getVersionVector: (namespace: 'notes' | 'learning'): VersionVector => namespace === 'learning' ? { first: received.length > 0 ? 1 : 0 } : {},
    }
    const first = await createP2pNode({
      identity: { deviceId: 'first', deviceName: 'First' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: firstPairing,
      provider: firstProvider,
      reconnectIntervalMs: 25,
    })
    const second = await createP2pNode({
      identity: { deviceId: 'second', deviceName: 'Second' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: secondPairing,
      provider: secondProvider,
      reconnectIntervalMs: 25,
    })
    handles.push(first, second)
    const firstPeerId = first.status().peerId
    const secondPeerId = second.status().peerId
    if (firstPeerId === null || secondPeerId === null)
      throw new Error('Peers did not start')
    firstPairing.identity.peerId = firstPeerId
    secondPairing.identity.peerId = secondPeerId
    const accepted = await secondPairing.acceptInvitation(firstPairing.createInvitation())
    await firstPairing.completeInvitation(accepted.response)

    await waitFor(() => first.status().connectedPeers.includes(secondPeerId), 2_000)
    await waitFor(() => received.includes('mdns-change'), 2_000)
  })

  it('forwards a durable change through a paired middle device', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-p2p-forward-'))
    temporaryDirectories.push(directory)
    const devices = ['first', 'middle', 'last'] as const
    const pairings = new Map(devices.map(deviceId => [
      deviceId,
      new PairingManager({ deviceId, deviceName: deviceId, peerId: '' }, new MemoryPairingStore()),
    ] as const))
    const journals = new Map<string, ProtobufSyncJournal>()
    for (const deviceId of devices) {
      await pairings.get(deviceId)?.load()
      const journal = new ProtobufSyncJournal(join(directory, `${deviceId}.bin`))
      await journal.load()
      await journal.setDeviceId(deviceId)
      journals.set(deviceId, journal)
    }
    const createProvider = (deviceId: string) => {
      const journal = journals.get(deviceId)
      if (!journal)
        throw new Error(`Missing journal for ${deviceId}`)
      return {
        applyChanges: async (_namespace: 'notes' | 'learning', changes: readonly SyncChange[]) => journal.recordReceived(changes),
        getChanges: async (namespace: 'notes' | 'learning', since: VersionVector) => journal.listChanges(since, namespace),
        getMembershipEpoch: () => 1,
        getVersionVector: (namespace: 'notes' | 'learning') => journal.getVersionVector(namespace),
      }
    }
    const first = await createP2pNode({
      identity: { deviceId: 'first', deviceName: 'first' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: pairings.get('first')!,
      provider: createProvider('first'),
    })
    const middle = await createP2pNode({
      identity: { deviceId: 'middle', deviceName: 'middle' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: pairings.get('middle')!,
      provider: createProvider('middle'),
    })
    const last = await createP2pNode({
      identity: { deviceId: 'last', deviceName: 'last' },
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      pairing: pairings.get('last')!,
      provider: createProvider('last'),
    })
    handles.push(first, middle, last)
    for (const [deviceId, handle] of [['first', first], ['middle', middle], ['last', last]] as const) {
      const peerId = handle.status().peerId
      if (peerId === null)
        throw new Error(`Peer ${deviceId} did not start`)
      pairings.get(deviceId)!.identity.peerId = peerId
    }
    const middlePairing = pairings.get('middle')!
    const lastPairing = pairings.get('last')!
    const firstPairing = pairings.get('first')!
    const middleInvitation = middlePairing.createInvitation()
    const acceptedLast = await lastPairing.acceptInvitation(middleInvitation)
    await middlePairing.completeInvitation(acceptedLast.response)
    const acceptedMiddle = await middlePairing.acceptInvitation(firstPairing.createInvitation())
    await firstPairing.completeInvitation(acceptedMiddle.response)

    await journals.get('first')!.appendLocal({ id: 'relayed-change', kind: 'learning-mutation', payload: learningMutationPayload() })
    const middleAddress = middle.node.getMultiaddrs()[0]
    const lastAddress = last.node.getMultiaddrs()[0]
    const middlePeerId = middle.status().peerId
    const lastPeerId = last.status().peerId
    if (middleAddress === undefined || lastAddress === undefined || middlePeerId === null || lastPeerId === null)
      throw new Error('Relay peers did not expose listen addresses')
    await first.node.dial(multiaddr(middleAddress.toString()))
    await first.syncPeer(middlePeerId)
    await waitFor(() => journals.get('middle')!.getVersionVector().first === 1)
    await middle.node.dial(multiaddr(lastAddress.toString()))
    await middle.syncPeer(lastPeerId)
    await waitFor(() => journals.get('last')!.getVersionVector().first === 1)
    expect(journals.get('last')!.listChanges({}).some(change => change.id === 'relayed-change')).toBe(true)
  }, 15_000)
})
