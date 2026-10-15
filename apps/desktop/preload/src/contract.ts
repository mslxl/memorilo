import type {
  DesktopConfiguration,
  DesktopDeviceGalleryStatus,
  DesktopDeviceGalleryTarget,
  DesktopDeviceGalleryUpload,
  DesktopDeviceGalleryUploadProgress,
  DesktopDeviceStatus,
  DesktopDeviceTodoPush,
  DesktopDeviceTodoSnapshot,
  DesktopDeviceTodoState,
  DesktopDeviceTodoTargetState,
  DesktopNoteExternalUpdate,
  DesktopP2pDiscoveredPeer,
  DesktopP2pLocalDevice,
  DesktopP2pPairedDevice,
  DesktopP2pPairingRequest,
  DesktopP2pStatus,
  DesktopProvisioningDevice,
  DesktopProvisioningPairingRequest,
  DesktopProvisioningPairingResponse,
  DesktopProvisioningTransport,
  DesktopSyncServerEvent,
  DesktopSyncServerStatus,
  DesktopTodoCalendarFeed,
  DesktopWhiteboardLibraryData,
} from '@memorilo/desktop-api'
import type {
  DesktopFetchRequest,
  DesktopFetchResponse,
} from '@memorilo/desktop-api/transport'

export type * from '@memorilo/desktop-api'

export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'other'

export const desktopCustomTitlebarArgument = '--memorilo-custom-titlebar'

export interface DesktopApi {
  readonly customTitlebarEnabled: boolean
  readonly platform: DesktopPlatform
  deviceProvisioning: {
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
    selectDevice: (deviceId: string, transport?: 'bluetooth' | 'serial') => Promise<void>
    subscribeDevices: (listener: (devices: readonly DesktopProvisioningDevice[], transport?: DesktopProvisioningTransport) => void) => () => void
    subscribePairing: (listener: (request: DesktopProvisioningPairingRequest) => void) => () => void
    uploadGalleryAsset: (
      input: DesktopDeviceGalleryUpload,
      onProgress?: (progress: DesktopDeviceGalleryUploadProgress) => void,
    ) => Promise<void>
  }
  loadWhiteboardLibrary: () => Promise<DesktopWhiteboardLibraryData>
  request: (request: DesktopFetchRequest) => Promise<DesktopFetchResponse>
  saveWhiteboardLibrary: (data: DesktopWhiteboardLibraryData) => Promise<void>
  p2p: {
    approvePairing: (requestId: string) => Promise<string>
    acceptInvitation: (invitation: string, dialTarget?: string) => Promise<string>
    confirmPairing: (requestId: string, emoji: string) => Promise<DesktopP2pPairedDevice | null>
    completePairing: (response: string) => Promise<DesktopP2pPairedDevice>
    createInvitation: () => Promise<string>
    enableDiscovery: () => Promise<number>
    getLocalDevice: () => Promise<DesktopP2pLocalDevice>
    getPairingRequests: () => Promise<readonly DesktopP2pPairingRequest[]>
    getServerStatus: () => Promise<DesktopSyncServerStatus>
    getStatus: () => Promise<DesktopP2pStatus>
    installServerCredential: (credential: string) => Promise<void>
    listDevices: () => Promise<readonly DesktopP2pPairedDevice[]>
    listDiscoveredPeers: () => Promise<readonly DesktopP2pDiscoveredPeer[]>
    requestPairing: (peerId: string) => Promise<DesktopP2pPairingRequest>
    removeDevice: (deviceId: string) => Promise<void>
    updateDeviceName: (deviceName: string) => Promise<void>
  }
  todoCalendarFeed: {
    get: () => Promise<DesktopTodoCalendarFeed>
    issue: () => Promise<DesktopTodoCalendarFeed>
    revoke: () => Promise<void>
  }
  subscribeConfiguration: (listener: (configuration: DesktopConfiguration) => void) => () => void
  subscribeLearningUpdates: (listener: () => void) => () => void
  subscribeNoteSaveRequests: (listener: () => Promise<void>) => () => void
  subscribeNoteUpdates: (listener: (update: DesktopNoteExternalUpdate) => void) => () => void
  subscribeP2pStatus: (listener: (status: DesktopP2pStatus) => void) => () => void
  subscribeSyncServerEvents: (listener: (event: DesktopSyncServerEvent) => void) => () => void
}
