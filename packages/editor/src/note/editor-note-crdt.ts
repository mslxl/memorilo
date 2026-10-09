import type { BookFileBinding } from '@memorilo/reading-model'
import type { LoroDoc, LoroMap } from 'loro-crdt'
import type { CardTopicSource } from './editor-note'
import type { TopicReaderReference } from './topic-reader-reference'
import { assertBookFileBinding } from '@memorilo/reading-model'
import { normalizeTopicReaderReference } from './topic-reader-reference'

export const NOTE_META_KEY = 'noteMeta'
export const NOTE_ENTRIES_KEY = 'entries'
export const NOTE_SCHEMA_VERSION = 1
export const NOTE_UNDO_BOUNDARY_KEY = 'undoBoundary'
export const NOTE_LEARNING_ENABLED_KEY = 'learningEnabled'
export const NOTE_KIND_KEY = 'kind'
export const NOTE_JOURNAL_DATE_KEY = 'journalDate'
export const ENTRY_ID_KEY = 'entryId'
export const ENTRY_KIND_KEY = 'kind'
export const FOLDER_NAME_KEY = 'name'
export const TOPIC_TITLE_KEY = 'title'
export const TOPIC_EDITOR_MODE_KEY = 'editorMode'
export const TOPIC_BLOCK_TREE_KEY = 'blockTreeKey'
export const TOPIC_READER_REFERENCE_KEY = 'readerReference'
export const TOPIC_TYPE_KEY = 'topicType'
export const TOPIC_CARD_SOURCE_KEY = 'cardSource'
export const IMAGE_OCCLUSION_STATE_KEY = 'imageOcclusion'
export const BOOK_BINDING_KEY = 'book'
export const BOOK_READING_STATE_KEY = 'readingStateKey'
export const BOOK_ANNOTATIONS_KEY = 'annotationsKey'
export const WHITEBOARD_SCENE_KEY = 'scene'
export const WHITEBOARD_EMBEDDED_EDITORS_KEY = 'embeddedEditors'
export const EMBEDDED_EDITOR_ID_KEY = 'editorId'
export const EMBEDDED_EDITOR_MODE_KEY = 'editorMode'
export const EMBEDDED_EDITOR_DOCUMENT_KEY = 'document'

export function readString(map: LoroMap, key: string, description: string): string {
  const value = map.get(key)
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${description} must be a non-empty string`)
  return value
}

export function readBoolean(map: LoroMap, key: string, description: string): boolean {
  const value = map.get(key)
  if (typeof value !== 'boolean')
    throw new Error(`${description} must be a boolean`)
  return value
}

export function readTopicTitle(map: LoroMap, description: string): string {
  const value = map.get(TOPIC_TITLE_KEY)
  if (typeof value !== 'string')
    throw new Error(`${description} must be a string`)
  return value
}

export function readTopicType(map: LoroMap, description: string): 'book' | 'image-occlusion' | 'regular' | 'whiteboard' {
  const value = map.get(TOPIC_TYPE_KEY)
  if (value !== 'book' && value !== 'image-occlusion' && value !== 'regular' && value !== 'whiteboard')
    throw new Error(`${description} must be "book", "image-occlusion", "regular", or "whiteboard"`)
  return value
}

export function readCardTopicSource(map: LoroMap, description: string): CardTopicSource | null {
  const value = map.get(TOPIC_CARD_SOURCE_KEY)
  if (value === undefined)
    return null
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${description} must be an object or undefined`)
  const source = value as Record<string, unknown>
  if (source.kind !== 'basic' && source.kind !== 'cloze' && source.kind !== 'highlight' && source.kind !== 'list' && source.kind !== 'set')
    throw new TypeError(`${description} kind is unsupported`)
  if (typeof source.sourceId !== 'string' || source.sourceId.length === 0)
    throw new TypeError(`${description} sourceId must be a non-empty string`)
  if (typeof source.sourceTopicId !== 'string' || source.sourceTopicId.length === 0)
    throw new TypeError(`${description} sourceTopicId must be a non-empty string`)
  if (source.syncStatus !== 'synced' && source.syncStatus !== 'detached')
    throw new TypeError(`${description} syncStatus is unsupported`)
  return {
    kind: source.kind,
    sourceId: source.sourceId,
    sourceTopicId: source.sourceTopicId,
    syncStatus: source.syncStatus,
  }
}

export function validateBookBindingValue(value: unknown, description: string): BookFileBinding {
  const binding = structuredClone(value) as BookFileBinding
  assertBookFileBinding(binding, description)
  return binding
}

export function readBookBinding(map: LoroMap, description: string): BookFileBinding {
  return validateBookBindingValue(map.get(BOOK_BINDING_KEY), description)
}

export function readTopicReaderReference(map: LoroMap): TopicReaderReference | null {
  const value = map.get(TOPIC_READER_REFERENCE_KEY)
  return value === undefined ? null : normalizeTopicReaderReference(value)
}

export function noteTree(doc: LoroDoc) {
  return doc.getTree(NOTE_ENTRIES_KEY)
}

export function findNoteEntry(doc: LoroDoc, entryId: string) {
  const normalizedId = entryId.trim()
  if (normalizedId.length === 0)
    throw new TypeError('Note entry id must be a non-empty string')
  const node = noteTree(doc).getNodes().find(candidate => candidate.data.get(ENTRY_ID_KEY) === normalizedId)
  if (!node)
    throw new Error(`Unknown NoteEntry: ${normalizedId}`)
  return node
}
