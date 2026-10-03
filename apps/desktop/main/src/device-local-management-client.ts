import type {
  DesktopDeviceGalleryStatus,
  DesktopDeviceGalleryTarget,
  DesktopDeviceGalleryUpload,
  DesktopDeviceGalleryUploadProgress,
  DesktopDeviceStatus,
  DesktopDeviceTodoPush,
  DesktopDeviceTodoSnapshot,
  DesktopDeviceTodoState,
} from '@memorilo/desktop-api'
import type { LocalManagementCredentialStore } from './storage/electron-local-management-credential-store'
import { Buffer } from 'node:buffer'
import { encodeTodoSnapshot } from '@memorilo/device-provisioning'
import { Data, Effect } from 'effect'

const imageBytes = 30_000
const requestTimeoutMilliseconds = 15_000
const maxResponseBytes = 64 * 1024
const maxTodoSnapshotBytes = 32 * 1024
const uploadChunkBytes = 1_024

type GalleryUploadProgressListener = (progress: DesktopDeviceGalleryUploadProgress) => void
type StreamingRequestInit = RequestInit & { duplex: 'half' }

// eslint-disable-next-line unicorn/throw-new-error
export class DeviceLocalManagementError extends Data.TaggedError('DeviceLocalManagementError')<{
  readonly cause?: unknown
  readonly code: 'credential-missing' | 'invalid-input' | 'invalid-response' | 'request-failed'
  readonly status?: number
}> {}

export class DeviceLocalManagementClient {
  constructor(
    private readonly credentials: LocalManagementCredentialStore,
    private readonly request: typeof fetch = fetch,
  ) {}

