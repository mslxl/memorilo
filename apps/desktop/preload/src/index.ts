import type { DesktopApi, DesktopConfiguration, DesktopDeviceGalleryUploadProgressEvent, DesktopNoteExternalUpdate, DesktopProvisioningDevicesChanged, DesktopProvisioningPairingRequest, DesktopSyncServerEvent } from './contract'
import type { NoteSaveRequest } from './note-save-handshake'
import { desktopProvisioningChannels, desktopSyncServerEventChannel } from '@memorilo/desktop-api'
import { desktopConfigurationChangedChannel } from '@memorilo/desktop-config/contract'
import { Match } from 'effect'
import { contextBridge, ipcRenderer } from 'electron'

import { desktopCustomTitlebarArgument } from './contract'
import { createDesktopApi } from './desktop-api'
import { createDesktopIpcClient } from './ipc-client'
import { createNoteSaveCoordinator } from './note-save-coordinator'
import { noteSaveRequestChannel, noteSaveResultChannel } from './note-save-handshake'

const p2pStatusChannel = 'memorilo:p2p-status'
const learningUpdateChannel = 'memorilo:learning-update'

const services = createDesktopIpcClient(ipcRenderer)

const deviceProvisioning: DesktopApi['deviceProvisioning'] = {
  cancelSelection: () => ipcRenderer.invoke(desktopProvisioningChannels.selectDevice, null),
  clearLocalManagementToken: deviceId => ipcRenderer.invoke(desktopProvisioningChannels.clearLocalManagementToken, deviceId),
  deleteGalleryAsset: (target, id) => ipcRenderer.invoke(
    desktopProvisioningChannels.deleteGalleryAsset,
    { ...target, id },
  ),
  generateLocalManagementToken: () => ipcRenderer.invoke(desktopProvisioningChannels.generateLocalManagementToken),
  hasLocalManagementToken: deviceId => ipcRenderer.invoke(desktopProvisioningChannels.hasLocalManagementToken, deviceId),
  loadGallery: target => ipcRenderer.invoke(desktopProvisioningChannels.loadGallery, target),
  loadStatus: target => ipcRenderer.invoke(desktopProvisioningChannels.loadStatus, target),
  loadTodos: target => ipcRenderer.invoke(desktopProvisioningChannels.loadTodos, target),
  loadTodoSnapshot: () => ipcRenderer.invoke(desktopProvisioningChannels.loadTodoSnapshot),
  loadTodoTarget: deviceId => ipcRenderer.invoke(desktopProvisioningChannels.loadTodoTarget, deviceId),
  pushTodos: input => ipcRenderer.invoke(desktopProvisioningChannels.pushTodos, input),
  refreshDevice: target => ipcRenderer.invoke(desktopProvisioningChannels.refreshDevice, target),
  nextDevicePage: target => ipcRenderer.invoke(desktopProvisioningChannels.nextDevicePage, target),
  sleepDevice: target => ipcRenderer.invoke(desktopProvisioningChannels.sleepDevice, target),
  reorderGallery: (target, order) => ipcRenderer.invoke(
    desktopProvisioningChannels.reorderGallery,
    { ...target, order },
  ),
  respondToPairing: response => ipcRenderer.invoke(desktopProvisioningChannels.respondToPairing, response),
  saveLocalManagementToken: (deviceId, token) => ipcRenderer.invoke(
    desktopProvisioningChannels.saveLocalManagementToken,
    { deviceId, token },
  ),
  saveTodoTarget: (deviceId, address) => ipcRenderer.invoke(
    desktopProvisioningChannels.saveTodoTarget,
    { address, deviceId },
  ),
  setGallerySlideshow: (target, intervalSeconds) => ipcRenderer.invoke(
    desktopProvisioningChannels.setGallerySlideshow,
    { ...target, intervalSeconds },
  ),
  selectDevice: (deviceId, transport) => transport === undefined
    ? ipcRenderer.invoke(desktopProvisioningChannels.selectDevice, deviceId)
    : ipcRenderer.invoke(desktopProvisioningChannels.selectDevice, deviceId, transport),
  subscribeDevices: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, payload: DesktopProvisioningDevicesChanged) => listener(payload.devices, payload.transport)
    ipcRenderer.on(desktopProvisioningChannels.devicesChanged, handle)
    return () => ipcRenderer.removeListener(desktopProvisioningChannels.devicesChanged, handle)
  },
  subscribePairing: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, request: DesktopProvisioningPairingRequest) => listener(request)
    ipcRenderer.on(desktopProvisioningChannels.pairingRequested, handle)
    return () => ipcRenderer.removeListener(desktopProvisioningChannels.pairingRequested, handle)
  },
  uploadGalleryAsset: async (input, onProgress) => {
    const requestId = globalThis.crypto.randomUUID()
    const handleProgress = (
      _event: Electron.IpcRendererEvent,
      progress: DesktopDeviceGalleryUploadProgressEvent,
    ): void => {
      if (progress.requestId === requestId)
        onProgress?.({ sentBytes: progress.sentBytes, totalBytes: progress.totalBytes })
    }
    if (onProgress)
      ipcRenderer.on(desktopProvisioningChannels.galleryUploadProgress, handleProgress)
    try {
      await ipcRenderer.invoke(desktopProvisioningChannels.uploadGalleryAsset, {
        ...input,
        requestId,
      })
    }
    finally {
      if (onProgress)
        ipcRenderer.removeListener(desktopProvisioningChannels.galleryUploadProgress, handleProgress)
    }
  },
}

