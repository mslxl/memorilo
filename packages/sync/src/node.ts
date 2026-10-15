import type { Libp2p, PeerId, PrivateKey } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import type { Server } from 'node:http'
import type { DeviceSigningKeyStore } from './device-signing'
import type { DeviceId, PairedDevice, PairingInvitation, PairingMessage, PairingResponse, SyncAssetManifest, SyncChange, SyncDataNamespace, SyncError, SyncFrontiers, SyncHello, SyncMessage, SyncMode, SyncPeerRole, VersionVector } from './model'
import type { PairingManager } from './pairing'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { keys } from '@libp2p/crypto'
import { identify } from '@libp2p/identify'
import { mdns } from '@libp2p/mdns'
import { peerIdFromString } from '@libp2p/peer-id'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { decodeMemoriloProto, encodeMemoriloProto } from '@memorilo/sync-protocol'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import { JsonDeviceSigningKeyStore, loadOrCreateDeviceSigner, signDevicePayload, verifyDevicePayload, withoutDeviceSignature } from './device-signing'
import { decodeAssetManifest, decodeMessage, decodePairingMessage, encodeMessage, encodePairingMessage, maxSyncFrameBytes, validateAssetManifest } from './model'
import { decodePairingPayload, JsonPairingStore, pairingEmojiForSecret, PairingManager as PairingManagerClass } from './pairing'
import { sharedServerWebSockets } from './shared-server-websockets'

export type { DeviceSigner, DeviceSigningKeyStore } from './device-signing'
export { createDeviceSigner, generateDeviceSigningPrivateKey, JsonDeviceSigningKeyStore, loadOrCreateDeviceSigner, signDevicePayload, verifyDevicePayload } from './device-signing'
export type { LocalSyncChangeInput } from './journal'
export { ProtobufSyncJournal } from './journal'
export type { LocalDeviceIdentity, PairingStore } from './pairing'
export { decodePairingPayload, encodePairingPayload, JsonPairingStore, MemoryPairingStore, PairingManager, verifyPairingInvitation, verifyPairingResponse } from './pairing'

export const memoriloSyncProtocol = '/memorilo/sync/1'
export const memoriloPairingProtocol = '/memorilo/pairing/1'
export const memoriloObjectProtocol = '/memorilo/object/1'
export const maxSyncObjectBytes = 128 * 1024 * 1024
export const maxDeviceSignatureClockSkewMs = 5 * 60 * 1000

export interface SyncObjectPutRequest {
  readonly type: 'put-object'
  readonly protocol: 'memorilo-object/1'
  readonly deviceId: string
  readonly generation: number
  readonly membershipEpoch: number
  readonly policyEpoch: number
  readonly pairingId: string
  readonly sharedSecret: string
  readonly credential?: string
  readonly nonce: string
  readonly issuedAt: number
  readonly manifest: SyncAssetManifest
  readonly signature: string
}

export interface SyncObjectTransferStore {
  readonly has: (manifest: SyncAssetManifest, peer: PairedDevice) => Promise<boolean>
  readonly put: (manifest: SyncAssetManifest, body: AsyncIterable<Uint8Array>, peer: PairedDevice, request: SyncObjectPutRequest) => Promise<void>
}

export function verifySyncHelloSignature(hello: SyncHello, publicKey: string): boolean {
  const { signature, ...unsigned } = hello
  return verifyDevicePayload(publicKey, 'sync-hello', unsigned, signature)
}

export function verifySyncObjectRequestSignature(request: SyncObjectPutRequest, publicKey: string): boolean {
  const { signature, ...unsigned } = request
  return verifyDevicePayload(publicKey, 'sync-object-put', unsigned, signature)
}

export class SyncProtocolError extends Error {
  readonly code: SyncError['code']
  readonly action: SyncError['action']
  readonly retryable: boolean

  constructor(message: SyncError) {
    super(`Memorilo sync rejected: ${message.code}`)
    this.name = 'SyncProtocolError'
    this.code = message.code
    this.action = message.action
    this.retryable = message.retryable
  }
}

export interface SyncStateProvider {
  getVersionVector: (namespace: SyncDataNamespace) => VersionVector
  getVersionVectorAsync?: (namespace: SyncDataNamespace) => Promise<VersionVector>
  getMembershipEpoch: () => number
  getGeneration?: () => number
  getPolicyEpoch?: () => number
  getModes?: () => readonly SyncMode[]
  observeMembershipEpoch?: (epoch: number) => Promise<void>
  getChanges: (namespace: SyncDataNamespace, since: VersionVector) => Promise<readonly SyncChange[]>
  getChangesAsync?: (namespace: SyncDataNamespace, since: VersionVector) => Promise<readonly SyncChange[]>
  applyChanges: (namespace: SyncDataNamespace, changes: readonly SyncChange[], peer: PairedDevice, remoteMembershipEpoch: number) => Promise<void>
  applyChangesAsync?: (namespace: SyncDataNamespace, changes: readonly SyncChange[], peer: PairedDevice, remoteMembershipEpoch: number) => Promise<void>
  acknowledgeChanges?: (namespace: SyncDataNamespace, changeIds: readonly string[], peer: PairedDevice) => Promise<void>
  getAssetVersionVector?: () => Promise<VersionVector>
  getAssetManifests?: (since: VersionVector) => Promise<readonly SyncAssetManifest[]>
  prepareAssetManifestsForPeer?: (manifests: readonly SyncAssetManifest[], peer: PairedDevice) => Promise<void>
  applyAssetManifests?: (manifests: readonly SyncAssetManifest[], peer: PairedDevice, remoteMembershipEpoch: number) => Promise<void>
  acknowledgeAssetManifests?: (manifestIds: readonly string[], peer: PairedDevice) => Promise<void>
  observeRemoteHello?: (hello: SyncHello, peer: PairedDevice) => Promise<void>
  validateRemoteHello?: (hello: SyncHello, peer: PairedDevice) => Promise<void>
}

export interface SyncServerPeerTarget {
  readonly peerId: string
  readonly credential: string
  readonly generation: number
  readonly membershipEpoch: number
  readonly policyEpoch: number
  readonly modes: readonly ('relay' | 'authoritative')[]
}

export interface SyncObjectTransferContext {
  readonly generation: number
  readonly membershipEpoch: number
  readonly policyEpoch: number
  /** Server peers supply the account-scoped pairing because their clients do not share one global pairing namespace. */
  readonly paired?: PairedDevice
}

/**
 * Deterministic session barriers are useful to integration harnesses that need
 * to force a disconnect or cancellation at a protocol boundary.
 */
export interface SyncSessionHooks {
  readonly afterHello?: (hello: SyncHello, peer: PairedDevice, context: SyncSessionHookContext) => Promise<void> | void
  readonly beforeApplyBatch?: (message: Extract<SyncMessage, { type: 'changes' | 'asset-manifests' }>, peer: PairedDevice, context: SyncSessionHookContext) => Promise<void> | void
  readonly beforeAck?: (message: Extract<SyncMessage, { type: 'ack' | 'asset-ack' }>, peer: PairedDevice, context: SyncSessionHookContext) => Promise<void> | void
  readonly afterObjectPut?: (request: SyncObjectPutRequest, peer: PairedDevice, context: SyncSessionHookContext) => Promise<void> | void
}

export interface SyncSessionHookContext {
  readonly signal: AbortSignal
}

export interface P2pNodeOptions {
  readonly identity: {
    deviceId: DeviceId
    deviceName: string
  }
  readonly pairing: PairingManager
  readonly privateKey?: PrivateKey
  readonly provider?: SyncStateProvider
  readonly listenAddresses?: readonly string[]
  readonly dialTargets?: ReadonlyMap<string, unknown>
  /** Selects the transport set; desktop defaults to direct TCP, server peers use WebSocket. */
  readonly transport?: 'tcp' | 'websocket' | 'both'
  readonly sharedWebSocketServer?: Server
  readonly discovery?: boolean
  readonly now?: () => number
  readonly pairingAvailability?: () => number | null
  readonly pairingProbeIntervalMs?: number
  readonly reconnectIntervalMs?: number
  readonly maxReconnectAttempts?: number
  readonly maxReconnectDelayMs?: number
  readonly reconnectJitter?: () => number
  readonly sessionIdleTimeoutMs?: number
  readonly sessionTotalTimeoutMs?: number
  readonly onStatus?: (status: P2pNodeStatus) => void
  readonly onPeerDisconnected?: (peerId: string) => Promise<void> | void
  readonly onPairingMessage?: (message: PairingMessage, peerId: string) => Promise<void>
  readonly authorizeIncomingSync?: (peerId: string, hello: SyncHello, session: { readonly close: () => Promise<void>, readonly closed: Promise<void> }) => Promise<{
    readonly paired: PairedDevice
    readonly provider: SyncStateProvider
    readonly onClose?: () => Promise<void> | void
  } | null>
  readonly objectStore?: SyncObjectTransferStore
  readonly authorizeIncomingObject?: (peerId: string, request: SyncObjectPutRequest) => Promise<{
    readonly paired: PairedDevice
    readonly store: SyncObjectTransferStore
  } | null>
  readonly server?: SyncServerPeerTarget | (() => SyncServerPeerTarget | undefined)
  readonly role?: SyncPeerRole
  readonly sessionHooks?: SyncSessionHooks
}

export interface P2pNodeStatus {
  readonly state: 'stopped' | 'starting' | 'ready' | 'error'
  readonly peerId: string | null
  readonly connectedPeers: readonly string[]
  readonly devices: readonly P2pDeviceStatus[]
  readonly error: string | null
  readonly discoveredPeers: readonly { deviceId: string, deviceName: string, peerId: string }[]
}

export interface P2pDeviceStatus {
  readonly deviceId: string
  readonly deviceName: string
  readonly peerId: string
  readonly state: 'connecting' | 'syncing' | 'synced' | 'paused' | 'error'
  readonly error: string | null
}

type AutomaticSyncState
  = { readonly kind: 'blocked', readonly authorizationFingerprint: string }
    | { readonly kind: 'retry', readonly attempts: number, readonly nextAttemptAt: number }

export interface P2pNodeHandle {
  readonly node: Libp2p
  readonly multiaddrs: () => readonly Multiaddr[]
  readonly status: () => P2pNodeStatus
  readonly close: () => Promise<void>
  readonly notifyChangesAvailable: () => Promise<void>
  readonly syncPeer: (peerId: string, dialTarget?: unknown) => Promise<void>
  readonly requestPairing: (peerId: string) => Promise<{ deviceId: string, deviceName: string, peerId: string, requestId: string }>
  readonly sendPairingMessage: (peerId: string, message: PairingMessage) => Promise<void>
  readonly putObject: (peerId: string, manifest: SyncAssetManifest, body: AsyncIterable<Uint8Array>, context?: SyncObjectTransferContext, dialTarget?: unknown) => Promise<void>
}

