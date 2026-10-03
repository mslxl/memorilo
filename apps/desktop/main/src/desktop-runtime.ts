import type { ConfigurationStore } from '@memorilo/config'
import type { DesktopConfiguration } from '@memorilo/desktop-config'
import type { LearningPracticeConfiguration, TodoTask } from '@memorilo/editor-storage'
import type { P2pApplication } from '@memorilo/sync/node'
import type { MessageBoxOptions } from 'electron'
import type { TodoDevicePushTarget } from './todo/todo-device-push-service'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'

import process from 'node:process'
import { createConfigurationStore } from '@memorilo/config'
import { desktopSyncServerEventChannel } from '@memorilo/desktop-api'
import { memoriloAppOrigin } from '@memorilo/desktop-api/transport'
import {
  desktopConfigurationChangedChannel,
  desktopConfigurationDefinition,
} from '@memorilo/desktop-config'
import {
  SqliteEditorStorage,
  SqliteShelfImageCache,
  SqliteShelfStorage,
} from '@memorilo/editor-storage'
import { createOperationSupervisor, createResourceScope } from '@memorilo/effect-lifecycle'
import { ShelfReadingFileStore } from '@memorilo/shelf/node'
import { decodeSyncServerCredentialBundle, encodeLearningMutation, learningMutationRecord } from '@memorilo/sync'
import { decodeMemoriloProto, encodeMemoriloProto } from '@memorilo/sync-protocol'

import { createP2pApplication, ProtobufSyncJournal, syncServerDialTarget } from '@memorilo/sync/node'
import { Effect } from 'effect'
import { app, BrowserWindow, dialog } from 'electron'
import { installApplicationMenu } from './application-menu'
import { createDesktopAssetSync } from './assets/asset-p2p-sync'
import { createDatabaseBackupApplication } from './backup/backup-application'
import { createDesktopConfigurationAdapter } from './configuration/desktop-configuration-adapter'
import { DeviceLocalManagementClient } from './device-local-management-client'
import { createDesktopServices } from './ipc/services'
import { installJournalRollover } from './lifecycle/journal-rollover'
import { createMcpServerController } from './mcp/mcp-server-controller'
import { createNoteApplicationService } from './notes/note-application-service'
import { ensureNoteP2pBaselines } from './notes/note-p2p-baselines'
import { NoteTransferApplication } from './notes/note-transfer-application'
import { createActiveReadingRegistry } from './reading/active-reading-registry'
import { BetterSqliteDatabase } from './storage/better-sqlite-database'
import { ElectronDeviceSigningKeyStore } from './storage/electron-device-signing-key-store'
import { ElectronLocalManagementCredentialStore } from './storage/electron-local-management-credential-store'
import { ElectronSyncServerCredentialStore } from './storage/electron-sync-server-credential-store'
import { openCurrentMainDatabase } from './storage/main-database'
import { TransformersEmbeddingModel } from './storage/transformers-embedding-model'
import {
  applicationDataDirectory,
  assetDirectory,
  mainDatabasePath,
  shelfLibraryDirectory,
} from './storage/workspace-paths'
import { createSyncServerStatusController } from './sync-server-status'
import { createTodoDevicePushService } from './todo/todo-device-push-service'
import { createTodoDeviceTargetStore, loadTodoDeviceTargetsForStartup } from './todo/todo-device-target-store'
import { createTodoReminderScheduler } from './todo/todo-reminder-scheduler'
import { WhiteboardLibraryApplication } from './whiteboard/whiteboard-library-application'
import { createSettingsWindowController } from './windows/settings-window'

export interface DesktopRuntime {
  close: () => Promise<void>
}

interface DesktopRuntimeOptions {
  allowTestClock: boolean
  createWindow: () => void
  flushRenderer: () => Promise<boolean>
  mainDirectory: string
  requestRestart: () => void
}

function embeddingModelCacheDirectory(mainDirectory: string): string {
  if (app.isPackaged)
    return join(process.resourcesPath, 'embedding-models')
  return resolve(mainDirectory, '../../../../.cache/embedding-models')
}

