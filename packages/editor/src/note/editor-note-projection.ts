import type { BookFileBinding } from '@memorilo/reading-model'
import type { LoroDoc } from 'loro-crdt'
import type { NoteEntryKind, NoteEntrySnapshot } from './editor-note'
import type { TopicContentProjection } from './topic-projection'
import { createNodeJsonFromLoroTree } from '@memorilo/loro-prosemirror-tree/document'
import { bookFileIdentityKey } from '@memorilo/reading-model'
import { assertEditorMode } from '../common/editor-mode'
import { imageOcclusionSourceKey } from '../image-occlusion/image-occlusion-model'
import {
  ENTRY_ID_KEY,
  ENTRY_KIND_KEY,
  findNoteEntry,
  FOLDER_NAME_KEY,
  NOTE_META_KEY,
  noteTree,
  readBookBinding,
  readCardTopicSource,
  readString,
  readTopicReaderReference,
  readTopicTitle,
  readTopicType,
  TOPIC_BLOCK_TREE_KEY,
  TOPIC_EDITOR_MODE_KEY,
} from './editor-note-crdt'
import { getImageOcclusionState, projectImageOcclusionContent } from './editor-note-image-occlusion'
import {
  assertLinkedReaderAnnotationExists,
  readerAnnotationBindingKey,
} from './editor-note-reader-bindings'
import { projectWhiteboardContent } from './editor-note-whiteboard'
import { projectTopicContent } from './topic-projection'
import { isLinkedTopicReaderReference } from './topic-reader-reference'

export interface EditorNoteProjection {
  entries: readonly NoteEntrySnapshot[]
  topics: readonly TopicContentProjection[]
}

export function projectTopicContentFromTree(
  blockTree: ReturnType<LoroDoc['getTree']>,
  topicId: string,
  explicitTitle: string,
): TopicContentProjection {
  const document = createNodeJsonFromLoroTree(blockTree)
  if (!document)
    throw new Error(`Topic ${topicId} does not contain an initialized document`)
  return projectTopicContent(document, topicId, explicitTitle)
}

