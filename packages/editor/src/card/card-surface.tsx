import type { EditorAdapters } from '../adapters/editor-adapters'
import type { EditorTopicDocument } from '../note/editor-note'
import type { EditorCardProjection } from './card-model'
import type { CardReviewItemSelection, CardReviewSide } from './card-review-runtime'
import * as stylex from '@stylexjs/stylex'
import { useMemo } from 'react'
import { EditorMode } from '../common/editor-mode'
import { Editor } from '../editor'
import { cardSurfaceStyles } from './card-surface.stylex'

export interface CardSurfaceProps {
  adapters: EditorAdapters
  appearance?: 'preview' | 'review'
  card: EditorCardProjection
  editable?: boolean
  itemSelection?: CardReviewItemSelection
  revealedItemBlockIds?: readonly string[]
  showSource?: boolean
  side: CardReviewSide
  topic: EditorTopicDocument
}

export function CardSurface({
  adapters,
  appearance = 'review',
  card,
  editable = false,
  itemSelection,
  revealedItemBlockIds,
  showSource = false,
  side,
  topic,
}: CardSurfaceProps) {
  const focus = useMemo(() => ({ blockId: card.sourceBlockId }), [card.sourceBlockId])
  const outline = useMemo(() => ({ defaultFocus: focus, focus }), [focus])
  const cardReview = useMemo(() => ({
    active: !showSource,
    card,
    itemSelection,
    revealedItemBlockIds,
    side,
  }), [card, itemSelection, revealedItemBlockIds, showSource, side])

  return (
    <section
      {...stylex.props(
        cardSurfaceStyles.root,
        appearance === 'review' ? cardSurfaceStyles.review : cardSurfaceStyles.preview,
      )}
      aria-label={showSource ? undefined : `${card.kind} card`}
      data-card-id={card.id}
      data-card-review-active={showSource ? undefined : ''}
      data-card-side={showSource ? 'source' : side}
      data-card-surface={appearance}
    >
      <Editor
        adapters={adapters}
        cardReview={cardReview}
        mode={EditorMode.Outline}
        outline={outline}
        readOnly={!editable}
        topic={topic}
      />
    </section>
  )
}

export type { CardReviewItemSelection as CardSurfaceItemSelection, CardReviewSide as CardSurfaceSide } from './card-review-runtime'