export interface P2pApplicationOptions {
  readonly statePath: string
  readonly deviceName: string
  readonly now?: () => number
  readonly provider?: SyncStateProvider
  readonly onStatus?: (status: P2pNodeStatus) => void
  readonly listenAddresses?: readonly string[]
  readonly transport?: P2pNodeOptions['transport']
  readonly sharedWebSocketServer?: Server
  readonly discovery?: boolean
  readonly dialTargets?: ReadonlyMap<string, unknown>
  readonly authorizeIncomingSync?: P2pNodeOptions['authorizeIncomingSync']
  readonly objectStore?: SyncObjectTransferStore
  readonly authorizeIncomingObject?: P2pNodeOptions['authorizeIncomingObject']
  readonly server?: SyncServerPeerTarget | (() => SyncServerPeerTarget | undefined)
  readonly role?: SyncPeerRole
  readonly signingKeyStore?: DeviceSigningKeyStore
  readonly onPeerDisconnected?: P2pNodeOptions['onPeerDisconnected']
  readonly persistCompletedPairings?: boolean
  readonly reconnectIntervalMs?: number
  readonly maxReconnectAttempts?: number
  readonly maxReconnectDelayMs?: number
  readonly reconnectJitter?: () => number
  readonly sessionIdleTimeoutMs?: number
  readonly sessionTotalTimeoutMs?: number
  readonly sessionHooks?: SyncSessionHooks
}

export interface P2pApplication {
  readonly pairing: PairingManager
  readonly localDevice: () => { deviceId: DeviceId, deviceName: string, peerId: string }
  readonly multiaddrs: () => readonly Multiaddr[]
  readonly updateDeviceName: (deviceName: string) => Promise<void>
  readonly status: () => P2pNodeStatus
  readonly createInvitation: (membershipEpoch?: number) => Promise<string>
  readonly acceptInvitation: (invitation: string, dialTarget?: unknown) => Promise<string>
  readonly completePairing: (response: string) => Promise<PairedDevice>
  readonly removeDevice: (deviceId: DeviceId) => Promise<void>
  readonly observeMembershipEpoch: (epoch: number) => Promise<void>
  readonly membershipEpoch: () => number
  readonly enableDiscovery: () => Promise<number>
  readonly discoveryEnabled: () => boolean
  readonly discoveredPeers: () => readonly { deviceId: string, deviceName: string, peerId: string }[]
  readonly requestPairing: (peerId: string) => Promise<{ requestId: string, deviceId: string, deviceName: string, peerId: string }>
  readonly listPairingRequests: () => readonly { requestId: string, deviceId: string, deviceName: string, peerId: string, emoji: string }[]
  readonly notifyChangesAvailable: () => Promise<void>
  readonly putObject: P2pNodeHandle['putObject']
  readonly approvePairing: (requestId: string) => Promise<string>
  readonly confirmPairing: (requestId: string, emoji: string) => Promise<PairedDevice | null>
  readonly close: () => Promise<void>
}

interface P2pState {
  readonly deviceId: DeviceId
  deviceName: string
  membershipEpoch: number
  readonly privateKey: string
  pendingInvitations: Record<string, PendingInvitation>
}

interface PendingInvitation {
  readonly expiresAt: number
  readonly sharedSecret: string
}

export interface SyncStream {
  readonly send: (data: Uint8Array) => boolean
  readonly onDrain?: () => Promise<void>
  readonly [Symbol.asyncIterator]: () => AsyncIterator<unknown>
  readonly close?: () => Promise<void>
}

interface CloseEventStream {
  readonly addEventListener?: (type: 'close', listener: () => void) => void
  readonly removeEventListener?: (type: 'close', listener: () => void) => void
}

function abortOnStreamClose(stream: SyncStream, controller: AbortController): () => void {
  const eventful = stream as SyncStream & CloseEventStream
  if (eventful.addEventListener === undefined)
    return () => undefined
  const listener = (): void => controller.abort()
  eventful.addEventListener('close', listener)
  return () => eventful.removeEventListener?.('close', listener)
}

interface TimedSyncStream {
  readonly run: <Value>(operation: (stream: SyncStream) => Promise<Value>) => Promise<Value>
}

function createTimedSyncStream(stream: SyncStream, idleTimeoutMs: number, totalTimeoutMs: number, onExpire?: () => void): TimedSyncStream {
  let finished = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let totalTimer: ReturnType<typeof setTimeout> | undefined
  let rejectExpiration!: (error: Error) => void
  const expiration = new Promise<never>((_resolve, reject) => {
    rejectExpiration = reject
  })
  const clearTimers = (): void => {
    if (idleTimer !== undefined)
      clearTimeout(idleTimer)
    if (totalTimer !== undefined)
      clearTimeout(totalTimer)
  }
  const expire = (message: string): void => {
    if (finished)
      return
    finished = true
    clearTimers()
    onExpire?.()
    const error = new Error(message)
    error.name = 'TimeoutError'
    void stream.close?.().catch(() => undefined)
    rejectExpiration(error)
  }
  const touch = (): void => {
    if (finished)
      return
    if (idleTimer !== undefined)
      clearTimeout(idleTimer)
    idleTimer = setTimeout(() => expire('Memorilo sync session exceeded its idle deadline'), idleTimeoutMs)
  }
  touch()
  totalTimer = setTimeout(() => expire('Memorilo sync session exceeded its total deadline'), totalTimeoutMs)
  const timed: SyncStream = {
    ...(stream.close === undefined ? {} : { close: () => stream.close!() }),
    ...(stream.onDrain === undefined
      ? {}
      : {
          onDrain: async () => {
            await Promise.race([stream.onDrain!(), expiration])
            touch()
          },
        }),
    send: (data) => {
      const accepted = stream.send(data)
      touch()
      return accepted
    },
    [Symbol.asyncIterator]: () => {
      const iterator = stream[Symbol.asyncIterator]()
      return {
        next: async () => {
          const result = await Promise.race([iterator.next(), expiration])
          touch()
          return result
        },
      }
    },
  }
  return {
    run: async (operation) => {
      try {
        return await Promise.race([operation(timed), expiration])
      }
      finally {
        finished = true
        clearTimers()
      }
    },
  }
}

function bytesFromChunk(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array)
    return chunk
  if (typeof chunk === 'object' && chunk !== null && 'subarray' in chunk && typeof chunk.subarray === 'function')
    return chunk.subarray()
  throw new TypeError('Unsupported libp2p stream chunk')
}

interface MessageReader {
  readonly read: () => Promise<SyncMessage>
}

interface ChunkReader {
  readonly readExact: (length: number, endedMessage: string) => Promise<Uint8Array>
  readonly readSome: (maximum: number, endedMessage: string) => Promise<Uint8Array>
}

function createChunkReader(stream: SyncStream, maximumChunkBytes: number): ChunkReader {
  const iterator = stream[Symbol.asyncIterator]()
  const chunks: Uint8Array[] = []
  let offset = 0

  const readSome = async (maximum: number, endedMessage: string): Promise<Uint8Array> => {
    if (!Number.isSafeInteger(maximum) || maximum <= 0)
      throw new RangeError('Invalid framed read length')
    while (chunks.length > 0) {
      const current = chunks[0]!
      if (offset < current.byteLength) {
        const size = Math.min(maximum, current.byteLength - offset)
        const result = current.slice(offset, offset + size)
        offset += size
        if (offset >= current.byteLength) {
          chunks.shift()
          offset = 0
        }
        return result
      }
      chunks.shift()
      offset = 0
    }
    const result = await iterator.next()
    if (result.done)
      throw new Error(endedMessage)
    const chunk = bytesFromChunk(result.value)
    if (chunk.byteLength === 0)
      return readSome(maximum, endedMessage)
    if (chunk.byteLength > maximumChunkBytes)
      throw new RangeError('Memorilo sync stream chunk exceeds the maximum buffered size')
    const size = Math.min(maximum, chunk.byteLength)
    if (size < chunk.byteLength)
      chunks.unshift(chunk.slice(size))
    return chunk.slice(0, size)
  }

  const take = (length: number): Uint8Array | null => {
    while (chunks.length > 0) {
      const current = chunks[0]!
      const available = current.byteLength - offset
      if (available <= 0) {
        chunks.shift()
        offset = 0
        continue
      }
      const size = Math.min(length, available)
      const result = current.slice(offset, offset + size)
      offset += size
      if (offset >= current.byteLength) {
        chunks.shift()
        offset = 0
      }
      return result
    }
    return null
  }

  return {
    readSome,
    readExact: async (length, endedMessage) => {
      if (!Number.isSafeInteger(length) || length < 0)
        throw new RangeError('Invalid framed read length')
      const result = new Uint8Array(length)
      let written = 0
      while (written < length) {
        const part = take(length - written) ?? await readSome(length - written, endedMessage)
        const size = Math.min(part.byteLength, length - written)
        result.set(part.subarray(0, size), written)
        written += size
        if (size < part.byteLength) {
          chunks.unshift(part.slice(size))
          offset = 0
        }
      }
      return result
    },
  }
}

async function readFrame(reader: ChunkReader, maximum: number, endedMessage: string, tooLargeMessage: string): Promise<Uint8Array> {
  const header = await reader.readExact(4, endedMessage)
  const frameLength = new DataView(header.buffer, header.byteOffset, 4).getUint32(0)
  if (frameLength > maximum)
    throw new RangeError(tooLargeMessage)
  return reader.readExact(frameLength, endedMessage)
}

function createMessageReader(stream: SyncStream): MessageReader {
  const reader = createChunkReader(stream, maxSyncFrameBytes + 4)

  return {
    read: async () => {
      return decodeMessage(await readFrame(reader, maxSyncFrameBytes, 'Peer closed the sync stream before sending a message', 'Memorilo sync message exceeds the maximum frame size'))
    },
  }
}

function createPairingReader(stream: SyncStream): { read: () => Promise<PairingMessage> } {
  const reader = createChunkReader(stream, maxSyncFrameBytes + 4)
  return {
    read: async () => decodePairingMessage(await readFrame(reader, maxSyncFrameBytes, 'Peer closed the pairing stream', 'Memorilo pairing message exceeds the maximum frame size')),
  }
}

type ObjectTransferResponse
  = { readonly type: 'ready' | 'exists' | 'complete' }
    | { readonly type: 'error', readonly code: string }

interface ObjectStreamReader {
  readonly readFrame: <Value>() => Promise<Value>
  readonly readBody: (length: number) => AsyncIterable<Uint8Array>
}

