import type { SyncObjectStore, SyncRepository } from '@memorilo/sync'
import type { Server } from 'node:http'
import type { SyncServerPeer } from '../infrastructure/p2p/server-peer'
import type { SyncServerConfig } from './config'
import type { TodoNotificationPublisher } from './todo-notification-publisher'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createResourceScope } from '@memorilo/effect-lifecycle'
import { Effect } from 'effect'
import { createPostgresSyncDatabase } from '../infrastructure/database/postgres'
import { createSqliteSyncDatabase } from '../infrastructure/database/sqlite'
import { createFilesystemObjectStore } from '../infrastructure/object-store/filesystem'
import { createS3ObjectStore } from '../infrastructure/object-store/s3'
import { createSyncServerPeer, rebuildAuthoritativeState } from '../infrastructure/p2p/server-peer'
import { createSyncServerApp } from './app'
import { createDeviceTodoModule } from './device-todo'
import { createSyncServerMetrics } from './metrics'
import { createOrphanWorker } from './orphan-worker'
import { createResetWorker } from './reset-worker'
import { createTodoNotificationPublisher } from './todo-notification-publisher'
import { loadSyncServerWebRenderer } from './web-renderer'

export interface SyncServerRuntime {
  readonly app: ReturnType<typeof createSyncServerApp>
  readonly objectStore: SyncObjectStore
  readonly repository: SyncRepository
  readonly peer: SyncServerPeer
  readonly beginDrain: () => Promise<void>
  readonly close: () => Promise<void>
}

function requireConfigured(value: string | undefined, message: string): string {
  if (value === undefined)
    throw new Error(message)
  return value
}