function subscribeConfiguration(listener: (configuration: DesktopConfiguration) => void): () => void {
  const handleChange = (_event: Electron.IpcRendererEvent, configuration: DesktopConfiguration) => {
    listener(configuration)
  }
  ipcRenderer.on(desktopConfigurationChangedChannel, handleChange)
  return () => ipcRenderer.removeListener(desktopConfigurationChangedChannel, handleChange)
}

const noteSaveCoordinator = createNoteSaveCoordinator(result => ipcRenderer.send(noteSaveResultChannel, result))
// Sandboxed preloads expose process.platform but cannot require node:process.
// eslint-disable-next-line node/prefer-global/process
const nativePlatform = process.platform
// eslint-disable-next-line node/prefer-global/process
const customTitlebarEnabled = process.argv.includes(desktopCustomTitlebarArgument)
const platform = Match.value(nativePlatform).pipe(
  Match.when('darwin', () => 'macos' as const),
  Match.when('win32', () => 'windows' as const),
  Match.when('linux', () => 'linux' as const),
  Match.orElse(() => 'other' as const),
)
ipcRenderer.on(noteSaveRequestChannel, async (_event, request: NoteSaveRequest) => {
  await noteSaveCoordinator.handle(request.requestId)
})
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void noteSaveCoordinator.close().catch(error => console.error(
      'Failed to close the renderer Note save coordinator',
      error,
    ))
  }, { once: true })
}

function subscribeNoteSaveRequests(listener: Parameters<DesktopApi['subscribeNoteSaveRequests']>[0]): () => void {
  return noteSaveCoordinator.subscribe(listener)
}

function subscribeNoteUpdates(listener: Parameters<DesktopApi['subscribeNoteUpdates']>[0]): () => void {
  const handleUpdate = (_event: Electron.IpcRendererEvent, update: DesktopNoteExternalUpdate) => {
    listener(update)
  }
  ipcRenderer.on('memorilo:note-update', handleUpdate)
  return () => ipcRenderer.removeListener('memorilo:note-update', handleUpdate)
}

function subscribeLearningUpdates(listener: Parameters<DesktopApi['subscribeLearningUpdates']>[0]): () => void {
  const handleUpdate = () => listener()
  ipcRenderer.on(learningUpdateChannel, handleUpdate)
  return () => ipcRenderer.removeListener(learningUpdateChannel, handleUpdate)
}

function subscribeP2pStatus(listener: Parameters<DesktopApi['subscribeP2pStatus']>[0]): () => void {
  const handleStatus = (_event: Electron.IpcRendererEvent, status: Parameters<DesktopApi['subscribeP2pStatus']>[0] extends (status: infer Status) => void ? Status : never) => listener(status)
  ipcRenderer.on(p2pStatusChannel, handleStatus)
  return () => ipcRenderer.removeListener(p2pStatusChannel, handleStatus)
}

function subscribeSyncServerEvents(listener: Parameters<DesktopApi['subscribeSyncServerEvents']>[0]): () => void {
  const handleEvent = (_event: Electron.IpcRendererEvent, event: DesktopSyncServerEvent) => listener(event)
  ipcRenderer.on(desktopSyncServerEventChannel, handleEvent)
  return () => ipcRenderer.removeListener(desktopSyncServerEventChannel, handleEvent)
}

contextBridge.exposeInMainWorld(
  'desktop',
  createDesktopApi(
    platform,
    services,
    subscribeConfiguration,
    subscribeNoteSaveRequests,
    subscribeNoteUpdates,
    subscribeP2pStatus,
    subscribeLearningUpdates,
    subscribeSyncServerEvents,
    deviceProvisioning,
    customTitlebarEnabled,
  ),
)
