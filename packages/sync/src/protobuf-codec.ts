import type { PairingMessage, SyncAck, SyncAssetAck, SyncAssetManifest, SyncAssetManifests, SyncChange, SyncChanges, SyncError, SyncFrontiers, SyncHello, SyncMessage } from './model'
import { Buffer } from 'node:buffer'
import { decodeMemoriloProto, encodeMemoriloProto } from '@memorilo/sync-protocol'

type ProtoRecord = Record<string, any>

const roleToProto = { device: 1, server: 2 } as const
const roleFromProto = { 1: 'device', 2: 'server' } as const
const modeToProto = { direct: 1, relay: 2, authoritative: 3 } as const
const modeFromProto = { 1: 'direct', 2: 'relay', 3: 'authoritative' } as const
const namespaceToProto = { notes: 1, learning: 2, assets: 3 } as const
const namespaceFromProto = { 1: 'notes', 2: 'learning', 3: 'assets' } as const
const entityKindToProto = { 'assignment': 1, 'card': 2, 'optimizer': 3, 'review-event': 4, 'tombstone': 5 } as const
const entityKindFromProto = { 1: 'assignment', 2: 'card', 3: 'optimizer', 4: 'review-event', 5: 'tombstone' } as const
const operationToProto = { upsert: 1, delete: 2 } as const
const operationFromProto = { 1: 'upsert', 2: 'delete' } as const

function bytes(value: Uint8Array | undefined): Uint8Array | undefined {
  return value === undefined ? undefined : new Uint8Array(value)
}

function hexBytes(value: string | null): Uint8Array | undefined {
  return value === null ? undefined : Uint8Array.from(value.match(/.{2}/gu)?.map(pair => Number.parseInt(pair, 16)) ?? [])
}

function bytesHex(value: Uint8Array | undefined): string | null {
  return value === undefined ? null : Buffer.from(value).toString('hex')
}

function vectorToProto(vector: Readonly<Record<string, number>>): ProtoRecord {
  return { entries: Object.entries(vector).map(([deviceId, sequence]) => ({ deviceId, sequence })) }
}

function vectorFromProto(value: ProtoRecord | undefined): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const entry of value?.entries ?? [])
    result[String(entry.deviceId)] = Number(entry.sequence)
  return result
}

function frontiersToProto(frontiers: SyncFrontiers): ProtoRecord {
  return {
    assets: vectorToProto(frontiers.assets),
    learning: vectorToProto(frontiers.learning),
    notes: vectorToProto(frontiers.notes),
  }
}

function frontiersFromProto(value: ProtoRecord): SyncFrontiers {
  return {
    assets: vectorFromProto(value.assets),
    learning: vectorFromProto(value.learning),
    notes: vectorFromProto(value.notes),
  }
}

function helloToProto(value: SyncHello): ProtoRecord {
  return {
    credential: value.credential,
    deviceId: value.deviceId,
    deviceName: value.deviceName,
    frontiers: frontiersToProto(value.frontiers),
    generation: value.generation,
    issuedAt: value.issuedAt,
    membershipEpoch: value.membershipEpoch,
    modes: value.modes.map(mode => modeToProto[mode]),
    namespaces: value.namespaces.map(namespace => namespaceToProto[namespace]),
    nonce: value.nonce,
    pairingId: value.pairingId,
    policyEpoch: value.policyEpoch,
    protocol: value.protocol,
    role: roleToProto[value.role],
    sharedSecret: value.sharedSecret,
    signature: value.signature,
  }
}

