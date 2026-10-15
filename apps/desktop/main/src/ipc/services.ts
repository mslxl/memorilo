import type { ConfigurationStore } from '@memorilo/config'
import type { DesktopSyncServerStatus, DesktopTodoCalendarFeed } from '@memorilo/desktop-api'
import type { DesktopFetchRequest, DesktopFetchResponse } from '@memorilo/desktop-api/transport'
import type { DesktopConfiguration } from '@memorilo/desktop-config'
import type { EditorStorage, LearningStorage } from '@memorilo/editor-storage'
import type { ShelfImageCache, ShelfStorage } from '@memorilo/shelf'
import type { ShelfReadingFileStore } from '@memorilo/shelf/node'
import type { P2pApplication } from '@memorilo/sync/node'
import type { DesktopAssetSync } from '../assets/asset-p2p-sync'
import type { DatabaseBackupApplication } from '../backup/backup-application'
import type { DesktopRequestContext } from '../desktop-request-handlers'
import type { NoteApplicationService } from '../notes/note-application-service'
import type { NoteTransferApplication } from '../notes/note-transfer-application'
import type { ActiveReadingRegistry } from '../reading/active-reading-registry'
import type { WhiteboardLibraryApplication } from '../whiteboard/whiteboard-library-application'
import type { IpcHandlerHost } from './ipc-handler-registry'
import { createDesktopHonoApp } from '@memorilo/desktop-api/server'
import { memoriloApiHost, memoriloApiOrigin, memoriloProtocol } from '@memorilo/desktop-api/transport'
import { createResourceScope } from '@memorilo/effect-lifecycle'
import { ipcMain } from 'electron'
import { createLearningReviewApplication } from '../learning/learning-review-application'
import { registerMemoriloProtocol } from '../memorilo-protocol'

import { createTodoCalendarService } from '../todo/todo-calendar-service'
import { createAppHandlers } from './app-service'
import { createAssetHandlers } from './asset-service'
import { createBackupHandlers } from './backup-service'
import { BookReadingApplication } from './book-reading-application'
import { createBookHandlers } from './book-service'
import { createConfigurationHandlers } from './configuration-service'
import { createIpcHandlerRegistry, withIpcContext } from './ipc-handler-registry'
import { createJournalHandlers } from './journal-service'
import { createLearningHandlers } from './learning-service'
import { createNoteHandlers } from './note-service'
import { createP2pHandlers } from './p2p-service'
import { createShelfOperationRuntime } from './shelf-operation-runtime'
import { createShelfHandlers } from './shelf-service'
import { createWhiteboardLibraryHandlers } from './whiteboard-library-service'
import { createWindowHandlers } from './window-service'

const maximumConcurrentShelfAssetRequests = 3

