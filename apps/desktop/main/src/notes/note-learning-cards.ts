import type {
  EditorStorage,
  LearningCardProjection,
  LearningTopicCardProjection,
  ReadingItemProjection,
} from '@memorilo/editor-storage'
import type { ReviewCardProjection } from '@memorilo/editor/card'
import type { EditorNote } from '@memorilo/editor/note'
import { projectEditorCards, projectEditorReadingItems, projectImageOcclusionCards } from '@memorilo/editor/card'
import { projectCardTopicCards } from '@memorilo/editor/note'

type TopicDocument = Extract<ReturnType<EditorNote['getTopicValidationInput']>, { document: unknown }>['document']

function topicDocuments(note: EditorNote, topicId: string): readonly TopicDocument[] {
  const validation = note.getTopicValidationInput(topicId)
  if ('document' in validation)
    return [validation.document]
  if ('embeddedEditors' in validation)
    return Object.values(validation.embeddedEditors).map(editor => editor.document)
  throw new TypeError(`ImageOcclusionTopic ${topicId} does not have ProseMirror documents`)
}

function toLearningCard(card: ReviewCardProjection): LearningCardProjection {
  return {
    cardId: card.id,
    direction: card.kind === 'cloze' || card.kind === 'highlight' ? 'forward' : card.direction,
    itemBlockIds: (card.kind === 'list' || card.kind === 'set') && card.direction === 'forward'
      ? card.items.map(item => item.blockId)
      : [],
    kind: card.kind === 'image-occlusion' || card.kind === 'highlight' ? 'basic' : card.kind,
    sourceBlockId: card.sourceBlockId,
  }
}

export function projectNoteLearningCards(
  note: EditorNote,
  topicIds?: Iterable<string>,
): readonly LearningTopicCardProjection[] {
  const learningEnabled = note.getLearningEnabled()
  const entries = note.getEntries()
  const selectedTopicIds = topicIds === undefined
    ? entries.filter(entry => entry.kind === 'topic').map(entry => entry.id)
    : [...new Set(topicIds)]
  return selectedTopicIds.map((topicId) => {
    const topicOrder = entries.findIndex(candidate => candidate.id === topicId)
    const entry = topicOrder === -1 ? undefined : entries[topicOrder]
    let cards: readonly LearningCardProjection[]
    if (entry?.kind !== 'topic' || !learningEnabled) {
      cards = []
    }
    else if (entry.topicType === 'image-occlusion') {
      cards = projectImageOcclusionCards(note.getImageOcclusionTopic(topicId).getState()).map(toLearningCard)
    }
    else if (entry.topicType === 'regular') {
      const source = entry.cardSource
      cards = source === undefined
        ? []
        : topicDocuments(note, topicId).flatMap(document => projectCardTopicCards(document, source).map(toLearningCard))
    }
    else {
      cards = topicDocuments(note, topicId).flatMap(document => projectEditorCards(document).filter(card => card.kind !== 'highlight').map(toLearningCard))
    }
    return {
      cards,
      topicId,
      topicOrder: topicOrder === -1 ? 0 : topicOrder,
    }
  })
}

export function projectNoteReadingItems(note: EditorNote, topicIds?: Iterable<string>): readonly ReadingItemProjection[] {
  const selectedTopicIds = topicIds === undefined
    ? note.getEntries().filter(entry => entry.kind === 'topic').map(entry => entry.id)
    : [...new Set(topicIds)]
  const result: ReadingItemProjection[] = []
  for (const topicId of selectedTopicIds) {
    const entry = note.getEntries().find(candidate => candidate.id === topicId)
    // CardTopics are projections of a source Topic. Their copied Highlight
    // marks must not create a second Reading Item for the same source.
    if (
      entry?.kind !== 'topic'
      || entry.topicType === 'image-occlusion'
      || (entry.topicType === 'regular' && entry.cardSource !== undefined)
    ) {
      continue
    }
    for (const document of topicDocuments(note, topicId)) {
      for (const item of projectEditorReadingItems(document)) {
        result.push({
          highlightId: item.highlightId,
          readingItemId: item.highlightId,
          sourceBlockId: item.sourceBlockId,
          topicId,
        })
      }
    }
  }
  return result
}

export async function repairNoteLearningCards(
  storage: EditorStorage,
  note: EditorNote,
): Promise<void> {
  const current = projectNoteLearningCards(note)
  const topicIds = new Set([
    ...current.map(topic => topic.topicId),
    ...await storage.learning.cards.listNoteTopicIds(note.id),
  ])
  const projectionByTopic = new Map(
    projectNoteLearningCards(note, topicIds).map(topic => [topic.topicId, topic]),
  )
  for (const topic of projectionByTopic.values()) {
    await storage.learning.cards.reconcileTopicCards({
      ...topic,
      noteId: note.id,
    })
  }
}
