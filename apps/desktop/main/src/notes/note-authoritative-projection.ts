import type {
  NoteEntryProjection,
  TopicContentProjection as StoredTopicContentProjection,
} from '@memorilo/editor-storage'
import type {
  EditorNoteMutation,
  EditorNoteVersion,
  NoteEntrySnapshot,
  TopicContentProjection,
} from '@memorilo/editor/note'
import { createHash } from 'node:crypto'

export function mergeMutation(target: {
  entriesChanged: boolean
  metadataChanged: boolean
  topicIds: Set<string>
}, mutation: EditorNoteMutation): void {
  target.entriesChanged ||= mutation.entriesChanged
  target.metadataChanged ||= mutation.metadataChanged
  mutation.topicIds.forEach(topicId => target.topicIds.add(topicId))
}

export function toStoredEntries(entries: readonly NoteEntrySnapshot[]): readonly NoteEntryProjection[] {
  return entries.map(entry => structuredClone(entry))
}

export function toStoredTopic(topic: TopicContentProjection): StoredTopicContentProjection {
  return structuredClone(topic)
}

export function updateHash(update: Uint8Array): string {
  return createHash('sha256').update(update).digest('hex')
}

export function noteRevision(version: readonly EditorNoteVersion[]): string {
  const normalized = [...version]
    .sort((left, right) => left.peer.localeCompare(right.peer) || left.counter - right.counter)
    .map(item => `${item.peer}:${item.counter}`)
    .join(',')
  return createHash('sha256').update(normalized).digest('hex')
}