function helloFromProto(value: ProtoRecord): SyncHello {
  return {
    ...(value.credential === undefined ? {} : { credential: String(value.credential) }),
    deviceId: String(value.deviceId),
    deviceName: String(value.deviceName),
    frontiers: frontiersFromProto(value.frontiers),
    generation: Number(value.generation),
    issuedAt: Number(value.issuedAt),
    membershipEpoch: Number(value.membershipEpoch),
    modes: (value.modes ?? []).map((mode: number) => modeFromProto[mode as keyof typeof modeFromProto]).filter(Boolean),
    namespaces: (value.namespaces ?? []).map((namespace: number) => namespaceFromProto[namespace as keyof typeof namespaceFromProto]).filter(Boolean),
    nonce: String(value.nonce),
    pairingId: String(value.pairingId),
    policyEpoch: Number(value.policyEpoch),
    protocol: 'memorilo-sync/1',
    role: roleFromProto[value.role as keyof typeof roleFromProto],
    sharedSecret: String(value.sharedSecret),
    signature: String(value.signature),
    type: 'hello',
  }
}

function changeToProto(value: SyncChange): ProtoRecord {
  return {
    deviceId: value.deviceId,
    id: value.id,
    learningMutation: value.kind === 'learning-mutation' ? decodeMemoriloProto('LearningMutation', value.payload) : undefined,
    noteUpdate: value.kind === 'note-update'
      ? decodeMemoriloProto('NoteUpdate', value.payload)
      : undefined,
    sequence: value.sequence,
  }
}

function changeFromProto(value: ProtoRecord): SyncChange {
  if (value.noteUpdate !== undefined) {
    return {
      deviceId: String(value.deviceId),
      id: String(value.id),
      kind: 'note-update',
      payload: encodeMemoriloProto('NoteUpdate', value.noteUpdate),
      sequence: Number(value.sequence),
    }
  }
  const mutation = value.learningMutation
  if (mutation === undefined)
    throw new TypeError('Protobuf sync change does not contain a payload')
  return {
    deviceId: String(value.deviceId),
    id: String(value.id),
    kind: 'learning-mutation',
    payload: encodeMemoriloProto('LearningMutation', mutation),
    sequence: Number(value.sequence),
  }
}

function learningPayloadToProto(entityKind: string, payload: Record<string, any>): ProtoRecord {
  switch (entityKind) {
    case 'assignment': return { assignment: payload }
    case 'card': return { card: payload }
    case 'optimizer': return { optimizer: { ...payload, configuration: payload.configuration } }
    case 'review-event': return { reviewEvent: { ...payload, resultState: payload.resultState } }
    case 'tombstone': return { tombstone: payload }
    default: throw new TypeError('Unsupported learning mutation entity kind')
  }
}

export function encodeLearningMutation(value: {
  readonly createdAt: number
  readonly entityId: string
  readonly entityKind: keyof typeof entityKindToProto
  readonly mutationId: string
  readonly operation: keyof typeof operationToProto
  readonly payload: Record<string, unknown>
}): Uint8Array {
  const payload = learningPayloadToProto(value.entityKind, value.payload)
  const encoded = encodeMemoriloProto('LearningMutation', {
    createdAt: value.createdAt,
    entityId: value.entityId,
    entityKind: entityKindToProto[value.entityKind],
    mutationId: value.mutationId,
    operation: operationToProto[value.operation],
    ...payload,
  })
  return encoded
}

export function decodeLearningMutation(value: Uint8Array): Uint8Array {
  // Validate the complete typed mutation while preserving its canonical bytes.
  const mutation = decodeMemoriloProto('LearningMutation', value)
  const kind = entityKindFromProto[mutation.entityKind as keyof typeof entityKindFromProto]
  if (!kind)
    throw new TypeError('Invalid protobuf learning mutation')
  return new Uint8Array(value)
}

export function learningMutationRecord(value: Uint8Array): Record<string, unknown> {
  const mutation = decodeMemoriloProto('LearningMutation', value)
  const kind = entityKindFromProto[mutation.entityKind as keyof typeof entityKindFromProto]
  const operation = operationFromProto[mutation.operation as keyof typeof operationFromProto]
  if (!kind || !operation)
    throw new TypeError('Invalid protobuf learning mutation')
  const payload = mutation.assignment ?? mutation.card ?? mutation.optimizer ?? mutation.reviewEvent ?? mutation.tombstone
  return {
    createdAt: Number(mutation.createdAt),
    entityId: String(mutation.entityId),
    entityKind: kind,
    mutationId: String(mutation.mutationId),
    operation,
    payload: payload ?? {},
  }
}