function learningPracticeConfiguration(
  configuration: DesktopConfiguration,
): LearningPracticeConfiguration {
  return {
    dailyGoal: {
      fixedCards: configuration.goals.dailyLearningGoalCards,
      mode: configuration.goals.dailyLearningGoalMode,
    },
    queuePolicy: {
      buryInterdayLearningSiblings: configuration.flashcards.buryInterdayLearningSiblings,
      buryNewSiblings: configuration.flashcards.buryNewSiblings,
      buryReviewSiblings: configuration.flashcards.buryReviewSiblings,
      interdayOrder: configuration.flashcards.interdayOrder,
      learnAheadMinutes: configuration.flashcards.learnAheadMinutes,
      maxNewCardsPerDay: configuration.flashcards.newCardsPerDay,
      newGatherOrder: configuration.flashcards.newGatherOrder,
      reviewOrder: configuration.flashcards.reviewOrder,
      studyDayStartsAtHour: configuration.flashcards.studyDayStartsAtHour,
    },
  }
}

async function reportInvalidConfiguration(configurationPath: string, phase: 'reload' | 'startup'): Promise<void> {
  const consequence = phase === 'startup'
    ? 'Memorilo could not start.'
    : 'The changes were not applied. Memorilo will keep using the last valid settings.'
  console.error(`Invalid Memorilo configuration during ${phase}: ${configurationPath}`)
  const options: MessageBoxOptions = {
    buttons: ['OK'],
    defaultId: 0,
    detail: `One or more recognized settings have an invalid format. ${consequence}\n\nCheck the configuration file at:\n${configurationPath}`,
    message: 'Invalid Memorilo Configuration',
    noLink: true,
    type: 'error',
  }
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (owner)
    await dialog.showMessageBox(owner, options)
  else
    await dialog.showMessageBox(options)
}

async function reportP2pJournalRecovery(backupPath: string): Promise<void> {
  const options: MessageBoxOptions = {
    buttons: ['OK'],
    defaultId: 0,
    detail: `The previous sync journal belonged to a different local device identity. Memorilo backed it up to:\n\n${backupPath}\n\nA new sync journal was created from the current local database. Existing Notes and pending learning changes are preserved and will synchronize again.`,
    message: 'P2P Sync Journal Rebuilt',
    noLink: true,
    type: 'warning',
  }
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (owner)
    await dialog.showMessageBox(owner, options)
  else
    await dialog.showMessageBox(options)
}

async function createDesktopConfigurationStore(dataDirectory: string): Promise<ConfigurationStore<DesktopConfiguration>> {
  const configurationPath = join(dataDirectory, 'configuration.json')
  try {
    return await createConfigurationStore(
      desktopConfigurationDefinition,
      createDesktopConfigurationAdapter(dataDirectory),
      {
        onError: () => void reportInvalidConfiguration(configurationPath, 'reload'),
      },
    )
  }
  catch {
    await reportInvalidConfiguration(configurationPath, 'startup')
    throw new Error(`Invalid Memorilo configuration: ${configurationPath}`)
  }
}

function shelfImageCacheDatabasePath(dataDirectory: string): string {
  const configured = process.env.MEMORILO_SHELF_IMAGE_CACHE_PATH
  if (configured !== undefined) {
    if (configured.length === 0)
      throw new TypeError('MEMORILO_SHELF_IMAGE_CACHE_PATH must not be empty')
    return configured
  }
  if (!app.isPackaged)
    return join(dataDirectory, 'shelf-images.sqlite')
  const homePath = app.getPath('home')
  const cacheDirectory = process.platform === 'darwin'
    ? join(homePath, 'Library', 'Caches', 'Memorilo')
    : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || app.getPath('sessionData'), 'Memorilo', 'Cache')
      : join(process.env.XDG_CACHE_HOME || join(homePath, '.cache'), 'memorilo')
  mkdirSync(cacheDirectory, { recursive: true })
  return join(cacheDirectory, 'shelf-images.sqlite')
}

