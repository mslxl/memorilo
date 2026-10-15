import type { DesktopDeviceTodoPush, DesktopDeviceTodoPushStatus, DesktopDeviceTodoSnapshot, DesktopDeviceTodoStatusValue } from '@memorilo/desktop-api'
import type { TodoTask } from '@memorilo/editor-storage'
import { createHash } from 'node:crypto'

export interface TodoDevicePushTarget {
  readonly address: string
  readonly deviceId: string
}

export interface TodoDevicePushService {
  readonly close: () => void
  readonly notifyLocalMutation: () => void
  readonly setTargets: (targets: readonly TodoDevicePushTarget[]) => void
  readonly statuses: () => readonly DesktopDeviceTodoPushStatus[]
  readonly snapshot: () => Promise<DesktopDeviceTodoSnapshot>
}

interface TodoDevicePushServiceOptions {
  readonly listTasks: () => Promise<readonly TodoTask[]>
  readonly push: (input: DesktopDeviceTodoPush) => Promise<void>
  readonly targets: readonly TodoDevicePushTarget[]
  readonly debounceMs?: number
  readonly now?: () => Date
}

const maxTasks = 64

export function createTodoDevicePushService(options: TodoDevicePushServiceOptions): TodoDevicePushService {
  const now = options.now ?? (() => new Date())
  const debounceMs = options.debounceMs ?? 750
  let targets = [...options.targets]
  const statuses = new Map<string, DesktopDeviceTodoPushStatus>(targets.map(target => [
    target.deviceId,
    { address: target.address, deviceId: target.deviceId, lastError: null, phase: 'idle', revision: null },
  ]))
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let generation = 0
  let flush: (run: number) => Promise<void>

  const notifyLocalMutation = (): void => {
    if (closed || targets.length === 0)
      return
    statuses.forEach((status, deviceId) => statuses.set(deviceId, { ...status, phase: 'pending', lastError: null }))
    if (timer !== null)
      clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush(++generation)
    }, debounceMs)
  }

  flush = async (run: number): Promise<void> => {
    if (closed)
      return
    try {
      const snapshot = await buildSnapshot(await options.listTasks(), now())
      if (closed || run !== generation)
        return
      await Promise.all(targets.map(async (target) => {
        try {
          await options.push({ ...target, snapshot })
          statuses.set(target.deviceId, {
            address: target.address,
            deviceId: target.deviceId,
            lastError: null,
            phase: 'success',
            revision: snapshot.revision,
          })
        }
        catch (error) {
          statuses.set(target.deviceId, {
            address: target.address,
            deviceId: target.deviceId,
            lastError: error instanceof Error ? error.message : 'lan-push-failed',
            phase: 'error',
            revision: snapshot.revision,
          })
        }
      }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'todo-snapshot-failed'
      statuses.forEach((status, deviceId) => statuses.set(deviceId, { ...status, lastError: message, phase: 'error' }))
    }
  }

  return {
    close() {
      closed = true
      generation += 1
      if (timer !== null)
        clearTimeout(timer)
      timer = null
    },
    notifyLocalMutation,
    setTargets(nextTargets) {
      if (closed)
        return
      targets = [...nextTargets]
      const targetIds = new Set(targets.map(target => target.deviceId))
      for (const deviceId of statuses.keys()) {
        if (!targetIds.has(deviceId))
          statuses.delete(deviceId)
      }
      for (const target of targets) {
        const previous = statuses.get(target.deviceId)
        statuses.set(target.deviceId, previous === undefined
          ? { address: target.address, deviceId: target.deviceId, lastError: null, phase: 'idle', revision: null }
          : { ...previous, address: target.address })
      }
    },
    statuses: () => [...statuses.values()],
    snapshot: async () => buildSnapshot(await options.listTasks(), now()),
  }
}

export async function buildSnapshot(tasks: readonly TodoTask[], now = new Date()): Promise<DesktopDeviceTodoSnapshot> {
  const selectedTasks = tasks
    .filter(task => task.status !== 'done')
    .slice(0, maxTasks)
  const selectedIds = new Set(selectedTasks.map(task => task.blockId))
  const items = selectedTasks
    .map(task => ({
      id: task.blockId,
      schedule: task.schedule,
      noteTitle: task.noteTitle,
      parentId: (() => {
        const parentId = task.todoParentId ?? task.parentId
        return parentId !== null && selectedIds.has(parentId) ? parentId : null
      })(),
      revision: taskRevision(task),
      status: toDeviceStatus(task.status),
      text: task.text,
      topicTitle: task.topicTitle,
    }))
  const canonical = JSON.stringify(items)
  return {
    generatedAt: now.toISOString(),
    timeZoneOffsetMinutes: -now.getTimezoneOffset(),
    items,
    revision: createHash('sha256').update(canonical).digest('hex'),
  }
}

function taskRevision(task: TodoTask): string {
  return createHash('sha256')
    .update(JSON.stringify({
      blockId: task.blockId,
      parentId: task.todoParentId ?? task.parentId,
      schedule: task.schedule,
      status: task.status,
      text: task.text,
    }))
    .digest('hex')
}

function toDeviceStatus(status: TodoTask['status']): DesktopDeviceTodoStatusValue {
  return status === 'doing' ? 'in-progress' : status
}
