import type { DesktopP2pDiscoveredPeer, DesktopP2pLocalDevice, DesktopP2pPairedDevice, DesktopP2pPairingRequest, DesktopP2pStatus, DesktopSyncServerStatus, DesktopTodoCalendarFeed } from '@memorilo/desktop-api'
import type { DesktopFetchRequest, DesktopFetchResponse } from '@memorilo/desktop-api/transport'
import type { DesktopWhiteboardLibraryData } from './contract'

export {
  decodeDesktopIpcEnvelope,
  DesktopIpcError,
  desktopIpcFailure,
  DesktopIpcProtocolError,
  desktopIpcSuccess,
} from './ipc-wire'
export type { DesktopIpcEnvelope, DesktopIpcFailure } from './ipc-wire'

export interface DesktopIpcClient {
  transport: {
    fetch: (request: DesktopFetchRequest) => Promise<DesktopFetchResponse>
  }
  whiteboardLibrary: {
    load: () => Promise<DesktopWhiteboardLibraryData>
    save: (data: DesktopWhiteboardLibraryData) => Promise<void>
  }
  p2p?: {
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
  todoCalendarFeed?: {
    get: () => Promise<DesktopTodoCalendarFeed>
    issue: () => Promise<DesktopTodoCalendarFeed>
    revoke: () => Promise<void>
  }
}

type DesktopIpcChannels = {
  readonly [Group in keyof DesktopIpcClient]: {
    readonly [Method in keyof DesktopIpcClient[Group]]: string
  }
}

export const desktopIpcChannels = {
  transport: {
    fetch: 'memorilo:invoke:transport:fetch',
  },
  whiteboardLibrary: {
    load: 'memorilo:invoke:whiteboardLibrary:load',
    save: 'memorilo:invoke:whiteboardLibrary:save',
  },
  p2p: {
    approvePairing: 'memorilo:invoke:p2p:approvePairing',
    acceptInvitation: 'memorilo:invoke:p2p:acceptInvitation',
    confirmPairing: 'memorilo:invoke:p2p:confirmPairing',
    completePairing: 'memorilo:invoke:p2p:completePairing',
    createInvitation: 'memorilo:invoke:p2p:createInvitation',
    enableDiscovery: 'memorilo:invoke:p2p:enableDiscovery',
    getLocalDevice: 'memorilo:invoke:p2p:getLocalDevice',
    getPairingRequests: 'memorilo:invoke:p2p:getPairingRequests',
    getServerStatus: 'memorilo:invoke:p2p:getServerStatus',
    getStatus: 'memorilo:invoke:p2p:getStatus',
    installServerCredential: 'memorilo:invoke:p2p:installServerCredential',
    listDevices: 'memorilo:invoke:p2p:listDevices',
    listDiscoveredPeers: 'memorilo:invoke:p2p:listDiscoveredPeers',
    requestPairing: 'memorilo:invoke:p2p:requestPairing',
    removeDevice: 'memorilo:invoke:p2p:removeDevice',
    updateDeviceName: 'memorilo:invoke:p2p:updateDeviceName',
  },
  todoCalendarFeed: {
    get: 'memorilo:invoke:todoCalendarFeed:get',
    issue: 'memorilo:invoke:todoCalendarFeed:issue',
    revoke: 'memorilo:invoke:todoCalendarFeed:revoke',
  },
} as const satisfies DesktopIpcChannels
