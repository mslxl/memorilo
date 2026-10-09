import type {
  CreateBookTopicInput,
  CreateFolderInput,
  CreateImageOcclusionTopicInput,
  CreateTopicInput,
  CreateWhiteboardTopicInput,
  DeleteNoteEntryInput,
  MoveNoteEntryInput,
  NoteEntrySnapshot,
} from './editor-note'
import type { EditorNoteDocument } from './editor-note-runtime'
import type { TopicReaderReference } from './topic-reader-reference'
import {
  ENTRY_ID_KEY,
  ENTRY_KIND_KEY,
  findNoteEntry,
  FOLDER_NAME_KEY,
  noteTree,
  readCardTopicSource,
  readString,
  readTopicReaderReference,
  readTopicType,
  TOPIC_CARD_SOURCE_KEY,
  TOPIC_READER_REFERENCE_KEY,
  TOPIC_TITLE_KEY,
  validateBookBindingValue,
} from './editor-note-crdt'
import {
  createImageOcclusionNode,
  getImageOcclusionSourceIdentity,
  getImageOcclusionState,
} from './editor-note-image-occlusion'
import { projectEditorNote } from './editor-note-projection'
import {
  assertLinkedReaderAnnotationExists,
  findReaderAnnotationTopicId,
} from './editor-note-reader-bindings'
import {
  assertBookFileAvailable,
  readTopicValidationInput,
  validateTopicInput,
} from './editor-note-topic-documents'
import { createTopicNode } from './editor-note-topic-factory'
import {
  normalizeNonEmptyString,
  normalizeTopicTitle,
  resolveNoteEntryIndex,
} from './editor-note-validation'
import { createWhiteboardNode, whiteboardHasUserContent } from './editor-note-whiteboard'
import { isLinkedTopicReaderReference, normalizeTopicReaderReference } from './topic-reader-reference'
import { hasTopicUserContent } from './topic-user-content'

interface EditorNoteEntryRepositoryDependencies {
  readonly runMutation: <Result>(operation: () => Result) => Result
  readonly runtime: EditorNoteDocument
}

export interface EditorNoteEntryRepository {
  readonly createBookTopic: (input: CreateBookTopicInput) => string
  readonly createFolder: (input: CreateFolderInput) => string
  readonly createImageOcclusionTopic: (input: CreateImageOcclusionTopicInput) => Promise<string>
  readonly createTopic: (input: CreateTopicInput) => string
  readonly createWhiteboardTopic: (input: CreateWhiteboardTopicInput) => string
  readonly deleteEntry: (input: DeleteNoteEntryInput) => void
  readonly getEntries: () => readonly NoteEntrySnapshot[]
  readonly getTopicReaderReference: (topicId: string) => TopicReaderReference | null
  readonly hasUserContent: () => boolean
  readonly moveEntry: (input: MoveNoteEntryInput) => void
  readonly renameEntry: (entryId: string, label: string) => void
  readonly setTopicReaderReference: (topicId: string, reference: TopicReaderReference | null) => void
}

