import type { StoredNote } from '@memorilo/editor-storage'
import type { ProtobufSyncJournal } from '@memorilo/sync/node'
import { createEditorNote } from '@memorilo/editor/note'
import { encodeMemoriloProto } from '@memorilo/sync-protocol'

interface EnsureNoteP2pBaselinesOptions {
  defaultNoteLearningEnabled: () => boolean
  deviceId: string
  getNote: (noteId: string) => Promise<StoredNote>
  journal: Pick<ProtobufSyncJournal, 'appendLocal' | 'listChanges'>
  listNoteIds: () => Promise<readonly string[]>
}

export async function ensureNoteP2pBaselines({
  defaultNoteLearningEnabled,
  deviceId,
  getNote,
  journal,
  listNoteIds,
}: EnsureNoteP2pBaselinesOptions): Promise<void> {
  const baselinePrefix = `${deviceId}:note-baseline:`
  const baselineNoteIds = new Set(journal.listChanges({})
    .filter(change => change.deviceId === deviceId && change.id.startsWith(baselinePrefix))
    .map(change => change.id.slice(baselinePrefix.length)))

  for (const noteId of await listNoteIds()) {
    if (baselineNoteIds.has(noteId))
      continue
    // Existing Notes may predate the sync journal, so retain one complete baseline before sending later deltas.
    const stored = await getNote(noteId)
    const snapshot = createEditorNote({
      id: stored.id,
      learningEnabled: defaultNoteLearningEnabled(),
      snapshot: stored.snapshot,
      title: stored.title,
      updates: stored.updates.map(update => update.update),
    }).exportSnapshot()
    await journal.appendLocal({
      id: `${baselinePrefix}${noteId}`,
      kind: 'note-update',
      payload: encodeMemoriloProto('NoteUpdate', { noteId, loroUpdate: snapshot }),
    })
  }
}