/** Validates and projects the complete Note entry tree from its CRDT document. */
export function projectEditorNote(doc: LoroDoc, includeTopics = true): EditorNoteProjection {
  const entries: NoteEntrySnapshot[] = []
  const topics: TopicContentProjection[] = []
  const seenEntryIds = new Set<string>()
  const bookTopicIdsByFile = new Map<string, string>()
  const imageOcclusionTopicIdsBySource = new Map<string, string>()
  const readerTopicIdsByAnnotation = new Map<string, string>()
  const runtime = { doc, noteId: readString(doc.getMap(NOTE_META_KEY), 'id', 'Note id') }

  const visit = (
    nodes: ReturnType<ReturnType<typeof noteTree>['toArray']>,
    parentId: string | null,
    parentKind: NoteEntryKind | null,
  ): void => {
    nodes.forEach((node, ordinal) => {
      const id = readString(node.meta, ENTRY_ID_KEY, 'NoteEntry id')
      if (seenEntryIds.has(id))
        throw new Error(`Duplicate NoteEntry id: ${id}`)
      seenEntryIds.add(id)
      const kind = node.meta.get(ENTRY_KIND_KEY)

      if (kind === 'folder') {
        if (parentKind === 'topic')
          throw new Error(`Folder ${id} cannot use Topic ${parentId} as its parent`)
        if (node.meta.get(TOPIC_BLOCK_TREE_KEY) !== undefined)
          throw new Error(`Folder ${id} must not have a Topic Block tree`)
        if (node.meta.get(TOPIC_EDITOR_MODE_KEY) !== undefined)
          throw new Error(`Folder ${id} must not have an Editor mode`)
        entries.push({
          id,
          kind,
          name: readString(node.meta, FOLDER_NAME_KEY, `Folder ${id} name`),
          ordinal,
          parentId,
        })
      }
      else if (kind === 'topic') {
        const topicType = readTopicType(node.meta, `Topic ${id} type`)
        const content = topicType === 'image-occlusion'
          ? projectImageOcclusionContent(runtime, id)
          : topicType === 'whiteboard'
            ? projectWhiteboardContent({
                doc,
                noteId: readString(doc.getMap(NOTE_META_KEY), 'id', 'Note id'),
              }, id)
            : projectTopicContentFromTree(
                doc.getTree(readString(node.meta, TOPIC_BLOCK_TREE_KEY, `Topic ${id} Block tree key`)),
                id,
                readTopicTitle(node.meta, `Topic ${id} title`),
              )
        if (topicType === 'image-occlusion') {
          const state = getImageOcclusionState(runtime, id)
          if (parentId !== state.source.topicId)
            throw new Error(`ImageOcclusionTopic ${id} must be a child of source Topic ${state.source.topicId}`)
          const sourceNode = findNoteEntry(doc, state.source.topicId)
          const sourceTopicType = readTopicType(sourceNode.data, `Topic ${state.source.topicId} type`)
          const expectedSourceTopicType = state.source.kind === 'reader-region' ? 'book' : 'regular'
          if (sourceTopicType !== expectedSourceTopicType) {
            throw new Error(
              `ImageOcclusionTopic ${id} ${state.source.kind} source must use a ${expectedSourceTopicType} Topic`,
            )
          }
          const sourceKey = imageOcclusionSourceKey(state.source)
          const existingTopicId = imageOcclusionTopicIdsBySource.get(sourceKey)
          if (existingTopicId)
            throw new Error(`ImageOcclusionTopics ${existingTopicId} and ${id} use the same source`)
          imageOcclusionTopicIdsBySource.set(sourceKey, id)
          entries.push({ id, kind, ordinal, parentId, title: content.title, topicType })
        }
        else if (topicType === 'book') {
          const base = {
            id,
            kind,
            mode: assertEditorMode(node.meta.get(TOPIC_EDITOR_MODE_KEY), `Topic ${id} Editor mode`),
            ordinal,
            parentId,
            title: content.title,
          } as const
          const book: BookFileBinding = readBookBinding(node.meta, `BookTopic ${id} binding`)
          const identity = bookFileIdentityKey(book.file)
          const existingTopicId = bookTopicIdsByFile.get(identity)
          if (existingTopicId)
            throw new Error(`BookTopics ${existingTopicId} and ${id} bind the same file ${identity}`)
          bookTopicIdsByFile.set(identity, id)
          entries.push({ ...base, book, topicType })
        }
        else if (topicType === 'regular') {
          const readerReference = readTopicReaderReference(node.meta)
          const cardSource = readCardTopicSource(node.meta, `Topic ${id} card source`)
          if (cardSource !== null && parentId !== cardSource.sourceTopicId)
            throw new Error(`Card Topic ${id} must be a child of source Topic ${cardSource.sourceTopicId}`)
          if (readerReference !== null && isLinkedTopicReaderReference(readerReference)) {
            if (parentId !== readerReference.bookTopicId) {
              throw new Error(
                `Reader-bound Topic ${id} must be a direct child of BookTopic ${readerReference.bookTopicId}`,
              )
            }
            assertLinkedReaderAnnotationExists(runtime, id, readerReference)
            const sourceKey = readerAnnotationBindingKey(readerReference)
            const existingTopicId = readerTopicIdsByAnnotation.get(sourceKey)
            if (existingTopicId) {
              throw new Error(
                `Topics ${existingTopicId} and ${id} both bind Reader annotation ${readerReference.annotationId}`,
              )
            }
            readerTopicIdsByAnnotation.set(sourceKey, id)
          }
          entries.push({
            id,
            kind,
            mode: assertEditorMode(node.meta.get(TOPIC_EDITOR_MODE_KEY), `Topic ${id} Editor mode`),
            ordinal,
            parentId,
            ...(readerReference === null ? {} : { readerReference }),
            ...(cardSource === null ? {} : { cardSource }),
            title: content.title,
            topicType,
          })
        }
        else {
          entries.push({ id, kind, ordinal, parentId, title: content.title, topicType })
        }

        if (includeTopics)
          topics.push(content)
      }
      else {
        throw new Error(`NoteEntry ${id} has unknown kind: ${String(kind)}`)
      }

      visit(node.children, id, kind)
    })
  }

  visit(noteTree(doc).toArray(), null, null)
  return { entries, topics }
}