function createObjectStreamReader(stream: SyncStream): ObjectStreamReader {
  const reader = createChunkReader(stream, maxSyncObjectBytes + 4)
  let bodyActive = false
  return {
    readBody: (length) => {
      if (bodyActive)
        throw new Error('Object stream body is already being consumed')
      if (!Number.isSafeInteger(length) || length < 0 || length > maxSyncObjectBytes)
        throw new RangeError('Memorilo object body exceeds the maximum object size')
      bodyActive = true
      return (async function* () {
        try {
          let remaining = length
          while (remaining > 0) {
            const chunk = await reader.readSome(remaining, 'Peer closed the object stream before completing the transfer')
            yield chunk
            remaining -= chunk.byteLength
          }
        }
        finally {
          bodyActive = false
        }
      })()
    },
    readFrame: async <Value>() => {
      if (bodyActive)
        throw new Error('Object stream body must finish before reading another frame')
      const frame = await readFrame(reader, 64 * 1024, 'Peer closed the object stream before completing the transfer', 'Memorilo object header exceeds the maximum frame size')
      const decoded = decodeMemoriloProto('ObjectFrame', frame) as any
      if (decoded.put !== undefined)
        return decoded.put as Value
      if (decoded.response !== undefined)
        return decoded.response as Value
      throw new TypeError('Memorilo object frame has no body')
    },
  }
}

function exactObjectKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  if (required.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !allowed.has(key)))
    throw new TypeError('Memorilo object request has invalid fields')
}

function decodeObjectPutRequest(value: unknown): SyncObjectPutRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Memorilo object request must be an object')
  const record = value as Record<string, unknown>
  if (record.manifest && typeof record.manifest === 'object' && (record.manifest as any).contentHash instanceof Uint8Array) {
    const manifest = record.manifest as any
    record.manifest = {
      ...manifest,
      contentHash: manifest.contentHash.length === 0 ? null : Buffer.from(manifest.contentHash).toString('hex'),
      contentLength: manifest.contentLength === undefined ? null : Number(manifest.contentLength),
      contentType: manifest.contentType === undefined ? null : String(manifest.contentType),
    }
  }
  exactObjectKeys(record, ['type', 'protocol', 'deviceId', 'generation', 'membershipEpoch', 'policyEpoch', 'pairingId', 'sharedSecret', 'nonce', 'issuedAt', 'manifest', 'signature'], ['credential', 'body'])
  if (record.type !== 'put-object' || record.protocol !== 'memorilo-object/1')
    throw new TypeError('Memorilo object protocol is invalid')
  const manifest = decodeAssetManifest(record.manifest)
  const strings = ['deviceId', 'pairingId', 'sharedSecret', 'nonce', 'signature'] as const
  if (strings.some(key => typeof record[key] !== 'string' || record[key].length === 0))
    throw new TypeError('Memorilo object identity fields are invalid')
  const integers = ['generation', 'membershipEpoch', 'policyEpoch', 'issuedAt'] as const
  if (integers.some(key => !Number.isSafeInteger(record[key]) || (record[key] as number) < 0))
    throw new TypeError('Memorilo object epoch fields are invalid')
  if (record.credential !== undefined && (typeof record.credential !== 'string' || record.credential.length === 0))
    throw new TypeError('Memorilo object credential is invalid')
  return {
    ...(record.credential === undefined ? {} : { credential: record.credential as string }),
    deviceId: record.deviceId as string,
    generation: record.generation as number,
    issuedAt: record.issuedAt as number,
    manifest,
    membershipEpoch: record.membershipEpoch as number,
    nonce: record.nonce as string,
    pairingId: record.pairingId as string,
    policyEpoch: record.policyEpoch as number,
    protocol: 'memorilo-object/1',
    sharedSecret: record.sharedSecret as string,
    signature: record.signature as string,
    type: 'put-object',
  }
}

function decodeObjectResponse(value: unknown): ObjectTransferResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Memorilo object response must be an object')
  const record = value as Record<string, unknown>
  if (record.type === 'error') {
    if (typeof record.code !== 'string' || record.code.length === 0)
      throw new TypeError('Memorilo object error code is invalid')
    return { code: record.code, type: 'error' }
  }
  if (record.type !== 'ready' && record.type !== 'exists' && record.type !== 'complete')
    throw new TypeError('Memorilo object response type is invalid')
  return { type: record.type }
}

async function writeObjectFrame(stream: SyncStream, value: SyncObjectPutRequest | ObjectTransferResponse): Promise<void> {
  const body = 'type' in value && value.type === 'put-object'
    ? encodeMemoriloProto('ObjectFrame', { put: {
        credential: value.credential,
        deviceId: value.deviceId,
        generation: value.generation,
        issuedAt: value.issuedAt,
        manifest: {
          contentHash: value.manifest.contentHash === null ? undefined : Uint8Array.from(Buffer.from(value.manifest.contentHash, 'hex')),
          contentLength: value.manifest.contentLength ?? undefined,
          contentType: value.manifest.contentType ?? undefined,
          createdAt: value.manifest.createdAt,
          deviceId: value.manifest.deviceId,
          fileName: value.manifest.fileName,
          id: value.manifest.id,
          operation: value.manifest.operation,
          originalFileName: value.manifest.originalFileName,
          sequence: value.manifest.sequence,
        },
        membershipEpoch: value.membershipEpoch,
        nonce: value.nonce,
        pairingId: value.pairingId,
        policyEpoch: value.policyEpoch,
        protocol: value.protocol,
        sharedSecret: value.sharedSecret,
        signature: value.signature,
        type: value.type,
      } })
    : encodeMemoriloProto('ObjectFrame', { response: value })
  if (body.byteLength > 64 * 1024)
    throw new RangeError('Memorilo object header exceeds the maximum frame size')
  const frame = new Uint8Array(body.byteLength + 4)
  new DataView(frame.buffer).setUint32(0, body.byteLength)
  frame.set(body, 4)
  if (!stream.send(frame))
    await stream.onDrain?.()
}

async function writeMessage(stream: SyncStream, message: SyncMessage): Promise<void> {
  if (!stream.send(encodeMessage(message)))
    await stream.onDrain?.()
}

async function writePairingMessage(stream: SyncStream, message: PairingMessage): Promise<void> {
  if (!stream.send(encodePairingMessage(message)))
    await stream.onDrain?.()
}

function peerString(peer: PeerId | string): string {
  return typeof peer === 'string' ? peer : peer.toString()
}

function resolveDialTarget(peerId: string, discoveredTarget?: unknown, configuredTargets?: ReadonlyMap<string, unknown>): unknown {
  const target = discoveredTarget ?? configuredTargets?.get(peerId)
  if (typeof target === 'string' && (target.startsWith('ws://') || target.startsWith('wss://')))
    return syncServerDialTarget(target)
  return target ?? peerIdFromString(peerId)
}

export function syncServerDialTarget(serverUrl: string): unknown {
  const url = new URL(serverUrl)
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:')
    throw new TypeError('Sync server URL must use ws:// or wss://')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new TypeError('Sync server URL must contain only a WebSocket origin')
  const host = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  const addressProtocol = host.includes(':')
    ? 'ip6'
    : /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host)
      ? 'ip4'
      : 'dns'
  const port = url.port || (url.protocol === 'wss:' ? '443' : '80')
  return multiaddr(`/${addressProtocol}/${host}/tcp/${port}${url.protocol === 'wss:' ? '/tls' : ''}/ws`)
}

function isNoValidAddressesError(error: unknown): boolean {
  // libp2p does not export this dial error from its public interface package.
  return error instanceof Error && error.name === 'NoValidAddressesError'
}

function isTransientConnectionError(error: unknown): boolean {
  if (error instanceof AggregateError && error.message === 'All multiaddr dials failed')
    return true
  // The WebSocket transport reports connection refusal as an opaque ErrorEvent.
  if (error instanceof Event && error.type === 'error')
    return true
  if (isNoValidAddressesError(error))
    return true
  if (!(error instanceof Error))
    return false
  return ['AbortError', 'ConnectionClosedError', 'ConnectionClosingError', 'DialError', 'StreamAbortedError', 'StreamClosedError', 'StreamStateError', 'TimeoutError'].includes(error.name)
}

function normalizeDeviceName(deviceName: string): string {
  const normalized = deviceName.trim()
  if (normalized.length === 0)
    throw new TypeError('Device name must not be empty')
  if (normalized.length > 80)
    throw new RangeError('Device name must not exceed 80 characters')
  if (/\p{Cc}/u.test(normalized))
    throw new TypeError('Device name must not contain control characters')
  return normalized
}

