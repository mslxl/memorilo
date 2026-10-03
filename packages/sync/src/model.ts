import { decodePairing, decodeSyncMessage, encodePairing, encodeSyncMessage } from './protobuf-codec'

export type DeviceId = string

export type VersionVector = Readonly<Record<DeviceId, number>>

export type SyncPeerRole = 'device' | 'server'

export type SyncMode = 'direct' | 'relay' | 'authoritative'

export type SyncWireNamespace = 'notes' | 'learning' | 'assets'

export type SyncDataNamespace = Exclude<SyncWireNamespace, 'assets'>

export type SyncFrontiers = Readonly<Record<SyncWireNamespace, VersionVector>>

export interface PairedDevice {
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly peerId: string
  readonly role: SyncPeerRole
  readonly pairingId: string
  readonly sharedSecret: string
  readonly signingPublicKey: string
  readonly addedAt: number
  readonly lastSeenAt: number | null
}

export interface PairingInvitation {
  readonly version: 1
  readonly pairingId: string
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly peerId: string
  readonly role: SyncPeerRole
  readonly sharedSecret: string
  readonly signingPublicKey: string
  readonly signature: string
  readonly membershipEpoch: number
  readonly createdAt: number
  readonly expiresAt: number
}

export interface PairingResponse {
  readonly version: 1
  readonly pairingId: string
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly peerId: string
  readonly role: SyncPeerRole
  readonly sharedSecret: string
  readonly signingPublicKey: string
  readonly signature: string
  readonly membershipEpoch: number
}

export interface PairingRequestMessage {
  readonly type: 'pairing-request'
  readonly requestId: string
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly peerId: string
  readonly signingPublicKey: string
  readonly signature: string
  readonly createdAt: number
}

export interface PairingProbeMessage {
  readonly type: 'pairing-probe'
  readonly requestId: string
}

export interface PairingAvailableMessage {
  readonly type: 'pairing-available'
  readonly requestId: string
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly peerId: string
  readonly expiresAt: number
}

export interface PairingApprovalMessage {
  readonly type: 'pairing-approval'
  readonly requestId: string
  readonly pairingId: string
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly peerId: string
  readonly sharedSecret: string
  readonly signingPublicKey: string
  readonly signature: string
  readonly emoji: string
  readonly membershipEpoch: number
}

export interface PairingConfirmationMessage {
  readonly type: 'pairing-confirmation'
  readonly requestId: string
  readonly pairingId: string
  readonly emoji: string
  readonly signature: string
}

export interface PairingRejectedMessage {
  readonly type: 'pairing-rejected'
  readonly requestId: string
  readonly reason: string
}

export type PairingMessage
  = | PairingAvailableMessage
    | PairingProbeMessage
    | PairingRequestMessage
    | PairingApprovalMessage
    | PairingConfirmationMessage
    | PairingRejectedMessage

export interface SyncHello {
  readonly type: 'hello'
  readonly protocol: 'memorilo-sync/1'
  readonly role: SyncPeerRole
  readonly deviceId: DeviceId
  readonly deviceName: string
  readonly namespaces: readonly SyncWireNamespace[]
  readonly modes: readonly SyncMode[]
  readonly generation: number
  readonly membershipEpoch: number
  readonly policyEpoch: number
  readonly nonce: string
  readonly issuedAt: number
  readonly frontiers: SyncFrontiers
  readonly pairingId: string
  readonly sharedSecret: string
  readonly credential?: string
  readonly signature: string
}

export interface SyncChanges {
  readonly type: 'changes'
  readonly namespace: SyncDataNamespace
  readonly deviceName: string
  readonly membershipEpoch: number
  readonly frontier: VersionVector
  readonly changes: readonly SyncChange[]
}

export interface SyncAck {
  readonly type: 'ack'
  readonly namespace: SyncDataNamespace
  readonly membershipEpoch: number
  readonly frontier: VersionVector
  readonly acceptedChangeIds: readonly string[]
}

export interface SyncAssetManifest {
  readonly id: string
  readonly deviceId: DeviceId
  readonly sequence: number
  readonly fileName: string
  readonly originalFileName: string
  readonly operation: 'put' | 'delete'
  readonly contentHash: string | null
  readonly contentLength: number | null
  readonly contentType: string | null
  readonly createdAt: number
}

