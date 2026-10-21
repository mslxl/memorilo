import type {
  DesktopDeviceGalleryStatus,
  DesktopDeviceGalleryTarget,
  DesktopDeviceGalleryUpload,
  DesktopDeviceStatus,
  DesktopDeviceTodoPush,
  DesktopDeviceTodoSnapshot,
  DesktopDeviceTodoState,
  DesktopDeviceTodoTargetState,
  DesktopProvisioningDevice,
  DesktopProvisioningPairingRequest,
  DesktopProvisioningPairingResponse,
  DesktopProvisioningTransport,
} from '@memorilo/desktop-api'
import type {
  ApplyStatusEnvelope,
  ChunkFrame,
  DeviceConfigPatch,
  DeviceInfoEnvelope,
  GalleryResponse,
  PublicConfigEnvelope,
  SerialProvisioningRequest,
  SerialProvisioningResponse,
  TodoSyncResponse,
  WifiNetwork,
} from '@memorilo/device-provisioning'
import type { BleConnectStage } from './device-provisioning-support'
import {
  decodeFrame,
  encodeFrames,
  encodeSerialProvisioningRequest,
  encodeTodoSyncRequest,
  parseApplyStatusEnvelope,
  parseDeviceInfoEnvelope,
  parsePublicConfigEnvelope,
  parseSerialProvisioningResponse,
  parseSerialProvisioningResponseBytes,
  parseTodoSyncResponse,
  PROTOCOL_VERSION,
  PROVISIONING_UUIDS,
  reassembleFrames,
  SERIAL_PROVISIONING_PREFIX,
} from '@memorilo/device-provisioning'

import { Deferred, Effect } from 'effect'
import { DeviceProvisioningError } from './device-provisioning-error'
import {
  abortReason,
  applyConfigPatch,
  bytesToBase64,
  concatDataViews,
  createApplyRequest,
  decodeEnvelope,
  isGalleryResponse,
  isSerialAccessDenied,
  notifyGalleryUploadProgress,
  randomRequestToken,
  recordBleConnectDiagnostic,
  resetBleConnectDiagnostics,
  todoSnapshotFitsProtocol,
  toProvisioningError,
  viewBytes,
} from './device-provisioning-support'

export { DeviceProvisioningError } from './device-provisioning-error'

const characteristicChunkBytes = 180
const serialUploadChunkBytes = 1_024
const galleryCharacteristicUuid = '7b7a1007-6c6f-4d65-8a8b-6d656d6f7269'
const applyTimeoutMilliseconds = 15_000
const connectInitializationTimeoutMilliseconds = 35_000
const connectRetryDelayMilliseconds = 500
const connectRetryWindowMilliseconds = 30_000

export type DeviceProvisioningTransport = DesktopProvisioningTransport

export interface ProvisionedDevice {
  readonly config: PublicConfigEnvelope
  readonly info: DeviceInfoEnvelope
  readonly name: string
}

export interface BluetoothCharacteristicAdapter {
  addEventListener: (type: 'characteristicvaluechanged', listener: (event: Event) => void) => void
  readValue: () => Promise<DataView>
  removeEventListener: (type: 'characteristicvaluechanged', listener: (event: Event) => void) => void
  startNotifications: () => Promise<BluetoothCharacteristicAdapter>
  value: DataView | null
  writeValueWithResponse: (value: BufferSource) => Promise<void>
}

export interface BluetoothServiceAdapter {
  getCharacteristic: (uuid: string) => Promise<BluetoothCharacteristicAdapter>
}

export interface BluetoothServerAdapter {
  connected: boolean
  disconnect: () => void
  getPrimaryService: (uuid: string) => Promise<BluetoothServiceAdapter>
}

export interface BluetoothDeviceAdapter {
  addEventListener: (type: 'gattserverdisconnected', listener: () => void) => void
  removeEventListener: (type: 'gattserverdisconnected', listener: () => void) => void
  forget?: () => Promise<void>
  gatt?: {
    connect: () => Promise<BluetoothServerAdapter>
  }
  name?: string
}

export interface BluetoothAdapter {
  requestDevice: (options: {
    filters: Array<{ namePrefix: string }>
    optionalServices: string[]
  }) => Promise<BluetoothDeviceAdapter>
}

export interface SerialPortAdapter extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  close: () => Promise<void>
  forget?: () => Promise<void>
  open: (options: { baudRate: number }) => Promise<void>
}

export interface SerialAdapter {
  requestPort: (options: {
    filters: ReadonlyArray<{
      usbProductId?: number
      usbVendorId?: number
    }>
  }) => Promise<SerialPortAdapter>
}

interface PairingBridge {
  cancelSelection: () => Promise<void>
  clearLocalManagementToken: (deviceId: string) => Promise<void>
  deleteGalleryAsset: (target: DesktopDeviceGalleryTarget, id: number) => Promise<void>
  generateLocalManagementToken: () => Promise<string>
  hasLocalManagementToken: (deviceId: string) => Promise<boolean>
  loadGallery: (target: DesktopDeviceGalleryTarget) => Promise<DesktopDeviceGalleryStatus>
  loadStatus: (target: DesktopDeviceGalleryTarget) => Promise<DesktopDeviceStatus>
  loadTodos: (target: DesktopDeviceGalleryTarget) => Promise<DesktopDeviceTodoState>
  loadTodoSnapshot: () => Promise<DesktopDeviceTodoSnapshot>
  loadTodoTarget: (deviceId: string) => Promise<DesktopDeviceTodoTargetState>
  pushTodos: (input: DesktopDeviceTodoPush) => Promise<void>
  refreshDevice: (target: DesktopDeviceGalleryTarget) => Promise<void>
  nextDevicePage: (target: DesktopDeviceGalleryTarget) => Promise<void>
  sleepDevice: (target: DesktopDeviceGalleryTarget) => Promise<void>
  reorderGallery: (target: DesktopDeviceGalleryTarget, order: readonly number[]) => Promise<void>
  respondToPairing: (response: DesktopProvisioningPairingResponse) => Promise<void>
  saveLocalManagementToken: (deviceId: string, token: string) => Promise<void>
  saveTodoTarget: (deviceId: string, address: string | null) => Promise<void>
  setGallerySlideshow: (target: DesktopDeviceGalleryTarget, intervalSeconds: number | null) => Promise<void>
  selectDevice: (deviceId: string, transport?: DeviceProvisioningTransport) => Promise<void>
  subscribeDevices: (listener: (devices: readonly DesktopProvisioningDevice[], transport?: DeviceProvisioningTransport) => void) => () => void
  subscribePairing: (listener: (request: DesktopProvisioningPairingRequest) => void) => () => void
  uploadGalleryAsset: (input: DesktopDeviceGalleryUpload, onProgress?: GalleryUploadProgressListener) => Promise<void>
}