export async function createP2pNode(options: P2pNodeOptions): Promise<P2pNodeHandle> {
  const now = options.now ?? Date.now
  const reconnectIntervalMs = options.reconnectIntervalMs ?? 5_000
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 6
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? 60_000
  const sessionIdleTimeoutMs = options.sessionIdleTimeoutMs ?? 30_000
  const sessionTotalTimeoutMs = options.sessionTotalTimeoutMs ?? 120_000
  if (!Number.isSafeInteger(reconnectIntervalMs) || reconnectIntervalMs < 1)
    throw new RangeError('Reconnect interval must be a positive safe integer')
  if (!Number.isSafeInteger(maxReconnectAttempts) || maxReconnectAttempts < 1)
    throw new RangeError('Maximum reconnect attempts must be a positive safe integer')
  if (!Number.isSafeInteger(maxReconnectDelayMs) || maxReconnectDelayMs < reconnectIntervalMs)
    throw new RangeError('Maximum reconnect delay must be a safe integer no smaller than the reconnect interval')
  if (!Number.isSafeInteger(sessionIdleTimeoutMs) || sessionIdleTimeoutMs < 1)
    throw new RangeError('Sync session idle timeout must be a positive safe integer')
  if (!Number.isSafeInteger(sessionTotalTimeoutMs) || sessionTotalTimeoutMs < sessionIdleTimeoutMs)
    throw new RangeError('Sync session total timeout must be a safe integer no smaller than its idle timeout')
  let currentStatus: P2pNodeStatus = {
    connectedPeers: [],
    devices: [],
    discoveredPeers: [],
    error: null,
    peerId: null,
    state: 'starting',
  }
  const updateStatus = (patch: Partial<P2pNodeStatus>) => {
    currentStatus = { ...currentStatus, ...patch }
    options.onStatus?.(currentStatus)
  }
  const transportMode = options.transport ?? 'tcp'
  const transports = [
    ...(transportMode === 'tcp' || transportMode === 'both' ? [tcp()] : []),
    ...(transportMode === 'websocket' || transportMode === 'both'
      ? [options.sharedWebSocketServer === undefined ? webSockets() : sharedServerWebSockets(options.sharedWebSocketServer)]
      : []),
  ]
  const node = await createLibp2p({
    ...(options.privateKey === undefined ? {} : { privateKey: options.privateKey }),
    addresses: { listen: [...(options.listenAddresses ?? ['/ip4/0.0.0.0/tcp/0'])] },
    connectionEncrypters: [noise()],
    peerDiscovery: options.discovery === false ? [] : [mdns()],
    services: { identify: identify() },
    // The transport packages currently publish slightly different interface patch versions.
    // Their runtime contracts are compatible; keep the shared node API independent of that type duplication.
    streamMuxers: [yamux() as never],
    transports,
  })
  updateStatus({ peerId: node.peerId.toString(), state: 'ready' })

  const connected = new Set<string>()
  const discoveredPeers = new Map<string, { deviceId: string, deviceName: string, expiresAt: number, peerId: string }>()
  const discoveredTargets = new Map<string, unknown>()
  const advertisedPairingPeers = new Map<string, number>()
  const pairingProbes = new Map<string, { requestId: string, sentAt: number }>()
  const dialing = new Set<string>()
  const connectedOnce = new Set<string>()
  const activeSyncs = new Map<string, Promise<void>>()
  const syncSchedules = new Map<string, { dirty: boolean, running: Promise<void> | null }>()
  const automaticSyncStates = new Map<string, AutomaticSyncState>()
  const deviceStates = new Map<string, Pick<P2pDeviceStatus, 'error' | 'state'>>()
  const isConfiguredServerPeer = (peerId: string): boolean => {
    const configuredServer = typeof options.server === 'function' ? options.server() : options.server
    return configuredServer?.peerId === peerId
  }
  const shouldInitiate = (peerId: string): boolean => {
    // A configured server cannot discover and dial an individual client, so
    // the client owns reconnection regardless of the peers' lexical ordering.
    return isConfiguredServerPeer(peerId) || node.peerId.toString() < peerId
  }
  const authorizationFingerprint = (peerId: string): string => {
    const paired = options.pairing.findByPeerId(peerId)
    const configuredServer = typeof options.server === 'function' ? options.server() : options.server
    const server = configuredServer?.peerId === peerId ? configuredServer : undefined
    return createHash('sha256').update(JSON.stringify({
      pairingId: paired?.pairingId ?? null,
      sharedSecret: paired?.sharedSecret ?? null,
      server: server === undefined
        ? null
        : {
            credential: server.credential,
            generation: server.generation,
            membershipEpoch: server.membershipEpoch,
            modes: server.modes,
            policyEpoch: server.policyEpoch,
          },
    })).digest('base64url')
  }
  const canAutomaticallySync = (peerId: string): boolean => {
    const state = automaticSyncStates.get(peerId)
    if (state === undefined)
      return true
    if (state.kind === 'retry')
      return now() >= state.nextAttemptAt
    if (state.authorizationFingerprint === authorizationFingerprint(peerId))
      return false
    automaticSyncStates.delete(peerId)
    return true
  }
  const recordAutomaticSyncFailure = (peerId: string, error: unknown, attemptFingerprint: string): void => {
    if (!isTransientConnectionError(error)) {
      automaticSyncStates.set(peerId, { authorizationFingerprint: attemptFingerprint, kind: 'blocked' })
      return
    }
    const previous = automaticSyncStates.get(peerId)
    const attempts = previous?.kind === 'retry' ? previous.attempts + 1 : 1
    if (attempts >= maxReconnectAttempts && !isConfiguredServerPeer(peerId)) {
      automaticSyncStates.set(peerId, { authorizationFingerprint: attemptFingerprint, kind: 'blocked' })
      return
    }
    // A configured server has no discovery event that could unblock a client
    // after an outage, so keep retrying with a bounded maximum backoff.
    const backoffStep = Math.min(attempts, maxReconnectAttempts)
    const jitter = Math.min(1, Math.max(0, options.reconnectJitter?.() ?? Math.random()))
    const exponentialDelay = Math.min(maxReconnectDelayMs, reconnectIntervalMs * 2 ** (backoffStep - 1))
    automaticSyncStates.set(peerId, {
      attempts: backoffStep,
      kind: 'retry',
      nextAttemptAt: now() + Math.round(exponentialDelay * (0.5 + jitter)),
    })
  }
  const authorizedConnectedPeers = (): readonly string[] => [...connected].filter(peerId => options.pairing.findByPeerId(peerId) !== undefined)
  const deviceStatuses = (): readonly P2pDeviceStatus[] => [...deviceStates.entries()].flatMap(([peerId, status]) => {
    const device = options.pairing.findByPeerId(peerId)
    return device === undefined
      ? []
      : [{
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          error: status.error,
          peerId,
          state: status.state,
        }]
  })
  const updateDeviceStatus = (
    peerId: string,
    state: P2pDeviceStatus['state'],
    error: string | null = null,
  ): void => {
    if (options.pairing.findByPeerId(peerId) === undefined)
      return
    deviceStates.set(peerId, { error, state })
    updateStatus({ devices: deviceStatuses() })
  }
  const availablePeers = (): readonly { deviceId: string, deviceName: string, peerId: string }[] => {
    const currentTime = now()
    const available: { deviceId: string, deviceName: string, peerId: string }[] = []
    for (const [peerId, peer] of discoveredPeers) {
      if (peer.expiresAt <= currentTime || options.pairing.findByPeerId(peerId) !== undefined) {
        discoveredPeers.delete(peerId)
        continue
      }
      available.push({ deviceId: peer.deviceId, deviceName: peer.deviceName, peerId: peer.peerId })
    }
    return available
  }
  const updateDiscoveredPeers = (): void => updateStatus({ discoveredPeers: availablePeers() })
  const requireType = <T extends Exclude<SyncMessage['type'], 'error'>>(message: SyncMessage, type: T): Extract<SyncMessage, { type: T }> => {
    if (message.type === 'error')
      throw new SyncProtocolError(message)
    if (message.type !== type)
      throw new Error(`Expected ${type} message, received ${message.type}`)
    return message as Extract<SyncMessage, { type: T }>
  }
  const protocolError = (error: unknown): SyncError => {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('sync-credential-revoked'))
      return { action: 're-pair', code: 'credential-revoked', retryable: false, type: 'error' }
    if (message.includes('sync-generation-stale') || message.includes('sync-account-data-reset'))
      return { action: 'bootstrap', code: 'account-data-reset', retryable: false, type: 'error' }
    if (message.includes('sync-membership-epoch-stale'))
      return { action: 're-pair', code: 'membership-epoch-stale', retryable: false, type: 'error' }
    if (message.includes('sync-policy-epoch-stale'))
      return { action: 'administrator-action', code: 'policy-epoch-stale', retryable: false, type: 'error' }
    if (message.includes('sync-mode-disabled'))
      return { action: 'administrator-action', code: 'mode-disabled', retryable: false, type: 'error' }
    if (message.includes('rate-limit'))
      return { action: 'retry', code: 'rate-limited', retryable: true, type: 'error' }
    if (error instanceof TypeError || error instanceof RangeError || message.includes('protocol') || message.includes('Expected '))
      return { action: 'administrator-action', code: 'protocol-invalid', retryable: false, type: 'error' }
    return { action: 'retry', code: 'server-failure', retryable: true, type: 'error' }
  }
  const dataNamespaces = ['notes', 'learning'] as const satisfies readonly SyncDataNamespace[]
  const getVersionVector = async (provider: SyncStateProvider, namespace: SyncDataNamespace): Promise<VersionVector> => provider.getVersionVectorAsync?.(namespace) ?? provider.getVersionVector(namespace)
  const getFrontiers = async (provider: SyncStateProvider): Promise<SyncFrontiers> => {
    const [notes, learning, assets] = await Promise.all([
      getVersionVector(provider, 'notes'),
      getVersionVector(provider, 'learning'),
      provider.getAssetVersionVector?.() ?? {},
    ])
    return { assets, learning, notes }
  }
  const supportsAssetSync = (provider: SyncStateProvider): boolean => provider.getAssetVersionVector !== undefined
    && provider.getAssetManifests !== undefined
    && provider.applyAssetManifests !== undefined
  const getChanges = async (provider: SyncStateProvider, namespace: SyncDataNamespace, since: VersionVector): Promise<readonly SyncChange[]> => provider.getChangesAsync?.(namespace, since) ?? provider.getChanges(namespace, since)
  const applyProviderChanges = async (provider: SyncStateProvider, namespace: SyncDataNamespace, changes: readonly SyncChange[], paired: PairedDevice, remoteMembershipEpoch: number): Promise<void> => {
    await (provider.applyChangesAsync?.(namespace, changes, paired, remoteMembershipEpoch)
      ?? provider.applyChanges(namespace, changes, paired, remoteMembershipEpoch))
  }
  const acknowledge = async (provider: SyncStateProvider | undefined, namespace: SyncDataNamespace, changeIds: readonly string[], paired: PairedDevice): Promise<void> => {
    await provider?.acknowledgeChanges?.(namespace, changeIds, paired)
  }
  const applyChanges = async (provider: SyncStateProvider, changes: Extract<SyncMessage, { type: 'changes' }>, paired: PairedDevice): Promise<void> => {
    await options.pairing.updateDeviceName(paired.peerId, changes.deviceName)
    await provider.observeMembershipEpoch?.(changes.membershipEpoch)
    await applyProviderChanges(provider, changes.namespace, changes.changes, paired, changes.membershipEpoch)
  }
  const createHello = async (provider: SyncStateProvider, paired: PairedDevice): Promise<SyncHello> => {
    const configuredServer = typeof options.server === 'function' ? options.server() : options.server
    const server = configuredServer?.peerId === paired.peerId ? configuredServer : undefined
    const unsigned: Omit<SyncHello, 'signature'> = {
      deviceId: options.identity.deviceId,
      deviceName: options.identity.deviceName,
      frontiers: await getFrontiers(provider),
      generation: server?.generation ?? provider.getGeneration?.() ?? 0,
      issuedAt: now(),
      membershipEpoch: server?.membershipEpoch ?? provider.getMembershipEpoch(),
      modes: server?.modes ?? provider.getModes?.() ?? ['direct'],
      namespaces: supportsAssetSync(provider) ? ['notes', 'learning', 'assets'] : ['notes', 'learning'],
      nonce: randomUUID(),
      pairingId: paired.pairingId,
      policyEpoch: server?.policyEpoch ?? provider.getPolicyEpoch?.() ?? 0,
      protocol: 'memorilo-sync/1',
      role: options.role ?? 'device',
      sharedSecret: paired.sharedSecret,
      ...(server === undefined ? {} : { credential: server.credential }),
      type: 'hello',
    }
    return {
      ...unsigned,
      signature: signDevicePayload(options.pairing.signer, 'sync-hello', unsigned),
    }
  }
  // A configured sync server has its own membership epoch; direct peers use the local P2P epoch.
  const getMembershipEpochForPeer = (paired: PairedDevice): number => {
    const configuredServer = typeof options.server === 'function' ? options.server() : options.server
    if (configuredServer?.peerId === paired.peerId)
      return configuredServer.membershipEpoch
    return options.provider?.getMembershipEpoch?.() ?? options.pairing.identity.membershipEpoch ?? 1
  }
  const createObjectRequest = (peerId: string, manifest: SyncAssetManifest, context?: SyncObjectTransferContext): SyncObjectPutRequest => {
    validateAssetManifest(manifest)
    if (manifest.operation !== 'put' || manifest.contentLength === null || manifest.contentLength > maxSyncObjectBytes)
      throw new RangeError(`Sync object must be a put manifest no larger than ${maxSyncObjectBytes} bytes`)
    const paired = context?.paired ?? options.pairing.findByPeerId(peerId)
    if (!paired || paired.peerId !== peerId)
      throw new Error('Cannot transfer an object to an unpaired peer')
    const configuredServer = typeof options.server === 'function' ? options.server() : options.server
    const server = configuredServer?.peerId === peerId ? configuredServer : undefined
    const unsigned: Omit<SyncObjectPutRequest, 'signature'> = {
      ...(server === undefined ? {} : { credential: server.credential }),
      deviceId: options.identity.deviceId,
      generation: server?.generation ?? context?.generation ?? options.provider?.getGeneration?.() ?? 0,
      issuedAt: now(),
      manifest,
      membershipEpoch: server?.membershipEpoch ?? context?.membershipEpoch ?? options.provider?.getMembershipEpoch() ?? options.pairing.identity.membershipEpoch ?? 1,
      nonce: randomUUID(),
      pairingId: paired.pairingId,
      policyEpoch: server?.policyEpoch ?? context?.policyEpoch ?? options.provider?.getPolicyEpoch?.() ?? 0,
      protocol: 'memorilo-object/1',
      sharedSecret: paired.sharedSecret,
      type: 'put-object',
    }
    return {
      ...unsigned,
      signature: signDevicePayload(options.pairing.signer, 'sync-object-put', unsigned),
    }
  }
  const putObject = async (peerId: string, manifest: SyncAssetManifest, body: AsyncIterable<Uint8Array>, context?: SyncObjectTransferContext, dialTarget?: unknown): Promise<void> => {
    const request = createObjectRequest(peerId, manifest, context)
    const connection = node.getConnections().find(current => peerString(current.remotePeer) === peerId)
    const rawStream = await (connection === undefined
      ? node.dialProtocol(resolveDialTarget(peerId, dialTarget, options.dialTargets) as never, memoriloObjectProtocol)
      : connection.newStream(memoriloObjectProtocol)) as unknown as SyncStream
    try {
      await createTimedSyncStream(rawStream, sessionIdleTimeoutMs, sessionTotalTimeoutMs).run(async (stream) => {
        const reader = createObjectStreamReader(stream)
        await writeObjectFrame(stream, request)
        const response = decodeObjectResponse(await reader.readFrame())
        if (response.type === 'exists')
          return
        if (response.type === 'error')
          throw new Error(`Memorilo object transfer rejected: ${response.code}`)
        if (response.type !== 'ready')
          throw new Error(`Expected object ready response, received ${response.type}`)
        const contentLength = request.manifest.contentLength
        if (contentLength === null)
          throw new Error('Sync object put manifest must declare its content length')
        let sent = 0
        for await (const chunk of body) {
          sent += chunk.byteLength
          if (sent > contentLength)
            throw new Error('Sync object body exceeds its declared length')
          if (!stream.send(chunk))
            await stream.onDrain?.()
        }
        if (sent !== contentLength)
          throw new Error(`Sync object length mismatch: expected ${contentLength}, sent ${sent}`)
        const completed = decodeObjectResponse(await reader.readFrame())
        if (completed.type === 'error')
          throw new Error(`Memorilo object transfer rejected: ${completed.code}`)
        if (completed.type !== 'complete')
          throw new Error(`Expected object completion response, received ${completed.type}`)
      })
    }
    finally {
      await rawStream.close?.()
    }
  }
  const requireNamespace = <Message extends Extract<SyncMessage, { type: 'changes' | 'ack' }>>(message: Message, namespace: SyncDataNamespace): Message => {
    if (message.namespace !== namespace)
      throw new Error(`Expected ${namespace} namespace, received ${message.namespace}`)
    return message
  }
  const handleIncomingSession = async (stream: SyncStream, paired: PairedDevice, provider: SyncStateProvider, hookContext: SyncSessionHookContext, initialHello?: SyncHello, sessionReader?: MessageReader): Promise<void> => {
    try {
      const reader = sessionReader ?? createMessageReader(stream)
      const hello = initialHello ?? requireType(await reader.read(), 'hello')
      if (Math.abs(now() - hello.issuedAt) > maxDeviceSignatureClockSkewMs
        || !verifySyncHelloSignature(hello, paired.signingPublicKey)) {
        throw new Error('Peer device signature was rejected')
      }
      if (hello.pairingId !== paired.pairingId || hello.sharedSecret !== paired.sharedSecret)
        throw new Error('Peer pairing credentials were rejected')
      await options.pairing.updateDeviceName(paired.peerId, hello.deviceName)
      await options.pairing.markSeen(paired.peerId)
      await writeMessage(stream, await createHello(provider, paired))
      await provider.validateRemoteHello?.(hello, paired)
      await options.sessionHooks?.afterHello?.(hello, paired, hookContext)

      for (const namespace of dataNamespaces.filter(current => hello.namespaces.includes(current))) {
        const changesForPeer = await getChanges(provider, namespace, hello.frontiers[namespace])
        if (changesForPeer.length > 0)
          updateDeviceStatus(paired.peerId, 'syncing')
        await writeMessage(stream, {
          changes: changesForPeer,
          deviceName: options.identity.deviceName,
          frontier: await getVersionVector(provider, namespace),
          membershipEpoch: getMembershipEpochForPeer(paired),
          namespace,
          type: 'changes',
        })
        const remoteAcknowledgement = requireNamespace(requireType(await reader.read(), 'ack'), namespace)
        await acknowledge(provider, namespace, remoteAcknowledgement.acceptedChangeIds, paired)

        const changesFromPeer = requireNamespace(requireType(await reader.read(), 'changes'), namespace)
        if (changesFromPeer.changes.length > 0)
          updateDeviceStatus(paired.peerId, 'syncing')
        await options.sessionHooks?.beforeApplyBatch?.(changesFromPeer, paired, hookContext)
        await applyChanges(provider, changesFromPeer, paired)
        const acknowledgement: SyncMessage = {
          acceptedChangeIds: changesFromPeer.changes.map(change => change.id),
          frontier: await getVersionVector(provider, namespace),
          membershipEpoch: getMembershipEpochForPeer(paired),
          namespace,
          type: 'ack',
        }
        await options.sessionHooks?.beforeAck?.(acknowledgement, paired, hookContext)
        await writeMessage(stream, acknowledgement)
      }
      if (hello.namespaces.includes('assets') && supportsAssetSync(provider)) {
        const manifestsForPeer = await provider.getAssetManifests!(hello.frontiers.assets)
        await provider.prepareAssetManifestsForPeer?.(manifestsForPeer, paired)
        await writeMessage(stream, {
          deviceName: options.identity.deviceName,
          frontier: await provider.getAssetVersionVector!(),
          manifests: manifestsForPeer,
          membershipEpoch: getMembershipEpochForPeer(paired),
          type: 'asset-manifests',
        })
        const remoteAcknowledgement = requireType(await reader.read(), 'asset-ack')
        await provider.acknowledgeAssetManifests?.(remoteAcknowledgement.acceptedManifestIds, paired)
        const manifestsFromPeer = requireType(await reader.read(), 'asset-manifests')
        await options.pairing.updateDeviceName(paired.peerId, manifestsFromPeer.deviceName)
        await provider.observeMembershipEpoch?.(manifestsFromPeer.membershipEpoch)
        await options.sessionHooks?.beforeApplyBatch?.(manifestsFromPeer, paired, hookContext)
        await provider.applyAssetManifests!(manifestsFromPeer.manifests, paired, manifestsFromPeer.membershipEpoch)
        const assetAcknowledgement: SyncMessage = {
          acceptedManifestIds: manifestsFromPeer.manifests.map(manifest => manifest.id),
          frontier: await provider.getAssetVersionVector!(),
          membershipEpoch: getMembershipEpochForPeer(paired),
          type: 'asset-ack',
        }
        await options.sessionHooks?.beforeAck?.(assetAcknowledgement, paired, hookContext)
        await writeMessage(stream, assetAcknowledgement)
      }
      connectedOnce.add(paired.peerId)
      updateDeviceStatus(paired.peerId, 'synced')
    }
    catch (error) {
      updateDeviceStatus(paired.peerId, 'error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  const syncPeer = async (peerId: string, dialTarget?: unknown): Promise<void> => {
    const activeSync = activeSyncs.get(peerId)
    if (activeSync !== undefined)
      return activeSync
    const paired = options.pairing.findByPeerId(peerId)
    if (!paired || options.provider === undefined)
      return
    const provider = options.provider
    const attemptFingerprint = authorizationFingerprint(peerId)
    const task = (async () => {
      try {
        const connection = node.getConnections().find(current => peerString(current.remotePeer) === peerId)
        const rawStream = await (connection === undefined
          ? node.dialProtocol(resolveDialTarget(peerId, dialTarget, options.dialTargets) as never, memoriloSyncProtocol)
          : connection.newStream(memoriloSyncProtocol)) as unknown as SyncStream
        await createTimedSyncStream(rawStream, sessionIdleTimeoutMs, sessionTotalTimeoutMs).run(async (stream) => {
          const reader = createMessageReader(stream)
          const hello = await createHello(provider, paired)
          await writeMessage(stream, hello)
          const remoteHello = requireType(await reader.read(), 'hello')
          if (remoteHello.pairingId !== paired.pairingId || remoteHello.sharedSecret !== paired.sharedSecret)
            throw new Error('Peer pairing credentials were rejected')
          await options.pairing.updateDeviceName(paired.peerId, remoteHello.deviceName)
          await options.pairing.markSeen(paired.peerId)
          await provider.observeRemoteHello?.(remoteHello, paired)
          await provider.validateRemoteHello?.(remoteHello, paired)

          for (const namespace of dataNamespaces.filter(current => remoteHello.namespaces.includes(current))) {
            const changesFromPeer = requireNamespace(requireType(await reader.read(), 'changes'), namespace)
            if (changesFromPeer.changes.length > 0)
              updateDeviceStatus(peerId, 'syncing')
            await applyChanges(provider, changesFromPeer, paired)
            await writeMessage(stream, {
              acceptedChangeIds: changesFromPeer.changes.map(change => change.id),
              frontier: await getVersionVector(provider, namespace),
              membershipEpoch: getMembershipEpochForPeer(paired),
              namespace,
              type: 'ack',
            })

            const changesForPeer = await getChanges(provider, namespace, changesFromPeer.frontier)
            if (changesForPeer.length > 0)
              updateDeviceStatus(peerId, 'syncing')
            await writeMessage(stream, {
              changes: changesForPeer,
              deviceName: options.identity.deviceName,
              frontier: await getVersionVector(provider, namespace),
              membershipEpoch: getMembershipEpochForPeer(paired),
              namespace,
              type: 'changes',
            })
            const acknowledgement = requireNamespace(requireType(await reader.read(), 'ack'), namespace)
            await acknowledge(provider, namespace, acknowledgement.acceptedChangeIds, paired)
          }
          if (remoteHello.namespaces.includes('assets') && supportsAssetSync(provider)) {
            const manifestsFromPeer = requireType(await reader.read(), 'asset-manifests')
            await options.pairing.updateDeviceName(paired.peerId, manifestsFromPeer.deviceName)
            await provider.observeMembershipEpoch?.(manifestsFromPeer.membershipEpoch)
            await provider.applyAssetManifests!(manifestsFromPeer.manifests, paired, manifestsFromPeer.membershipEpoch)
            await writeMessage(stream, {
              acceptedManifestIds: manifestsFromPeer.manifests.map(manifest => manifest.id),
              frontier: await provider.getAssetVersionVector!(),
              membershipEpoch: getMembershipEpochForPeer(paired),
              type: 'asset-ack',
            })

            const manifestsForPeer = await provider.getAssetManifests!(manifestsFromPeer.frontier)
            await provider.prepareAssetManifestsForPeer?.(manifestsForPeer, paired)
            await writeMessage(stream, {
              deviceName: options.identity.deviceName,
              frontier: await provider.getAssetVersionVector!(),
              manifests: manifestsForPeer,
              membershipEpoch: getMembershipEpochForPeer(paired),
              type: 'asset-manifests',
            })
            const acknowledgement = requireType(await reader.read(), 'asset-ack')
            await provider.acknowledgeAssetManifests?.(acknowledgement.acceptedManifestIds, paired)
          }
          await stream.close?.()
        })
        automaticSyncStates.delete(peerId)
        connectedOnce.add(peerId)
        updateDeviceStatus(peerId, 'synced')
      }
      catch (error) {
        recordAutomaticSyncFailure(peerId, error, attemptFingerprint)
        if (!connected.has(peerId) && isTransientConnectionError(error)) {
          if (connectedOnce.has(peerId)) {
            updateDeviceStatus(peerId, 'paused')
          }
          else {
            deviceStates.delete(peerId)
            updateStatus({ devices: deviceStatuses() })
          }
          return
        }
        updateDeviceStatus(peerId, 'error', error instanceof Error ? error.message : String(error))
        throw error
      }
    })()
    activeSyncs.set(peerId, task)
    try {
      await task
    }
    finally {
      if (activeSyncs.get(peerId) === task)
        activeSyncs.delete(peerId)
    }
  }

  const requestSyncPeer = (peerId: string, dialTarget?: unknown): Promise<void> => {
    if (!canAutomaticallySync(peerId))
      return Promise.resolve()
    const schedule = syncSchedules.get(peerId) ?? { dirty: false, running: null }
    syncSchedules.set(peerId, schedule)
    schedule.dirty = true
    if (schedule.running !== null)
      return schedule.running

    schedule.running = (async () => {
      try {
        while (schedule.dirty) {
          schedule.dirty = false
          await syncPeer(peerId, dialTarget)
        }
      }
      finally {
        schedule.running = null
        if (schedule.dirty) {
          queueMicrotask(() => {
            void requestSyncPeer(peerId, dialTarget).catch(() => undefined)
          })
        }
        else {
          syncSchedules.delete(peerId)
        }
      }
    })()
    return schedule.running
  }

  const notifyChangesAvailable = async (): Promise<void> => {
    const peers = options.pairing.list()
    await Promise.all(peers.map(peer => requestSyncPeer(peer.peerId)))
  }

  const dialAndRequestSync = async (peerId: string, target: unknown): Promise<void> => {
    const attemptFingerprint = authorizationFingerprint(peerId)
    try {
      await node.dial(target as never)
      await requestSyncPeer(peerId)
    }
    catch (error) {
      recordAutomaticSyncFailure(peerId, error, attemptFingerprint)
      if (connectedOnce.has(peerId)) {
        updateDeviceStatus(peerId, 'paused')
      }
      else {
        deviceStates.delete(peerId)
        updateStatus({ devices: deviceStatuses() })
      }
    }
    finally {
      dialing.delete(peerId)
    }
  }

  const sendPairingMessage = async (peerId: string, message: PairingMessage): Promise<void> => {
    const connection = node.getConnections().find(current => peerString(current.remotePeer) === peerId)
    if (connection === undefined) {
      const target = discoveredTargets.get(peerId)
      if (target !== undefined)
        await node.dial(target as never)
    }
    const connected = node.getConnections().find(current => peerString(current.remotePeer) === peerId)
    const stream = await (connected === undefined
      ? node.dialProtocol(resolveDialTarget(peerId, discoveredTargets.get(peerId), options.dialTargets) as never, memoriloPairingProtocol)
      : connected.newStream(memoriloPairingProtocol)) as unknown as SyncStream
    await writePairingMessage(stream, message)
    await stream.close?.()
  }

  const probePairingAvailability = async (peerId: string): Promise<void> => {
    if (options.pairing.findByPeerId(peerId) !== undefined)
      return
    const available = discoveredPeers.get(peerId)
    if (available !== undefined && available.expiresAt > now())
      return
    const previous = pairingProbes.get(peerId)
    const requestId = previous?.requestId ?? randomUUID()
    pairingProbes.set(peerId, { requestId, sentAt: now() })
    await sendPairingMessage(peerId, { requestId, type: 'pairing-probe' })
  }

  await node.handle(memoriloSyncProtocol, async (stream, connection) => {
    const peerId = peerString(connection.remotePeer)
    let closeAuthorizedSession: (() => Promise<void> | void) | undefined
    const rawStream = stream as unknown as SyncStream
    const abortController = new AbortController()
    const hookContext: SyncSessionHookContext = { signal: abortController.signal }
    const removeStreamAbortListener = abortOnStreamClose(rawStream, abortController)
    let resolveClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    try {
      await createTimedSyncStream(rawStream, sessionIdleTimeoutMs, sessionTotalTimeoutMs, () => abortController.abort()).run(async (typedStream) => {
        const reader = createMessageReader(typedStream)
        const hello = requireType(await reader.read(), 'hello')
        const customAuthorization = options.authorizeIncomingSync === undefined
          ? null
          : await options.authorizeIncomingSync(peerId, hello, { close: () => typedStream.close?.() ?? Promise.resolve(), closed })
        closeAuthorizedSession = customAuthorization?.onClose
        const paired = customAuthorization?.paired ?? options.pairing.findByPeerId(peerId)
        const provider = customAuthorization?.provider ?? options.provider
        if (!paired || provider === undefined || (customAuthorization === null && options.authorizeIncomingSync !== undefined)) {
          await stream.close()
          return
        }
        await handleIncomingSession(typedStream, paired, provider, hookContext, hello, reader)
        await stream.close()
      })
    }
    catch (error) {
      if (!isTransientConnectionError(error))
        console.warn(`Memorilo sync stream rejected for ${peerId}`, error)
      await writeMessage(rawStream, protocolError(error)).catch(() => undefined)
      await stream.close()
    }
    finally {
      try {
        await closeAuthorizedSession?.()
      }
      finally {
        removeStreamAbortListener()
        abortController.abort()
        resolveClosed()
      }
    }
  })

  await node.handle(memoriloObjectProtocol, async (stream, connection) => {
    const peerId = peerString(connection.remotePeer)
    const rawStream = stream as unknown as SyncStream
    const abortController = new AbortController()
    const hookContext: SyncSessionHookContext = { signal: abortController.signal }
    const removeStreamAbortListener = abortOnStreamClose(rawStream, abortController)
    try {
      await createTimedSyncStream(rawStream, sessionIdleTimeoutMs, sessionTotalTimeoutMs, () => abortController.abort()).run(async (typedStream) => {
        const reader = createObjectStreamReader(typedStream)
        const request = decodeObjectPutRequest(await reader.readFrame())
        const customAuthorization = options.authorizeIncomingObject === undefined
          ? null
          : await options.authorizeIncomingObject(peerId, request)
        const paired = customAuthorization?.paired ?? options.pairing.findByPeerId(peerId)
        const store = customAuthorization?.store ?? options.objectStore
        if (!paired || !store || (customAuthorization === null && options.authorizeIncomingObject !== undefined))
          throw new Error('object-credential-rejected')
        if (Math.abs(now() - request.issuedAt) > maxDeviceSignatureClockSkewMs
          || !verifySyncObjectRequestSignature(request, paired.signingPublicKey)) {
          throw new Error('object-credential-rejected')
        }
        if (request.deviceId !== paired.deviceId || request.pairingId !== paired.pairingId || request.sharedSecret !== paired.sharedSecret)
          throw new Error('object-credential-rejected')
        if (request.manifest.operation !== 'put'
          || request.manifest.contentLength === null
          || request.manifest.contentLength > maxSyncObjectBytes) {
          throw new Error('object-size-invalid')
        }
        if (await store.has(request.manifest, paired)) {
          await writeObjectFrame(typedStream, { type: 'exists' })
          return
        }
        await writeObjectFrame(typedStream, { type: 'ready' })
        await store.put(request.manifest, reader.readBody(request.manifest.contentLength), paired, request)
        await options.sessionHooks?.afterObjectPut?.(request, paired, hookContext)
        await writeObjectFrame(typedStream, { type: 'complete' })
      })
    }
    catch (error) {
      await writeObjectFrame(rawStream, {
        code: error instanceof Error ? error.message.slice(0, 128) : 'object-transfer-failed',
        type: 'error',
      }).catch(() => undefined)
    }
    finally {
      removeStreamAbortListener()
      abortController.abort()
      await stream.close()
    }
  })

  await node.handle(memoriloPairingProtocol, async (stream, connection) => {
    const peerId = peerString(connection.remotePeer)
    try {
      const message = await createPairingReader(stream as unknown as SyncStream).read()
      if (message.type === 'pairing-probe') {
        const expiresAt = options.pairingAvailability?.()
        if (expiresAt !== null && expiresAt !== undefined && expiresAt > now()) {
          await sendPairingMessage(peerId, {
            deviceId: options.identity.deviceId,
            deviceName: options.identity.deviceName,
            expiresAt,
            peerId: node.peerId.toString(),
            requestId: message.requestId,
            type: 'pairing-available',
          })
          advertisedPairingPeers.set(peerId, expiresAt)
        }
        return
      }
      if (message.type === 'pairing-available') {
        const probe = pairingProbes.get(peerId)
        if (probe?.requestId === message.requestId
          && message.peerId === peerId
          && message.expiresAt > now()
          && options.pairing.findByPeerId(peerId) === undefined) {
          discoveredPeers.set(peerId, {
            deviceId: message.deviceId,
            deviceName: message.deviceName,
            expiresAt: message.expiresAt,
            peerId,
          })
          updateDiscoveredPeers()
        }
        return
      }
      if (message.type === 'pairing-request' && (advertisedPairingPeers.get(peerId) ?? 0) <= now())
        return
      await options.onPairingMessage?.(message, peerId)
    }
    catch {
      await stream.close()
    }
  })

  node.addEventListener('peer:discovery', (event) => {
    const discovered = event.detail
    const peerId = peerString(discovered.id)
    const known = options.pairing.list().find(device => device.peerId === peerId)
    discoveredTargets.set(peerId, discovered.multiaddrs)
    if (known === undefined) {
      void probePairingAvailability(peerId).catch(() => undefined)
      return
    }
    if (!shouldInitiate(peerId))
      return
    if (dialing.has(peerId))
      return
    dialing.add(peerId)
    void dialAndRequestSync(peerId, discovered.multiaddrs)
  })
  node.addEventListener('connection:open', (event) => {
    const peerId = peerString(event.detail.remotePeer)
    if (automaticSyncStates.get(peerId)?.kind === 'retry')
      automaticSyncStates.delete(peerId)
    connected.add(peerId)
    if (options.pairing.findByPeerId(peerId) !== undefined) {
      connectedOnce.add(peerId)
      deviceStates.set(peerId, { error: null, state: 'connecting' })
    }
    updateStatus({ connectedPeers: authorizedConnectedPeers(), devices: deviceStatuses() })
    if (options.pairing.findByPeerId(peerId) && shouldInitiate(peerId)) {
      if (!dialing.has(peerId)) {
        dialing.add(peerId)
        void requestSyncPeer(peerId).catch(() => undefined).finally(() => dialing.delete(peerId))
      }
    }
  })
  node.addEventListener('connection:close', (event) => {
    const peerId = peerString(event.detail.remotePeer)
    queueMicrotask(() => {
      if (node.getConnections().some(connection => peerString(connection.remotePeer) === peerId))
        return
      connected.delete(peerId)
      const deviceState = deviceStates.get(peerId)
      if (connectedOnce.has(peerId) && deviceState?.state !== 'error')
        deviceStates.set(peerId, { error: null, state: 'paused' })
      else if (!connectedOnce.has(peerId))
        deviceStates.delete(peerId)
      updateStatus({ connectedPeers: authorizedConnectedPeers(), devices: deviceStatuses() })
      void options.onPeerDisconnected?.(peerId)
    })
  })

  const reconnectTimer = setInterval(() => {
    for (const paired of options.pairing.list()) {
      const peerId = paired.peerId
      if (!shouldInitiate(peerId) || dialing.has(peerId) || !canAutomaticallySync(peerId))
        continue
      if (connected.has(peerId)) {
        void requestSyncPeer(peerId).catch(() => undefined)
        continue
      }
      dialing.add(peerId)
      const target = resolveDialTarget(peerId, discoveredTargets.get(peerId), options.dialTargets)
      void dialAndRequestSync(peerId, target)
    }
  }, reconnectIntervalMs)
  const pairingProbeTimer = setInterval(() => {
    updateDiscoveredPeers()
    for (const peerId of discoveredTargets.keys()) {
      if (options.pairing.findByPeerId(peerId) !== undefined)
        continue
      const previous = pairingProbes.get(peerId)
      if (previous !== undefined && now() - previous.sentAt < (options.pairingProbeIntervalMs ?? 1_000))
        continue
      void probePairingAvailability(peerId).catch(() => undefined)
    }
  }, options.pairingProbeIntervalMs ?? 1_000)

  return {
    close: async () => {
      clearInterval(reconnectTimer)
      clearInterval(pairingProbeTimer)
      connected.clear()
      connectedOnce.clear()
      automaticSyncStates.clear()
      deviceStates.clear()
      updateStatus({ connectedPeers: [], devices: [], state: 'stopped' })
      await node.stop()
    },
    node,
    multiaddrs: () => node.getMultiaddrs(),
    notifyChangesAvailable,
    putObject,
    status: () => ({
      ...currentStatus,
      connectedPeers: [...authorizedConnectedPeers()],
      devices: [...deviceStatuses()],
      discoveredPeers: [...availablePeers()],
    }),
    syncPeer,
    sendPairingMessage,
    requestPairing: async (peerId: string) => {
      const available = discoveredPeers.get(peerId)
      if (available === undefined || available.expiresAt <= now()) {
        discoveredPeers.delete(peerId)
        updateDiscoveredPeers()
        throw new Error('Peer is not available for pairing')
      }
      const unsigned = {
        createdAt: now(),
        deviceId: options.identity.deviceId,
        deviceName: options.identity.deviceName,
        peerId: node.peerId.toString(),
        requestId: randomUUID(),
        signingPublicKey: options.pairing.signer.publicKey,
        type: 'pairing-request' as const,
      }
      const request = {
        ...unsigned,
        signature: signDevicePayload(options.pairing.signer, 'pairing-request', unsigned),
      }
      await (async () => {
        const connection = node.getConnections().find(current => peerString(current.remotePeer) === peerId)
        if (connection === undefined) {
          const target = discoveredTargets.get(peerId)
          if (target !== undefined)
            await node.dial(target as never)
        }
        const connected = node.getConnections().find(current => peerString(current.remotePeer) === peerId)
        const stream = await (connected === undefined
          ? node.dialProtocol(resolveDialTarget(peerId, discoveredTargets.get(peerId), options.dialTargets) as never, memoriloPairingProtocol)
          : connected.newStream(memoriloPairingProtocol)) as unknown as SyncStream
        await writePairingMessage(stream, request)
        await stream.close?.()
      })()
      return { deviceId: available.deviceId, deviceName: available.deviceName, peerId: available.peerId, requestId: request.requestId }
    },
  }
}

async function loadState(path: string, deviceName: string): Promise<{ state: P2pState, privateKey: PrivateKey }> {
  const defaultDeviceName = normalizeDeviceName(deviceName)
  try {
    const state = JSON.parse(await readFile(path, 'utf8')) as Partial<P2pState>
    if (typeof state.privateKey !== 'string' || typeof state.deviceId !== 'string' || state.deviceId.length === 0)
      throw new TypeError('P2P identity state is invalid')
    return {
      privateKey: keys.privateKeyFromProtobuf(Buffer.from(state.privateKey, 'base64url')),
      state: {
        deviceId: state.deviceId,
        deviceName: typeof state.deviceName === 'string' && state.deviceName.trim().length > 0 ? normalizeDeviceName(state.deviceName) : defaultDeviceName,
        membershipEpoch: Number.isSafeInteger(state.membershipEpoch) && (state.membershipEpoch as number) > 0 ? state.membershipEpoch as number : 1,
        pendingInvitations: normalizePendingInvitations(state.pendingInvitations),
        privateKey: state.privateKey,
      },
    }
  }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
    const privateKey = await keys.generateKeyPair('Ed25519')
    return {
      privateKey,
      state: {
        deviceId: randomUUID(),
        deviceName: defaultDeviceName,
        membershipEpoch: 1,
        pendingInvitations: {},
        privateKey: Buffer.from(keys.privateKeyToProtobuf(privateKey)).toString('base64url'),
      },
    }
  }
}