export interface SyncAssetManifests {
  readonly type: 'asset-manifests'
  readonly deviceName: string
  readonly membershipEpoch: number
  readonly frontier: VersionVector
  readonly manifests: readonly SyncAssetManifest[]
}

export interface SyncAssetAck {
  readonly type: 'asset-ack'
  readonly membershipEpoch: number
  readonly frontier: VersionVector
  readonly acceptedManifestIds: readonly string[]
}

export type SyncErrorCode
  = | 'account-data-reset'
    | 'credential-revoked'
    | 'membership-epoch-stale'
    | 'mode-disabled'
    | 'policy-epoch-stale'
    | 'protocol-invalid'
    | 'rate-limited'
    | 'server-failure'

export type SyncErrorAction = 'retry' | 're-pair' | 'bootstrap' | 'wait-for-device' | 'administrator-action'

export interface SyncError {
  readonly type: 'error'
  readonly code: SyncErrorCode
  readonly action: SyncErrorAction
  readonly retryable: boolean
}

export type SyncMessage = SyncHello | SyncChanges | SyncAck | SyncAssetManifests | SyncAssetAck | SyncError

export const maxSyncFrameBytes = 1024 * 1024
export const maxSyncChangesPerBatch = 256
export const maxSyncDecodedPayloadBytes = 768 * 1024

export interface SyncChange {
  readonly id: string
  readonly deviceId: DeviceId
  readonly sequence: number
  readonly kind: 'note-update' | 'learning-mutation'
  readonly payload: Uint8Array
}

export function normalizeVersionVector(vector: VersionVector): VersionVector {
  const normalized: Record<string, number> = {}
  for (const [deviceId, sequence] of Object.entries(vector)) {
    if (!deviceId || !Number.isSafeInteger(sequence) || sequence < 0)
      throw new TypeError('Version vector entries must contain non-negative safe integers')
    if (sequence > 0)
      normalized[deviceId] = sequence
  }
  return normalized
}

export function mergeVersionVectors(...vectors: VersionVector[]): VersionVector {
  const merged: Record<string, number> = {}
  for (const vector of vectors) {
    for (const [deviceId, sequence] of Object.entries(normalizeVersionVector(vector))) {
      merged[deviceId] = Math.max(merged[deviceId] ?? 0, sequence)
    }
  }
  return merged
}

export function compareVersionVectors(left: VersionVector, right: VersionVector): 'equal' | 'left-dominates' | 'right-dominates' | 'concurrent' {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  let leftAtLeast = true
  let rightAtLeast = true
  let leftGreater = false
  let rightGreater = false
  for (const key of keys) {
    const a = left[key] ?? 0
    const b = right[key] ?? 0
    if (a < b)
      leftAtLeast = false
    if (b < a)
      rightAtLeast = false
    if (a > b)
      leftGreater = true
    if (b > a)
      rightGreater = true
  }
  if (!leftGreater && !rightGreater)
    return 'equal'
  if (leftAtLeast)
    return 'left-dominates'
  if (rightAtLeast)
    return 'right-dominates'
  return 'concurrent'
}

export function missingSequences(local: VersionVector, remote: VersionVector): VersionVector {
  const missing: Record<string, number> = {}
  for (const [deviceId, remoteSequence] of Object.entries(normalizeVersionVector(remote))) {
    const localSequence = local[deviceId] ?? 0
    if (remoteSequence > localSequence)
      missing[deviceId] = remoteSequence
  }
  return missing
}

type JsonRecord = Record<string, unknown>

const textEncoder = new TextEncoder()