export async function createSyncServerRuntime(config: SyncServerConfig, options: { readonly httpServer: Server, readonly port: number }): Promise<SyncServerRuntime> {
  const scope = createResourceScope('Sync server')
  let ready = false
  let stopWorkers: (() => Promise<void>) | null = null
  try {
    await mkdir(config.dataDir, { recursive: true })
    const database = (await scope.acquire({
      acquire: () => config.metadataDatabase === 'sqlite'
        ? createSqliteSyncDatabase({ filename: join(config.dataDir, 'sync.sqlite') })
        : createPostgresSyncDatabase({ url: requireConfigured(config.postgresUrl, 'PostgreSQL metadata provider requires a connection URL') }),
      close: current => current.close(),
      name: 'metadata database',
    })).resource
    await database.migrate()
    for (const account of await database.repository.listAccountStates())
      await rebuildAuthoritativeState(database.repository, account)
    const metrics = createSyncServerMetrics()
    const todoNotificationTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const pendingTodoNotifications = new Map<string, { readonly accountId: string, readonly generation: number, readonly changedAt: number }>()
    let todoNotificationPublisher: TodoNotificationPublisher | null = null
    if (config.mqttTodoBrokerUrl !== undefined) {
      todoNotificationPublisher = (await scope.acquire({
        acquire: () => createTodoNotificationPublisher({
          brokerUrl: config.mqttTodoBrokerUrl!,
          clientId: `memorilo-sync-server-${process.pid}`,
          listRecipients: async accountId => (await database.deviceTodo.listTokens(accountId))
            .filter(token => token.revokedAt === null && token.expiresAt > Date.now())
            .map(token => token.deviceId),
          password: config.mqttTodoPassword,
          topicPrefix: config.mqttTodoTopicPrefix,
          username: config.mqttTodoUsername,
        }),
        close: publisher => publisher.close(),
        name: 'TODO MQTT notification publisher',
      })).resource
    }
    const objectStore = (await scope.acquire({
      acquire: () => config.objectStore === 'filesystem'
        ? createFilesystemObjectStore({ root: config.filesystemRoot ?? join(config.dataDir, 'objects') })
        : createS3ObjectStore({
            accessKeyId: config.s3AccessKeyId,
            bucket: requireConfigured(config.s3Bucket, 'S3 object provider requires a bucket'),
            endpoint: config.s3Endpoint,
            forcePathStyle: config.s3ForcePathStyle,
            region: config.s3Region,
            secretAccessKey: config.s3SecretAccessKey,
          }),
      close: store => store.close(),
      name: 'object store',
    })).resource
    await objectStore.verify()
    const deviceTodo = createDeviceTodoModule({ objectStore, repository: database.repository, store: database.deviceTodo })
    if (config.maintenanceMode !== 'read-only') {
      const resetWorker = (await scope.acquire({
        acquire: () => createResetWorker({ metrics: metrics.peerRecorder, objectStore, repository: database.repository }),
        close: worker => worker.close(),
        name: 'reset worker',
      })).resource
      const orphanWorker = (await scope.acquire({
        acquire: () => createOrphanWorker({
          graceMs: config.orphanGraceMs,
          intervalMs: config.orphanIntervalMs,
          objectStore,
          repository: database.repository,
        }),
        close: worker => worker.close(),
        name: 'orphan reconciliation worker',
      })).resource
      let workersStopped = false
      stopWorkers = async () => {
        if (workersStopped)
          return
        workersStopped = true
        await Promise.allSettled([resetWorker.close(), orphanWorker.close()])
      }
    }
    const peer = (await scope.acquire({
      acquire: () => createSyncServerPeer({
        auth: database.auth,
        listenAddress: `/ip4/127.0.0.1/tcp/${options.port}/ws`,
        sharedWebSocketServer: options.httpServer,
        enabledModes: config.enabledModes,
        isAccepting: () => ready,
        maxObjectTransfersPerAccount: config.maxObjectTransfersPerAccount,
        maxSyncSessionsPerAccount: config.maxSyncSessionsPerAccount,
        objectStore,
        readOnly: config.maintenanceMode === 'read-only',
        repository: database.repository,
        sessionIdleTimeoutMs: config.sessionIdleTimeoutMs,
        sessionTotalTimeoutMs: config.sessionTotalTimeoutMs,
        statePath: join(config.dataDir, 'peer', 'identity.json'),
        metrics: metrics.peerRecorder,
        onAuthoritativeNotesChanged: (input) => {
          deviceTodo.invalidateAccount(input.accountId)
          if (todoNotificationPublisher === null)
            return
          const key = input.accountId
          pendingTodoNotifications.set(key, input)
          const currentTimer = todoNotificationTimers.get(key)
          if (currentTimer !== undefined)
            clearTimeout(currentTimer)
          todoNotificationTimers.set(key, setTimeout(() => {
            todoNotificationTimers.delete(key)
            const pending = pendingTodoNotifications.get(key)
            pendingTodoNotifications.delete(key)
            if (!pending || todoNotificationPublisher === null)
              return
            void Effect.runPromise(deviceTodo.revision(pending.accountId, pending.generation)).then(revision => todoNotificationPublisher?.publishChanged({
              accountId: pending.accountId,
              changedAt: pending.changedAt,
              generation: pending.generation,
              revision,
            })).catch((error) => {
              console.warn('Failed to publish TODO MQTT update hint', error)
            })
          }, 250))
        },
      }),
      close: current => current.close(),
      name: 'sync peer',
    })).resource
    const webRootUrl = new URL('../dist/', import.meta.url)
    const webRenderer = await loadSyncServerWebRenderer(new URL('../dist-ssr/server.js', import.meta.url))
    const app = createSyncServerApp(config, {
      audit: database.audit,
      auth: database.auth,
      closeAccountSyncSessions: peer.closeAccountSessions,
      closeDeviceSyncSessions: peer.closeDeviceSessions,
      isReady: () => ready,
      metrics,
      peer: peer.application,
      peerMetrics: () => metrics.snapshot(peer.metrics()),
      renderWeb: webRenderer.render,
      repository: database.repository,
      deviceTodo,
      webRoot: fileURLToPath(webRootUrl),
    })
    scope.commit()
    ready = true
    return {
      app,
      beginDrain: async () => {
        if (!ready)
          return
        ready = false
        await stopWorkers?.()
        await peer.drain()
      },
      close: async () => {
        for (const timer of todoNotificationTimers.values())
          clearTimeout(timer)
        todoNotificationTimers.clear()
        pendingTodoNotifications.clear()
        await scope.close()
      },
      objectStore,
      peer,
      repository: database.repository,
    }
  }
  catch (error) {
    return scope.rollback(error)
  }
}
