import type { ReactNode } from 'react'
import type {
  EditorCardProjection,
  HighlightColor,
  MultiLineCardItemProjection,
} from './card-model'
import * as stylex from '@stylexjs/stylex'
import i18next from 'i18next'
import { CircleX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cardPreviewStyles } from './card-preview.stylex'
import { CardRichContent } from './card-rich-content'

export type CardPreviewMode = 'back' | 'front' | 'interactive'

export interface CardPreviewProps {
  appearance?: 'embedded' | 'standalone'
  card: EditorCardProjection
  itemSelection?: CardPreviewItemSelection
  mode?: CardPreviewMode
  revealedItemBlockIds?: readonly string[]
}

export interface CardPreviewItemSelection {
  label: (itemBlockId: string, selected: boolean) => string
  onToggle: (itemBlockId: string) => void
  selectedItemBlockIds: readonly string[]
}

function blockHighlightStyle(color: HighlightColor | null) {
  if (color === 'yellow')
    return cardPreviewStyles.blockYellow
  if (color === 'green')
    return cardPreviewStyles.blockGreen
  if (color === 'blue')
    return cardPreviewStyles.blockBlue
  if (color === 'pink')
    return cardPreviewStyles.blockPink
  if (color === 'orange')
    return cardPreviewStyles.blockOrange
  if (color === 'purple')
    return cardPreviewStyles.blockPurple
  return null
}

function RevealButton({ action, children, onClick }: { action: 'reveal-answer' | 'reveal-next', children: ReactNode, onClick: () => void }) {
  return (
    <div {...stylex.props(cardPreviewStyles.actions)}>
      <button {...stylex.props(cardPreviewStyles.revealButton)} data-card-action={action} type="button" onClick={onClick}>
        {children}
      </button>
    </div>
  )
}

function ItemList({
  itemSelection,
  items,
  ordered,
  revealedItemBlockIds,
}: {
  itemSelection?: CardPreviewItemSelection
  items: readonly MultiLineCardItemProjection[]
  ordered: boolean
  revealedItemBlockIds?: readonly string[]
}) {
  const List = ordered ? 'ol' : 'ul'
  const revealed = revealedItemBlockIds === undefined ? undefined : new Set(revealedItemBlockIds)
  const selected = new Set(itemSelection?.selectedItemBlockIds)
  return (
    <List {...stylex.props(cardPreviewStyles.itemList)}>
      {items.map((item) => {
        const itemRevealed = revealed?.has(item.blockId) ?? true
        const itemSelected = selected.has(item.blockId)
        return (
          <li
            key={item.blockId}
            {...stylex.props(cardPreviewStyles.item, itemSelected && cardPreviewStyles.itemSelected)}
            data-card-item-id={item.blockId}
          >
            <div {...stylex.props(cardPreviewStyles.itemContent)}>
              {itemRevealed
                ? <CardRichContent nodes={item.content} />
                : (
                    <span {...stylex.props(cardPreviewStyles.hiddenItem)} aria-label={i18next.t('ui.hiddenCardItem', { ns: 'editor' })}>
                      ···
                    </span>
                  )}
            </div>
            {itemSelection && itemRevealed
              ? (
                  <button
                    {...stylex.props(cardPreviewStyles.itemSelectionButton, itemSelected && cardPreviewStyles.itemSelectionButtonSelected)}
                    aria-label={itemSelection.label(item.blockId, itemSelected)}
                    aria-pressed={itemSelected}
                    title={itemSelection.label(item.blockId, itemSelected)}
                    type="button"
                    onClick={() => itemSelection.onToggle(item.blockId)}
                  >
                    <CircleX aria-hidden="true" size={17} strokeWidth={1.8} />
                  </button>
                )
              : null}
          </li>
        )
      })}
    </List>
  )
}

function BasicPreview({ card, mode }: {
  card: Extract<EditorCardProjection, { kind: 'basic' }>
  mode: CardPreviewMode
}) {
  const [revealed, setRevealed] = useState(false)
  const showBack = mode === 'back' || (mode === 'interactive' && revealed)
  return (
    <>
      <CardRichContent nodes={card.front} />
      {showBack
        ? (
            <div {...stylex.props(cardPreviewStyles.answer)} aria-live="polite">
              <hr {...stylex.props(cardPreviewStyles.divider)} />
              <CardRichContent nodes={card.back} />
            </div>
          )
        : null}
      {mode === 'interactive' && !revealed ? <RevealButton action="reveal-answer" onClick={() => setRevealed(true)}>{i18next.t('ui.showAnswer', { ns: 'editor' })}</RevealButton> : null}
    </>
  )
}

