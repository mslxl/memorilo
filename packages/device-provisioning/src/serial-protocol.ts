import type {
  ApplyConfigEnvelope,
  ApplyStatusEnvelope,
  DeviceInfoEnvelope,
  GalleryRequest,
  GalleryResponse,
  GalleryStatus,
  PublicConfigEnvelope,
  TodoSnapshot,
  WifiNetwork,
} from './protocol'
import {
  encodeTodoSyncRequest,
  parseApplyConfigEnvelope,
  parseApplyStatusEnvelope,
  parseDeviceInfoEnvelope,
  parseGalleryRequest,
  parsePublicConfigEnvelope,
  parseTodoSyncRequest,
  parseTodoSyncResponse,
  PROTOCOL_VERSION,
  ProvisioningProtocolError,
} from './protocol'

export const SERIAL_PROVISIONING_PREFIX = 'MEMORILO_PROVISIONING_V1 '
// Gallery uploads carry one FRAME_BYTES image as base64 (~40 KiB).
export const MAX_SERIAL_MESSAGE_BYTES = 64 * 1024

export interface SerialProvisioningReadRequest {
  readonly operation: 'read'
  readonly protocolVersion: typeof PROTOCOL_VERSION
  readonly requestId: string
}

export interface SerialProvisioningWifiScanRequest {
  readonly operation: 'scanWifi'
  readonly protocolVersion: typeof PROTOCOL_VERSION
  readonly requestId: string
}

export type SerialProvisioningGalleryRequest = GalleryRequest

export interface SerialProvisioningApplyRequest {
  readonly operation: 'apply'
  readonly request: ApplyConfigEnvelope
}

export interface SerialProvisioningTodoSyncRequest {
  readonly operation: 'todo.sync'
  readonly protocolVersion: typeof PROTOCOL_VERSION
  readonly requestId: string
  readonly snapshot: TodoSnapshot
}

export type SerialProvisioningRequest = SerialProvisioningApplyRequest | SerialProvisioningReadRequest | SerialProvisioningWifiScanRequest | SerialProvisioningTodoSyncRequest | SerialProvisioningGalleryRequest

export interface SerialProvisioningReadResponse {
  readonly deviceInfo: DeviceInfoEnvelope
  readonly operation: 'read'
  readonly publicConfig: PublicConfigEnvelope
  readonly requestId: string
}

export interface SerialProvisioningApplyResponse {
  readonly operation: 'apply'
  readonly requestId: string
  readonly status: ApplyStatusEnvelope
}

export interface SerialProvisioningWifiScanResponse {
  readonly networks: readonly WifiNetwork[]
  readonly operation: 'scanWifi'
  readonly requestId: string
}

export interface SerialProvisioningGalleryResponse extends GalleryResponse {
  readonly gallery?: GalleryStatus
}

export interface SerialProvisioningTodoSyncResponse {
  readonly operation: 'todo.sync'
  readonly requestId: string
  readonly status: 'accepted' | 'rejected'
  readonly error?: string
}

export type SerialProvisioningResponse = SerialProvisioningApplyResponse | SerialProvisioningReadResponse | SerialProvisioningWifiScanResponse | SerialProvisioningTodoSyncResponse | SerialProvisioningGalleryResponse

export function encodeSerialProvisioningRequest(request: SerialProvisioningRequest): Uint8Array {
  if (request.operation === 'todo.sync') {
    const payload = encodeTodoSyncRequest(request)
    const prefix = new TextEncoder().encode(SERIAL_PROVISIONING_PREFIX)
    const result = new Uint8Array(prefix.byteLength + 4 + payload.byteLength)
    result.set(prefix)
    new DataView(result.buffer).setUint32(prefix.byteLength, payload.byteLength, true)
    result.set(payload, prefix.byteLength + 4)
    return result
  }
  const json = JSON.stringify(request)
  const bytes = new TextEncoder().encode(json)
  if (bytes.byteLength > MAX_SERIAL_MESSAGE_BYTES)
    throw new ProvisioningProtocolError('request-too-large')
  return new TextEncoder().encode(`${SERIAL_PROVISIONING_PREFIX}${json}\n`)
}

export function parseSerialProvisioningResponse(line: string): SerialProvisioningResponse | null {
  if (!line.startsWith(SERIAL_PROVISIONING_PREFIX))
    return null
  const bytes = new TextEncoder().encode(line.slice(SERIAL_PROVISIONING_PREFIX.length))
  if (bytes.byteLength > MAX_SERIAL_MESSAGE_BYTES)
    throw new ProvisioningProtocolError('request-too-large')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  }
  catch {
    throw new ProvisioningProtocolError('invalid-request')
  }
  if (!isRecord(value) || typeof value.requestId !== 'string')
    throw new ProvisioningProtocolError('invalid-request')
  if (value.operation === 'read' && isRecord(value.deviceInfo) && isRecord(value.publicConfig)) {
    return {
      deviceInfo: parseDeviceInfoEnvelope(jsonBytes(value.deviceInfo)),
      operation: 'read',
      publicConfig: parsePublicConfigEnvelope(jsonBytes(value.publicConfig)),
      requestId: value.requestId,
    }
  }
  if (value.operation === 'scanWifi' && Array.isArray(value.networks)) {
    if (!value.networks.every(isWifiNetwork))
      throw new ProvisioningProtocolError('invalid-request')
    return {
      networks: value.networks as WifiNetwork[],
      operation: 'scanWifi',
      requestId: value.requestId,
    }
  }
  if (value.operation === 'todo.sync') {
    return parseTodoSyncResponse(bytes)
  }
  if (value.operation === 'apply' && isRecord(value.status)) {
    const status = parseApplyStatusEnvelope(jsonBytes(value.status))
    if (status.requestId !== value.requestId)
      throw new ProvisioningProtocolError('invalid-request')
    return { operation: 'apply', requestId: value.requestId, status }
  }
  if (typeof value.operation === 'string'
    && value.operation.startsWith('gallery.')
    && (value.status === 'ok' || value.status === 'error')) {
    if (value.status === 'ok' && value.gallery !== undefined && !isGalleryStatus(value.gallery))
      throw new ProvisioningProtocolError('invalid-request')
    return value as unknown as SerialProvisioningGalleryResponse
  }
  throw new ProvisioningProtocolError('invalid-request')
}