function recordValue(value: unknown, name: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${name} must be an object`)
  return value as JsonRecord
}

function exactKeys(value: JsonRecord, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      throw new TypeError(`Memorilo sync message is missing ${key}`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new TypeError(`Memorilo sync message contains unsupported field ${key}`)
  }
}

function stringValue(value: unknown, name: string, maximum = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || textEncoder.encode(value).byteLength > maximum)
    throw new TypeError(`${name} must be a non-empty string no larger than ${maximum} bytes`)
  return value
}

function integerValue(value: unknown, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new TypeError(`${name} must be a safe integer greater than or equal to ${minimum}`)
  return value as number
}

function enumValue<const Value extends string>(value: unknown, name: string, allowed: readonly Value[]): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value))
    throw new TypeError(`${name} has an unsupported value`)
  return value as Value
}

function enumArray<const Value extends string>(value: unknown, name: string, allowed: readonly Value[]): readonly Value[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > allowed.length)
    throw new TypeError(`${name} must be a non-empty array`)
  const parsed = value.map(item => enumValue(item, name, allowed))
  if (new Set(parsed).size !== parsed.length)
    throw new TypeError(`${name} must not contain duplicates`)
  return parsed
}

function versionVectorValue(value: unknown): VersionVector {
  const record = recordValue(value, 'Version vector')
  if (Object.keys(record).length > 4096)
    throw new RangeError('Version vector contains too many devices')
  const vector: Record<string, number> = {}
  for (const [deviceId, sequence] of Object.entries(record))
    vector[stringValue(deviceId, 'Version vector device id', 256)] = integerValue(sequence, 'Version vector sequence', 0)
  return vector
}

function frontiersValue(value: unknown): SyncFrontiers {
  const record = recordValue(value, 'Sync frontiers')
  exactKeys(record, ['notes', 'learning', 'assets'])
  return {
    assets: versionVectorValue(record.assets),
    learning: versionVectorValue(record.learning),
    notes: versionVectorValue(record.notes),
  }
}

function syncChangeValue(value: unknown): SyncChange {
  const record = recordValue(value, 'Sync change')
  exactKeys(record, ['id', 'deviceId', 'sequence', 'kind', 'payload'])
  return {
    deviceId: stringValue(record.deviceId, 'Sync change device id', 256),
    id: stringValue(record.id, 'Sync change id', 256),
    kind: enumValue(record.kind, 'Sync change kind', ['note-update', 'learning-mutation']),
    payload: bytesValue(record.payload, 'Sync change payload', maxSyncDecodedPayloadBytes),
    sequence: integerValue(record.sequence, 'Sync change sequence', 1),
  }
}

export function validateAssetManifest(manifest: SyncAssetManifest): void {
  if (!manifest.id || !manifest.deviceId || !manifest.fileName || !manifest.originalFileName)
    throw new TypeError('Asset manifest identity fields must not be empty')
  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1)
    throw new TypeError('Asset manifest sequence must be a positive safe integer')
  if (!Number.isSafeInteger(manifest.createdAt) || manifest.createdAt < 0)
    throw new TypeError('Asset manifest creation time must be a non-negative safe integer')
  if (manifest.operation === 'delete') {
    if (manifest.contentHash !== null || manifest.contentLength !== null || manifest.contentType !== null)
      throw new TypeError('Deleted asset manifests must not contain object metadata')
    return
  }
  if (!/^[a-f\d]{64}$/u.test(manifest.contentHash ?? ''))
    throw new TypeError('Asset manifest content hash must be a lowercase SHA-256 digest')
  if (!Number.isSafeInteger(manifest.contentLength) || (manifest.contentLength ?? -1) < 0)
    throw new TypeError('Asset manifest content length must be a non-negative safe integer')
}

export function decodeAssetManifest(value: unknown): SyncAssetManifest {
  const record = recordValue(value, 'Sync asset manifest')
  exactKeys(record, ['id', 'deviceId', 'sequence', 'fileName', 'originalFileName', 'operation', 'contentHash', 'contentLength', 'contentType', 'createdAt'])
  const operation = enumValue(record.operation, 'Asset manifest operation', ['put', 'delete'])
  const manifest: SyncAssetManifest = {
    contentHash: record.contentHash === null ? null : stringValue(record.contentHash, 'Asset content hash', 64),
    contentLength: record.contentLength === null ? null : integerValue(record.contentLength, 'Asset content length', 0),
    contentType: record.contentType === null ? null : stringValue(record.contentType, 'Asset content type', 256),
    createdAt: integerValue(record.createdAt, 'Asset creation time', 0),
    deviceId: stringValue(record.deviceId, 'Asset manifest device id', 256),
    fileName: stringValue(record.fileName, 'Asset file name', 512),
    id: stringValue(record.id, 'Asset manifest id', 256),
    operation,
    originalFileName: stringValue(record.originalFileName, 'Asset original file name', 512),
    sequence: integerValue(record.sequence, 'Asset manifest sequence', 1),
  }
  validateAssetManifest(manifest)
  return manifest
}

function syncMessageValue(value: unknown): SyncMessage {
  const record = recordValue(value, 'Memorilo sync message')
  const type = enumValue(record.type, 'Memorilo sync message type', ['hello', 'changes', 'ack', 'asset-manifests', 'asset-ack', 'error'])
  if (type === 'error') {
    exactKeys(record, ['type', 'code', 'action', 'retryable'])
    if (typeof record.retryable !== 'boolean')
      throw new TypeError('Sync error retryable must be a boolean')
    return {
      action: enumValue(record.action, 'Sync error action', ['retry', 're-pair', 'bootstrap', 'wait-for-device', 'administrator-action']),
      code: enumValue(record.code, 'Sync error code', ['account-data-reset', 'credential-revoked', 'membership-epoch-stale', 'mode-disabled', 'policy-epoch-stale', 'protocol-invalid', 'rate-limited', 'server-failure']),
      retryable: record.retryable,
      type,
    }
  }
  if (type === 'hello') {
    exactKeys(record, [
      'type',
      'protocol',
      'role',
      'deviceId',
      'deviceName',
      'namespaces',
      'modes',
      'generation',
      'membershipEpoch',
      'policyEpoch',
      'nonce',
      'issuedAt',
      'frontiers',
      'pairingId',
      'sharedSecret',
      'signature',
    ], ['credential'])
    if (record.protocol !== 'memorilo-sync/1')
      throw new TypeError('Unsupported Memorilo sync protocol')
    return {
      ...(record.credential === undefined
        ? {}
        : { credential: stringValue(record.credential, 'Device credential', 4096) }),
      deviceId: stringValue(record.deviceId, 'Device id', 256),
      deviceName: stringValue(record.deviceName, 'Device name', 256),
      frontiers: frontiersValue(record.frontiers),
      generation: integerValue(record.generation, 'Reset generation', 0),
      issuedAt: integerValue(record.issuedAt, 'Signature issue time', 0),
      membershipEpoch: integerValue(record.membershipEpoch, 'Membership epoch', 1),
      modes: enumArray(record.modes, 'Sync modes', ['direct', 'relay', 'authoritative']),
      namespaces: enumArray(record.namespaces, 'Sync namespaces', ['notes', 'learning', 'assets']),
      nonce: stringValue(record.nonce, 'Session nonce', 256),
      pairingId: stringValue(record.pairingId, 'Pairing id', 256),
      policyEpoch: integerValue(record.policyEpoch, 'Policy epoch', 0),
      protocol: 'memorilo-sync/1',
      role: enumValue(record.role, 'Peer role', ['device', 'server']),
      sharedSecret: stringValue(record.sharedSecret, 'Pairing secret', 4096),
      signature: stringValue(record.signature, 'Device signature', 1024),
      type,
    }
  }
  if (type === 'changes') {
    exactKeys(record, ['type', 'namespace', 'deviceName', 'membershipEpoch', 'frontier', 'changes'])
    if (!Array.isArray(record.changes) || record.changes.length > maxSyncChangesPerBatch)
      throw new RangeError(`Sync change batch cannot exceed ${maxSyncChangesPerBatch} changes`)
    const changes = record.changes.map(syncChangeValue)
    const namespace = enumValue(record.namespace, 'Sync namespace', ['notes', 'learning'])
    if (changes.some(change => namespace === 'notes' ? change.kind !== 'note-update' : change.kind !== 'learning-mutation'))
      throw new TypeError('Sync change kind does not match its namespace')
    const payloadBytes = changes.reduce((total, change) => total + change.payload.byteLength, 0)
    if (payloadBytes > maxSyncDecodedPayloadBytes)
      throw new RangeError(`Decoded sync payload cannot exceed ${maxSyncDecodedPayloadBytes} bytes`)
    return {
      changes,
      deviceName: stringValue(record.deviceName, 'Device name', 256),
      frontier: versionVectorValue(record.frontier),
      membershipEpoch: integerValue(record.membershipEpoch, 'Membership epoch', 1),
      namespace,
      type,
    }
  }
  if (type === 'asset-manifests') {
    exactKeys(record, ['type', 'deviceName', 'membershipEpoch', 'frontier', 'manifests'])
    if (!Array.isArray(record.manifests) || record.manifests.length > maxSyncChangesPerBatch)
      throw new RangeError(`Sync asset manifest batch cannot exceed ${maxSyncChangesPerBatch} manifests`)
    return {
      deviceName: stringValue(record.deviceName, 'Device name', 256),
      frontier: versionVectorValue(record.frontier),
      manifests: record.manifests.map(decodeAssetManifest),
      membershipEpoch: integerValue(record.membershipEpoch, 'Membership epoch', 1),
      type,
    }
  }
  if (type === 'asset-ack') {
    exactKeys(record, ['type', 'membershipEpoch', 'frontier', 'acceptedManifestIds'])
    if (!Array.isArray(record.acceptedManifestIds) || record.acceptedManifestIds.length > maxSyncChangesPerBatch)
      throw new RangeError(`Sync asset acknowledgement cannot exceed ${maxSyncChangesPerBatch} manifest ids`)
    const acceptedManifestIds = record.acceptedManifestIds.map(id => stringValue(id, 'Accepted asset manifest id', 256))
    if (new Set(acceptedManifestIds).size !== acceptedManifestIds.length)
      throw new TypeError('Sync asset acknowledgement must not contain duplicate manifest ids')
    return {
      acceptedManifestIds,
      frontier: versionVectorValue(record.frontier),
      membershipEpoch: integerValue(record.membershipEpoch, 'Membership epoch', 1),
      type,
    }
  }
  exactKeys(record, ['type', 'namespace', 'membershipEpoch', 'frontier', 'acceptedChangeIds'])
  if (!Array.isArray(record.acceptedChangeIds) || record.acceptedChangeIds.length > maxSyncChangesPerBatch)
    throw new RangeError(`Sync acknowledgement cannot exceed ${maxSyncChangesPerBatch} change ids`)
  const acceptedChangeIds = record.acceptedChangeIds.map(id => stringValue(id, 'Accepted change id', 256))
  if (new Set(acceptedChangeIds).size !== acceptedChangeIds.length)
    throw new TypeError('Sync acknowledgement must not contain duplicate change ids')
  return {
    acceptedChangeIds,
    frontier: versionVectorValue(record.frontier),
    membershipEpoch: integerValue(record.membershipEpoch, 'Membership epoch', 1),
    namespace: enumValue(record.namespace, 'Sync namespace', ['notes', 'learning']),
    type,
  }
}

function pairingMessageValue(value: unknown): PairingMessage {
  const record = recordValue(value, 'Memorilo pairing message')
  const type = enumValue(record.type, 'Memorilo pairing message type', [
    'pairing-probe',
    'pairing-available',
    'pairing-request',
    'pairing-approval',
    'pairing-confirmation',
    'pairing-rejected',
  ])
  if (type === 'pairing-probe') {
    exactKeys(record, ['type', 'requestId'])
    return { requestId: stringValue(record.requestId, 'Pairing request id', 256), type }
  }
  if (type === 'pairing-available') {
    exactKeys(record, ['type', 'requestId', 'deviceId', 'deviceName', 'peerId', 'expiresAt'])
    return {
      deviceId: stringValue(record.deviceId, 'Device id', 256),
      deviceName: stringValue(record.deviceName, 'Device name', 256),
      expiresAt: integerValue(record.expiresAt, 'Pairing expiry', 0),
      peerId: stringValue(record.peerId, 'Peer id', 256),
      requestId: stringValue(record.requestId, 'Pairing request id', 256),
      type,
    }
  }
  if (type === 'pairing-request') {
    exactKeys(record, ['type', 'requestId', 'deviceId', 'deviceName', 'peerId', 'createdAt', 'signingPublicKey', 'signature'])
    return {
      createdAt: integerValue(record.createdAt, 'Pairing creation time', 0),
      deviceId: stringValue(record.deviceId, 'Device id', 256),
      deviceName: stringValue(record.deviceName, 'Device name', 256),
      peerId: stringValue(record.peerId, 'Peer id', 256),
      requestId: stringValue(record.requestId, 'Pairing request id', 256),
      signature: stringValue(record.signature, 'Pairing request signature', 1024),
      signingPublicKey: stringValue(record.signingPublicKey, 'Pairing signing public key', 1024),
      type,
    }
  }
  if (type === 'pairing-approval') {
    exactKeys(record, ['type', 'requestId', 'pairingId', 'deviceId', 'deviceName', 'peerId', 'sharedSecret', 'emoji', 'membershipEpoch', 'signingPublicKey', 'signature'])
    return {
      deviceId: stringValue(record.deviceId, 'Device id', 256),
      deviceName: stringValue(record.deviceName, 'Device name', 256),
      emoji: stringValue(record.emoji, 'Pairing emoji', 128),
      membershipEpoch: integerValue(record.membershipEpoch, 'Membership epoch', 1),
      pairingId: stringValue(record.pairingId, 'Pairing id', 256),
      peerId: stringValue(record.peerId, 'Peer id', 256),
      requestId: stringValue(record.requestId, 'Pairing request id', 256),
      sharedSecret: stringValue(record.sharedSecret, 'Pairing secret', 4096),
      signature: stringValue(record.signature, 'Pairing approval signature', 1024),
      signingPublicKey: stringValue(record.signingPublicKey, 'Pairing signing public key', 1024),
      type,
    }
  }
  if (type === 'pairing-confirmation') {
    exactKeys(record, ['type', 'requestId', 'pairingId', 'emoji', 'signature'])
    return {
      emoji: stringValue(record.emoji, 'Pairing emoji', 128),
      pairingId: stringValue(record.pairingId, 'Pairing id', 256),
      requestId: stringValue(record.requestId, 'Pairing request id', 256),
      signature: stringValue(record.signature, 'Pairing confirmation signature', 1024),
      type,
    }
  }
  exactKeys(record, ['type', 'requestId', 'reason'])
  return {
    reason: stringValue(record.reason, 'Pairing rejection reason', 1024),
    requestId: stringValue(record.requestId, 'Pairing request id', 256),
    type,
  }
}

function messagePayload(data: Uint8Array, name: string): Uint8Array {
  if (data.byteLength > maxSyncFrameBytes + 4)
    throw new RangeError(`${name} exceeds the maximum frame size`)
  if (data.byteLength >= 4 && data[0] === 0) {
    const length = new DataView(data.buffer, data.byteOffset, 4).getUint32(0)
    if (length > maxSyncFrameBytes)
      throw new RangeError(`${name} exceeds the maximum frame size`)
    if (length !== data.byteLength - 4)
      throw new TypeError(`${name} has an invalid frame length`)
    return data.slice(4)
  }
  if (data.byteLength > maxSyncFrameBytes)
    throw new RangeError(`${name} exceeds the maximum frame size`)
  return data
}

export function encodeMessage(message: SyncMessage): Uint8Array {
  // Protobuf is the wire format; the outer four-byte length prefix remains
  // the stream framing used by libp2p and the sync server.
  const payload = encodeSyncMessage(syncMessageValue(message))
  if (payload.byteLength > maxSyncFrameBytes)
    throw new RangeError('Memorilo sync message exceeds the maximum frame size')
  const framed = new Uint8Array(4 + payload.byteLength)
  new DataView(framed.buffer).setUint32(0, payload.byteLength)
  framed.set(payload, 4)
  return framed
}

export function decodeMessage(data: Uint8Array): SyncMessage {
  try {
    const payload = messagePayload(data, 'Memorilo sync message')
    return syncMessageValue(decodeSyncMessage(payload))
  }
  catch (error) {
    throw new TypeError('Invalid Memorilo sync message', { cause: error })
  }
}

function bytesValue(value: unknown, name: string, maximum: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > maximum)
    throw new TypeError(`${name} must be a non-empty byte array no larger than ${maximum} bytes`)
  return new Uint8Array(value)
}

export function encodePairingMessage(message: PairingMessage): Uint8Array {
  const payload = encodePairing(pairingMessageValue(message))
  if (payload.byteLength > maxSyncFrameBytes)
    throw new RangeError('Memorilo pairing message exceeds the maximum frame size')
  const framed = new Uint8Array(4 + payload.byteLength)
  new DataView(framed.buffer).setUint32(0, payload.byteLength)
  framed.set(payload, 4)
  return framed
}

export function decodePairingMessage(data: Uint8Array): PairingMessage {
  try {
    const payload = messagePayload(data, 'Memorilo pairing message')
    return pairingMessageValue(decodePairing(payload))
  }
  catch (error) {
    throw new TypeError('Invalid Memorilo pairing message', { cause: error })
  }
}