function changesToProto(value: SyncChanges): ProtoRecord {
  return {
    changes: value.changes.map(changeToProto),
    deviceName: value.deviceName,
    frontier: vectorToProto(value.frontier),
    membershipEpoch: value.membershipEpoch,
    namespace: namespaceToProto[value.namespace],
  }
}

function changesFromProto(value: ProtoRecord): SyncChanges {
  return {
    changes: (value.changes ?? []).map(changeFromProto),
    deviceName: String(value.deviceName),
    frontier: vectorFromProto(value.frontier),
    membershipEpoch: Number(value.membershipEpoch),
    namespace: namespaceFromProto[value.namespace as keyof typeof namespaceFromProto] as 'notes' | 'learning',
    type: 'changes',
  }
}

function ackToProto(value: SyncAck): ProtoRecord {
  return {
    acceptedChangeIds: value.acceptedChangeIds,
    frontier: vectorToProto(value.frontier),
    membershipEpoch: value.membershipEpoch,
    namespace: namespaceToProto[value.namespace],
  }
}

function ackFromProto(value: ProtoRecord): SyncAck {
  return {
    acceptedChangeIds: (value.acceptedChangeIds ?? []).map(String),
    frontier: vectorFromProto(value.frontier),
    membershipEpoch: Number(value.membershipEpoch),
    namespace: namespaceFromProto[value.namespace as keyof typeof namespaceFromProto] as 'notes' | 'learning',
    type: 'ack',
  }
}

function manifestToProto(value: SyncAssetManifest): ProtoRecord {
  return {
    contentHash: hexBytes(value.contentHash),
    contentLength: value.contentLength ?? undefined,
    contentType: value.contentType ?? undefined,
    createdAt: value.createdAt,
    deviceId: value.deviceId,
    fileName: value.fileName,
    id: value.id,
    operation: value.operation,
    originalFileName: value.originalFileName,
    sequence: value.sequence,
  }
}

function manifestFromProto(value: ProtoRecord): SyncAssetManifest {
  return {
    contentHash: bytesHex(bytes(value.contentHash)),
    contentLength: value.contentLength === undefined ? null : Number(value.contentLength),
    contentType: value.contentType === undefined ? null : String(value.contentType),
    createdAt: Number(value.createdAt),
    deviceId: String(value.deviceId),
    fileName: String(value.fileName),
    id: String(value.id),
    operation: value.operation as 'put' | 'delete',
    originalFileName: String(value.originalFileName),
    sequence: Number(value.sequence),
  }
}

function assetManifestsToProto(value: SyncAssetManifests): ProtoRecord {
  return { deviceName: value.deviceName, frontier: vectorToProto(value.frontier), manifests: value.manifests.map(manifestToProto), membershipEpoch: value.membershipEpoch }
}

function assetManifestsFromProto(value: ProtoRecord): SyncAssetManifests {
  return { deviceName: String(value.deviceName), frontier: vectorFromProto(value.frontier), manifests: (value.manifests ?? []).map(manifestFromProto), membershipEpoch: Number(value.membershipEpoch), type: 'asset-manifests' }
}

function assetAckToProto(value: SyncAssetAck): ProtoRecord {
  return { acceptedManifestIds: value.acceptedManifestIds, frontier: vectorToProto(value.frontier), membershipEpoch: value.membershipEpoch }
}

function assetAckFromProto(value: ProtoRecord): SyncAssetAck {
  return { acceptedManifestIds: (value.acceptedManifestIds ?? []).map(String), frontier: vectorFromProto(value.frontier), membershipEpoch: Number(value.membershipEpoch), type: 'asset-ack' }
}

function syncErrorToProto(value: SyncError): ProtoRecord {
  return { action: value.action, code: value.code, retryable: value.retryable }
}

function syncErrorFromProto(value: ProtoRecord): SyncError {
  return { action: String(value.action) as SyncError['action'], code: String(value.code) as SyncError['code'], retryable: Boolean(value.retryable), type: 'error' }
}