function ClozePreview({ card, mode }: {
  card: Extract<EditorCardProjection, { kind: 'cloze' }>
  mode: CardPreviewMode
}) {
  const [revealed, setRevealed] = useState(false)
  const showAnswer = mode === 'back' || (mode === 'interactive' && revealed)
  return (
    <>
      <CardRichContent clozeCardId={card.id} nodes={card.content} revealCloze={showAnswer} />
      {mode === 'interactive' && !revealed ? <RevealButton action="reveal-answer" onClick={() => setRevealed(true)}>{i18next.t('ui.showAnswer', { ns: 'editor' })}</RevealButton> : null}
    </>
  )
}

function HighlightPreview({ card }: {
  card: Extract<EditorCardProjection, { kind: 'highlight' }>
}) {
  return <CardRichContent nodes={card.content} />
}

function MultiLinePreview({ card, itemSelection, mode, revealedItemBlockIds }: {
  card: Extract<EditorCardProjection, { kind: 'list' | 'set' }>
  itemSelection?: CardPreviewItemSelection
  mode: CardPreviewMode
  revealedItemBlockIds?: readonly string[]
}) {
  const [revealedItems, setRevealedItems] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const backward = card.direction === 'backward'
  const fullyRevealed = mode === 'back' || (mode === 'interactive' && revealed)

  if (backward) {
    return (
      <>
        <ItemList items={card.items} ordered={card.kind === 'list'} />
        {fullyRevealed
          ? (
              <div {...stylex.props(cardPreviewStyles.answer)} aria-live="polite">
                <hr {...stylex.props(cardPreviewStyles.divider)} />
                <CardRichContent nodes={card.prompt} />
              </div>
            )
          : null}
        {mode === 'interactive' && !revealed ? <RevealButton action="reveal-answer" onClick={() => setRevealed(true)}>{i18next.t('ui.showAnswer', { ns: 'editor' })}</RevealButton> : null}
      </>
    )
  }

  const visibleCount = mode === 'back'
    ? card.items.length
    : card.kind === 'list' ? revealedItems : fullyRevealed ? card.items.length : 0
  const visibleItems = card.items.slice(0, visibleCount)
  const controlledItems = revealedItemBlockIds !== undefined
  const canRevealNext = mode === 'interactive' && card.kind === 'list' && visibleCount < card.items.length

  return (
    <>
      <CardRichContent nodes={card.prompt} />
      {controlledItems || visibleItems.length > 0
        ? (
            <div {...stylex.props(cardPreviewStyles.answer)} aria-live="polite">
              <ItemList
                itemSelection={itemSelection}
                items={controlledItems ? card.items : visibleItems}
                ordered={card.kind === 'list'}
                revealedItemBlockIds={revealedItemBlockIds}
              />
            </div>
          )
        : null}
      {canRevealNext
        ? (
            <RevealButton action="reveal-next" onClick={() => setRevealedItems(count => count + 1)}>
              {i18next.t('ui.showNextItem', { visibleCount: visibleCount + 1, total: card.items.length, ns: 'editor' })}
            </RevealButton>
          )
        : null}
      {mode === 'interactive' && card.kind === 'set' && !revealed
        ? <RevealButton action="reveal-answer" onClick={() => setRevealed(true)}>{i18next.t('ui.showAnswer', { ns: 'editor' })}</RevealButton>
        : null}
    </>
  )
}

function CardPreviewSession({
  appearance,
  card,
  itemSelection,
  mode,
  revealedItemBlockIds,
}: {
  appearance: NonNullable<CardPreviewProps['appearance']>
  card: EditorCardProjection
  itemSelection?: CardPreviewItemSelection
  mode: NonNullable<CardPreviewProps['mode']>
  revealedItemBlockIds?: readonly string[]
}) {
  return (
    <section
      {...stylex.props(
        cardPreviewStyles.surface,
        appearance === 'embedded' && cardPreviewStyles.embeddedSurface,
        blockHighlightStyle(card.blockHighlight),
      )}
      data-block-highlight={card.blockHighlight ?? undefined}
      data-card-direction={card.kind === 'basic' || card.kind === 'list' || card.kind === 'set' ? card.direction : undefined}
      data-card-id={card.id}
      data-card-kind={card.kind}
    >
      {card.kind === 'basic' ? <BasicPreview card={card} mode={mode} /> : null}
      {card.kind === 'cloze' ? <ClozePreview card={card} mode={mode} /> : null}
      {card.kind === 'highlight' ? <HighlightPreview card={card} /> : null}
      {card.kind === 'list' || card.kind === 'set'
        ? (
            <MultiLinePreview
              card={card}
              itemSelection={itemSelection}
              mode={mode}
              revealedItemBlockIds={revealedItemBlockIds}
            />
          )
        : null}
    </section>
  )
}

export function CardPreview({
  appearance = 'standalone',
  card,
  itemSelection,
  mode = 'interactive',
  revealedItemBlockIds,
}: CardPreviewProps) {
  useTranslation('editor')
  return (
    <CardPreviewSession
      key={`${card.id}:${mode}`}
      appearance={appearance}
      card={card}
      itemSelection={itemSelection}
      mode={mode}
      revealedItemBlockIds={revealedItemBlockIds}
    />
  )
}
