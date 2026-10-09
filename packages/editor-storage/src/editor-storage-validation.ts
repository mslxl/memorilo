import type {
  AssetReferenceProjection,
  NoteEntryProjection,
  TopicContentProjection,
  TopicProjection,
} from './editor-storage-contracts'
import type { LearningTopicCardProjection } from './learning'
import { assertBookFileBinding, bookFileIdentityKey } from '@memorilo/reading-model'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { validateAssetFileName } from './editor-asset-repository'
import { assertNonEmpty } from './editor-storage-shared'

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string')
    throw new TypeError(`${name} must be a string`)
}

export function validateBinary(value: Uint8Array, name: string): void {
  if (!(value instanceof Uint8Array) || value.byteLength === 0)
    throw new TypeError(`${name} must be a non-empty Uint8Array`)
}

export function validateCompleteLearningProjection(
  entries: readonly NoteEntryProjection[],
  learningCards: readonly LearningTopicCardProjection[],
): void {
  const entryTopicIds = new Set(entries.flatMap(entry => entry.kind === 'topic' ? [entry.id] : []))
  const learningTopicIds = new Set(learningCards.map(topic => topic.topicId))
  if (entryTopicIds.size !== learningTopicIds.size
    || [...entryTopicIds].some(topicId => !learningTopicIds.has(topicId))) {
    throw new Error('A complete Note entry projection must include learning Cards for every Topic')
  }
}

function validateHierarchy<T extends { id: string, ordinal: number, parentId: string | null }>(
  values: readonly T[],
  description: string,
): Map<string, T> {
  const byId = new Map<string, T>()
  const siblingPositions = new Set<string>()

  for (const value of values) {
    assertNonEmpty(value.id, `${description} id`)
    if (!Number.isInteger(value.ordinal) || value.ordinal < 0)
      throw new RangeError(`${description} ${value.id} ordinal must be a non-negative integer`)
    if (byId.has(value.id))
      throw new Error(`Duplicate ${description} id: ${value.id}`)
    if (value.parentId === value.id)
      throw new Error(`${description} ${value.id} cannot be its own parent`)

    byId.set(value.id, value)
    const position = `${value.parentId ?? '<root>'}\0${value.ordinal}`
    if (siblingPositions.has(position))
      throw new Error(`Duplicate ${description} ordinal ${value.ordinal} under ${value.parentId ?? '<root>'}`)
    siblingPositions.add(position)
  }

  for (const value of values) {
    const ancestors = new Set<string>([value.id])
    let parentId = value.parentId
    while (parentId !== null) {
      if (ancestors.has(parentId))
        throw new Error(`${description} ${value.id} belongs to a parent cycle`)
      ancestors.add(parentId)
      const parent = byId.get(parentId)
      if (!parent)
        throw new Error(`${description} ${value.id} has unknown parent ${parentId}`)
      parentId = parent.parentId
    }
  }
  return byId
}

/** Validates the complete projection required by a Journal Note save. */
export function validateJournalProjection(
  entries: readonly NoteEntryProjection[] | undefined,
  topics: readonly TopicContentProjection[],
): void {
  if (entries === undefined)
    throw new TypeError('Journal saves must include the complete Note entry projection')
  if (entries.length !== 1)
    throw new TypeError('A Journal Note must contain exactly one Topic')
  const entry = entries[0]
  if (!entry || entry.kind !== 'topic' || entry.parentId !== null || entry.ordinal !== 0)
    throw new TypeError('A Journal Note must contain one root Topic at ordinal zero')
  if (topics.length !== 1 || topics[0]?.topicId !== entry.id)
    throw new TypeError('Journal saves must include the complete root Topic projection')
}

