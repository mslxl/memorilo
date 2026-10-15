import type { DesktopP2pLocalDevice, DesktopP2pPairedDevice, DesktopP2pStatus, DesktopSyncServerStatus } from '@memorilo/desktop-api'
import type { DesktopIpcClient } from '@memorilo/desktop-preload/ipc'
import type { WebContents } from 'electron'
import {
  desktopIpcChannels,
  desktopIpcFailure,
  desktopIpcSuccess,
} from '@memorilo/desktop-preload/ipc'
import {
  createOperationSupervisor,
  createResourceScope,
} from '@memorilo/effect-lifecycle'

export interface IpcInvocationContext {
  sender: WebContents
}

interface ContextualIpcHandler<Arguments extends readonly unknown[], Result> {
  readonly invoke: (
    context: IpcInvocationContext,
    ...args: Arguments
  ) => Promise<Result> | Result
}

type ContextualHandlerFor<Method> = Method extends (...args: infer Arguments) => Promise<infer Result>
  ? ContextualIpcHandler<Arguments, Result>
  : never

export interface DesktopIpcHandlers {
  readonly todoCalendarFeed: NonNullable<DesktopIpcClient['todoCalendarFeed']>
  readonly transport: {
    readonly fetch: ContextualHandlerFor<DesktopIpcClient['transport']['fetch']>
  }
  readonly whiteboardLibrary: {
    readonly load: DesktopIpcClient['whiteboardLibrary']['load']
    readonly save: DesktopIpcClient['whiteboardLibrary']['save']
  }
  readonly p2p: {
    readonly approvePairing: (requestId: string) => Promise<string>
    readonly acceptInvitation: (invitation: string, dialTarget?: string) => Promise<string>
    readonly confirmPairing: (requestId: string, emoji: string) => Promise<DesktopP2pPairedDevice | null>
    readonly completePairing: (response: string) => Promise<DesktopP2pPairedDevice>
    readonly createInvitation: () => Promise<string>
    readonly enableDiscovery: () => Promise<number>
    readonly getLocalDevice: () => DesktopP2pLocalDevice
    readonly getPairingRequests: () => Promise<readonly { requestId: string, deviceId: string, deviceName: string, peerId: string, emoji: string }[]>
    readonly getServerStatus: () => DesktopSyncServerStatus
    readonly getStatus: () => DesktopP2pStatus
    readonly installServerCredential: (credential: string) => Promise<void>
    readonly listDevices: () => readonly DesktopP2pPairedDevice[]
    readonly listDiscoveredPeers: () => Promise<readonly { deviceId: string, deviceName: string, peerId: string }[]>
    readonly requestPairing: (peerId: string) => Promise<{ requestId: string, deviceId: string, deviceName: string, peerId: string }>
    readonly removeDevice: (deviceId: string) => Promise<void>
    readonly updateDeviceName: (deviceName: string) => Promise<void>
  }
}

export interface IpcHandlerHost {
  handle: (
    channel: string,
    handler: (event: { sender: WebContents }, ...args: unknown[]) => unknown,
  ) => void
  removeHandler: (channel: string) => void
}

export interface IpcHandlerRegistry {
  close: () => Promise<void>
}

type RuntimeHandler
  = | ((...args: unknown[]) => unknown)
    | ContextualIpcHandler<readonly unknown[], unknown>

export function withIpcContext<Arguments extends readonly unknown[], Result>(
  invoke: (
    context: IpcInvocationContext,
    ...args: Arguments
  ) => Promise<Result> | Result,
): ContextualIpcHandler<Arguments, Result> {
  return { invoke }
}

async function invokeHandler(
  handler: RuntimeHandler,
  context: IpcInvocationContext,
  args: unknown[],
): Promise<unknown> {
  return typeof handler === 'function'
    ? await handler(...args)
    : await handler.invoke(context, ...args)
}

export async function createIpcHandlerRegistry(
  handlers: DesktopIpcHandlers,
  options: { host: IpcHandlerHost },
): Promise<IpcHandlerRegistry> {
  const admission = createOperationSupervisor('Desktop IPC transport', {
    closedError: () => new Error('Desktop IPC transport is shutting down'),
    concurrency: 'unbounded',
  })
  const resources = createResourceScope('Desktop IPC registry', { closeMode: 'dependent' })
  // Handlers are registered after admission. Dependent reverse-order cleanup
  // therefore drains accepted calls before unregistering their channels.
  resources.own({ close: admission.close, name: 'Desktop IPC admission' })

  try {
    for (const [groupName, groupChannels] of Object.entries(desktopIpcChannels)) {
      const groupHandlers = handlers[groupName as keyof DesktopIpcHandlers] as Record<string, RuntimeHandler>
      for (const [methodName, channel] of Object.entries(groupChannels)) {
        const handler = groupHandlers[methodName]
        if (handler === undefined)
          throw new Error(`Missing IPC handler for ${groupName}.${methodName}`)
        options.host.handle(channel, async (event, ...args) => {
          try {
            const result = await admission.run(() => invokeHandler(handler, { sender: event.sender }, args))
            return desktopIpcSuccess(result)
          }
          catch (error) {
            return desktopIpcFailure(error)
          }
        })
        resources.own({
          close: () => options.host.removeHandler(channel),
          name: `IPC handler ${channel}`,
        })
      }
    }
    resources.commit()
  }
  catch (error) {
    return resources.rollback(error)
  }
  return { close: resources.close }
}