  loadGallery(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceGalleryStatus, DeviceLocalManagementError> {
    const authorizedRequest = (path: string, init: RequestInit) => this.authorizedRequest(target, path, init)
    return Effect.gen(function* () {
      const response = yield* authorizedRequest('/v1/gallery', { method: 'GET' })
      if (response.status !== 200)
        return yield* Effect.fail(responseError(response.status))
      const body = yield* readBoundedJson(response)
      return parseGalleryStatus(body)
    })
  }

  loadStatus(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceStatus, DeviceLocalManagementError> {
    const authorizedRequest = (path: string, init: RequestInit) => this.authorizedRequest(target, path, init)
    return Effect.gen(function* () {
      const response = yield* authorizedRequest('/v1/status', { method: 'GET' })
      if (response.status !== 200)
        return yield* Effect.fail(responseError(response.status))
      return parseDeviceStatus(yield* readBoundedJson(response))
    })
  }

  loadTodos(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceTodoState, DeviceLocalManagementError> {
    const authorizedRequest = (path: string, init: RequestInit) => this.authorizedRequest(target, path, init)
    return Effect.gen(function* () {
      const response = yield* authorizedRequest('/v1/todos', { method: 'GET' })
      if (response.status !== 200)
        return yield* Effect.fail(responseError(response.status))
      return parseTodoState(yield* readBoundedJson(response))
    })
  }

  pushTodos(input: DesktopDeviceTodoPush): Effect.Effect<void, DeviceLocalManagementError> {
    if (!isTodoSnapshot(input.snapshot))
      return Effect.fail(invalidInput())
    const body = encodeTodoSnapshot(input.snapshot)
    if (body.byteLength > maxTodoSnapshotBytes)
      return Effect.fail(invalidInput())
    return this.mutate(input, '/v1/todos', {
      body,
      headers: { 'Content-Type': 'application/x-protobuf' },
      method: 'POST',
    })
  }

  uploadAsset(
    input: DesktopDeviceGalleryUpload,
    onProgress?: GalleryUploadProgressListener,
  ): Effect.Effect<void, DeviceLocalManagementError> {
    if (!(input.bytes instanceof Uint8Array)
      || input.bytes.byteLength !== imageBytes
      || input.name.length === 0
      || Array.from(input.name).length > 64
      || !Number.isSafeInteger(input.createdAtUnixSeconds)
      || input.createdAtUnixSeconds < 0) {
      return Effect.fail(invalidInput())
    }
    const init: StreamingRequestInit = {
      body: createUploadBody(input.bytes, onProgress),
      duplex: 'half',
      headers: {
        'Content-Length': String(input.bytes.byteLength),
        'Content-Type': 'application/octet-stream',
        'X-Memorilo-Asset-Name': encodeURIComponent(input.name),
        'X-Memorilo-Created-At': String(input.createdAtUnixSeconds),
      },
      method: 'POST',
    }
    return this.mutate(input, '/v1/gallery/assets', init)
  }

  deleteAsset(target: DesktopDeviceGalleryTarget, id: number): Effect.Effect<void, DeviceLocalManagementError> {
    if (!isAssetId(id))
      return Effect.fail(invalidInput())
    return this.jsonMutation(target, '/v1/gallery/delete', { id })
  }

  reorder(target: DesktopDeviceGalleryTarget, order: readonly number[]): Effect.Effect<void, DeviceLocalManagementError> {
    if (order.length > 100 || order.some(id => !isAssetId(id)) || new Set(order).size !== order.length)
      return Effect.fail(invalidInput())
    return this.jsonMutation(target, '/v1/gallery/reorder', { order })
  }

  setSlideshow(
    target: DesktopDeviceGalleryTarget,
    intervalSeconds: number | null,
  ): Effect.Effect<void, DeviceLocalManagementError> {
    if (intervalSeconds !== null
      && (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 300 || intervalSeconds > 604_800)) {
      return Effect.fail(invalidInput())
    }
    return this.jsonMutation(target, '/v1/gallery/slideshow', { intervalSeconds })
  }

  refreshDevice(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceLocalManagementError> {
    return this.command(target, '/v1/commands/refresh')
  }

  nextDevicePage(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceLocalManagementError> {
    return this.command(target, '/v1/commands/next-page')
  }

  sleepDevice(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceLocalManagementError> {
    return this.command(target, '/v1/commands/sleep')
  }

  private command(target: DesktopDeviceGalleryTarget, path: string): Effect.Effect<void, DeviceLocalManagementError> {
    return this.mutate(target, path, { method: 'POST' })
  }

  private jsonMutation(
    target: DesktopDeviceGalleryTarget,
    path: string,
    body: unknown,
  ): Effect.Effect<void, DeviceLocalManagementError> {
    return this.mutate(target, path, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
  }

  private mutate(
    target: DesktopDeviceGalleryTarget,
    path: string,
    init: RequestInit,
  ): Effect.Effect<void, DeviceLocalManagementError> {
    const authorizedRequest = () => this.authorizedRequest(target, path, init)
    return Effect.gen(function* () {
      const response = yield* authorizedRequest()
      if (response.status !== 202)
        return yield* Effect.fail(responseError(response.status))
    })
  }

  private authorizedRequest(
    target: DesktopDeviceGalleryTarget,
    path: string,
    init: RequestInit,
  ): Effect.Effect<Response, DeviceLocalManagementError> {
    const { credentials, request } = this
    return Effect.gen(function* () {
      const baseUrl = yield* Effect.try({
        catch: cause => cause instanceof DeviceLocalManagementError ? cause : invalidInput(),
        try: () => parseLocalDeviceAddress(target.address),
      })
      if (target.deviceId.length === 0 || target.deviceId.length > 256)
        return yield* Effect.fail(invalidInput())
      const token = yield* Effect.tryPromise({
        catch: cause => new DeviceLocalManagementError({ cause, code: 'request-failed' }),
        try: () => credentials.load(target.deviceId),
      })
      if (!token)
        return yield* Effect.fail(new DeviceLocalManagementError({ code: 'credential-missing' }))
      return yield* Effect.tryPromise({
        catch: cause => new DeviceLocalManagementError({ cause, code: 'request-failed' }),
        try: () => request(new URL(path, baseUrl), {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${token}`,
          },
          redirect: 'error',
          signal: AbortSignal.timeout(requestTimeoutMilliseconds),
        }),
      })
    })
  }
}

function createUploadBody(
  bytes: Uint8Array,
  onProgress?: GalleryUploadProgressListener,
): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === 0)
        onProgress?.({ sentBytes: 0, totalBytes: bytes.byteLength })
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const nextOffset = Math.min(offset + uploadChunkBytes, bytes.byteLength)
      controller.enqueue(bytes.slice(offset, nextOffset))
      offset = nextOffset
      onProgress?.({ sentBytes: offset, totalBytes: bytes.byteLength })
      if (offset === bytes.byteLength)
        controller.close()
    },
  })
}

export function parseLocalDeviceAddress(address: string): URL {
  const hostname = address.trim().toLowerCase()
  if (/^memorilo-[a-z0-9-]+\.local(?::\d{1,5})?$/u.test(hostname)) {
    const portText = hostname.match(/:(\d+)$/u)?.[1]
    const port = portText === undefined ? 80 : Number(portText)
    if (port >= 1 && port <= 65_535)
      return new URL(`http://${hostname}:${port}/`)
  }
  const match = /^(?<host>(?:\d{1,3}\.){3}\d{1,3})(?::(?<port>\d{1,5}))?$/u.exec(address.trim())
  if (!match?.groups)
    throw invalidInput()
  const host = match.groups.host
  if (!host)
    throw invalidInput()
  const octets = host.split('.').map(Number)
  const first = octets[0] ?? -1
  const second = octets[1] ?? -1
  const port = match.groups.port === undefined ? 80 : Number(match.groups.port)
  const isPrivate = octets.length === 4
    && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && (first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254))
  if (!isPrivate || port < 1 || port > 65_535)
    throw invalidInput()
  return new URL(`http://${host}:${port}/`)
}

function parseGalleryStatus(value: unknown): DesktopDeviceGalleryStatus {
  if (!isRecord(value) || !isRecord(value.catalog) || !Array.isArray(value.catalog.assets))
    throw invalidResponse()
  const assets = value.catalog.assets.map((asset) => {
    if (!isRecord(asset)
      || !isAssetId(asset.id)
      || typeof asset.name !== 'string'
      || typeof asset.byteLength !== 'number'
      || typeof asset.checksum !== 'number'
      || typeof asset.createdAtUnixSeconds !== 'number') {
      throw invalidResponse()
    }
    return {
      byteLength: asset.byteLength,
      checksum: asset.checksum,
      createdAtUnixSeconds: asset.createdAtUnixSeconds,
      id: asset.id,
      name: asset.name,
    }
  })
  if (assets.length > 100
    || typeof value.capacityBytes !== 'number'
    || typeof value.fullRefreshSeconds !== 'number'
    || typeof value.imageBytes !== 'number'
    || typeof value.maxAssets !== 'number'
    || typeof value.mutationRevision !== 'number'
    || (value.lastError !== null && typeof value.lastError !== 'string')
    || (value.catalog.slideshowIntervalSeconds !== null
      && typeof value.catalog.slideshowIntervalSeconds !== 'number')) {
    throw invalidResponse()
  }
  return {
    capacityBytes: value.capacityBytes,
    catalog: {
      assets,
      slideshowIntervalSeconds: value.catalog.slideshowIntervalSeconds,
    },
    fullRefreshSeconds: value.fullRefreshSeconds,
    imageBytes: value.imageBytes,
    lastError: value.lastError,
    maxAssets: value.maxAssets,
    mutationRevision: value.mutationRevision,
  }
}

function parseDeviceStatus(value: unknown): DesktopDeviceStatus {
  if (!isRecord(value) || typeof value.firmwareVersion !== 'string' || !Number.isSafeInteger(value.uptimeMs)
    || !isRecord(value.network)
    || !['authentication-failed', 'backoff', 'connecting', 'disabled', 'idle', 'online'].includes(value.network.phase as string)
    || (value.network.ipv4 !== null && typeof value.network.ipv4 !== 'string')
    || typeof value.network.timeSynchronized !== 'boolean'
    || typeof value.network.mqttConnected !== 'boolean'
    || !Number.isSafeInteger(value.network.consecutiveFailures)
    || (value.network.retryAtMs !== null && !Number.isSafeInteger(value.network.retryAtMs))) {
    throw invalidResponse()
  }
  return value as unknown as DesktopDeviceStatus
}

function parseTodoState(value: unknown): DesktopDeviceTodoState {
  if (!isRecord(value)
    || (value.snapshot !== null && !isTodoSnapshot(value.snapshot))
    || (value.revision !== null && typeof value.revision !== 'string')
    || (value.source !== null && value.source !== 'client-lan-push' && value.source !== 'mqtt-triggered-https' && value.source !== 'periodic-https')
    || (value.lastSuccessUnixSeconds !== null && !Number.isSafeInteger(value.lastSuccessUnixSeconds))
    || (value.lastEvent !== null && value.lastEvent !== undefined && !['updated', 'empty', 'notification', 'not-modified', 'authentication-failure', 'retrying', 'offline-cache'].includes(value.lastEvent as string))
    || (value.lastError !== null && typeof value.lastError !== 'string')) {
    throw invalidResponse()
  }
  return value as unknown as DesktopDeviceTodoState
}

function isTodoSnapshot(value: unknown): value is DesktopDeviceTodoSnapshot {
  if (!isRecord(value)
    || typeof value.generatedAt !== 'string'
    || value.generatedAt.length > 64
    || typeof value.revision !== 'string'
    || value.revision.length === 0
    || value.revision.length > 128
    || !Array.isArray(value.items)
    || value.items.length > 64) {
    return false
  }
  if (value.timeZoneOffsetMinutes !== undefined
    && (typeof value.timeZoneOffsetMinutes !== 'number'
      || !Number.isInteger(value.timeZoneOffsetMinutes)
      || value.timeZoneOffsetMinutes < -840
      || value.timeZoneOffsetMinutes > 840)) {
    return false
  }
  return value.items.every(item => isRecord(item)
    && typeof item.allDay === 'boolean'
    && (item.dueDate === null || typeof item.dueDate === 'string')
    && (item.dueTime === null || typeof item.dueTime === 'string')
    && typeof item.id === 'string'
    && item.id.length > 0
    && item.id.length <= 256
    && typeof item.noteTitle === 'string'
    && (item.parentId === null || typeof item.parentId === 'string')
    && typeof item.revision === 'string'
    && (item.status === 'todo' || item.status === 'in-progress' || item.status === 'done')
    && typeof item.text === 'string'
    && item.text.length > 0
    && typeof item.topicTitle === 'string')
}

function readBoundedJson(response: Response): Effect.Effect<unknown, DeviceLocalManagementError> {
  return Effect.tryPromise({
    catch: cause => cause instanceof DeviceLocalManagementError
      ? cause
      : new DeviceLocalManagementError({ cause, code: 'invalid-response' }),
    try: async () => {
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes)
        throw invalidResponse()
      return JSON.parse(text) as unknown
    },
  })
}

function isAssetId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalidInput(): DeviceLocalManagementError {
  return new DeviceLocalManagementError({ code: 'invalid-input' })
}

function invalidResponse(): DeviceLocalManagementError {
  return new DeviceLocalManagementError({ code: 'invalid-response' })
}

function responseError(status: number): DeviceLocalManagementError {
  return new DeviceLocalManagementError({ code: 'request-failed', status })
}