export interface DeviceProvisioningClient {
  cancelSelection: () => Effect.Effect<void, DeviceProvisioningError>
  clearLocalManagementToken: (deviceId: string) => Effect.Effect<void, DeviceProvisioningError>
  connect: (transport?: DeviceProvisioningTransport) => Effect.Effect<DeviceProvisioningSession, DeviceProvisioningError>
  generateLocalManagementToken: () => Effect.Effect<string, DeviceProvisioningError>
  hasLocalManagementToken: (deviceId: string) => Effect.Effect<boolean, DeviceProvisioningError>
  deleteGalleryAsset: (target: DesktopDeviceGalleryTarget, id: number) => Effect.Effect<void, DeviceProvisioningError>
  loadGallery: (target: DesktopDeviceGalleryTarget) => Effect.Effect<DesktopDeviceGalleryStatus, DeviceProvisioningError>
  loadStatus: (target: DesktopDeviceGalleryTarget) => Effect.Effect<DesktopDeviceStatus, DeviceProvisioningError>
  loadTodos: (target: DesktopDeviceGalleryTarget) => Effect.Effect<DesktopDeviceTodoState, DeviceProvisioningError>
  loadTodoSnapshot: () => Effect.Effect<DesktopDeviceTodoSnapshot, DeviceProvisioningError>
  loadTodoTarget: (deviceId: string) => Effect.Effect<DesktopDeviceTodoTargetState, DeviceProvisioningError>
  pushTodos: (input: DesktopDeviceTodoPush) => Effect.Effect<void, DeviceProvisioningError>
  refreshDevice: (target: DesktopDeviceGalleryTarget) => Effect.Effect<void, DeviceProvisioningError>
  nextDevicePage: (target: DesktopDeviceGalleryTarget) => Effect.Effect<void, DeviceProvisioningError>
  sleepDevice: (target: DesktopDeviceGalleryTarget) => Effect.Effect<void, DeviceProvisioningError>
  reorderGallery: (target: DesktopDeviceGalleryTarget, order: readonly number[]) => Effect.Effect<void, DeviceProvisioningError>
  respondToPairing: (response: DesktopProvisioningPairingResponse) => Effect.Effect<void, DeviceProvisioningError>
  saveLocalManagementToken: (deviceId: string, token: string) => Effect.Effect<void, DeviceProvisioningError>
  saveTodoTarget: (deviceId: string, address: string | null) => Effect.Effect<void, DeviceProvisioningError>
  setGallerySlideshow: (target: DesktopDeviceGalleryTarget, intervalSeconds: number | null) => Effect.Effect<void, DeviceProvisioningError>
  selectDevice: (device: DesktopProvisioningDevice) => Effect.Effect<void, DeviceProvisioningError>
  subscribeDevices: (listener: (devices: readonly DesktopProvisioningDevice[], transport?: DeviceProvisioningTransport) => void) => () => void
  subscribePairing: (listener: (request: DesktopProvisioningPairingRequest) => void) => () => void
  uploadGalleryAsset: (input: DesktopDeviceGalleryUpload, onProgress?: GalleryUploadProgressListener) => Effect.Effect<void, DeviceProvisioningError>
}

export interface GalleryUploadProgress {
  readonly sentBytes: number
  readonly totalBytes: number
}

export type GalleryUploadProgressListener = (progress: GalleryUploadProgress) => void

export interface DeviceProvisioningSession {
  readonly connected: boolean
  subscribeDisconnected: (listener: () => void) => () => void
  readonly device: ProvisionedDevice
  apply: (patch: DeviceConfigPatch) => Effect.Effect<ApplyStatusEnvelope, DeviceProvisioningError>
  pushTodos: (snapshot: DesktopDeviceTodoSnapshot) => Effect.Effect<void, DeviceProvisioningError>
  loadGallery: () => Effect.Effect<DesktopDeviceGalleryStatus, DeviceProvisioningError>
  uploadGalleryAsset: (bytes: Uint8Array, name: string, createdAtUnixSeconds: number, onProgress?: GalleryUploadProgressListener) => Effect.Effect<void, DeviceProvisioningError>
  deleteGalleryAsset: (id: number) => Effect.Effect<void, DeviceProvisioningError>
  reorderGallery: (order: readonly number[]) => Effect.Effect<void, DeviceProvisioningError>
  setGallerySlideshow: (intervalSeconds: number | null) => Effect.Effect<void, DeviceProvisioningError>
  scanWifi: () => Effect.Effect<readonly WifiNetwork[], DeviceProvisioningError>
  close: () => Effect.Effect<void>
  forget: () => Effect.Effect<void, DeviceProvisioningError>
}

export class DeviceProvisioningConnection {
  private currentDevice: ProvisionedDevice
  private readonly statusWaiters = new Map<string, Deferred.Deferred<ApplyStatusEnvelope, DeviceProvisioningError>>()
  private readonly wifiScanWaiters = new Map<string, Deferred.Deferred<readonly WifiNetwork[], DeviceProvisioningError>>()
  private readonly galleryWaiters = new Map<string, Deferred.Deferred<GalleryResponse, DeviceProvisioningError>>()
  private readonly todoWaiters = new Map<string, Deferred.Deferred<TodoSyncResponse, DeviceProvisioningError>>()
  private galleryFrames: ChunkFrame[] = []
  private readonly disconnected = Deferred.makeUnsafe<never, DeviceProvisioningError>()
  private readonly disconnectListeners = new Set<() => void>()
  private closed = false

  constructor(
    device: ProvisionedDevice,
    private readonly bluetoothDevice: BluetoothDeviceAdapter,
    private readonly server: BluetoothServerAdapter,
    private readonly applyCharacteristic: BluetoothCharacteristicAdapter,
    private readonly statusCharacteristic: BluetoothCharacteristicAdapter,
    private readonly wifiScanCharacteristic: BluetoothCharacteristicAdapter,
    private readonly galleryCharacteristic?: BluetoothCharacteristicAdapter,
  ) {
    this.currentDevice = device
    this.statusCharacteristic.addEventListener('characteristicvaluechanged', this.handleStatus)
    this.wifiScanCharacteristic.addEventListener('characteristicvaluechanged', this.handleWifiScan)
    this.galleryCharacteristic?.addEventListener('characteristicvaluechanged', this.handleGallery)
    this.bluetoothDevice.addEventListener('gattserverdisconnected', this.handleDisconnected)
  }