export function parseSerialProvisioningResponseBytes(bytes: Uint8Array): SerialProvisioningResponse | null {
  const prefix = new TextEncoder().encode(SERIAL_PROVISIONING_PREFIX)
  if (bytes.byteLength < prefix.byteLength + 4 || !prefix.every((value, index) => bytes[index] === value))
    return null
  const length = new DataView(bytes.buffer, bytes.byteOffset + prefix.byteLength, 4).getUint32(0, true)
  if (length > MAX_SERIAL_MESSAGE_BYTES || bytes.byteLength !== prefix.byteLength + 4 + length)
    throw new ProvisioningProtocolError('invalid-bounds')
  return parseTodoSyncResponse(bytes.slice(prefix.byteLength + 4))
}

export function parseSerialProvisioningRequestBytes(bytes: Uint8Array): SerialProvisioningRequest | null {
  const prefix = new TextEncoder().encode(SERIAL_PROVISIONING_PREFIX)
  if (bytes.byteLength < prefix.byteLength + 4 || !prefix.every((value, index) => bytes[index] === value))
    return null
  const length = new DataView(bytes.buffer, bytes.byteOffset + prefix.byteLength, 4).getUint32(0, true)
  if (length > MAX_SERIAL_MESSAGE_BYTES || bytes.byteLength !== prefix.byteLength + 4 + length)
    throw new ProvisioningProtocolError('invalid-bounds')
  return parseTodoSyncRequest(bytes.slice(prefix.byteLength + 4)) as SerialProvisioningTodoSyncRequest
}

function isGalleryStatus(value: unknown): value is GalleryStatus {
  if (!isRecord(value) || !Number.isSafeInteger(value.capacityBytes)
    || !Number.isSafeInteger(value.imageBytes) || !Number.isSafeInteger(value.maxAssets)
    || !Number.isSafeInteger(value.fullRefreshSeconds) || !Number.isSafeInteger(value.mutationRevision)
    || (value.lastError !== null && typeof value.lastError !== 'string') || !isRecord(value.catalog)
    || !Array.isArray(value.catalog.assets)) {
    return false
  }
  return value.catalog.assets.every(asset => isRecord(asset)
    && isAssetId(asset.id) && typeof asset.name === 'string'
    && Number.isSafeInteger(asset.byteLength) && Number.isSafeInteger(asset.checksum)
    && Number.isSafeInteger(asset.createdAtUnixSeconds))
  && (value.catalog.slideshowIntervalSeconds === null || Number.isSafeInteger(value.catalog.slideshowIntervalSeconds))
}

function isAssetId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isWifiNetwork(value: unknown): value is WifiNetwork {
  return isRecord(value)
    && typeof value.ssid === 'string'
    && value.ssid.length <= 32
    && typeof value.rssi === 'number'
    && Number.isInteger(value.rssi)
    && value.rssi >= -127
    && value.rssi <= 127
    && (value.security === 'open' || value.security === 'secured')
}

export function parseSerialProvisioningRequest(line: string): SerialProvisioningRequest | null {
  if (!line.startsWith(SERIAL_PROVISIONING_PREFIX))
    return null
  const bytes = new TextEncoder().encode(line.slice(SERIAL_PROVISIONING_PREFIX.length))
  if (bytes.byteLength > MAX_SERIAL_MESSAGE_BYTES)
    throw new ProvisioningProtocolError('request-too-large')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  }
  catch {
    throw new ProvisioningProtocolError('invalid-request')
  }
  if (!isRecord(value))
    throw new ProvisioningProtocolError('invalid-request')
  if (value.operation === 'read'
    && value.protocolVersion === PROTOCOL_VERSION
    && typeof value.requestId === 'string'
    && value.requestId.length > 0
    && value.requestId.length <= 64) {
    return value as unknown as SerialProvisioningReadRequest
  }
  if (value.operation === 'scanWifi'
    && value.protocolVersion === PROTOCOL_VERSION
    && typeof value.requestId === 'string'
    && value.requestId.length > 0
    && value.requestId.length <= 64) {
    return value as unknown as SerialProvisioningWifiScanRequest
  }
  if (value.operation === 'todo.sync') {
    return parseTodoSyncRequest(bytes)
  }
  if (value.operation === 'apply' && isRecord(value.request)) {
    return {
      operation: 'apply',
      request: parseApplyConfigEnvelope(jsonBytes(value.request)),
    }
  }
  if (typeof value.operation === 'string' && value.operation.startsWith('gallery.'))
    return parseGalleryRequest(jsonBytes(value))
  throw new ProvisioningProtocolError('invalid-request')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonBytes(value: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