export function createEditorNoteEntryRepository(
  dependencies: EditorNoteEntryRepositoryDependencies,
): EditorNoteEntryRepository {
  const { runMutation, runtime } = dependencies
  const { doc } = runtime
  const entryNode = (entryId: string) => findNoteEntry(doc, entryId)
  const resolveParent = (parentId: string | null | undefined) => {
    return parentId === null || parentId === undefined ? undefined : entryNode(parentId)
  }
  const assertFolderParent = (parent: ReturnType<typeof entryNode> | undefined): void => {
    if (parent?.data.get(ENTRY_KIND_KEY) === 'topic') {
      const parentId = readString(parent.data, ENTRY_ID_KEY, 'Topic id')
      throw new TypeError(`Folder cannot use Topic ${parentId} as its parent`)
    }
  }
  const assertReaderBoundTopicParent = (
    topicId: string,
    reference: TopicReaderReference | null | undefined,
    parent: ReturnType<typeof entryNode> | undefined,
  ): void => {
    if (reference === null || reference === undefined || !isLinkedTopicReaderReference(reference))
      return
    const parentId = parent?.data.get(ENTRY_KIND_KEY) === 'topic'
      ? readString(parent.data, ENTRY_ID_KEY, 'Parent Topic id')
      : null
    if (parentId !== reference.bookTopicId
      || parent === undefined
      || readTopicType(parent.data, `Parent Topic ${parentId ?? 'unknown'} type`) !== 'book') {
      throw new TypeError(
        `Reader-bound Topic ${topicId} must be a direct child of BookTopic ${reference.bookTopicId}`,
      )
    }
  }
  const assertReaderBoundTopicReference = (
    topicId: string,
    reference: TopicReaderReference | null | undefined,
    parent: ReturnType<typeof entryNode> | undefined,
    excludedTopicId?: string,
  ): void => {
    assertReaderBoundTopicParent(topicId, reference, parent)
    if (reference === null || reference === undefined || !isLinkedTopicReaderReference(reference))
      return
    assertLinkedReaderAnnotationExists(runtime, topicId, reference)
    const existingTopicId = findReaderAnnotationTopicId(doc, reference, excludedTopicId)
    if (existingTopicId) {
      throw new TypeError(
        `Topic ${existingTopicId} already binds Reader annotation ${reference.annotationId}`,
      )
    }
  }
  const assertCardTopicParent = (
    topicId: string,
    parent: ReturnType<typeof entryNode> | undefined,
  ): void => {
    const node = entryNode(topicId)
    if (node.data.get(ENTRY_KIND_KEY) !== 'topic'
      || readTopicType(node.data, `Topic ${topicId} type`) !== 'regular') {
      return
    }
    const source = readCardTopicSource(node.data, `Topic ${topicId} card source`)
    if (source === null)
      return
    const parentId = parent?.data.get(ENTRY_KIND_KEY) === 'topic'
      ? readString(parent.data, ENTRY_ID_KEY, `Parent of Card Topic ${topicId}`)
      : null
    if (parentId !== source.sourceTopicId)
      throw new TypeError(`Card Topic ${topicId} must remain a child of source Topic ${source.sourceTopicId}`)
  }

  return {
    createBookTopic: input => runMutation(() => {
      const book = validateBookBindingValue(input.book, 'BookTopic binding')
      assertBookFileAvailable(runtime, book)
      const parent = resolveParent(input.parentId)
      const entryId = createTopicNode(doc, input, parent?.id, book)
      doc.commit({ origin: 'note:create-book-topic' })
      return entryId
    }),
    createFolder: input => runMutation(() => {
      const index = resolveNoteEntryIndex(input.index)
      const name = normalizeNonEmptyString(input.name, 'Folder name')
      const parent = resolveParent(input.parentId)
      assertFolderParent(parent)
      const node = noteTree(doc).createNode(parent?.id, index)
      const entryId = crypto.randomUUID()
      node.data.set(ENTRY_ID_KEY, entryId)
      node.data.set(ENTRY_KIND_KEY, 'folder')
      node.data.set(FOLDER_NAME_KEY, name)
      doc.commit({ origin: 'note:create-folder' })
      return entryId
    }),
    createImageOcclusionTopic: async (input) => {
      const source = structuredClone(input.source)
      const snapshotSource = getImageOcclusionSourceIdentity(runtime, source)
      const image = await input.snapshot(structuredClone(snapshotSource))
      return runMutation(() => {
        const entryId = createImageOcclusionNode(runtime, {
          image,
          index: input.index,
          snapshotSource,
          source,
          title: input.title,
        })
        doc.commit({ origin: 'note:create-image-occlusion-topic' })
        return entryId
      })
    },
    createTopic: input => runMutation(() => {
      const parent = resolveParent(input.parentId)
      const readerReference = input.readerReference === undefined
        ? undefined
        : normalizeTopicReaderReference(input.readerReference)
      assertReaderBoundTopicReference('new', readerReference, parent)
      const entryId = createTopicNode(doc, {
        ...input,
        ...(readerReference === undefined ? {} : { readerReference }),
      }, parent?.id)
      doc.commit({ origin: 'note:create-topic' })
      return entryId
    }),
    createWhiteboardTopic: input => runMutation(() => {
      const parent = resolveParent(input.parentId)
      const entryId = createWhiteboardNode(doc, input, parent?.id)
      validateTopicInput(readTopicValidationInput(runtime, entryId))
      doc.commit({ origin: 'note:create-whiteboard-topic' })
      return entryId
    }),
    deleteEntry: input => runMutation(() => {
      const node = entryNode(input.entryId)
      const parent = node.parent()
      const index = node.index()
      if (index === undefined)
        throw new Error(`NoteEntry ${input.entryId} does not have a tree position`)

      if (input.strategy === 'promote-children') {
        const children = node.children() ?? []
        const cardTopic = children.find(child => (
          child.data.get(ENTRY_KIND_KEY) === 'topic'
          && readTopicType(child.data, 'Child Topic type') === 'regular'
          && readCardTopicSource(child.data, 'Child Card Topic source') !== null
        ))
        if (cardTopic) {
          const childId = readString(cardTopic.data, ENTRY_ID_KEY, 'Card Topic id')
          throw new TypeError(`Topic ${input.entryId} cannot promote bound Card Topic ${childId}`)
        }
        const boundReaderTopic = children.find((child) => {
          if (child.data.get(ENTRY_KIND_KEY) !== 'topic'
            || readTopicType(child.data, 'Child Topic type') !== 'regular') {
            return false
          }
          const reference = readTopicReaderReference(child.data)
          return reference !== null && isLinkedTopicReaderReference(reference)
        })
        if (boundReaderTopic) {
          const childId = readString(boundReaderTopic.data, ENTRY_ID_KEY, 'Reader-bound Topic id')
          throw new TypeError(`Topic ${input.entryId} cannot promote Reader-bound Topic ${childId}`)
        }
        const boundImageOcclusion = children.find(child => (
          child.data.get(ENTRY_KIND_KEY) === 'topic'
          && readTopicType(child.data, 'Child Topic type') === 'image-occlusion'
          && getImageOcclusionState(runtime, readString(child.data, ENTRY_ID_KEY, 'Child Topic id')).source.topicId === input.entryId
        ))
        if (boundImageOcclusion) {
          const childId = readString(boundImageOcclusion.data, ENTRY_ID_KEY, 'ImageOcclusionTopic id')
          throw new TypeError(`Topic ${input.entryId} cannot promote bound ImageOcclusionTopic ${childId}`)
        }
        children.forEach((child, offset) => child.move(parent, index + offset))
        noteTree(doc).delete(node.id)
      }
      else if (input.strategy === 'delete-subtree') {
        const remove = (current: typeof node): void => {
          current.children()?.forEach(remove)
          noteTree(doc).delete(current.id)
        }
        remove(node)
      }
      else {
        throw new TypeError(`Unknown NoteEntry deletion strategy: ${String(input.strategy)}`)
      }
      doc.commit({ origin: 'note:delete-entry' })
    }),
    getEntries: () => projectEditorNote(doc, false).entries,
    getTopicReaderReference: (topicId) => {
      const node = entryNode(topicId)
      if (readTopicType(node.data, `Topic ${topicId} type`) !== 'regular')
        throw new TypeError(`BookTopic ${topicId} cannot contain a Reader source reference`)
      return readTopicReaderReference(node.data)
    },
    hasUserContent: () => {
      const entries = projectEditorNote(doc, false).entries
      if (entries.length !== 1)
        return true
      const [entry] = entries
      if (!entry || entry.kind !== 'topic' || entry.parentId !== null)
        return true

      const validation = readTopicValidationInput(runtime, entry.id)
      const topic = validateTopicInput(validation)
      if (topic.entry.topicType === 'image-occlusion') {
        getImageOcclusionState(runtime, entry.id)
        return true
      }
      if (entry.topicType === 'whiteboard')
        return topic.entry.title.length > 0 || whiteboardHasUserContent(validation)
      if (!('document' in validation))
        throw new Error(`Topic ${entry.id} is missing its document`)
      return topic.entry.title.length > 0 || hasTopicUserContent(validation.document)
    },
    moveEntry: input => runMutation(() => {
      const node = entryNode(input.entryId)
      const parent = resolveParent(input.parentId)
      if (node.data.get(ENTRY_KIND_KEY) === 'folder')
        assertFolderParent(parent)
      if (node.data.get(ENTRY_KIND_KEY) === 'topic'
        && readTopicType(node.data, `Topic ${input.entryId} type`) === 'image-occlusion') {
        const sourceTopicId = getImageOcclusionState(runtime, input.entryId).source.topicId
        const parentId = parent ? readString(parent.data, ENTRY_ID_KEY, 'Parent Topic id') : null
        if (parentId !== sourceTopicId)
          throw new TypeError(`ImageOcclusionTopic ${input.entryId} must remain a child of Topic ${sourceTopicId}`)
      }
      if (node.data.get(ENTRY_KIND_KEY) === 'topic'
        && readTopicType(node.data, `Topic ${input.entryId} type`) === 'regular') {
        assertCardTopicParent(input.entryId, parent)
        assertReaderBoundTopicParent(input.entryId, readTopicReaderReference(node.data), parent)
      }
      noteTree(doc).move(node.id, parent?.id, resolveNoteEntryIndex(input.index))
      doc.commit({ origin: 'note:move-entry' })
    }),
    renameEntry: (entryId, label) => runMutation(() => {
      const node = entryNode(entryId)
      const kind = node.data.get(ENTRY_KIND_KEY)
      if (kind === 'folder') {
        node.data.set(FOLDER_NAME_KEY, normalizeNonEmptyString(label, 'Folder name'))
      }
      else if (kind === 'topic') {
        if (readTopicType(node.data, `Topic ${entryId} type`) === 'regular') {
          const cardSource = readCardTopicSource(node.data, `Topic ${entryId} card source`)
          if (cardSource?.syncStatus === 'synced')
            node.data.set(TOPIC_CARD_SOURCE_KEY, { ...cardSource, syncStatus: 'detached' as const })
        }
        node.data.set(TOPIC_TITLE_KEY, readTopicType(node.data, `Topic ${entryId} type`) === 'book'
          ? normalizeNonEmptyString(label, 'BookTopic title')
          : normalizeTopicTitle(label))
      }
      else {
        throw new Error(`NoteEntry ${entryId} has unknown kind: ${String(kind)}`)
      }
      doc.commit({ origin: 'note:rename-entry' })
    }),
    setTopicReaderReference: (topicId, reference) => runMutation(() => {
      const node = entryNode(topicId)
      if (readTopicType(node.data, `Topic ${topicId} type`) !== 'regular')
        throw new TypeError(`BookTopic ${topicId} cannot contain a Reader source reference`)
      const normalized = reference === null ? null : normalizeTopicReaderReference(reference)
      assertReaderBoundTopicReference(topicId, normalized, node.parent(), topicId)
      const entry = node.data.toJSON()
      if (normalized === null)
        Reflect.deleteProperty(entry, TOPIC_READER_REFERENCE_KEY)
      else
        entry[TOPIC_READER_REFERENCE_KEY] = normalized
      validateTopicInput({ ...readTopicValidationInput(runtime, topicId), entry })
      if (normalized === null)
        node.data.delete(TOPIC_READER_REFERENCE_KEY)
      else
        node.data.set(TOPIC_READER_REFERENCE_KEY, normalized)
      doc.commit({ origin: 'reader:set-topic-source-reference' })
    }),
  }
}