  get connected(): boolean {
    return !this.closed && this.server.connected
  }

  subscribeDisconnected(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    if (!this.connected)
      listener()
    return () => {
      this.disconnectListeners.delete(listener)
    }
  }

  get device(): ProvisionedDevice {
    return this.currentDevice
  }

  apply(patch: DeviceConfigPatch): Effect.Effect<ApplyStatusEnvelope, DeviceProvisioningError> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const requestId = globalThis.crypto.randomUUID()
        const status = Deferred.makeUnsafe<ApplyStatusEnvelope, DeviceProvisioningError>()
        this.statusWaiters.set(requestId, status)
        return { requestId, status }
      }),
      ({ requestId, status }) => Effect.gen({ self: this }, function* () {
        if (!this.connected)
          return yield* Effect.fail(new DeviceProvisioningError({ code: 'connection-failed' }))
        const request = createApplyRequest(this.device.config.revision, patch, requestId)
        const exchange = Effect.gen({ self: this }, function* () {
          const frames = yield* Effect.try({
            try: () => encodeFrames(randomRequestToken(), new TextEncoder().encode(JSON.stringify(request)), characteristicChunkBytes),
            catch: cause => toProvisioningError('protocol-error', cause),
          })
          for (const frame of frames) {
            yield* Effect.tryPromise({
              try: () => this.applyCharacteristic.writeValueWithResponse(new Uint8Array(frame)),
              catch: cause => toProvisioningError('connection-failed', cause),
            })
          }
          const result = yield* Deferred.await(status)
          if (result.status !== 'accepted') {
            return yield* Effect.fail(new DeviceProvisioningError({
              code: 'apply-rejected',
              cause: result.error,
            }))
          }
          this.currentDevice = {
            ...this.currentDevice,
            config: applyConfigPatch(this.currentDevice.config, patch, result.revision),
          }
          return result
        })
        return yield* exchange.pipe(
          Effect.raceFirst(Deferred.await(this.disconnected)),
          Effect.timeoutOrElse({
            duration: applyTimeoutMilliseconds,
            onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })),
          }),
        )
      }),
      ({ requestId }) => Effect.sync(() => { this.statusWaiters.delete(requestId) }),
    ).pipe(
      Effect.onError(() => this.close()),
      Effect.onInterrupt(() => this.close()),
    )
  }

  scanWifi(): Effect.Effect<readonly WifiNetwork[], DeviceProvisioningError> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const requestId = globalThis.crypto.randomUUID()
        const result = Deferred.makeUnsafe<readonly WifiNetwork[], DeviceProvisioningError>()
        this.wifiScanWaiters.set(requestId, result)
        return { requestId, result }
      }),
      ({ requestId, result }) => Effect.gen({ self: this }, function* () {
        if (!this.connected)
          return yield* Effect.fail(new DeviceProvisioningError({ code: 'connection-failed' }))
        yield* Effect.tryPromise({
          try: () => this.wifiScanCharacteristic.writeValueWithResponse(new TextEncoder().encode(JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            requestId,
          }))),
          catch: cause => toProvisioningError('connection-failed', cause),
        })
        return yield* Deferred.await(result).pipe(Effect.timeoutOrElse({
          duration: applyTimeoutMilliseconds,
          onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })),
        }))
      }),
      ({ requestId }) => Effect.sync(() => { this.wifiScanWaiters.delete(requestId) }),
    )
  }

  pushTodos(snapshot: DesktopDeviceTodoSnapshot): Effect.Effect<void, DeviceProvisioningError> {
    if (!todoSnapshotFitsProtocol(snapshot))
      return Effect.fail(new DeviceProvisioningError({ code: 'protocol-error' }))
    if (!this.galleryCharacteristic)
      return Effect.fail(new DeviceProvisioningError({ code: 'gallery-unavailable' }))
    return Effect.acquireUseRelease(Effect.sync(() => {
      const requestId = crypto.randomUUID()
      const waiter = Deferred.makeUnsafe<TodoSyncResponse, DeviceProvisioningError>()
      this.todoWaiters.set(requestId, waiter)
      return { requestId, waiter }
    }), ({ requestId, waiter }) => Effect.gen({ self: this }, function* () {
      const frames = yield* Effect.try({
        try: () => encodeFrames(randomRequestToken(), encodeTodoSyncRequest({
          operation: 'todo.sync',
          protocolVersion: PROTOCOL_VERSION,
          requestId,
          snapshot,
        }), characteristicChunkBytes),
        catch: cause => toProvisioningError('protocol-error', cause),
      })
      for (const frame of frames) {
        yield* Effect.tryPromise({
          try: () => this.galleryCharacteristic!.writeValueWithResponse(new Uint8Array(frame)),
          catch: cause => toProvisioningError('connection-failed', cause),
        })
      }
      const response = yield* Deferred.await(waiter).pipe(Effect.timeoutOrElse({
        duration: applyTimeoutMilliseconds,
        onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })),
      }))
      if (response.status !== 'accepted')
        return yield* Effect.fail(new DeviceProvisioningError({ code: 'apply-rejected', cause: response.error }))
    }), ({ requestId }) => Effect.sync(() => { this.todoWaiters.delete(requestId) }))
  }

  loadGallery(): Effect.Effect<DesktopDeviceGalleryStatus, DeviceProvisioningError> {
    return this.galleryRequest({ operation: 'gallery.list' }).pipe(Effect.flatMap(response => response.status === 'ok' && response.gallery ? Effect.succeed(response.gallery as DesktopDeviceGalleryStatus) : Effect.fail(new DeviceProvisioningError({ code: 'gallery-unavailable', cause: response.error }))))
  }

  uploadGalleryAsset(_bytes: Uint8Array, _name: string, _createdAtUnixSeconds: number, onProgress?: GalleryUploadProgressListener): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryRequest({ operation: 'gallery.upload', bytesBase64: bytesToBase64(_bytes), name: _name, createdAtUnixSeconds: _createdAtUnixSeconds }, onProgress).pipe(Effect.flatMap(r => this.galleryMutationResult(r)))
  }

  deleteGalleryAsset(_id: number): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryRequest({ operation: 'gallery.delete', id: _id }).pipe(Effect.flatMap(r => this.galleryMutationResult(r)))
  }

  reorderGallery(_order: readonly number[]): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryRequest({ operation: 'gallery.reorder', order: [..._order] }).pipe(Effect.flatMap(r => this.galleryMutationResult(r)))
  }

  setGallerySlideshow(_intervalSeconds: number | null): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryRequest({ operation: 'gallery.slideshow', intervalSeconds: _intervalSeconds }).pipe(Effect.flatMap(r => this.galleryMutationResult(r)))
  }

  private galleryRequest(request: GalleryCommand, onProgress?: GalleryUploadProgressListener): Effect.Effect<GalleryResponse, DeviceProvisioningError> {
    if (!this.galleryCharacteristic)
      return Effect.fail(new DeviceProvisioningError({ code: 'gallery-unavailable' }))
    return Effect.acquireUseRelease(Effect.sync(() => {
      const requestId = crypto.randomUUID()
      const waiter = Deferred.makeUnsafe<GalleryResponse, DeviceProvisioningError>()
      this.galleryWaiters.set(requestId, waiter)
      return { requestId, waiter }
    }), ({ requestId, waiter }) => Effect.gen({ self: this }, function* () {
      const frames = yield* Effect.try({ try: () => encodeFrames(randomRequestToken(), new TextEncoder().encode(JSON.stringify({ ...request, protocolVersion: PROTOCOL_VERSION, requestId })), characteristicChunkBytes), catch: cause => toProvisioningError('protocol-error', cause) })
      const totalBytes = frames.reduce((total, frame) => total + frame.byteLength, 0)
      let sentBytes = 0
      yield* notifyGalleryUploadProgress(onProgress, sentBytes, totalBytes)
      for (const frame of frames) {
        yield* Effect.tryPromise({ try: () => this.galleryCharacteristic!.writeValueWithResponse(new Uint8Array(frame)), catch: cause => toProvisioningError('connection-failed', cause) })
        sentBytes += frame.byteLength
        yield* notifyGalleryUploadProgress(onProgress, sentBytes, totalBytes)
      }
      return yield* Deferred.await(waiter).pipe(Effect.timeoutOrElse({ duration: applyTimeoutMilliseconds, onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })) }))
    }), ({ requestId }) => Effect.sync(() => { this.galleryWaiters.delete(requestId) }))
  }

  private galleryMutationResult(response: GalleryResponse): Effect.Effect<void, DeviceProvisioningError> {
    return response.status === 'ok' ? Effect.void : Effect.fail(new DeviceProvisioningError({ code: 'gallery-unavailable', cause: response.error }))
  }

  close(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.handleDisconnected()
      if (this.server.connected)
        this.server.disconnect()
    })
  }

  private readonly handleDisconnected = (): void => {
    if (this.closed)
      return
    this.closed = true
    this.statusCharacteristic.removeEventListener('characteristicvaluechanged', this.handleStatus)
    this.wifiScanCharacteristic.removeEventListener('characteristicvaluechanged', this.handleWifiScan)
    this.galleryCharacteristic?.removeEventListener('characteristicvaluechanged', this.handleGallery)
    this.bluetoothDevice.removeEventListener('gattserverdisconnected', this.handleDisconnected)
    Deferred.doneUnsafe(this.disconnected, Effect.fail(new DeviceProvisioningError({ code: 'connection-failed' })))
    for (const listener of this.disconnectListeners)
      listener()
    this.disconnectListeners.clear()
  }

  forget(): Effect.Effect<void, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('connection-failed', cause),
      try: async () => {
        await Effect.runPromise(this.close())
        await this.bluetoothDevice.forget?.()
      },
    })
  }

  private readonly handleStatus = (event: Event): void => {
    try {
      const characteristic = event.currentTarget as BluetoothCharacteristicAdapter | null
      const value = characteristic?.value
      if (!value)
        return
      const status = decodeEnvelope(value, 'status', parseApplyStatusEnvelope)
      const waiter = this.statusWaiters.get(status.requestId)
      if (!waiter)
        return
      this.statusWaiters.delete(status.requestId)
      Deferred.doneUnsafe(waiter, Effect.succeed(status))
    }
    catch (error) {
      for (const waiter of this.statusWaiters.values()) {
        Deferred.doneUnsafe(waiter, Effect.fail(toProvisioningError('protocol-error', error)))
      }
      this.statusWaiters.clear()
    }
  }

  private readonly handleWifiScan = (event: Event): void => {
    try {
      const value = (event.currentTarget as BluetoothCharacteristicAdapter | null)?.value
      if (!value)
        return
      const response = JSON.parse(new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))) as { requestId?: unknown, networks?: unknown }
      if (typeof response.requestId !== 'string' || !Array.isArray(response.networks))
        throw new Error('invalid Wi-Fi scan response')
      const waiter = this.wifiScanWaiters.get(response.requestId)
      if (waiter)
        Deferred.doneUnsafe(waiter, Effect.succeed(response.networks as readonly WifiNetwork[]))
    }
    catch (error) {
      for (const waiter of this.wifiScanWaiters.values())
        Deferred.doneUnsafe(waiter, Effect.fail(toProvisioningError('protocol-error', error)))
      this.wifiScanWaiters.clear()
    }
  }

  private readonly handleGallery = (event: Event): void => {
    try {
      const value = (event.currentTarget as BluetoothCharacteristicAdapter | null)?.value
      if (!value)
        return
      const frame = decodeFrame(viewBytes(value))
      if (this.galleryFrames.length === 0 || frame.index === 0)
        this.galleryFrames = []
      this.galleryFrames.push(frame)
      if (this.galleryFrames.length < frame.count)
        return
      const payload = reassembleFrames(this.galleryFrames)
      this.galleryFrames = []
      if (payload[0] !== 0x7B) {
        const response = parseTodoSyncResponse(payload)
        const waiter = this.todoWaiters.get(response.requestId)
        if (waiter)
          Deferred.doneUnsafe(waiter, Effect.succeed(response))
      }
      else {
        const raw = JSON.parse(new TextDecoder().decode(payload)) as GalleryResponse
        const waiter = this.galleryWaiters.get(String(raw.requestId))
        if (waiter)
          Deferred.doneUnsafe(waiter, Effect.succeed(raw))
      }
    }
    catch (error) {
      for (const waiter of this.galleryWaiters.values()) Deferred.doneUnsafe(waiter, Effect.fail(toProvisioningError('protocol-error', error)))
      this.galleryWaiters.clear()
      for (const waiter of this.todoWaiters.values())
        Deferred.doneUnsafe(waiter, Effect.fail(toProvisioningError('protocol-error', error)))
      this.todoWaiters.clear()
    }
  }
}