export function encodeSyncMessage(message: SyncMessage): Uint8Array {
  let body: ProtoRecord
  if (message.type === 'hello')
    body = { hello: helloToProto(message) }
  else if (message.type === 'changes')
    body = { changes: changesToProto(message) }
  else if (message.type === 'ack')
    body = { ack: ackToProto(message) }
  else if (message.type === 'asset-manifests')
    body = { assetManifests: assetManifestsToProto(message) }
  else if (message.type === 'asset-ack')
    body = { assetAck: assetAckToProto(message) }
  else body = { error: syncErrorToProto(message) }
  return encodeMemoriloProto('SyncFrame', body)
}

export function decodeSyncMessage(bytesValue: Uint8Array): SyncMessage {
  const frame = decodeMemoriloProto('SyncFrame', bytesValue)
  if (frame.hello !== undefined)
    return helloFromProto(frame.hello as ProtoRecord)
  if (frame.changes !== undefined)
    return changesFromProto(frame.changes as ProtoRecord)
  if (frame.ack !== undefined)
    return ackFromProto(frame.ack as ProtoRecord)
  if (frame.assetManifests !== undefined)
    return assetManifestsFromProto(frame.assetManifests as ProtoRecord)
  if (frame.assetAck !== undefined)
    return assetAckFromProto(frame.assetAck as ProtoRecord)
  if (frame.error !== undefined)
    return syncErrorFromProto(frame.error as ProtoRecord)
  throw new TypeError('Invalid Memorilo protobuf sync frame')
}

function pairingBody(message: PairingMessage): ProtoRecord {
  switch (message.type) {
    case 'pairing-probe': return { probe: { requestId: message.requestId } }
    case 'pairing-available': return { available: { deviceId: message.deviceId, deviceName: message.deviceName, expiresAt: message.expiresAt, peerId: message.peerId, requestId: message.requestId } }
    case 'pairing-request': return { request: { createdAt: message.createdAt, deviceId: message.deviceId, deviceName: message.deviceName, peerId: message.peerId, requestId: message.requestId, signature: message.signature, signingPublicKey: message.signingPublicKey } }
    case 'pairing-approval': return { approval: { deviceId: message.deviceId, deviceName: message.deviceName, emoji: message.emoji, membershipEpoch: message.membershipEpoch, pairingId: message.pairingId, peerId: message.peerId, requestId: message.requestId, sharedSecret: message.sharedSecret, signature: message.signature, signingPublicKey: message.signingPublicKey } }
    case 'pairing-confirmation': return { confirmation: { emoji: message.emoji, pairingId: message.pairingId, requestId: message.requestId, signature: message.signature } }
    case 'pairing-rejected': return { rejected: { reason: message.reason, requestId: message.requestId } }
  }
}

export function encodePairing(message: PairingMessage): Uint8Array {
  return encodeMemoriloProto('PairingFrame', pairingBody(message))
}

export function decodePairing(bytesValue: Uint8Array): PairingMessage {
  const frame = decodeMemoriloProto('PairingFrame', bytesValue)
  if (frame.probe !== undefined)
    return { requestId: String((frame.probe as ProtoRecord).requestId), type: 'pairing-probe' }
  if (frame.available !== undefined)
    return { ...(frame.available as ProtoRecord), type: 'pairing-available' } as PairingMessage
  if (frame.request !== undefined)
    return { ...(frame.request as ProtoRecord), type: 'pairing-request' } as PairingMessage
  if (frame.approval !== undefined)
    return { ...(frame.approval as ProtoRecord), type: 'pairing-approval' } as PairingMessage
  if (frame.confirmation !== undefined)
    return { ...(frame.confirmation as ProtoRecord), type: 'pairing-confirmation' } as PairingMessage
  if (frame.rejected !== undefined)
    return { ...(frame.rejected as ProtoRecord), type: 'pairing-rejected' } as PairingMessage
  throw new TypeError('Invalid Memorilo protobuf pairing frame')
}