async function saveState(path: string, state: P2pState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporaryPath, path)
}

export async function createP2pApplication(options: P2pApplicationOptions): Promise<P2pApplication> {
  const now = options.now ?? Date.now
  const { state, privateKey } = await loadState(options.statePath, options.deviceName)
  const signer = await loadOrCreateDeviceSigner(
    options.signingKeyStore ?? new JsonDeviceSigningKeyStore(`${options.statePath}.signing-key.json`),
  )
  const pairing = new PairingManagerClass(
    { deviceId: state.deviceId, deviceName: state.deviceName, membershipEpoch: state.membershipEpoch, peerId: '', role: options.role ?? 'device' },
    new JsonPairingStore(`${options.statePath}.devices.json`),
    now,
    signer,
  )
  await pairing.load()
  let discoveryUntil = 0
  const pairingRequests = new Map<string, {
    readonly deviceId: string
    readonly deviceName: string
    readonly peerId: string
    readonly emoji: string
    readonly pairingId: string
    readonly sharedSecret: string
    readonly signingPublicKey: string
    readonly localConfirmed: boolean
    readonly remoteConfirmed: boolean
  }>()
  const outgoingPairingRequests = new Map<string, {
    readonly deviceId: string
    readonly deviceName: string
    readonly peerId: string
    readonly pairingId: string
    readonly sharedSecret: string
    readonly signingPublicKey: string
    readonly emoji: string
    readonly localConfirmed: boolean
    readonly remoteConfirmed: boolean
  }>()
  const dialTargets = new Map(options.dialTargets)
  let finalizePairing: (requestId: string, request: { deviceId: string, deviceName: string, pairingId: string, peerId: string, sharedSecret: string, signingPublicKey: string }) => Promise<PairedDevice>
  const node = await createP2pNode({
    identity: pairing.identity,
    onStatus: options.onStatus,
    pairing,
    privateKey,
    provider: options.provider,
    listenAddresses: options.listenAddresses,
    transport: options.transport,
    sharedWebSocketServer: options.sharedWebSocketServer,
    discovery: options.discovery,
    dialTargets,
    authorizeIncomingSync: options.authorizeIncomingSync,
    authorizeIncomingObject: options.authorizeIncomingObject,
    objectStore: options.objectStore,
    server: options.server,
    role: options.role,
    onPeerDisconnected: options.onPeerDisconnected,
    reconnectIntervalMs: options.reconnectIntervalMs,
    maxReconnectAttempts: options.maxReconnectAttempts,
    maxReconnectDelayMs: options.maxReconnectDelayMs,
    reconnectJitter: options.reconnectJitter,
    sessionIdleTimeoutMs: options.sessionIdleTimeoutMs,
    sessionTotalTimeoutMs: options.sessionTotalTimeoutMs,
    sessionHooks: options.sessionHooks,
    now,
    pairingAvailability: () => discoveryUntil > now() ? discoveryUntil : null,
    onPairingMessage: async (message, peerId) => {
      if (message.type === 'pairing-request') {
        const request = message
        if (discoveryUntil <= now()
          || request.peerId !== peerId
          || !verifyDevicePayload(request.signingPublicKey, 'pairing-request', withoutDeviceSignature(request), request.signature)
          || pairing.findByPeerId(peerId) !== undefined) {
          return
        }
        pairingRequests.set(request.requestId, {
          deviceId: request.deviceId,
          deviceName: request.deviceName,
          emoji: '',
          pairingId: '',
          peerId: request.peerId,
          sharedSecret: '',
          signingPublicKey: request.signingPublicKey,
          localConfirmed: false,
          remoteConfirmed: false,
        })
        return
      }
      if (message.type === 'pairing-approval') {
        const approval = message
        const pending = outgoingPairingRequests.get(approval.requestId)
        if (pending === undefined
          || pending.peerId !== peerId
          || pending.deviceId !== approval.deviceId
          || approval.peerId !== peerId
          || !verifyDevicePayload(approval.signingPublicKey, 'pairing-approval', withoutDeviceSignature(approval), approval.signature)) {
          return
        }
        outgoingPairingRequests.set(approval.requestId, {
          deviceId: approval.deviceId,
          deviceName: approval.deviceName,
          emoji: approval.emoji,
          pairingId: approval.pairingId,
          peerId,
          sharedSecret: approval.sharedSecret,
          signingPublicKey: approval.signingPublicKey,
          localConfirmed: false,
          remoteConfirmed: false,
        })
        return
      }
      if (message.type === 'pairing-confirmation') {
        const challenge = pairingRequests.get(message.requestId) ?? outgoingPairingRequests.get(message.requestId)
        if (challenge
          && challenge.peerId === peerId
          && challenge.pairingId === message.pairingId
          && challenge.emoji === message.emoji
          && verifyDevicePayload(challenge.signingPublicKey, 'pairing-confirmation', withoutDeviceSignature(message), message.signature)) {
          const updated = { ...challenge, remoteConfirmed: true }
          if (pairingRequests.has(message.requestId))
            pairingRequests.set(message.requestId, updated)
          else
            outgoingPairingRequests.set(message.requestId, updated)
          if (updated.localConfirmed)
            await finalizePairing(message.requestId, updated)
        }
      }
    },
  })
  pairing.identity.peerId = node.status().peerId ?? ''
  await saveState(options.statePath, state)
  const syncPairedDevice = (device: PairedDevice): void => {
    if (pairing.identity.peerId < device.peerId)
      void node.syncPeer(device.peerId, dialTargets.get(device.peerId)).catch(() => undefined)
  }
  const observeMembershipEpoch = async (epoch: number): Promise<void> => {
    if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch <= state.membershipEpoch)
      return
    state.membershipEpoch = epoch
    pairing.identity.membershipEpoch = epoch
    await saveState(options.statePath, state)
  }
  const recordPairingChange = async (device: PairedDevice, sameGrant: boolean): Promise<void> => {
    if (sameGrant || options.role === 'server' || device.role === 'server')
      return
    state.membershipEpoch += 1
    pairing.identity.membershipEpoch = state.membershipEpoch
    await saveState(options.statePath, state)
  }
  const removeDevice = async (deviceId: DeviceId): Promise<void> => {
    const existed = pairing.findByDeviceId(deviceId) !== undefined
    await pairing.remove(deviceId)
    if (existed) {
      state.membershipEpoch += 1
      pairing.identity.membershipEpoch = state.membershipEpoch
      await saveState(options.statePath, state)
    }
  }
  const enableDiscovery = async (): Promise<number> => {
    discoveryUntil = now() + 5 * 60 * 1000
    return discoveryUntil
  }
  const discoveryEnabled = (): boolean => discoveryUntil > now()
  const localDevice = () => ({
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    peerId: pairing.identity.peerId,
  })
  const updateDeviceName = async (deviceName: string): Promise<void> => {
    const normalized = normalizeDeviceName(deviceName)
    if (normalized === state.deviceName)
      return
    state.deviceName = normalized
    pairing.identity.deviceName = normalized
    await saveState(options.statePath, state)
    await Promise.all(pairing.list().map(device => node.syncPeer(device.peerId).catch(() => undefined)))
  }
  const listPairingRequests = () => [...pairingRequests.entries(), ...[...outgoingPairingRequests.entries()].filter(([, request]) => request.emoji.length > 0)]
    .map(([requestId, request]) => ({
      deviceId: request.deviceId,
      deviceName: request.deviceName,
      emoji: request.emoji,
      peerId: request.peerId,
      requestId,
    }))
  const approvePairing = async (requestId: string): Promise<string> => {
    const request = pairingRequests.get(requestId)
    if (!request || !discoveryEnabled())
      throw new Error('Pairing request is no longer available')
    const sharedSecret = randomUUID() + randomUUID()
    const pairingId = randomUUID()
    const emoji = pairingEmojiForSecret(sharedSecret)
    const challenge = { ...request, emoji, pairingId, sharedSecret }
    pairingRequests.set(requestId, challenge)
    const unsigned = {
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      emoji,
      membershipEpoch: state.membershipEpoch,
      pairingId,
      peerId: pairing.identity.peerId,
      requestId,
      sharedSecret,
      signingPublicKey: pairing.signer.publicKey,
      type: 'pairing-approval',
    } as const
    await node.sendPairingMessage(request.peerId, {
      ...unsigned,
      signature: signDevicePayload(pairing.signer, 'pairing-approval', unsigned),
    })
    return emoji
  }
  finalizePairing = async (requestId: string, request: { deviceId: string, deviceName: string, pairingId: string, peerId: string, sharedSecret: string, signingPublicKey: string }): Promise<PairedDevice> => {
    const existing = pairing.findByDeviceId(request.deviceId)
    const device = await pairing.completeGrant({ ...request, role: 'device' })
    await recordPairingChange(device, existing?.pairingId === device.pairingId)
    pairingRequests.delete(requestId)
    outgoingPairingRequests.delete(requestId)
    syncPairedDevice(device)
    return device
  }
  const confirmPairing = async (requestId: string, emoji: string): Promise<PairedDevice | null> => {
    const request = pairingRequests.get(requestId) ?? outgoingPairingRequests.get(requestId)
    if (!request || request.emoji !== emoji)
      throw new Error('Pairing emoji does not match')
    const updated = { ...request, localConfirmed: true }
    if (pairingRequests.has(requestId))
      pairingRequests.set(requestId, updated)
    else
      outgoingPairingRequests.set(requestId, updated)
    const unsigned = { emoji, pairingId: request.pairingId, requestId, type: 'pairing-confirmation' as const }
    await node.sendPairingMessage(request.peerId, {
      ...unsigned,
      signature: signDevicePayload(pairing.signer, 'pairing-confirmation', unsigned),
    })
    return updated.remoteConfirmed ? finalizePairing(requestId, updated) : null
  }
  return {
    acceptInvitation: async (invitation, dialTarget) => {
      const decodedInvitation = decodePairingPayload<PairingInvitation>(invitation)
      if (dialTarget !== undefined)
        dialTargets.set(decodedInvitation.peerId, dialTarget)
      if (decodedInvitation.role !== 'server')
        await observeMembershipEpoch(decodedInvitation.membershipEpoch)
      pairing.identity.membershipEpoch = state.membershipEpoch
      const invitationDeviceId = decodedInvitation.deviceId
      const existing = pairing.findByDeviceId(invitationDeviceId)
      const decoded = await pairing.acceptInvitation(invitation)
      await recordPairingChange(decoded.device, existing?.pairingId === decoded.device.pairingId)
      syncPairedDevice(decoded.device)
      return decoded.response
    },
    close: node.close,
    completePairing: async (response) => {
      const decodedResponse = decodePairingPayload<PairingResponse>(response)
      if (options.role !== 'server')
        await observeMembershipEpoch(decodedResponse.membershipEpoch)
      pairing.identity.membershipEpoch = state.membershipEpoch
      const pending = state.pendingInvitations[decodedResponse.pairingId]
      const responseDeviceId = decodedResponse.deviceId
      const existing = pairing.findByDeviceId(responseDeviceId)
      const matchesPending = pending !== undefined
        && pending.expiresAt > now()
        && pending.sharedSecret === decodedResponse.sharedSecret
      const matchesExistingGrant = existing?.pairingId === decodedResponse.pairingId
        && existing.sharedSecret === decodedResponse.sharedSecret
        && existing.peerId === decodedResponse.peerId
      if (!matchesPending && !matchesExistingGrant)
        throw new Error('Pairing response does not match an active invitation')
      const device = await pairing.completeInvitation(response, { persist: options.persistCompletedPairings !== false })
      await recordPairingChange(device, existing?.pairingId === device.pairingId)
      delete state.pendingInvitations[decodedResponse.pairingId]
      await saveState(options.statePath, state)
      syncPairedDevice(device)
      return device
    },
    createInvitation: async (membershipEpoch) => {
      const encoded = pairing.createInvitation(10 * 60 * 1000, membershipEpoch)
      const invitation = decodePairingPayload<PairingInvitation>(encoded)
      const currentTime = now()
      for (const [pairingId, pending] of Object.entries(state.pendingInvitations)) {
        if (pending.expiresAt <= currentTime)
          delete state.pendingInvitations[pairingId]
      }
      state.pendingInvitations[invitation.pairingId] = {
        expiresAt: invitation.expiresAt,
        sharedSecret: invitation.sharedSecret,
      }
      await saveState(options.statePath, state)
      return encoded
    },
    pairing,
    localDevice,
    multiaddrs: () => node.multiaddrs(),
    enableDiscovery,
    discoveryEnabled,
    discoveredPeers: () => node.status().discoveredPeers,
    requestPairing: async (peerId) => {
      const request = await node.requestPairing(peerId)
      outgoingPairingRequests.set(request.requestId, {
        ...request,
        emoji: '',
        pairingId: '',
        sharedSecret: '',
        signingPublicKey: '',
        localConfirmed: false,
        remoteConfirmed: false,
      })
      return request
    },
    listPairingRequests,
    notifyChangesAvailable: node.notifyChangesAvailable,
    putObject: node.putObject,
    approvePairing,
    confirmPairing,
    membershipEpoch: () => state.membershipEpoch,
    observeMembershipEpoch,
    removeDevice,
    status: node.status,
    updateDeviceName,
  }
}

function normalizePendingInvitations(value: unknown): Record<string, PendingInvitation> {
  if (value === undefined)
    return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('P2P pending invitations state is invalid')
  const normalized: Record<string, PendingInvitation> = {}
  for (const [pairingId, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
      throw new TypeError('P2P pending invitation state is invalid')
    const current = candidate as Partial<PendingInvitation>
    if (!Number.isSafeInteger(current.expiresAt) || (current.expiresAt as number) <= 0
      || typeof current.sharedSecret !== 'string' || current.sharedSecret.length === 0) {
      throw new TypeError('P2P pending invitation state is invalid')
    }
    normalized[pairingId] = {
      expiresAt: current.expiresAt as number,
      sharedSecret: current.sharedSecret,
    }
  }
  return normalized
}