export class SerialProvisioningConnection implements DeviceProvisioningSession {
  private currentDevice: ProvisionedDevice | null = null
  private readonly disconnected = Deferred.makeUnsafe<never, DeviceProvisioningError>()
  private readonly disconnectListeners = new Set<() => void>()
  private readonly pending = new Map<string, Deferred.Deferred<SerialProvisioningResponse, DeviceProvisioningError>>()
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private closed = false

  private constructor(private readonly port: SerialPortAdapter) {
    this.port.addEventListener('disconnect', this.handleDisconnected)
    void this.readLoop()
  }

  static open(adapter: SerialAdapter): Effect.Effect<SerialProvisioningConnection, DeviceProvisioningError> {
    return Effect.acquireUseRelease(
      Effect.tryPromise({
        try: async () => {
          const port = await adapter.requestPort({
            // Let Electron receive every candidate and apply the authoritative
            // VID/PID filter in the main process. Chromium can omit or format
            // USB metadata differently before `select-serial-port`, which can
            // otherwise hide a valid ESP32-S3 port before the chooser opens.
            filters: [],
          })
          await port.open({ baudRate: 115_200 })
          return { connection: new SerialProvisioningConnection(port), transferred: false }
        },
        catch: cause => toProvisioningError(isSerialAccessDenied(cause) ? 'serial-access-denied' : 'connection-failed', cause),
      }),
      resource => Effect.gen(function* () {
        const response = yield* resource.connection.exchange({
          operation: 'read',
          protocolVersion: PROTOCOL_VERSION,
          requestId: globalThis.crypto.randomUUID(),
        })
        if (response.operation !== 'read')
          return yield* Effect.fail(new DeviceProvisioningError({ code: 'protocol-error' }))
        resource.connection.currentDevice = {
          config: response.publicConfig,
          info: response.deviceInfo,
          name: response.publicConfig.deviceName,
        }
        resource.transferred = true
        return resource.connection
      }),
      resource => resource.transferred ? Effect.void : resource.connection.close(),
    ).pipe(
      Effect.timeoutOrElse({
        duration: connectInitializationTimeoutMilliseconds,
        onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })),
      }),
    )
  }

  get connected(): boolean {
    return !this.closed && this.port.readable !== null && this.port.writable !== null
  }

  get device(): ProvisionedDevice {
    if (!this.currentDevice)
      throw new Error('Serial provisioning connection is not initialized')
    return this.currentDevice
  }

  subscribeDisconnected(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    if (!this.connected)
      listener()
    return () => this.disconnectListeners.delete(listener)
  }

  apply(patch: DeviceConfigPatch): Effect.Effect<ApplyStatusEnvelope, DeviceProvisioningError> {
    const requestId = globalThis.crypto.randomUUID()
    const request = createApplyRequest(this.device.config.revision, patch, requestId)
    return this.exchange({ operation: 'apply', request }).pipe(
      Effect.flatMap((response) => {
        if (response.operation !== 'apply')
          return Effect.fail(new DeviceProvisioningError({ code: 'protocol-error' }))
        if (response.status.status !== 'accepted') {
          return Effect.fail(new DeviceProvisioningError({
            cause: response.status.error,
            code: 'apply-rejected',
          }))
        }
        this.currentDevice = {
          ...this.device,
          config: applyConfigPatch(this.device.config, patch, response.status.revision),
        }
        return Effect.succeed(response.status)
      }),
      Effect.onError(() => this.close()),
      Effect.onInterrupt(() => this.close()),
    )
  }

  pushTodos(snapshot: DesktopDeviceTodoSnapshot): Effect.Effect<void, DeviceProvisioningError> {
    if (!todoSnapshotFitsProtocol(snapshot))
      return Effect.fail(new DeviceProvisioningError({ code: 'protocol-error' }))
    const requestId = globalThis.crypto.randomUUID()
    return this.exchange({
      operation: 'todo.sync',
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      snapshot,
    }).pipe(
      Effect.flatMap((response) => {
        if (response.operation !== 'todo.sync')
          return Effect.fail(new DeviceProvisioningError({ code: 'protocol-error' }))
        if (response.status !== 'accepted')
          return Effect.fail(new DeviceProvisioningError({ code: 'apply-rejected', cause: response.error }))
        return Effect.void
      }),
      Effect.onError(() => this.close()),
      Effect.onInterrupt(() => this.close()),
    )
  }

  scanWifi(): Effect.Effect<readonly WifiNetwork[], DeviceProvisioningError> {
    const requestId = globalThis.crypto.randomUUID()
    return this.exchange({ operation: 'scanWifi', protocolVersion: PROTOCOL_VERSION, requestId }).pipe(
      Effect.flatMap(response => response.operation === 'scanWifi'
        ? Effect.succeed(response.networks)
        : Effect.fail(new DeviceProvisioningError({ code: 'protocol-error' }))),
    )
  }

  loadGallery(): Effect.Effect<DesktopDeviceGalleryStatus, DeviceProvisioningError> {
    return this.galleryExchange({ operation: 'gallery.list' }).pipe(Effect.flatMap((response) => {
      if (response.status !== 'ok' || !response.gallery)
        return Effect.fail(new DeviceProvisioningError({ code: 'gallery-unavailable', cause: response.error }))
      return Effect.succeed(response.gallery as DesktopDeviceGalleryStatus)
    }))
  }

  uploadGalleryAsset(bytes: Uint8Array, name: string, createdAtUnixSeconds: number, onProgress?: GalleryUploadProgressListener): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryExchange({ operation: 'gallery.upload', bytesBase64: bytesToBase64(bytes), name, createdAtUnixSeconds }, onProgress).pipe(Effect.flatMap(response => this.galleryMutationResult(response)))
  }

  deleteGalleryAsset(id: number): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryExchange({ operation: 'gallery.delete', id }).pipe(Effect.flatMap(response => this.galleryMutationResult(response)))
  }

  reorderGallery(order: readonly number[]): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryExchange({ operation: 'gallery.reorder', order: [...order] }).pipe(Effect.flatMap(response => this.galleryMutationResult(response)))
  }

  setGallerySlideshow(intervalSeconds: number | null): Effect.Effect<void, DeviceProvisioningError> {
    return this.galleryExchange({ operation: 'gallery.slideshow', intervalSeconds }).pipe(Effect.flatMap(response => this.galleryMutationResult(response)))
  }

  private galleryExchange(request: GalleryCommand, onProgress?: GalleryUploadProgressListener): Effect.Effect<GalleryResponse, DeviceProvisioningError> {
    return this.exchange({ ...request, protocolVersion: PROTOCOL_VERSION, requestId: globalThis.crypto.randomUUID() } as SerialProvisioningRequest, onProgress).pipe(
      Effect.flatMap(response => isGalleryResponse(response)
        ? Effect.succeed(response)
        : Effect.fail(new DeviceProvisioningError({ code: 'protocol-error' }))),
    )
  }

  private galleryMutationResult(response: GalleryResponse): Effect.Effect<void, DeviceProvisioningError> {
    return response.status === 'ok'
      ? Effect.void
      : Effect.fail(new DeviceProvisioningError({ code: 'gallery-unavailable', cause: response.error }))
  }

  close(): Effect.Effect<void> {
    return Effect.promise(async () => {
      if (this.closed)
        return
      this.handleDisconnected()
      try {
        await this.reader?.cancel()
      }
      catch {
        // The serial device may already be gone.
      }
      try {
        await this.port.close()
      }
      catch {
        // Closing an already disconnected port is complete from the UI's perspective.
      }
    })
  }

  forget(): Effect.Effect<void, DeviceProvisioningError> {
    return Effect.tryPromise({
      try: async () => {
        await Effect.runPromise(this.close())
        await this.port.forget?.()
      },
      catch: cause => toProvisioningError('connection-failed', cause),
    })
  }

  private exchange(request: SerialProvisioningRequest, onProgress?: GalleryUploadProgressListener): Effect.Effect<SerialProvisioningResponse, DeviceProvisioningError> {
    const requestId = request.operation === 'apply' ? request.request.requestId : request.requestId
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const response = Deferred.makeUnsafe<SerialProvisioningResponse, DeviceProvisioningError>()
        this.pending.set(requestId, response)
        return response
      }),
      response => Effect.gen({ self: this }, function* () {
        if (!this.connected)
          return yield* Effect.fail(new DeviceProvisioningError({ code: 'connection-failed' }))
        yield* Effect.tryPromise({
          try: async () => {
            const writer = this.port.writable?.getWriter()
            if (!writer)
              throw new Error('Serial port is not writable')
            try {
              const encoded = encodeSerialProvisioningRequest(request)
              let sentBytes = 0
              onProgress?.({ sentBytes, totalBytes: encoded.byteLength })
              for (let offset = 0; offset < encoded.byteLength; offset += serialUploadChunkBytes) {
                const chunk = encoded.subarray(offset, Math.min(encoded.byteLength, offset + serialUploadChunkBytes))
                await writer.write(chunk)
                sentBytes += chunk.byteLength
                onProgress?.({ sentBytes, totalBytes: encoded.byteLength })
              }
            }
            finally {
              writer.releaseLock()
            }
          },
          catch: cause => toProvisioningError('connection-failed', cause),
        })
        return yield* Deferred.await(response).pipe(
          Effect.raceFirst(Deferred.await(this.disconnected)),
          Effect.timeoutOrElse({
            duration: applyTimeoutMilliseconds,
            onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })),
          }),
        )
      }),
      () => Effect.sync(() => this.pending.delete(requestId)),
    )
  }

  private async readLoop(): Promise<void> {
    const readable = this.port.readable
    if (!readable) {
      this.handleDisconnected()
      return
    }
    const reader = readable.getReader()
    this.reader = reader
    const decoder = new TextDecoder()
    let buffered = new Uint8Array()
    const prefix = new TextEncoder().encode(SERIAL_PROVISIONING_PREFIX)
    try {
      while (!this.closed) {
        const { done, value } = await reader.read()
        if (done)
          break
        const merged = new Uint8Array(buffered.byteLength + value.byteLength)
        merged.set(buffered)
        merged.set(value, buffered.byteLength)
        buffered = merged
        while (buffered.byteLength > 0) {
          const isPrefix = buffered.byteLength >= prefix.byteLength && prefix.every((byte, index) => buffered[index] === byte)
          if (isPrefix && buffered.byteLength >= prefix.byteLength + 4) {
            const headerOffset = prefix.byteLength
            const length = new DataView(buffered.buffer, buffered.byteOffset + headerOffset, 4).getUint32(0, true)
            const binaryHeader = buffered[headerOffset] !== 0x7B
              || buffered[headerOffset + 1] === 0
              || buffered[headerOffset + 2] === 0
              || buffered[headerOffset + 3] === 0
            if (!binaryHeader)
              break
            const total = prefix.byteLength + 4 + length
            if (length > 64 * 1024) {
              this.failPending(toProvisioningError('protocol-error', new Error('serial frame too large')))
              buffered = new Uint8Array()
              break
            }
            if (buffered.byteLength < total)
              break
            this.handleBytes(buffered.slice(0, total))
            buffered = buffered.slice(total)
            continue
          }
          const newline = buffered.indexOf(0x0A)
          if (newline < 0)
            break
          const line = decoder.decode(buffered.slice(0, newline)).replace(/\r$/u, '')
          buffered = buffered.slice(newline + 1)
          this.handleLine(line)
        }
        if (buffered.byteLength > 16_384)
          buffered = buffered.slice(-8_192)
      }
    }
    catch (cause) {
      if (!this.closed)
        this.failPending(toProvisioningError('connection-failed', cause))
    }
    finally {
      reader.releaseLock()
      if (this.reader === reader)
        this.reader = null
      this.handleDisconnected()
    }
  }

  private handleLine(line: string): void {
    if (!line.startsWith(SERIAL_PROVISIONING_PREFIX))
      return
    try {
      const response = parseSerialProvisioningResponse(line)
      if (!response)
        return
      const waiter = this.pending.get(response.requestId)
      if (waiter)
        Deferred.doneUnsafe(waiter, Effect.succeed(response))
    }
    catch (cause) {
      this.failPending(toProvisioningError('protocol-error', cause))
    }
  }

  private handleBytes(bytes: Uint8Array): void {
    try {
      const response = parseSerialProvisioningResponseBytes(bytes)
      if (!response)
        return
      const waiter = this.pending.get(response.requestId)
      if (waiter)
        Deferred.doneUnsafe(waiter, Effect.succeed(response))
    }
    catch (cause) {
      this.failPending(toProvisioningError('protocol-error', cause))
    }
  }

  private failPending(error: DeviceProvisioningError): void {
    for (const waiter of this.pending.values())
      Deferred.doneUnsafe(waiter, Effect.fail(error))
    this.pending.clear()
  }

  private readonly handleDisconnected = (): void => {
    if (this.closed)
      return
    this.closed = true
    this.port.removeEventListener('disconnect', this.handleDisconnected)
    const error = new DeviceProvisioningError({ code: 'connection-failed' })
    Deferred.doneUnsafe(this.disconnected, Effect.fail(error))
    this.failPending(error)
    for (const listener of this.disconnectListeners)
      listener()
    this.disconnectListeners.clear()
  }
}