export async function createDesktopServices(
  notes: NoteApplicationService,
  transfer: NoteTransferApplication,
  storage: EditorStorage,
  backup: DatabaseBackupApplication,
  shelfStorage: ShelfStorage,
  shelfImageCache: ShelfImageCache,
  shelfReadingFiles: ShelfReadingFileStore,
  configuration: ConfigurationStore<DesktopConfiguration>,
  assetDirectory: string | null,
  serializeAssetOperation: <Result>(operation: () => Promise<Result>) => Promise<Result>,
  activeReadings: ActiveReadingRegistry,
  learning: LearningStorage,
  whiteboardLibrary: WhiteboardLibraryApplication,
  now: () => number,
  protocolOptions: {
    allowedOrigins: ReadonlySet<string>
    rendererDirectory: string
  },
  p2p: P2pApplication,
  getSyncServerStatus: () => DesktopSyncServerStatus,
  installSyncServerCredential: (credential: string) => Promise<void>,
  todoCalendarFeed: {
    get: () => Promise<DesktopTodoCalendarFeed>
    issue: () => Promise<DesktopTodoCalendarFeed>
    revoke: () => Promise<void>
  },
  assetSync?: Pick<DesktopAssetSync, 'recordLocalDelete' | 'recordLocalPut'>,
) {
  const scope = createResourceScope('Desktop services', { closeMode: 'dependent' })
  try {
    const shelfOperations = (await scope.acquire({
      acquire: () => createShelfOperationRuntime(maximumConcurrentShelfAssetRequests),
      close: operations => operations.close(),
      name: 'Shelf operations',
    })).resource
    const requestHandlers = {
      assets: createAssetHandlers(assetDirectory, storage, configuration, serializeAssetOperation, assetSync === undefined
        ? undefined
        : {
            onDelete: async (asset) => {
              await assetSync.recordLocalDelete(asset).catch(error => console.warn(`Failed to synchronize deleted asset ${asset.fileName}`, error))
            },
            onPut: async (asset) => {
              await assetSync.recordLocalPut(asset).catch(error => console.warn(`Failed to synchronize saved asset ${asset.fileName}`, error))
            },
          }),
      backup: createBackupHandlers(backup),
      books: createBookHandlers(new BookReadingApplication({
        activeReadings,
        notes,
        operations: shelfOperations,
        readingFiles: shelfReadingFiles,
        storage,
      })),
      journals: createJournalHandlers(notes),
      learning: createLearningHandlers(
        learning,
        createLearningReviewApplication(notes, learning, now),
        now,
        () => {
          void p2p.notifyChangesAvailable().catch(error => console.warn('Failed to synchronize local Learning changes', error))
        },
      ),
      notes: createNoteHandlers(notes, createTodoCalendarService(storage, () => configuration.getSnapshot().language), transfer),
      shelf: createShelfHandlers(
        shelfStorage,
        shelfImageCache,
        shelfReadingFiles,
        activeReadings,
        shelfOperations,
      ),
      window: createWindowHandlers(),
    }
    const honoApp = createDesktopHonoApp<DesktopRequestContext>({
      ...requestHandlers,
      app: createAppHandlers(),
      configuration: createConfigurationHandlers(configuration),
    }, { allowedOrigins: protocolOptions.allowedOrigins })
    const ipcHandlers = {
      transport: {
        fetch: withIpcContext(async (context, request: DesktopFetchRequest): Promise<DesktopFetchResponse> => {
          if (typeof request !== 'object' || request === null)
            throw new TypeError('Desktop Fetch request is required')
          const url = new URL(request.url)
          if (url.protocol !== `${memoriloProtocol}:` || url.host !== memoriloApiHost || url.username || url.password || url.port)
            throw new TypeError(`Desktop Fetch URL must use ${memoriloApiOrigin}`)
          if (!Array.isArray(request.headers) || request.headers.some(header => (
            !Array.isArray(header) || header.length !== 2 || typeof header[0] !== 'string' || typeof header[1] !== 'string'
          ))) {
            throw new TypeError('Desktop Fetch headers are invalid')
          }
          if (typeof request.method !== 'string' || !/^[A-Z]+$/u.test(request.method))
            throw new TypeError('Desktop Fetch method is invalid')
          if (request.body !== null && typeof request.body !== 'string')
            throw new TypeError('Desktop Fetch body is invalid')
          const response = await honoApp.fetch(new Request(request.url, {
            body: request.body === null ? undefined : request.body,
            headers: request.headers.map(([name, value]) => [name, value]),
            method: request.method,
          }), { requestContext: { sender: context.sender } })
          return {
            body: await response.text(),
            headers: [...response.headers.entries()],
            status: response.status,
            statusText: response.statusText,
          }
        }),
      },
      whiteboardLibrary: createWhiteboardLibraryHandlers(whiteboardLibrary),
      p2p: createP2pHandlers(p2p, getSyncServerStatus, installSyncServerCredential),
      todoCalendarFeed,
    }
    await scope.acquire({
      acquire: () => registerMemoriloProtocol({
        apiHandler: request => honoApp.fetch(request),
        assetDirectory,
        rendererDirectory: protocolOptions.rendererDirectory,
      }),
      close: registration => registration.close(),
      name: 'Memorilo protocol',
    })
    await scope.acquire({
      acquire: () => createIpcHandlerRegistry(ipcHandlers, { host: ipcMain as unknown as IpcHandlerHost }),
      close: current => current.close(),
      name: 'IPC registry',
    })
    scope.commit()
    return { close: scope.close }
  }
  catch (error) {
    return scope.rollback(error)
  }
}
