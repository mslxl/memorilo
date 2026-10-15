import type { Schema as EffectSchema } from 'effect'
import type { DesktopApi, DesktopLearningApi } from './contract'
import type {
  DesktopOperationArguments,
  DesktopOperationGroup,
  DesktopOperationMethod,
  DesktopOperationResult,
} from './operations'
import type { DesktopHonoApp } from './server'
import type { DesktopFetchTransport } from './transport'
import { DesktopConfigurationSchema } from '@memorilo/desktop-config'
import { hc } from 'hono/client'
import { RuntimeInfoSchema } from './app-routes'
import { desktopOperationSchemas } from './operations'
import { createDesktopTransportFetch, memoriloApiOrigin } from './transport'
import {
  decodeDesktopHonoResponse,
  encodeDesktopHonoValue,
} from './wire'

export function createDesktopHonoClient(fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {
  if (typeof fetchImplementation !== 'function')
    throw new TypeError('Desktop Hono client requires a Fetch implementation')
  return hc<DesktopHonoApp>(memoriloApiOrigin, { fetch: fetchImplementation })
}

export type DesktopHonoClient = ReturnType<typeof createDesktopHonoClient>

export interface CreateDesktopApiClientOptions {
  contextualTransport: DesktopFetchTransport
  fetch?: typeof globalThis.fetch
}

export function createDesktopApiClient(options: CreateDesktopApiClientOptions): DesktopApi {
  const portableClient = options.fetch === undefined
    ? createDesktopHonoClient()
    : createDesktopHonoClient(options.fetch)
  const contextualClient = createDesktopHonoClient(createDesktopTransportFetch(options.contextualTransport))

  const rpc = async <
    Group extends DesktopOperationGroup,
    Method extends DesktopOperationMethod<Group>,
  >(
    group: Group,
    method: Method,
    ...args: DesktopOperationArguments<Group, Method>
  ): Promise<DesktopOperationResult<Group, Method>> => {
    type RuntimeSchema = EffectSchema.Top & {
      readonly DecodingServices: never
      readonly EncodingServices: never
    }
    const groupSchemas = desktopOperationSchemas[group] as unknown as Record<PropertyKey, {
      readonly arguments: RuntimeSchema
      readonly contextual: boolean
      readonly result: RuntimeSchema
    }>
    const definition = groupSchemas[method]
    if (definition === undefined)
      throw new Error(`Unknown desktop request operation: ${String(group)}.${String(method)}`)
    const operation = `${String(group)}.${String(method)}`
    const encodedArguments = encodeDesktopHonoValue(operation, definition.arguments, args)
    const client = definition.contextual ? contextualClient : portableClient
    const response = await client.rpc[':group'][':method'].$post({
      json: { args: encodedArguments },
      param: { group: String(group), method: String(method) },
    })
    return decodeDesktopHonoResponse(operation, response, definition.result) as DesktopOperationResult<Group, Method>
  }

  const learning: DesktopLearningApi = {
    archiveOptimizer: async (optimizerId) => { await rpc('learning', 'archiveOptimizer', optimizerId) },
    assignNoteOptimizer: async (input) => { await rpc('learning', 'assignNoteOptimizer', input) },
    createOptimizer: input => rpc('learning', 'createOptimizer', input),
    getActivitySummary: input => input === undefined
      ? rpc('learning', 'getActivitySummary')
      : rpc('learning', 'getActivitySummary', input),
    getDailyProgress: now => now === undefined
      ? rpc('learning', 'getDailyProgress')
      : rpc('learning', 'getDailyProgress', now),
    getLearningState: targetId => rpc('learning', 'getLearningState', targetId),
    getMaintenanceEstimate: () => rpc('learning', 'getMaintenanceEstimate'),
    getNextLearningKind: input => input === undefined
      ? rpc('learning', 'getNextLearningKind')
      : rpc('learning', 'getNextLearningKind', input),
    getNextItem: input => input === undefined
      ? rpc('learning', 'getNextItem')
      : rpc('learning', 'getNextItem', input),
    getNextNewItem: input => input === undefined
      ? rpc('learning', 'getNextNewItem')
      : rpc('learning', 'getNextNewItem', input),
    getNextReviewItem: input => input === undefined
      ? rpc('learning', 'getNextReviewItem')
      : rpc('learning', 'getNextReviewItem', input),
    getNoteOptimizer: noteId => rpc('learning', 'getNoteOptimizer', noteId),
    getOptimizer: optimizerId => rpc('learning', 'getOptimizer', optimizerId),
    getOptimizerNoteCount: optimizerId => rpc('learning', 'getOptimizerNoteCount', optimizerId),
    listNotesWithCards: () => rpc('learning', 'listNotesWithCards'),
    listOptimizers: () => rpc('learning', 'listOptimizers'),
    listQueue: input => input === undefined
      ? rpc('learning', 'listQueue')
      : rpc('learning', 'listQueue', input),
    listTargets: cardId => rpc('learning', 'listTargets', cardId),
    listReadingItems: input => input === undefined
      ? rpc('learning', 'listReadingItems')
      : rpc('learning', 'listReadingItems', input),
    processReadingItem: input => rpc('learning', 'processReadingItem', input),
    maintainDatabase: () => rpc('learning', 'maintainDatabase'),
    optimizeOptimizer: input => rpc('learning', 'optimizeOptimizer', input),
    prepareReview: input => rpc('learning', 'prepareReview', input),
    rateMultiLineCard: input => rpc('learning', 'rateMultiLineCard', input),
    rateTarget: input => rpc('learning', 'rateTarget', input),
    resetOptimizerDefaults: (optimizerId, rescheduleNow) => rescheduleNow === undefined
      ? rpc('learning', 'resetOptimizerDefaults', optimizerId)
      : rpc('learning', 'resetOptimizerDefaults', optimizerId, rescheduleNow),
    resetTarget: input => rpc('learning', 'resetTarget', input),
    restoreReviewItem: input => rpc('learning', 'restoreReviewItem', input),
    saveOptimizer: input => rpc('learning', 'saveOptimizer', input),
    undoLastReview: input => rpc('learning', 'undoLastReview', input),
    undoReviews: input => rpc('learning', 'undoReviews', input),
  }

  return {
    addShelfSource: input => rpc('shelf', 'addSource', input),
    captureReaderRegion: input => rpc('window', 'captureReaderRegion', input),
    checkAssets: () => rpc('assets', 'check'),
    closeBookReadingSession: sessionId => rpc('books', 'closeReadingSession', sessionId),
    createBookContext: input => rpc('books', 'createContext', input),
    createNote: input => input === undefined
      ? rpc('notes', 'createNote')
      : rpc('notes', 'createNote', input),
    deleteNote: input => rpc('notes', 'deleteNote', input),
    deleteShelfReading: readingId => rpc('shelf', 'deleteReading', readingId),
    exportDatabase: () => rpc('backup', 'exportDatabase'),
    exportNoteMemo: input => rpc('notes', 'exportNoteMemo', input),
    exportNotePdf: input => rpc('notes', 'exportNotePdf', input),
    startNoteExport: input => rpc('notes', 'startNoteExport', input),
    prepareNoteImport: () => rpc('notes', 'prepareNoteImport'),
    getNoteTransfer: operationId => rpc('notes', 'getNoteTransfer', operationId),
    continueNoteTransfer: input => rpc('notes', 'continueNoteTransfer', input),
    cancelNoteTransfer: operationId => rpc('notes', 'cancelNoteTransfer', operationId),
    getCachedShelfView: input => rpc('shelf', 'getCachedView', input),
    getConfiguration: async () => decodeDesktopHonoResponse(
      'configuration.get',
      await portableClient.configuration.$get(),
      DesktopConfigurationSchema,
    ),
    getNote: input => rpc('notes', 'getNote', input),
    generateCardTopic: input => rpc('notes', 'generateCardTopic', input),
    getDeleteNoteImpact: input => rpc('notes', 'getDeleteNoteImpact', input),
    getRuntimeInfo: async () => decodeDesktopHonoResponse(
      'app.getRuntimeInfo',
      await portableClient.app.runtime.$get(),
      RuntimeInfoSchema,
    ),
    getShelfAsset: input => rpc('shelf', 'getAsset', input),
    getShelfPublicationDetails: input => rpc('shelf', 'getPublicationDetails', input),
    getTopicBlock: input => rpc('notes', 'getTopicBlock', input),
    importNetworkImage: input => rpc('assets', 'importNetworkImage', input),
    importNote: () => rpc('notes', 'importNote'),
    isBookReadingAvailable: readingId => rpc('books', 'isReadingAvailable', readingId),
    listBookContexts: readingId => rpc('books', 'listContexts', readingId),
    listFavoriteNotes: input => input === undefined
      ? rpc('notes', 'listFavoriteNotes')
      : rpc('notes', 'listFavoriteNotes', input),
    listJournalDates: input => rpc('journals', 'listJournalDates', input),
    listNotes: input => input === undefined
      ? rpc('notes', 'listNotes')
      : rpc('notes', 'listNotes', input),
    listPastJournals: input => input === undefined
      ? rpc('journals', 'listPastJournals')
      : rpc('journals', 'listPastJournals', input),
    listRecentNotes: input => input === undefined
      ? rpc('notes', 'listRecentNotes')
      : rpc('notes', 'listRecentNotes', input),
    listTodoTasks: input => input === undefined
      ? rpc('notes', 'listTodoTasks')
      : rpc('notes', 'listTodoTasks', input),
    createTodoTask: input => rpc('notes', 'createTodoTask', input),
    listTodoCalendarEvents: input => rpc('notes', 'listTodoCalendarEvents', input),
    listTodoCalendarSubscriptions: () => rpc('notes', 'listTodoCalendarSubscriptions'),
    refreshTodoCalendar: id => rpc('notes', 'refreshTodoCalendar', id),
    removeTodoCalendar: async (id) => {
      await rpc('notes', 'removeTodoCalendar', id)
      return undefined
    },
    subscribeTodoCalendar: input => rpc('notes', 'subscribeTodoCalendar', input),
    updateTodoTask: input => rpc('notes', 'updateTodoTask', input),
    learning,
    listShelfSources: () => rpc('shelf', 'listSources'),
    openJournal: input => input === undefined
      ? rpc('journals', 'openJournal')
      : rpc('journals', 'openJournal', input),
    openMostRecentNote: () => rpc('notes', 'openMostRecentNote'),
    openShelfReading: input => rpc('shelf', 'openReading', input),
    prepareShelfReading: input => rpc('shelf', 'prepareReading', input),
    prunePastEmptyJournals: () => rpc('journals', 'prunePastEmptyJournals'),
    readShelfReadingRange: input => rpc('shelf', 'readReadingRange', input),
    reclaimAssets: input => rpc('assets', 'reclaim', input),
    rebindBookContext: input => rpc('books', 'rebindContext', input),
    recordNoteOpened: async (input) => { await rpc('notes', 'recordNoteOpened', input) },
    refreshShelfView: input => rpc('shelf', 'refreshView', input),
    removeShelfSource: async (sourceId) => { await rpc('shelf', 'removeSource', sourceId) },
    renameNote: input => rpc('notes', 'renameNote', input),
    restoreDatabase: () => rpc('backup', 'restoreDatabase'),
    saveImage: input => rpc('assets', 'saveImage', input),
    saveNoteUpdates: input => rpc('notes', 'saveNoteUpdates', input),
    searchNotes: input => rpc('notes', 'searchNotes', input),
    searchTopicBlocks: input => rpc('notes', 'searchTopicBlocks', input),
    setConfiguration: async configuration => decodeDesktopHonoResponse(
      'configuration.set',
      await portableClient.configuration.$put({
        json: encodeDesktopHonoValue('configuration.set', DesktopConfigurationSchema, configuration),
      }),
      DesktopConfigurationSchema,
    ),
    setConfigurationValue: async (path, value) => decodeDesktopHonoResponse(
      'configuration.setValue',
      await portableClient.configuration.value.$patch({ json: { path, value } }),
      DesktopConfigurationSchema,
    ),
    setNoteFavorite: input => rpc('notes', 'setNoteFavorite', input),
    selectBookContext: input => rpc('books', 'selectContext', input),
    showColumnVisibilityMenu: input => rpc('window', 'showColumnVisibilityMenu', input),
    showApplicationMenu: input => rpc('window', 'showApplicationMenu', input),
    setTitlebarAppearance: input => rpc('window', 'setTitlebarAppearance', input),
    updateShelfSource: input => rpc('shelf', 'updateSource', input),
  }
}