function shelfBookCacheDirectory(dataDirectory: string): string {
  const configured = process.env.MEMORILO_SHELF_BOOK_CACHE_PATH
  if (configured !== undefined) {
    if (configured.length === 0)
      throw new TypeError('MEMORILO_SHELF_BOOK_CACHE_PATH must not be empty')
    return configured
  }
  if (process.env.MEMORILO_SHELF_IMAGE_CACHE_PATH === ':memory:')
    return join(dataDirectory, 'shelf-book-cache')
  const homePath = app.getPath('home')
  return process.platform === 'darwin'
    ? join(homePath, 'Library', 'Caches', 'Memorilo', 'shelf-books')
    : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || app.getPath('sessionData'), 'Memorilo', 'Cache', 'shelf-books')
      : join(process.env.XDG_CACHE_HOME || join(homePath, '.cache'), 'memorilo', 'shelf-books')
}

function learningNow(allowTestClock: boolean): () => number {
  const configured = process.env.MEMORILO_E2E_NOW_MS
  if (configured === undefined)
    return Date.now
  if (!allowTestClock)
    throw new Error('MEMORILO_E2E_NOW_MS requires the E2E test clock capability')
  const milliseconds = Number(configured)
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
    throw new TypeError('MEMORILO_E2E_NOW_MS must be a non-negative safe integer')
  return () => milliseconds
}

function configuredTodoDeviceTargets(): readonly TodoDevicePushTarget[] {
  const raw = process.env.MEMORILO_NOTE4_TODO_DEVICES
  if (raw === undefined || raw.trim().length === 0)
    return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value))
      throw new TypeError('TODO device target list must be an array')
    return value.flatMap((entry): TodoDevicePushTarget[] => {
      if (typeof entry !== 'object' || entry === null)
        return []
      const candidate = entry as { address?: unknown, deviceId?: unknown }
      return typeof candidate.address === 'string' && typeof candidate.deviceId === 'string'
        ? [{ address: candidate.address, deviceId: candidate.deviceId }]
        : []
    })
  }
  catch (error) {
    console.warn('Ignoring invalid MEMORILO_NOTE4_TODO_DEVICES', error)
    return []
  }
}

