import type { SyncAssetManifest, SyncChange, SyncHello, SyncObjectStore } from '@memorilo/sync'
import type { P2pNodeHandle, SyncObjectTransferStore, SyncStateProvider } from '@memorilo/sync/node'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeLearningMutation } from '@memorilo/sync'
import { encodeMemoriloProto } from '@memorilo/sync-protocol'
import { createP2pNode, MemoryPairingStore, PairingManager } from '@memorilo/sync/node'
import { LoroDoc } from 'loro-crdt'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteSyncDatabase } from '../infrastructure/database/sqlite'
import { createFilesystemObjectStore } from '../infrastructure/object-store/filesystem'
import { createSyncServerPeer, hashDeviceCredential, hashPairingSharedSecret, newDeviceCredential, rebuildAuthoritativeState } from '../infrastructure/p2p/server-peer'

describe('sync server peer', () => {
  const handles: Array<{ close: () => Promise<void> }> = []
  const databases: Array<{ close: () => void }> = []
  const directories: string[] = []

  const notePayload = (noteId: string, update: Uint8Array = Uint8Array.from([1])) => encodeMemoriloProto('NoteUpdate', { noteId, loroUpdate: update })
  const tombstonePayload = (id: string) => encodeLearningMutation({
    createdAt: 10,
    entityId: id,
    entityKind: 'tombstone',
    mutationId: id,
    operation: 'delete',
    payload: { generation: 0, scopeId: 'card-1', scopeKind: 'card', tombstoneId: id },
  })

  afterEach(async () => {
    await Promise.all(handles.splice(0).map(handle => handle.close()))
    for (const database of databases.splice(0))
      database.close()
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  async function createFixture(mode: 'relay' | 'authoritative', options: {
    readonly enabledModes?: readonly ('relay' | 'authoritative')[]
    readonly readOnly?: boolean
  } = {}): Promise<{
    readonly database: ReturnType<typeof createSqliteSyncDatabase>
    readonly server: Awaited<ReturnType<typeof createSyncServerPeer>>
    readonly client: P2pNodeHandle
    readonly clientPairing: PairingManager
    readonly clientDeviceId: string
    readonly clientChanges: SyncChange[]
    readonly clientRemoteHellos: SyncHello[]
    readonly credentialHash: string
    readonly objectStore: SyncObjectStore
    readonly addClient: (input: { readonly deviceId: string, readonly changes?: SyncChange[], readonly received?: SyncChange[], readonly objectStore?: SyncObjectTransferStore }) => Promise<{ readonly client: P2pNodeHandle, readonly pairing: PairingManager }>
  }> {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-sync-server-peer-test-'))
    directories.push(directory)
    const database = createSqliteSyncDatabase({ filename: join(directory, 'sync.sqlite') })
    database.migrate()
    databases.push(database)
    await database.auth.provisionAccount({
      accountId: 'account-1',
      createdAt: 1,
      enabledModes: [mode],
      passwordHash: 'test-password-hash',
      requireEmpty: true,
      username: 'owner',
    })

    const objectStore = createFilesystemObjectStore({ root: join(directory, 'objects') })
    const server = await createSyncServerPeer({
      auth: database.auth,
      enabledModes: options.enabledModes,
      listenAddress: '/ip4/127.0.0.1/tcp/0/ws',
      objectStore,
      readOnly: options.readOnly,
      repository: database.repository,
      statePath: join(directory, 'server', 'identity.json'),
    })
    handles.push(server)

    let primaryCredentialHash = ''
    const clientRemoteHellos: SyncHello[] = []
    const addClient = async (input: { readonly deviceId: string, readonly changes?: SyncChange[], readonly received?: SyncChange[], readonly objectStore?: SyncObjectTransferStore }) => {
      const clientPairing = new PairingManager(
        { deviceId: input.deviceId, deviceName: input.deviceId, peerId: '' },
        new MemoryPairingStore(),
      )
      await clientPairing.load()
      const credentialValue = newDeviceCredential()
      const client = await createP2pNode({
        discovery: false,
        identity: clientPairing.identity,
        listenAddresses: ['/ip4/127.0.0.1/tcp/0/ws'],
        objectStore: input.objectStore,
        pairing: clientPairing,
        provider: providerWithChanges(
          input.changes ?? [],
          input.received,
          input.deviceId === 'client-device' ? clientRemoteHellos : undefined,
        ),
        reconnectIntervalMs: 60_000,
        server: {
          credential: credentialValue,
          generation: 0,
          membershipEpoch: 1,
          modes: [mode],
          peerId: server.application.localDevice().peerId,
          policyEpoch: 0,
        },
        transport: 'websocket',
      })
      handles.push(client)
      clientPairing.identity.peerId = client.status().peerId ?? ''

      const invitation = await server.application.createInvitation(1)
      const response = await clientPairing.acceptInvitation(invitation)
      const device = await server.application.completePairing(response.response)
      const credentialHash = hashDeviceCredential(credentialValue)
      await database.auth.createDeviceCredential({
        accountId: 'account-1',
        createdAt: Date.now(),
        credentialHash,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        expiresAt: Date.now() + 60_000,
        membershipEpoch: 1,
        pairingId: device.pairingId,
        peerId: device.peerId,
        scopes: ['sync', 'object'],
        sharedSecretHash: hashPairingSharedSecret(device.sharedSecret),
        signingPublicKey: device.signingPublicKey,
      })
      if (input.deviceId === 'client-device')
        primaryCredentialHash = credentialHash
      return { client, pairing: clientPairing }
    }

    const clientChanges: SyncChange[] = []
    const primary = await addClient({ changes: clientChanges, deviceId: 'client-device' })
    return {
      addClient,
      client: primary.client,
      clientChanges,
      clientDeviceId: primary.pairing.identity.deviceId,
      clientPairing: primary.pairing,
      clientRemoteHellos,
      credentialHash: primaryCredentialHash,
      database,
      objectStore,
      server,
    }
  }

  function providerWithChanges(
    changes: readonly SyncChange[],
    received: SyncChange[] = [],
    remoteHellos: SyncHello[] = [],
  ): SyncStateProvider {
    return {
      applyChanges: async (_namespace, incoming) => { received.push(...incoming) },
      getChanges: async (namespace, since) => changes.filter(change => (namespace === 'notes' ? change.kind === 'note-update' : change.kind === 'learning-mutation') && change.sequence > (since[change.deviceId] ?? 0)),
      getMembershipEpoch: () => 1,
      getVersionVector: namespace => ({ client: changes.filter(change => namespace === 'notes' ? change.kind === 'note-update' : change.kind === 'learning-mutation').length }),
      observeRemoteHello: async (hello) => { remoteHellos.push(hello) },
    }
  }

  it('authorizes a paired websocket device and persists its changes', async () => {
    const fixture = await createFixture('authoritative')
    const source = new LoroDoc()
    source.getMap('note').set('title', 'hello')
    source.commit()
    const change: SyncChange = {
      deviceId: fixture.clientDeviceId,
      id: 'authoritative-change',
      kind: 'note-update',
      payload: notePayload('authoritative-note', source.export({ mode: 'snapshot' })),
      sequence: 1,
    }
    fixture.clientChanges.push(change)
    const serverPeerId = fixture.server.application.localDevice().peerId
    const serverDevice = fixture.clientPairing.findByPeerId(serverPeerId)
    expect(serverDevice).toBeDefined()
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await fixture.client.syncPeer(serverPeerId, target)
    await expect(fixture.database.repository.listChanges('account-1', 'notes', 0, {}, 10)).resolves.toEqual([
      expect.objectContaining({ id: change.id, payload: change.payload, deviceId: change.deviceId }),
    ])
  })

  it('rejects an authoritative note envelope that cannot be materialized', async () => {
    const fixture = await createFixture('authoritative')
    fixture.clientChanges.push({
      deviceId: fixture.clientDeviceId,
      id: 'invalid-authoritative-note',
      kind: 'note-update',
      payload: Uint8Array.from([0xFF]),
      sequence: 1,
    })
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')

    await expect(fixture.client.syncPeer(fixture.server.application.localDevice().peerId, target)).rejects.toThrow()
    await expect(fixture.database.repository.listChanges('account-1', 'notes', 0, {}, 10)).resolves.toEqual([])
  })

  it('materializes learning entities and generation-zero tombstones', async () => {
    const fixture = await createFixture('authoritative')
    fixture.clientChanges.push({
      deviceId: fixture.clientDeviceId,
      id: 'learning-tombstone-change',
      kind: 'learning-mutation',
      payload: tombstonePayload('tombstone-1'),
      sequence: 1,
    })
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await fixture.client.syncPeer(fixture.server.application.localDevice().peerId, target)
    await expect(fixture.database.repository.listLearningEntities('account-1', 0)).resolves.toEqual([
      expect.objectContaining({ entityId: 'tombstone-1', entityKind: 'tombstone', operation: 'delete' }),
    ])
    await expect(fixture.database.repository.listLearningTombstones('account-1', 0)).resolves.toEqual([
      expect.objectContaining({ scopeKind: 'card', scopeId: 'card-1', tombstoneGeneration: 0 }),
    ])
  })

  it('rebuilds authoritative note snapshots from the durable change log after a crash window', async () => {
    const fixture = await createFixture('authoritative')
    const source = new LoroDoc()
    source.getMap('note').set('title', 'recover me')
    source.commit()
    fixture.clientChanges.push({
      deviceId: fixture.clientDeviceId,
      id: 'authoritative-note-snapshot',
      kind: 'note-update',
      payload: notePayload('note-1', source.export({ mode: 'snapshot' })),
      sequence: 1,
    })
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await fixture.client.syncPeer(fixture.server.application.localDevice().peerId, target)
    const before = await fixture.database.repository.getNoteSnapshot('account-1', 0, 'note-1')
    expect(before).not.toBeNull()
    fixture.database.database.prepare('DELETE FROM sync_note_snapshots').run()
    const account = await fixture.database.repository.getAccountState('account-1')
    if (!account)
      throw new Error('Sync account was not created')
    await rebuildAuthoritativeState(fixture.database.repository, account)
    const rebuilt = await fixture.database.repository.getNoteSnapshot('account-1', 0, 'note-1')
    expect(rebuilt).not.toBeNull()
    // Rebuild timestamps describe materialization time; CRDT content and identity are the recovery contract.
    expect(rebuilt).toMatchObject({
      accountId: before?.accountId,
      generation: before?.generation,
      noteId: before?.noteId,
      snapshot: before?.snapshot,
      frontier: before?.frontier,
    })
  })

  it('stores authoritative object bytes before accepting their manifest', async () => {
    const fixture = await createFixture('authoritative')
    const bytes = new TextEncoder().encode('authoritative asset bytes')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const manifest: SyncAssetManifest = {
      contentHash,
      contentLength: bytes.byteLength,
      contentType: 'text/plain',
      createdAt: Date.now(),
      deviceId: fixture.clientDeviceId,
      fileName: '00000000-0000-0000-0000-000000000001.txt',
      id: 'asset-manifest-1',
      operation: 'put',
      originalFileName: 'notes.txt',
      sequence: 1,
    }
    const prematureManifest = fixture.database.repository.appendAssetManifests('account-1', 0, [manifest])
    await expect(prematureManifest).rejects.toThrow('object must exist')
    const serverPeerId = fixture.server.application.localDevice().peerId
    const body = (async function* () {
      yield bytes
    })()
    await fixture.client.putObject(serverPeerId, manifest, body, undefined, fixture.server.multiaddrs)
    await expect(fixture.database.repository.appendAssetManifests('account-1', 0, [manifest])).resolves.toMatchObject({
      acceptedManifestIds: ['asset-manifest-1'],
    })
    const metadata = await fixture.database.repository.getObjectMetadata('account-1', 0, contentHash)
    if (metadata === null)
      throw new Error('Expected authoritative object metadata')
    await expect(fixture.objectStore.head('account-1', metadata.key)).resolves.toMatchObject({ contentHash })
  })

  it('does not persist relay object bytes or metadata', async () => {
    const fixture = await createFixture('relay')
    const bytes = new TextEncoder().encode('relay-only bytes')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const manifest: SyncAssetManifest = {
      contentHash,
      contentLength: bytes.byteLength,
      contentType: 'text/plain',
      createdAt: Date.now(),
      deviceId: fixture.clientDeviceId,
      fileName: '00000000-0000-0000-0000-000000000002.txt',
      id: 'relay-asset-manifest',
      operation: 'put',
      originalFileName: 'relay.txt',
      sequence: 1,
    }
    const serverPeerId = fixture.server.application.localDevice().peerId
    const body = (async function* () {
      yield bytes
    })()
    await fixture.client.putObject(serverPeerId, manifest, body, undefined, fixture.server.multiaddrs)
    await expect(fixture.database.repository.getObjectMetadata('account-1', 0, contentHash)).resolves.toBeNull()
    await expect(fixture.objectStore.list('account-1')).resolves.toEqual({ cursor: null, items: [] })
  })

  it('keeps relay payloads out of the authoritative repository', async () => {
    const fixture = await createFixture('relay')
    fixture.clientChanges.push({
      deviceId: fixture.clientDeviceId,
      id: 'relay-only-change',
      kind: 'learning-mutation',
      payload: tombstonePayload('relay-only-change'),
      sequence: 1,
    })
    const serverPeerId = fixture.server.application.localDevice().peerId
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await fixture.client.syncPeer(serverPeerId, target)
    const state = await fixture.database.repository.getAccountState('account-1')
    expect(state?.enabledModes).toEqual(['relay'])
    expect(await fixture.database.repository.listChanges('account-1', 'learning', 0, {}, 10)).toEqual([])
  })

  it('relays changes between authenticated peers while the destination connection remains online', async () => {
    const fixture = await createFixture('relay')
    const received: SyncChange[] = []
    const second = await fixture.addClient({ deviceId: 'second-device', received })
    const serverPeerId = fixture.server.application.localDevice().peerId
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await second.client.syncPeer(serverPeerId, target)
    const change: SyncChange = {
      deviceId: fixture.clientDeviceId,
      id: 'relayed-change',
      kind: 'note-update',
      payload: notePayload('relayed-note'),
      sequence: 1,
    }
    fixture.clientChanges.push(change)
    await fixture.client.syncPeer(serverPeerId, target)
    await second.client.syncPeer(serverPeerId, target)

    expect(received).toContainEqual(change)
    await expect(fixture.database.repository.listChanges('account-1', 'notes', 0, {}, 10)).resolves.toEqual([])
  })

  it('streams relay object bytes to online peers without retaining them', async () => {
    const fixture = await createFixture('relay')
    const received: Uint8Array[] = []
    const second = await fixture.addClient({
      deviceId: 'second-device',
      objectStore: {
        has: async () => false,
        put: async (_manifest, body) => {
          for await (const chunk of body)
            received.push(chunk)
        },
      },
    })
    const serverPeerId = fixture.server.application.localDevice().peerId
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await second.client.syncPeer(serverPeerId, target)
    const bytes = new TextEncoder().encode('relayed object bytes')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const manifest: SyncAssetManifest = {
      contentHash,
      contentLength: bytes.byteLength,
      contentType: 'text/plain',
      createdAt: Date.now(),
      deviceId: fixture.clientDeviceId,
      fileName: '00000000-0000-0000-0000-000000000003.txt',
      id: 'relayed-object-manifest',
      operation: 'put',
      originalFileName: 'relay.txt',
      sequence: 1,
    }
    const body = (async function* () {
      yield bytes
    })()
    await fixture.client.putObject(serverPeerId, manifest, body, undefined, target)

    expect(received).toEqual([bytes])
    await expect(fixture.database.repository.getObjectMetadata('account-1', 0, contentHash)).resolves.toBeNull()
    await expect(fixture.objectStore.list('account-1')).resolves.toEqual({ cursor: null, items: [] })
  })

  it('rejects a revoked device credential on the next sync session', async () => {
    const fixture = await createFixture('authoritative')
    await fixture.database.auth.revokeDeviceCredential('account-1', fixture.credentialHash, Date.now())
    const serverPeerId = fixture.server.application.localDevice().peerId
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await expect(fixture.client.syncPeer(serverPeerId, target)).rejects.toThrow()
  })

  it('reports an account reset before rejecting the stale membership epoch', async () => {
    const fixture = await createFixture('authoritative')
    await fixture.database.repository.requestGenerationReset('account-1', 0, 'reset-job', Date.now())
    const serverPeerId = fixture.server.application.localDevice().peerId
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')

    await expect(fixture.client.syncPeer(serverPeerId, target)).rejects.toThrow('account-data-reset')
    expect(fixture.clientRemoteHellos.at(-1)).toMatchObject({ generation: 1, membershipEpoch: 2 })
    await expect(fixture.database.auth.findDeviceCredential(fixture.credentialHash)).resolves.toMatchObject({ membershipEpoch: 2 })
  })

  it('reports a policy epoch change instead of silently closing the session', async () => {
    const fixture = await createFixture('authoritative')
    await fixture.database.repository.updateAccountPolicy('account-1', {
      enabledModes: ['relay'],
      expectedPolicyEpoch: 0,
      transition: 'retain-authoritative',
    })
    const serverPeerId = fixture.server.application.localDevice().peerId
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')

    await expect(fixture.client.syncPeer(serverPeerId, target)).rejects.toThrow('policy-epoch-stale')
  })

  it('keeps authoritative storage read-only during maintenance', async () => {
    const fixture = await createFixture('authoritative', { readOnly: true })
    fixture.clientChanges.push({
      deviceId: fixture.clientDeviceId,
      id: 'maintenance-change',
      kind: 'note-update',
      payload: notePayload('blocked-note'),
      sequence: 1,
    })
    const serverPeerId = fixture.server.application.localDevice().peerId
    const target = fixture.server.multiaddrs[0]
    if (!target)
      throw new Error('Server peer did not expose a WebSocket address')
    await expect(fixture.client.syncPeer(serverPeerId, target)).rejects.toThrow()
    await expect(fixture.database.repository.listChanges('account-1', 'notes', 0, {}, 10)).resolves.toEqual([])
  })
})