/** Validates an incremental Note projection without requiring every projection field. */
export function validateProjectionPatch(
  entries: readonly NoteEntryProjection[] | undefined,
  topics: readonly TopicContentProjection[],
): void {
  const entriesById = entries ? validateHierarchy(entries, 'NoteEntry') : undefined
  const topicEntries = new Map<string, TopicProjection>()
  const bookTopicIdsByFile = new Map<string, string>()

  for (const entry of entries ?? []) {
    if (entry.kind === 'folder') {
      assertNonEmpty(entry.name, `Folder ${entry.id} name`)
    }
    else if (entry.kind === 'topic') {
      const entryId = entry.id
      assertString(entry.title, `Topic ${entryId} title`)
      if (entry.topicType !== 'image-occlusion'
        && entry.topicType !== 'whiteboard'
        && entry.mode !== 0
        && entry.mode !== 1) {
        throw new TypeError(`Topic ${entryId} Editor mode must be 0 (Document) or 1 (Outline)`)
      }
      if (entry.topicType === 'book') {
        assertNonEmpty(entry.title, `BookTopic ${entryId} title`)
        assertBookFileBinding(entry.book, `BookTopic ${entryId} binding`)
        const identity = bookFileIdentityKey(entry.book.file)
        const existingTopicId = bookTopicIdsByFile.get(identity)
        if (existingTopicId)
          throw new Error(`BookTopics ${existingTopicId} and ${entryId} bind the same file ${identity}`)
        bookTopicIdsByFile.set(identity, entryId)
      }
      else if (entry.topicType !== 'image-occlusion'
        && entry.topicType !== 'regular'
        && entry.topicType !== 'whiteboard') {
        throw new TypeError(`Topic ${entryId} has an unknown subtype`)
      }
      if (entry.topicType === 'regular' && entry.cardSource !== undefined) {
        if (entry.cardSource.kind !== 'basic'
          && entry.cardSource.kind !== 'cloze'
          && entry.cardSource.kind !== 'highlight'
          && entry.cardSource.kind !== 'list'
          && entry.cardSource.kind !== 'set') {
          throw new TypeError(`Card Topic ${entryId} has an unsupported card kind`)
        }
        assertNonEmpty(entry.cardSource.sourceId, `Card Topic ${entryId} source id`)
        assertNonEmpty(entry.cardSource.sourceTopicId, `Card Topic ${entryId} source Topic id`)
        if (entry.cardSource.syncStatus !== 'synced' && entry.cardSource.syncStatus !== 'detached')
          throw new TypeError(`Card Topic ${entryId} has an unsupported sync status`)
        if (entry.parentId !== entry.cardSource.sourceTopicId)
          throw new TypeError(`Card Topic ${entryId} must remain under its source Topic`)
      }
      topicEntries.set(entryId, entry)
    }
    else {
      throw new TypeError(`Unknown NoteEntry kind: ${String((entry as { kind: unknown }).kind)}`)
    }
  }

  const projectedTopics = new Set<string>()
  for (const topic of topics) {
    assertNonEmpty(topic.topicId, 'Topic projection id')
    assertString(topic.title, `Topic ${topic.topicId} title`)
    if (projectedTopics.has(topic.topicId))
      throw new Error(`Duplicate Topic projection: ${topic.topicId}`)
    projectedTopics.add(topic.topicId)
    const entry = topicEntries.get(topic.topicId)
    if (entries && !entry)
      throw new Error(`Topic projection ${topic.topicId} has no matching NoteEntry`)
    if (entry && entry.title !== topic.title)
      throw new Error(`Topic projection ${topic.topicId} title does not match its NoteEntry`)

    validateHierarchy(topic.blocks, `Topic ${topic.topicId} Block`)
    for (const block of topic.blocks) {
      assertNonEmpty(block.kind, `Topic ${topic.topicId} Block ${block.id} kind`)
      if (block.attributes === null || Array.isArray(block.attributes) || typeof block.attributes !== 'object')
        throw new TypeError(`Topic ${topic.topicId} Block ${block.id} attributes must be an object`)
    }
  }

  for (const entry of entries ?? []) {
    if (entry.parentId !== null && !entriesById?.has(entry.parentId))
      throw new Error(`NoteEntry ${entry.id} has unknown parent ${entry.parentId}`)
    if (entry.kind === 'folder' && entry.parentId !== null && entriesById?.get(entry.parentId)?.kind === 'topic')
      throw new Error(`Folder ${entry.id} cannot use Topic ${entry.parentId} as its parent`)
  }
}

export function contentHash(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)))
}

export function validateAssetReferences(references: readonly AssetReferenceProjection[]): void {
  const fileNames = new Set<string>()
  for (const reference of references) {
    validateAssetFileName(reference.fileName)
    if (!Number.isInteger(reference.count) || reference.count <= 0)
      throw new RangeError('Asset reference count must be a positive integer')
    if (fileNames.has(reference.fileName))
      throw new TypeError(`Duplicate asset reference: ${reference.fileName}`)
    fileNames.add(reference.fileName)
  }
}
