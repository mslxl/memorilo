import type { IpcRenderer } from 'electron'
import type { DesktopIpcClient } from './ipc-contract'
import { desktopIpcChannels } from './ipc-contract'
import { decodeDesktopIpcEnvelope, DesktopIpcError } from './ipc-wire'

type Invoke = <Result>(channel: string, ...args: unknown[]) => Promise<Result>

function createGroupClient<Group extends keyof DesktopIpcClient>(
  group: Group,
  invoke: Invoke,
): DesktopIpcClient[Group] {
  const channels = desktopIpcChannels[group] as Readonly<Record<string, string>>
  return Object.fromEntries(
    Object.entries(channels).map(([method, channel]) => [
      method,
      (...args: unknown[]) => invoke(channel, ...args),
    ]),
  ) as DesktopIpcClient[Group]
}

export function createDesktopIpcClient(renderer: Pick<IpcRenderer, 'invoke'>): DesktopIpcClient {
  const invoke: Invoke = async <Result>(channel: string, ...args: unknown[]): Promise<Result> => {
    const envelope = decodeDesktopIpcEnvelope(channel, await renderer.invoke(channel, ...args))
    if (envelope.status === 'failure')
      throw new DesktopIpcError(channel, envelope.error)
    return envelope.value as Result
  }
  return {
    todoCalendarFeed: createGroupClient('todoCalendarFeed', invoke),
    p2p: createGroupClient('p2p', invoke),
    transport: createGroupClient('transport', invoke),
    whiteboardLibrary: createGroupClient('whiteboardLibrary', invoke),
  }
}