export async function createDesktopRuntime(options: DesktopRuntimeOptions): Promise<DesktopRuntime> {
  // Every resource acquired after the shared database can depend on it during
  // a failed close retry. Do not release prerequisites past the first failure.
  const scope = createResourceScope('Application', { closeMode: 'dependent' })
  try {
    const userDataPath = app.getPath('userData')
    const dataDirectory = applicationDataDirectory(userDataPath, resolve(options.mainDirectory, '../../../../.dev'), app.isPackaged)
    mkdirSync(dataDirectory, { recursive: true })
    const database = mainDatabasePath(dataDirectory)
    const assets = assetDirectory(database)
    const configuration = await scope.acquire({
      acquire: () => createDesktopConfigurationStore(dataDirectory),
      close: store => store.close(),
      name: 'configuration store',
    })
    const configurationStore = configuration.resource
    const syncServerCredentialStore = new ElectronSyncServerCredentialStore(join(dataDirectory, 'sync-server', 'device-credential.enc'))
    const localManagementCredentialStore = new ElectronLocalManagementCredentialStore(
      join(dataDirectory, 'devices', 'local-management'),
    )
    let storedSyncServerCredential = (await syncServerCredentialStore.load()) ?? ''
    const loadedSyncServerCredential = storedSyncServerCredential.length === 0
      ? null
      : decodeSyncServerCredentialBundle(storedSyncServerCredential)
    let syncServerCredential = loadedSyncServerCredential?.credential ?? ''
    if (loadedSyncServerCredential !== null) {
      const current = configurationStore.getSnapshot()
      const configuredPeerId = current.syncServer.peerId.trim()
      if (configuredPeerId.length > 0 && configuredPeerId !== loadedSyncServerCredential.peerId)
        throw new Error('Stored Sync Server credential does not match the configured server peer')
    }
    const runtimeSyncServerConfiguration = configurationStore.getSnapshot().syncServer
    const syncServerStatus = createSyncServerStatusController({
      configuration: () => configurationStore.getSnapshot().syncServer,
      credentialAvailable: () => syncServerCredential.length > 0,
      publish: (event) => {
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(desktopSyncServerEventChannel, event)
      },
      runtimeConfiguration: runtimeSyncServerConfiguration,
    })
    const mainDatabase = (await scope.acquire({
      acquire: () => openCurrentMainDatabase(database),
      close: current => current.close(),
      name: 'main database',
    })).resource
    const mainDatabaseOperations = (await scope.acquire({
      acquire: () => createOperationSupervisor('Main database operations'),
      close: operations => operations.close(),
      name: 'main database operations',
    })).resource
    const editor = await scope.acquire({
      acquire: () => SqliteEditorStorage.open({
        database: mainDatabase,
        databaseOwnership: 'borrowed',
        embeddingModel: new TransformersEmbeddingModel({
          allowRemoteModels: !app.isPackaged && process.env.MEMORILO_EMBEDDING_MODEL_OFFLINE !== '1',
          cacheDirectory: embeddingModelCacheDirectory(options.mainDirectory),
        }),
        learningConfiguration: () => learningPracticeConfiguration(configurationStore.getSnapshot()),
        operationSupervisor: mainDatabaseOperations,
      }),
      close: storage => storage.close(),
      name: 'editor storage',
    })
    const editorStorage = editor.resource
    const todoDevicePushClient = new DeviceLocalManagementClient(localManagementCredentialStore)
    const todoDeviceTargetStore = createTodoDeviceTargetStore(join(dataDirectory, 'devices', 'todo-targets.json'))
    const persistedTodoDeviceTargets = await loadTodoDeviceTargetsForStartup(todoDeviceTargetStore)
    const todoDevicePush = (await scope.acquire({
      acquire: () => createTodoDevicePushService({
        listTasks: async () => {
          const tasks: TodoTask[] = []
          let cursor: number | undefined
          while (tasks.length < 64) {
            const page = await editorStorage.tasks.list({
              ...(cursor === undefined ? {} : { cursor }),
              limit: 500,
            })
            tasks.push(...page.items.filter(task => task.status !== 'done'))
            if (page.nextCursor === null)
              break
            cursor = page.nextCursor
          }
          return tasks.slice(0, 64)
        },
        push: input => Effect.runPromise(todoDevicePushClient.pushTodos(input)),
        targets: persistedTodoDeviceTargets.length > 0
          ? persistedTodoDeviceTargets
          : configuredTodoDeviceTargets(),
      }),
      close: service => service.close(),
      name: 'TODO device LAN push',
    })).resource
    await scope.acquire({
      acquire: () => createTodoReminderScheduler(editorStorage),
      close: scheduler => scheduler.close(),
      name: 'Todo reminder scheduler',
    })
    const whiteboardLibrary = (await scope.acquire({
      acquire: () => WhiteboardLibraryApplication.open(editorStorage.userDocuments),
      close: application => application.close(),
      name: 'Whiteboard Library',
    })).resource
    let p2pApplication: P2pApplication | null = null
    const requireP2pApplication = (): P2pApplication => {
      if (p2pApplication === null)
        throw new Error('P2P application is not ready')
      return p2pApplication
    }
    const assetSync = assets === null
      ? null
      : createDesktopAssetSync({
          application: requireP2pApplication,
          assetDirectory: assets,
          assets: editorStorage.assets,
          deviceId: () => requireP2pApplication().pairing.identity.deviceId,
          notifyChangesAvailable: () => requireP2pApplication().notifyChangesAvailable(),
        })
    // Development worktrees keep identity, pairing, signing keys, and journal in .dev.
    const p2pStatePath = join(dataDirectory, 'p2p', 'identity.json')
    const syncJournalPath = join(dataDirectory, 'p2p', 'sync-journal.bin')
    let syncJournal = new ProtobufSyncJournal(syncJournalPath)
    await syncJournal.load()
    const pendingJournalWrites = new Set<Promise<void>>()
    const pendingLocalNoteUpdates: Array<{ noteId: string, update: Uint8Array }> = []
    let journalError: unknown = null
    let finishP2pInitialization!: () => void
    const p2pInitialization = new Promise<void>((resolve) => {
      finishP2pInitialization = resolve
    })
    let applyingRemoteP2pChanges = 0
    const waitForP2pInitialization = async (): Promise<void> => {
      await p2pInitialization
      if (journalError !== null)
        throw journalError
    }
    const queueJournalWrite = (write: Promise<void>): void => {
      const tracked = write.catch((error) => {
        journalError = error
      })
      pendingJournalWrites.add(tracked)
      void tracked.then(() => pendingJournalWrites.delete(tracked))
    }
    const queueLocalNoteUpdate = (noteId: string, update: Uint8Array): void => {
      const application = p2pApplication
      if (application === null) {
        pendingLocalNoteUpdates.push({ noteId, update: new Uint8Array(update) })
        return
      }
      const deviceId = application.pairing.identity.deviceId
      const updateId = createHash('sha256')
        .update(noteId)
        .update('\0')
        .update(update)
        .digest('hex')
      const payload = encodeMemoriloProto('NoteUpdate', { noteId, loroUpdate: update })
      const write = syncJournal.appendLocal({
        id: `${deviceId}:note:${updateId}`,
        kind: 'note-update',
        payload,
      }).then(() => undefined)
      queueJournalWrite(write)
      void write.then(
        () => application.notifyChangesAvailable(),
      ).catch(error => console.warn(`Failed to synchronize local Note ${noteId}`, error))
    }
    const shelfStorage = (await scope.acquire({
      acquire: () => SqliteShelfStorage.open({
        database: mainDatabase,
        databaseOwnership: 'borrowed',
        operationSupervisor: mainDatabaseOperations,
      }),
      close: storage => storage.close(),
      name: 'Shelf storage',
    })).resource
    const imageCacheDatabase = await scope.acquire({
      acquire: () => new BetterSqliteDatabase(shelfImageCacheDatabasePath(dataDirectory), {
        loadVectorExtension: false,
      }),
      close: current => current.close(),
      name: 'Shelf image cache database',
    })
    const shelfImageCache = (await scope.acquire({
      acquire: () => SqliteShelfImageCache.open({ database: imageCacheDatabase.resource }),
      close: cache => cache.close(),
      name: 'Shelf image cache',
    })).resource
    const shelfReadingFiles = (await scope.acquire({
      acquire: () => ShelfReadingFileStore.open({
        cacheDirectory: shelfBookCacheDirectory(dataDirectory),
        libraryDirectory: shelfLibraryDirectory(database, dataDirectory),
      }),
      close: files => files.close(),
      name: 'Shelf reading files',
    })).resource
    const activeReadings = (await scope.acquire({
      acquire: async () => createActiveReadingRegistry(),
      close: registry => registry.close(),
      name: 'active reading registry',
    })).resource

    let snapshot = configurationStore.getSnapshot()
    if (snapshot.mcp.accessToken.length < 32) {
      snapshot = await configurationStore.set({
        ...snapshot,
        mcp: { ...snapshot.mcp, accessToken: randomBytes(32).toString('base64url') },
      })
    }

    const assetOperations = (await scope.acquire({
      acquire: () => createOperationSupervisor('Asset operation queue'),
      close: operations => operations.close(),
      name: 'asset operations',
    })).resource
    const notes = (await scope.acquire({
      acquire: () => createNoteApplicationService(editorStorage, ({ noteId, update, updatedAt }) => {
        if (applyingRemoteP2pChanges === 0)
          queueLocalNoteUpdate(noteId, update)
        todoDevicePush.notifyLocalMutation()
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('memorilo:note-update', { noteId, update, updatedAt })
      }, {
        autoCompleteTodoParents: () => configurationStore.getSnapshot().todo.autoCompleteParentTasks,
        defaultNoteLearningEnabled: () => configurationStore.getSnapshot().defaultNoteLearningEnabled,
        recurringTaskCompletionAction: () => configurationStore.getSnapshot().todo.recurringTaskCompletionAction,
      }, activeReadings),
      close: noteApplication => noteApplication.close(),
      name: 'Note application',
    })).resource
    await notes.openJournal()
    await scope.acquire({
      acquire: () => installJournalRollover(notes),
      close: rollover => rollover.close(),
      name: 'Journal rollover',
    })
    const mcpServer = (await scope.acquire({
      acquire: () => createMcpServerController(notes),
      close: server => server.close(),
      name: 'MCP server',
    })).resource
    const initialSyncServerConfiguration = configurationStore.getSnapshot().syncServer
    const p2p = (await scope.acquire({
      acquire: () => createP2pApplication({
        deviceName: process.env.MEMORILO_DEVICE_NAME ?? hostname(),
        onStatus: (status) => {
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send('memorilo:p2p-status', status)
          syncServerStatus.updateP2pStatus(status)
        },
        statePath: p2pStatePath,
        signingKeyStore: new ElectronDeviceSigningKeyStore(join(dataDirectory, 'p2p', 'device-signing-key.enc')),
        ...(assetSync === null ? {} : { objectStore: assetSync.objectStore }),
        ...(initialSyncServerConfiguration.enabled && initialSyncServerConfiguration.url.length > 0
          ? {
              dialTargets: new Map([[initialSyncServerConfiguration.peerId, syncServerDialTarget(initialSyncServerConfiguration.url)]]),
              server: () => {
                const server = configurationStore.getSnapshot().syncServer
                return server.enabled
                  ? {
                      credential: syncServerCredential,
                      generation: server.generation,
                      membershipEpoch: server.membershipEpoch,
                      modes: server.modes,
                      peerId: server.peerId,
                      policyEpoch: server.policyEpoch,
                    }
                  : undefined
              },
              transport: 'both' as const,
            }
          : {}),
        provider: {
          ...(assetSync === null
            ? {}
            : {
                applyAssetManifests: assetSync.applyAssetManifests,
                getAssetManifests: assetSync.getAssetManifests,
                getAssetVersionVector: assetSync.getAssetVersionVector,
                prepareAssetManifestsForPeer: assetSync.prepareAssetManifestsForPeer,
              }),
          applyChanges: async (_namespace, changes, _peer) => {
            await waitForP2pInitialization()
            applyingRemoteP2pChanges += 1
            let learningChanged = false
            try {
              // Relayed deltas may precede a Note's initialization update, so import each Note as one batch before validation.
              const noteUpdates = new Map<string, Uint8Array[]>()
              for (const change of changes) {
                if (change.kind === 'learning-mutation') {
                  const learningChange = learningMutationRecord(change.payload) as any
                  await editorStorage.learning.sync.applyRemote({
                    ...learningChange,
                    sourceDeviceId: change.deviceId,
                    sourceSequence: change.sequence,
                  })
                  learningChanged = true
                  continue
                }
                if (change.kind !== 'note-update')
                  continue
                const payload = decodeMemoriloProto('NoteUpdate', change.payload) as any
                const updates = noteUpdates.get(String(payload.noteId)) ?? []
                updates.push(new Uint8Array(payload.loroUpdate))
                noteUpdates.set(String(payload.noteId), updates)
              }
              for (const [noteId, updates] of noteUpdates)
                await notes.saveNoteUpdates({ noteId, updates })
              const acceptedNewChanges = await syncJournal.recordReceivedAndReport(changes)
              if (learningChanged) {
                for (const window of BrowserWindow.getAllWindows())
                  window.webContents.send('memorilo:learning-update')
              }
              if (acceptedNewChanges) {
                queueMicrotask(() => {
                  void p2pApplication?.notifyChangesAvailable().catch(error => console.warn('Failed to relay P2P changes', error))
                })
              }
            }
            finally {
              applyingRemoteP2pChanges -= 1
            }
          },
          observeMembershipEpoch: async (epoch) => {
            await waitForP2pInitialization()
            await p2pApplication?.observeMembershipEpoch(epoch)
          },
          observeRemoteHello: async (hello, peer) => {
            const current = configurationStore.getSnapshot()
            const server = current.syncServer
            if (!server.enabled || server.peerId !== peer.peerId)
              return
            if (hello.role !== 'server')
              throw new Error('Configured sync server did not identify itself as a server peer')
            if (hello.generation < server.generation || hello.membershipEpoch < server.membershipEpoch || hello.policyEpoch < server.policyEpoch)
              throw new Error('Sync server state regressed')
            const modes = hello.modes.filter((mode): mode is 'relay' | 'authoritative' => mode === 'relay' || mode === 'authoritative')
            if (modes.length === 0)
              throw new Error('Sync server has no compatible mode enabled')
            const changed = hello.generation !== server.generation
              || hello.membershipEpoch !== server.membershipEpoch
              || hello.policyEpoch !== server.policyEpoch
              || modes.join('\0') !== server.modes.join('\0')
            if (!changed)
              return
            const nextServer = {
              ...server,
              generation: hello.generation,
              membershipEpoch: hello.membershipEpoch,
              modes,
              policyEpoch: hello.policyEpoch,
            }
            await configurationStore.set({
              ...current,
              syncServer: nextServer,
            })
            syncServerStatus.publishRemoteStateChange(server, nextServer)
            throw new Error(hello.generation !== server.generation ? 'sync-account-data-reset' : 'sync-server-policy-changed')
          },
          getChanges: async (namespace, since) => {
            await waitForP2pInitialization()
            await Promise.all([...pendingJournalWrites])
            if (journalError !== null)
              throw journalError
            const learningChanges = await editorStorage.learning.sync.listPending(250)
            for (const change of learningChanges) {
              const write = syncJournal.appendLocal({
                id: change.mutationId,
                kind: 'learning-mutation',
                payload: encodeLearningMutation(change as any),
              })
              await write
            }
            return syncJournal.listChanges(since, namespace)
          },
          acknowledgeChanges: async (_namespace, changeIds) => {
            const localDeviceId = p2pApplication?.pairing.identity.deviceId
            const learningIds = new Set(syncJournal.listChanges({})
              .filter(change => change.kind === 'learning-mutation'
                && change.deviceId === localDeviceId
                && changeIds.includes(change.id))
              .map(change => change.id))
            if (learningIds.size > 0)
              await editorStorage.learning.sync.acknowledgeMutations([...learningIds])
            if ((await editorStorage.learning.sync.listPending(1)).length > 0) {
              queueMicrotask(() => {
                void p2pApplication?.notifyChangesAvailable().catch(error => console.warn('Failed to continue Learning synchronization', error))
              })
            }
          },
          getMembershipEpoch: () => p2pApplication?.membershipEpoch() ?? 1,
          getVersionVector: namespace => syncJournal.getVersionVector(namespace),
        },
      }),
      close: application => application.close(),
      name: 'P2P sync',
    })).resource
    p2pApplication = p2p
    try {
      const deviceId = p2pApplication.pairing.identity.deviceId
      if (syncJournal.deviceId !== null && syncJournal.deviceId !== deviceId) {
        const backupPath = `${syncJournal.path}.backup-${Date.now()}-${randomBytes(6).toString('hex')}`
        await rename(syncJournal.path, backupPath)
        syncJournal = new ProtobufSyncJournal(syncJournal.path)
        await syncJournal.load()
        await reportP2pJournalRecovery(backupPath)
      }
      await syncJournal.setDeviceId(deviceId)
      await ensureNoteP2pBaselines({
        defaultNoteLearningEnabled: () => configurationStore.getSnapshot().defaultNoteLearningEnabled,
        deviceId,
        getNote: noteId => editorStorage.notes.getNote({ noteId }),
        journal: syncJournal,
        listNoteIds: () => editorStorage.notes.listNoteIds(),
      })
      await assetSync?.ensureBaselines()
      pendingLocalNoteUpdates.splice(0).forEach(({ noteId, update }) => queueLocalNoteUpdate(noteId, update))
      await Promise.all([...pendingJournalWrites])
      if (journalError !== null)
        throw journalError
    }
    catch (error) {
      journalError = error
      throw error
    }
    finally {
      finishP2pInitialization()
    }
    void p2pApplication.notifyChangesAvailable().catch(error => console.warn('Failed to synchronize Note baselines', error))
    await mcpServer.update(snapshot.mcp)
    const backup = (await scope.acquire({
      acquire: () => createDatabaseBackupApplication({
        assetDirectory: assets,
        configuration: configurationStore,
        database: mainDatabase,
        databasePath: database,
        flushRenderer: options.flushRenderer,
        requestRestart: options.requestRestart,
        shelfDirectory: shelfLibraryDirectory(database, dataDirectory),
      }),
      close: application => application.close(),
      name: 'database backup',
    })).resource
    const transfer = new NoteTransferApplication({
      appVersion: app.getVersion(),
      assetDirectory: assets,
      flushRenderer: options.flushRenderer,
      notes,
      shelfReadingFiles,
      storage: editorStorage,
      typstFontDirectories: [app.isPackaged
        ? join(process.resourcesPath, 'typst-fonts', 'Xiaolai')
        : resolve(options.mainDirectory, '../../../../packages/excalidraw/excalidraw/fonts/Xiaolai')],
    })
    await scope.acquire({
      acquire: () => transfer,
      close: application => application.close(),
      name: 'note transfer',
    })
    await scope.acquire({
      acquire: () => createDesktopServices(
        notes,
        transfer,
        editorStorage,
        backup,
        shelfStorage,
        shelfImageCache,
        shelfReadingFiles,
        configurationStore,
        assets,
        assetOperations.run,
        activeReadings,
        editorStorage.learning,
        whiteboardLibrary,
        learningNow(options.allowTestClock),
        {
          allowedOrigins: new Set([
            memoriloAppOrigin,
            ...(process.env.ELECTRON_RENDERER_URL === undefined
              ? []
              : [new URL(process.env.ELECTRON_RENDERER_URL).origin]),
          ]),
          rendererDirectory: join(options.mainDirectory, '../renderer'),
        },
        p2p,
        syncServerStatus.getStatus,
        async (credential) => {
          const normalized = credential.trim()
          const bundle = decodeSyncServerCredentialBundle(normalized)
          const current = configurationStore.getSnapshot()
          const previousServer = current.syncServer
          if (previousServer.peerId.trim().length === 0 || previousServer.peerId !== bundle.peerId)
            throw new TypeError('Sync Server credential does not match the configured server peer')
          const nextServer = {
            ...previousServer,
            generation: bundle.generation,
            membershipEpoch: bundle.membershipEpoch,
            modes: [...bundle.modes],
            policyEpoch: bundle.policyEpoch,
          }
          const previousStoredCredential = storedSyncServerCredential
          const previousCredential = syncServerCredential
          await syncServerCredentialStore.save(normalized)
          storedSyncServerCredential = normalized
          syncServerCredential = bundle.credential
          try {
            await configurationStore.set({ ...current, syncServer: nextServer })
          }
          catch (error) {
            if (previousStoredCredential.length === 0)
              await syncServerCredentialStore.clear()
            else
              await syncServerCredentialStore.save(previousStoredCredential)
            storedSyncServerCredential = previousStoredCredential
            syncServerCredential = previousCredential
            throw error
          }
          syncServerStatus.publishRemoteStateChange(previousServer, nextServer)
          void p2p.notifyChangesAvailable().catch(error => console.warn('Failed to reconnect after installing Sync Server credential', error))
        },
        assetSync ?? undefined,
      ),
      close: handle => handle.close(),
      name: 'desktop services',
    })
    await scope.acquire({
      acquire: () => configurationStore.subscribe(() => {
        const next = configurationStore.getSnapshot()
        syncServerStatus.refreshConfiguration()
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(desktopConfigurationChangedChannel, next)
        // The controller reports update failures; observe the rejection so a
        // failed hot reload cannot become an unhandled Promise.
        void mcpServer.update(next.mcp).then(undefined, () => undefined)
      }),
      close: unsubscribe => unsubscribe(),
      name: 'configuration subscription',
    })

    const settingsWindow = (await scope.acquire({
      acquire: () => createSettingsWindowController(
        options.mainDirectory,
        localManagementCredentialStore,
        todoDeviceTargetStore,
        todoDevicePush,
      ),
      close: controller => controller.close(),
      name: 'settings window controller',
    })).resource
    await scope.acquire({
      acquire: () => installApplicationMenu(settingsWindow.show),
      close: remove => remove(),
      name: 'application menu',
    })
    options.createWindow()
    const handleActivate = (): void => {
      if (BrowserWindow.getAllWindows().length === 0)
        options.createWindow()
    }
    await scope.acquire({
      acquire: () => {
        app.on('activate', handleActivate)
        return () => {
          app.removeListener('activate', handleActivate)
        }
      },
      close: remove => remove(),
      name: 'application activation listener',
    })
    scope.commit()
    return { close: scope.close }
  }
  catch (error) {
    return scope.rollback(error)
  }
}