type GalleryCommand
  = { operation: 'gallery.list' | 'gallery.refresh' | 'gallery.nextPage' | 'gallery.sleep' }
    | { operation: 'gallery.upload', bytesBase64: string, name: string, createdAtUnixSeconds: number }
    | { operation: 'gallery.delete', id: number }
    | { operation: 'gallery.reorder', order: number[] }
    | { operation: 'gallery.slideshow', intervalSeconds: number | null }

export class DeviceProvisioningService {
  constructor(
    private readonly adapter: BluetoothAdapter,
    private readonly bridge: PairingBridge,
    private readonly serial?: SerialAdapter,
  ) {}

  connect(transport: DeviceProvisioningTransport = 'bluetooth'): Effect.Effect<DeviceProvisioningSession, DeviceProvisioningError> {
    if (transport === 'serial') {
      if (!this.serial)
        return Effect.fail(new DeviceProvisioningError({ code: 'serial-unavailable' }))
      return SerialProvisioningConnection.open(this.serial)
    }
    const startedAt = Date.now()
    resetBleConnectDiagnostics()
    const request = <T>(
      stage: BleConnectStage,
      attempt: number,
      run: (signal: AbortSignal) => Promise<T>,
    ) => Effect.tryPromise({
      try: async (signal) => {
        recordBleConnectDiagnostic(stage, attempt, startedAt, 'start')
        try {
          const result = await run(signal)
          if (signal.aborted)
            throw abortReason(signal)
          recordBleConnectDiagnostic(stage, attempt, startedAt, 'success')
          return result
        }
        catch (cause) {
          recordBleConnectDiagnostic(stage, attempt, startedAt, 'failure', cause)
          throw cause
        }
      },
      catch: cause => toProvisioningError('connection-failed', cause),
    })
    const initialize = Effect.gen({ self: this }, function* () {
      // The product name remains stable when the service UUID changes to invalidate CoreBluetooth's GATT cache.
      const bluetoothDevice = yield* request('selection', 1, () => this.adapter.requestDevice({
        filters: [{ namePrefix: 'Memorilo' }],
        optionalServices: [PROVISIONING_UUIDS.service],
      }))
      if (!bluetoothDevice.gatt) {
        const cause = new DeviceProvisioningError({ code: 'connection-failed' })
        recordBleConnectDiagnostic('connect', 1, startedAt, 'failure', cause)
        return yield* Effect.fail(cause)
      }
      const gatt = bluetoothDevice.gatt
      const retryStartedAt = Date.now()
      return yield* connectWithRetry(attempt => Effect.acquireUseRelease(
        Effect.sync(() => ({ server: null as BluetoothServerAdapter | null, transferred: false })),
        resource => Effect.gen(function* () {
          const server = yield* request('connect', attempt, async (signal) => {
            const connected = await gatt.connect()
            // Web Bluetooth cannot abort connect(); reclaim a server that arrives after cancellation.
            if (signal.aborted) {
              if (connected.connected)
                connected.disconnect()
              throw abortReason(signal)
            }
            if (!connected.connected)
              throw new DeviceProvisioningError({ code: 'connection-failed' })
            resource.server = connected
            return connected
          })
          const service = yield* request('service', attempt, () => server.getPrimaryService(PROVISIONING_UUIDS.service))
          const infoCharacteristic = yield* request(
            'characteristics',
            attempt,
            () => service.getCharacteristic(PROVISIONING_UUIDS.deviceInfo),
          )
          const configCharacteristic = yield* request(
            'characteristics',
            attempt,
            () => service.getCharacteristic(PROVISIONING_UUIDS.publicConfig),
          )
          const configContinuationCharacteristic = yield* request(
            'characteristics',
            attempt,
            () => service.getCharacteristic(PROVISIONING_UUIDS.publicConfigContinuation),
          )
          const applyCharacteristic = yield* request(
            'characteristics',
            attempt,
            () => service.getCharacteristic(PROVISIONING_UUIDS.configApply),
          )
          const statusCharacteristic = yield* request(
            'characteristics',
            attempt,
            () => service.getCharacteristic(PROVISIONING_UUIDS.status),
          )
          const wifiScanCharacteristic = yield* request(
            'characteristics',
            attempt,
            () => service.getCharacteristic(PROVISIONING_UUIDS.wifiScan),
          )
          let galleryCharacteristic: BluetoothCharacteristicAdapter | undefined
          try {
            galleryCharacteristic = yield* request('characteristics', attempt, () => service.getCharacteristic(galleryCharacteristicUuid))
          }
          catch {
            galleryCharacteristic = undefined
          }
          yield* request('notifications', attempt, () => statusCharacteristic.startNotifications())
          yield* request('notifications', attempt, () => wifiScanCharacteristic.startNotifications())
          if (galleryCharacteristic)
            yield* request('notifications', attempt, () => galleryCharacteristic.startNotifications())
          const infoValue = yield* request('read', attempt, () => infoCharacteristic.readValue())
          const configValue = yield* request('read', attempt, () => configCharacteristic.readValue())
          const configContinuationValue = yield* request(
            'read',
            attempt,
            () => configContinuationCharacteristic.readValue(),
          )
          return yield* Effect.try({
            try: () => {
              recordBleConnectDiagnostic('decode', attempt, startedAt, 'start')
              try {
                const info = decodeEnvelope(infoValue, 'device-info', parseDeviceInfoEnvelope)
                const config = decodeEnvelope(
                  concatDataViews(configValue, configContinuationValue),
                  'public-config',
                  parsePublicConfigEnvelope,
                )
                const connection = new DeviceProvisioningConnection(
                  { config, info, name: bluetoothDevice.name ?? config.deviceName },
                  bluetoothDevice,
                  server,
                  applyCharacteristic,
                  statusCharacteristic,
                  wifiScanCharacteristic,
                  galleryCharacteristic,
                )
                resource.transferred = true
                recordBleConnectDiagnostic('decode', attempt, startedAt, 'success')
                return connection
              }
              catch (cause) {
                recordBleConnectDiagnostic('decode', attempt, startedAt, 'failure', cause)
                throw cause
              }
            },
            catch: cause => toProvisioningError('protocol-error', cause),
          })
        }),
        resource => Effect.sync(() => {
          if (!resource.transferred && resource.server?.connected)
            resource.server.disconnect()
        }),
      ), retryStartedAt)
    })
    return initialize.pipe(
      Effect.timeoutOrElse({
        duration: connectInitializationTimeoutMilliseconds,
        onTimeout: () => Effect.fail(new DeviceProvisioningError({ code: 'timeout' })),
      }),
    )
  }

