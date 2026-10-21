import type { LoroDoc } from 'loro-crdt'
import type {
  EditorNoteChange,
  EditorNoteMutation,
  EditorNoteVersion,
} from './editor-note'
import { combineLifecycleFailures } from '@memorilo/effect-lifecycle'
import {
  ENTRY_ID_KEY,
  ENTRY_KIND_KEY,
  NOTE_ENTRIES_KEY,
  NOTE_META_KEY,
  noteTree,
  readString,
  TOPIC_TYPE_KEY,
} from './editor-note-crdt'

interface CreateEditorNoteCollaborationRuntimeOptions {
  readonly doc: LoroDoc
  readonly noteId: string
  readonly onSubscriberError: (error: unknown) => void
}

export interface EditorNoteCollaborationRuntime {
  readonly checkout: (version: readonly EditorNoteVersion[]) => void
  readonly checkoutLatest: () => void
  readonly exportSnapshot: () => Uint8Array
  readonly exportUpdates: (from?: readonly EditorNoteVersion[]) => Uint8Array
  readonly getVersion: () => readonly EditorNoteVersion[]
  readonly importUpdates: (updates: Uint8Array) => EditorNoteMutation
  readonly isTimeTraveling: () => boolean
  readonly subscribe: (listener: (change: EditorNoteChange) => void) => () => void
}

function assertBinary(value: Uint8Array, name: string): void {
  if (!(value instanceof Uint8Array) || value.byteLength === 0)
    throw new TypeError(`${name} must be a non-empty Uint8Array`)
}

function mutationRoot(eventPath: readonly unknown[], targetPath: readonly unknown[]): string | undefined {
  const root = eventPath[0] ?? targetPath[0]
  return typeof root === 'string' ? root : undefined
}

function topicIdFromMutationRoot(root: string): string | undefined {
  if (!root.startsWith('topic:'))
    return undefined
  for (const suffix of [':annotations', ':blocks', ':reading-state']) {
    if (root.endsWith(suffix))
      return root.slice('topic:'.length, -suffix.length)
  }
  return undefined
}

export function importEditorNoteHistory(
  doc: LoroDoc,
  snapshot: Uint8Array | null | undefined,
  updates: readonly Uint8Array[] | undefined,
): void {
  if (snapshot !== null && snapshot !== undefined) {
    assertBinary(snapshot, 'Note snapshot')
    doc.import(snapshot)
  }
  for (const update of updates ?? []) {
    assertBinary(update, 'Note update')
    doc.import(update)
  }
}

export function createEditorNoteCollaborationRuntime(
  options: CreateEditorNoteCollaborationRuntimeOptions,
): EditorNoteCollaborationRuntime {
  const { doc, noteId, onSubscriberError } = options
  const listeners = new Set<(change: EditorNoteChange) => void>()

  doc.subscribeLocalUpdates((update) => {
    const failures: unknown[] = []
    for (const listener of [...listeners]) {
      try {
        listener({ noteId, update: new Uint8Array(update) })
      }
      catch (error) {
        failures.push(error)
      }
    }
    if (failures.length === 0)
      return
    const failure = combineLifecycleFailures(failures, `EditorNote ${noteId} subscribers failed`)
    try {
      onSubscriberError(failure)
    }
    catch (reportError) {
      try {
        console.error(`Failed to report EditorNote ${noteId} subscriber error`, reportError)
      }
      catch {
        // Subscriber reporting must never make a committed CRDT mutation appear to fail.
      }
    }
  })

  return {
    checkout: version => doc.checkout([...version]),
    checkoutLatest: () => doc.checkoutToLatest(),
    exportSnapshot: () => new Uint8Array(doc.export({ mode: 'snapshot' })),
    exportUpdates: from => new Uint8Array(doc.export(from === undefined
      ? { mode: 'update' }
      : { mode: 'update', from: doc.frontiersToVV([...from]) })),
    getVersion: () => doc.frontiers().map(({ counter, peer }) => ({ counter, peer })),
    importUpdates: (updates) => {
      assertBinary(updates, 'Note updates')
      const roots = new Set<string>()
      let importedEvents = false
      const unsubscribe = doc.subscribe((batch) => {
        importedEvents ||= batch.events.length > 0
        for (const event of batch.events) {
          const path = doc.getPathToContainer(event.target) ?? []
          const root = mutationRoot(event.path, path)
          if (root)
            roots.add(root)
        }
      })
      try {
        doc.import(updates)
      }
      finally {
        unsubscribe()
      }
      return {
        entriesChanged: roots.has(NOTE_ENTRIES_KEY),
        metadataChanged: roots.has(NOTE_META_KEY),
        topicIds: [...new Set([
          ...(importedEvents
            ? noteTree(doc).getNodes().flatMap((node) => {
                if (node.data.get(ENTRY_KIND_KEY) !== 'topic'
                  || node.data.get(TOPIC_TYPE_KEY) !== 'whiteboard') {
                  return []
                }
                return [readString(node.data, ENTRY_ID_KEY, 'container-backed Topic id')]
              })
            : []),
          ...[...roots].flatMap((root) => {
            const topicId = topicIdFromMutationRoot(root)
            return topicId === undefined ? [] : [topicId]
          }),
        ])],
      }
    },
    isTimeTraveling: () => doc.isDetached(),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