  selectDevice(device: DesktopProvisioningDevice): Effect.Effect<void, DeviceProvisioningError> {
    return this.bridgeEffect(() => this.bridge.selectDevice(device.deviceId, device.transport))
  }

  cancelSelection(): Effect.Effect<void, DeviceProvisioningError> {
    return this.bridgeEffect(() => this.bridge.cancelSelection())
  }

  clearLocalManagementToken(deviceId: string): Effect.Effect<void, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.clearLocalManagementToken(deviceId))
  }

  generateLocalManagementToken(): Effect.Effect<string, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.generateLocalManagementToken())
  }

  hasLocalManagementToken(deviceId: string): Effect.Effect<boolean, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.hasLocalManagementToken(deviceId))
  }

  deleteGalleryAsset(target: DesktopDeviceGalleryTarget, id: number): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.deleteGalleryAsset(target, id))
  }

  loadGallery(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceGalleryStatus, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadGallery(target))
  }

  loadStatus(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceStatus, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadStatus(target))
  }

  loadTodos(target: DesktopDeviceGalleryTarget): Effect.Effect<DesktopDeviceTodoState, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadTodos(target))
  }

  loadTodoSnapshot(): Effect.Effect<DesktopDeviceTodoSnapshot, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadTodoSnapshot())
  }

  loadTodoTarget(deviceId: string): Effect.Effect<DesktopDeviceTodoTargetState, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.loadTodoTarget(deviceId))
  }

  pushTodos(input: DesktopDeviceTodoPush): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.pushTodos(input))
  }

  refreshDevice(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.refreshDevice(target))
  }

  nextDevicePage(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.nextDevicePage(target))
  }

  sleepDevice(target: DesktopDeviceGalleryTarget): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.sleepDevice(target))
  }

  reorderGallery(target: DesktopDeviceGalleryTarget, order: readonly number[]): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.reorderGallery(target, order))
  }

  respondToPairing(response: DesktopProvisioningPairingResponse): Effect.Effect<void, DeviceProvisioningError> {
    return this.bridgeEffect(() => this.bridge.respondToPairing(response))
  }

  saveLocalManagementToken(deviceId: string, token: string): Effect.Effect<void, DeviceProvisioningError> {
    return this.credentialEffect(() => this.bridge.saveLocalManagementToken(deviceId, token))
  }

  saveTodoTarget(deviceId: string, address: string | null): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.saveTodoTarget(deviceId, address))
  }

  setGallerySlideshow(
    target: DesktopDeviceGalleryTarget,
    intervalSeconds: number | null,
  ): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.setGallerySlideshow(target, intervalSeconds))
  }

  uploadGalleryAsset(input: DesktopDeviceGalleryUpload, onProgress?: GalleryUploadProgressListener): Effect.Effect<void, DeviceProvisioningError> {
    return this.managementEffect(() => this.bridge.uploadGalleryAsset(input, onProgress))
  }

  subscribeDevices(listener: (devices: readonly DesktopProvisioningDevice[], transport?: DeviceProvisioningTransport) => void): () => void {
    return this.bridge.subscribeDevices(listener)
  }

  subscribePairing(listener: (request: DesktopProvisioningPairingRequest) => void): () => void {
    return this.bridge.subscribePairing(listener)
  }

  private bridgeEffect(operation: () => Promise<void>): Effect.Effect<void, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('connection-failed', cause),
      try: operation,
    })
  }

  private credentialEffect<Value>(operation: () => Promise<Value>): Effect.Effect<Value, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('secure-storage', cause),
      try: operation,
    })
  }

  private managementEffect<Value>(operation: () => Promise<Value>): Effect.Effect<Value, DeviceProvisioningError> {
    return Effect.tryPromise({
      catch: cause => toProvisioningError('local-management', cause),
      try: operation,
    })
  }
}

export function createDeviceProvisioningService(): DeviceProvisioningService {
  const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothAdapter }).bluetooth
  const serial = (navigator as Navigator & { serial?: SerialAdapter }).serial
  if (!bluetooth) {
    const unavailable: BluetoothAdapter = {
      requestDevice: async () => {
        throw new DeviceProvisioningError({ code: 'bluetooth-unavailable' })
      },
    }
    return new DeviceProvisioningService(unavailable, window.desktop.deviceProvisioning, serial)
  }
  return new DeviceProvisioningService(bluetooth, window.desktop.deviceProvisioning, serial)
}

function connectWithRetry(
  initialize: (attempt: number) => Effect.Effect<DeviceProvisioningConnection, DeviceProvisioningError>,
  startedAt: number,
): Effect.Effect<DeviceProvisioningConnection, DeviceProvisioningError> {
  return Effect.gen(function* () {
    let attempt = 1
    while (true) {
      const result = yield* Effect.result(initialize(attempt))
      if (result._tag === 'Success')
        return result.success
      const remaining = connectRetryWindowMilliseconds - (Date.now() - startedAt)
      if (remaining <= 0)
        return yield* Effect.fail(result.failure)
      attempt += 1
      yield* Effect.sleep(Math.min(connectRetryDelayMilliseconds, remaining))
    }
  })
}
