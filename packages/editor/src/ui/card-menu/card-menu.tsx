'use client'

import type { Editor } from 'prosekit/core'
import type { CSSProperties } from 'react'
import type { EditorAdapters } from '../../adapters/editor-adapters'
import type { CardExtension } from '../../card/card-extension'
import type { CardDelimiterAttrs, EditorCardProjection } from '../../card/card-model'
import type { CardSurfaceSide } from '../../card/card-surface'
import type { EditorTopicDocument } from '../../note/editor-note'
import { autoUpdate, flip, FloatingPortal, offset, shift, size, useFloating, useMergeRefs } from '@floating-ui/react'
import { SegmentedControl, Surface } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Eye, X } from 'lucide-react'
import { NodeSelection } from 'prosekit/pm/state'
import { useEditor, useEditorDerivedValue } from 'prosekit/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'
import { getSelectedCardDefinitionId, getSelectedCardDelimiterPosition, getSelectedCardDelimiterSurface, setSelectedCardDelimiterDefinitionId } from '../../card/card-extension'
import { projectEditorCards } from '../../card/card-model'
import { CardSurface } from '../../card/card-surface'
import { editorPositionerAdapterStyles } from '../floating-surface/editor-positioner-adapter.stylex'
import { floatingTransformOrigin } from '../floating-surface/floating-position'
import { cardMenuStyles } from './card-menu.stylex'

interface SelectedCardDelimiter {
  attrs: CardDelimiterAttrs
  position: number
  presentation: 'inline' | 'list' | 'set'
}

interface SelectedCard {
  cards: readonly EditorCardProjection[]
  definitionId: string
  delimiter: SelectedCardDelimiter | null
  surface: 'options' | 'preview'
}

interface CardPreviewState {
  cardId: string
  definitionId: string
  revealedItemBlockIds: readonly string[]
  side: CardSurfaceSide
}

function getSelectedCard(editor: Editor<CardExtension>): SelectedCard | null {
  const definitionId = getSelectedCardDefinitionId(editor.state)
  if (definitionId === null)
    return null
  const surface = getSelectedCardDelimiterSurface(editor.state)
  if (!surface)
    throw new Error('Selected Card is missing its UI surface')
  const cards = projectEditorCards(editor.state.doc.toJSON()).filter(card => (
    card.kind !== 'highlight' && card.definitionId === definitionId
  ))
  if (cards.length === 0)
    throw new Error(`Selected Card ${definitionId} has no preview projection`)

  const position = getSelectedCardDelimiterPosition(editor.state)
  if (position === null) {
    if (surface !== 'preview')
      throw new Error(`Cloze Card ${definitionId} does not support Card options`)
    if (cards.some(card => card.kind !== 'cloze'))
      throw new Error(`Card ${definitionId} has no delimiter and is not a Cloze Card`)
    return { cards, definitionId, delimiter: null, surface }
  }
  const delimiter = editor.state.doc.nodeAt(position)
  if (!delimiter || delimiter.type.name !== 'cardDelimiter')
    throw new Error('Selected Card delimiter is missing from the document')
  const attrs = delimiter.attrs as CardDelimiterAttrs

  const $from = editor.state.doc.resolve(position)
  let presentation: SelectedCardDelimiter['presentation'] = 'inline'
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'list')
      continue
    const memberKinds: unknown[] = []
    node.forEach((child) => {
      if (child.type.name === 'list' && child.attrs.cardItemDefinitionId === definitionId)
        memberKinds.push(child.attrs.kind)
    })
    if (memberKinds.length > 0)
      presentation = memberKinds.every(kind => kind === 'ordered') ? 'list' : 'set'
    break
  }
  return { cards, definitionId, delimiter: { attrs, position, presentation }, surface }
}

function CardMenuButton({
  children,
  dataDirection,
  dataPresentation,
  label,
  onClick,
  selected,
}: {
  children: string
  dataDirection?: 'backward' | 'forward'
  dataPresentation?: 'list' | 'set'
  label: string
  onClick: () => void
  selected: boolean
}) {
  return (
    <button
      {...stylex.props(cardMenuStyles.button, selected && cardMenuStyles.selected)}
      aria-label={label}
      aria-pressed={selected}
      data-card-direction={dataDirection}
      data-card-presentation={dataPresentation}
      type="button"
      onClick={onClick}
      onMouseDown={event => event.preventDefault()}
    >
      {children}
    </button>
  )
}

function preferredPreviewCard(selected: SelectedCard): EditorCardProjection {
  if (!selected.delimiter) {
    const clozeCards = selected.cards.filter(card => card.kind === 'cloze')
    if (clozeCards.length !== 1)
      throw new Error(`Cloze definition ${selected.definitionId} must project exactly one Card`)
    const card = clozeCards[0]
    if (!card)
      throw new Error(`Cloze definition ${selected.definitionId} has no Card projection`)
    return card
  }
  const preferredDirection = selected.delimiter.attrs.direction === 'backward' ? 'backward' : 'forward'
  const card = selected.cards.find(candidate => (
    (candidate.kind === 'basic' || candidate.kind === 'list' || candidate.kind === 'set')
    && candidate.direction === preferredDirection
  ))
  if (!card)
    throw new Error(`Card ${selected.definitionId} has no ${preferredDirection} preview projection`)
  return card
}

function getCardTrigger(editor: Editor<CardExtension>, selected: SelectedCard): HTMLElement {
  if (selected.delimiter) {
    const node = editor.view.nodeDOM(selected.delimiter.position)
    if (!(node instanceof HTMLElement))
      throw new Error('Selected Card delimiter is missing its DOM element')
    const trigger = node.querySelector(`[data-card-control="${selected.surface}"]`)
    if (!(trigger instanceof HTMLElement))
      throw new Error(`Selected Card is missing its ${selected.surface} control`)
    return trigger
  }
  const controls = editor.view.dom.querySelector(`[data-cloze-card-controls="${CSS.escape(selected.definitionId)}"]`)
  if (!(controls instanceof HTMLElement))
    throw new Error(`Selected Cloze Card ${selected.definitionId} is missing its controls`)
  const trigger = controls.querySelector('[data-card-control="preview"]')
  if (!(trigger instanceof HTMLElement))
    throw new Error(`Selected Cloze Card ${selected.definitionId} is missing its Preview control`)
  return trigger
}

export default function CardMenu({ adapters, topic }: {
  adapters: EditorAdapters
  topic: EditorTopicDocument
}) {
  const editor = useEditor<CardExtension>()
  const selected = useEditorDerivedValue(getSelectedCard)
  const popupRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation('editor')
  const [previewState, setPreviewState] = useState<CardPreviewState | null>(null)

  const selectedDefinitionId = selected?.definitionId ?? null
  const previewOpen = selected?.surface === 'preview'
  const previewCardId = previewOpen
    ? previewState?.definitionId === selectedDefinitionId
      ? previewState.cardId
      : selected ? preferredPreviewCard(selected).id : null
    : null

  const {
    floatingStyles,
    isPositioned,
    placement,
    refs,
  } = useFloating({
    middleware: [
      offset(10),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(48, availableHeight)}px`
        },
      }),
    ],
    open: selected !== null,
    placement: 'bottom',
    strategy: 'fixed',
    transform: false,
    whileElementsMounted: autoUpdate,
  })
  const floatingRef = useMergeRefs([popupRef, refs.setFloating])

  useLayoutEffect(() => {
    if (!selected) {
      refs.setReference(null)
      return
    }
    refs.setReference(getCardTrigger(editor, selected))
  }, [editor, refs, selected])

  useEffect(() => {
    if (!previewOpen || !selected)
      return

    const dismiss = (restoreFocus: boolean) => {
      setPreviewState(null)
      editor.view.dispatch(setSelectedCardDelimiterDefinitionId(editor.state.tr, null))
      if (restoreFocus)
        editor.view.focus()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape')
        return
      event.preventDefault()
      dismiss(true)
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node))
        return
      const trigger = getCardTrigger(editor, selected)
      const controls = trigger.closest('[data-card-hover-controls]')
      if (popupRef.current?.contains(target) || (controls instanceof Node && controls.contains(target)))
        return
      dismiss(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [editor, previewOpen, selected])

  if (!selected)
    return null

  const popupStyle: CSSProperties = {
    ...floatingStyles,
    transformOrigin: floatingTransformOrigin(placement),
    visibility: isPositioned ? 'visible' : 'hidden',
  }

  const prepareCommand = () => {
    if (!selected.delimiter)
      throw new Error(`Cloze Card ${selected.definitionId} does not support delimiter commands`)
    const node = editor.state.doc.nodeAt(selected.delimiter.position)
    if (!node || node.type.name !== 'cardDelimiter')
      throw new Error('Selected Card delimiter is missing from the document')
    editor.view.dispatch(setSelectedCardDelimiterDefinitionId(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, selected.delimiter.position)),
      selected.definitionId,
      'options',
    ))
  }

  const runDirectionCommand = (direction: CardDelimiterAttrs['direction']) => {
    prepareCommand()
    editor.commands.setCardDirection({ direction })
  }

  const runPresentationCommand = (presentation: 'list' | 'set') => {
    prepareCommand()
    editor.commands.setCardPresentation({ presentation })
    editor.view.dispatch(setSelectedCardDelimiterDefinitionId(editor.state.tr, null))
  }

  const closePreview = () => {
    setPreviewState(null)
    editor.view.dispatch(setSelectedCardDelimiterDefinitionId(editor.state.tr, null))
    editor.view.focus()
  }

  if (previewOpen) {
    const card = selected.cards.find(candidate => candidate.id === previewCardId)
    if (!card)
      throw new Error(`Preview CardID ${previewCardId} is missing from definition ${selected.definitionId}`)
    const directionalCards = selected.cards.filter((candidate): candidate is Extract<EditorCardProjection, { kind: 'basic' | 'list' | 'set' }> => (
      candidate.kind === 'basic' || candidate.kind === 'list' || candidate.kind === 'set'
    ))
    const activePreview = previewState?.definitionId === selected.definitionId && previewState.cardId === card.id
      ? previewState
      : {
          cardId: card.id,
          definitionId: selected.definitionId,
          revealedItemBlockIds: [],
          side: 'question' as const,
        }
    const forwardList = card.kind === 'list' && card.direction === 'forward'
    const nextItem = forwardList && activePreview.side === 'question'
      ? card.items.find(item => !activePreview.revealedItemBlockIds.includes(item.blockId))
      : undefined
    const revealLabel = nextItem
      ? t('ui.showNextItem', {
          total: card.kind === 'list' ? card.items.length : 0,
          visibleCount: activePreview.revealedItemBlockIds.length + 1,
        })
      : activePreview.side === 'question' && !forwardList ? t('ui.showAnswer') : null
    const reveal = () => {
      if (nextItem) {
        setPreviewState({
          ...activePreview,
          revealedItemBlockIds: [...activePreview.revealedItemBlockIds, nextItem.blockId],
        })
        return
      }
      setPreviewState({ ...activePreview, side: 'answer' })
    }

    return (
      <FloatingPortal>
        <Surface
          asChild
          variant="popover"
          xstyle={[editorPositionerAdapterStyles.motion, cardMenuStyles.previewPopup]}
        >
          <div
            ref={floatingRef}
            aria-label={t('ui.cardPreview')}
            aria-modal="false"
            data-card-preview-dialog=""
            role="dialog"
            style={popupStyle}
          >
            <div {...stylex.props(cardMenuStyles.previewHeader)}>
              <div {...stylex.props(cardMenuStyles.previewTitle)}>
                <Eye aria-hidden="true" size={15} strokeWidth={1.8} />
                <span>{t('ui.preview')}</span>
              </div>
              <button
                {...stylex.props(cardMenuStyles.iconButton)}
                aria-label={t('ui.closePreview')}
                data-card-action="close-preview"
                type="button"
                onClick={closePreview}
                onMouseDown={event => event.preventDefault()}
              >
                <X aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </div>
            {directionalCards.length > 1
              ? (
                  <div {...stylex.props(cardMenuStyles.previewDirection)} aria-label={t('ui.previewDirection')} role="group">
                    {directionalCards.map(candidate => (
                      <CardMenuButton
                        key={candidate.id}
                        dataDirection={candidate.direction}
                        label={candidate.direction === 'forward' ? t('ui.previewForwardCard') : t('ui.previewReverseCard')}
                        selected={candidate.id === card.id}
                        onClick={() => setPreviewState({
                          cardId: candidate.id,
                          definitionId: selected.definitionId,
                          revealedItemBlockIds: [],
                          side: 'question',
                        })}
                      >
                        {candidate.direction === 'forward' ? t('ui.questionToAnswer') : t('ui.answerToQuestion')}
                      </CardMenuButton>
                    ))}
                  </div>
                )
              : null}
            <div {...stylex.props(cardMenuStyles.previewBody)}>
              <CardSurface
                adapters={adapters}
                appearance="preview"
                card={card}
                revealedItemBlockIds={forwardList ? activePreview.revealedItemBlockIds : undefined}
                side={activePreview.side}
                topic={topic}
              />
              {revealLabel
                ? (
                    <div {...stylex.props(cardMenuStyles.previewActions)}>
                      <button
                        {...stylex.props(cardMenuStyles.previewRevealButton)}
                        data-card-action={nextItem ? 'reveal-next' : 'reveal-answer'}
                        type="button"
                        onClick={reveal}
                        onMouseDown={event => event.preventDefault()}
                      >
                        {revealLabel}
                      </button>
                    </div>
                  )
                : null}
            </div>
          </div>
        </Surface>
      </FloatingPortal>
    )
  }

  if (!selected.delimiter)
    throw new Error(`Cloze Card ${selected.definitionId} cannot open Card options`)

  return (
    <FloatingPortal>
      <Surface
        asChild
        variant="popover"
        xstyle={[editorPositionerAdapterStyles.motion, cardMenuStyles.popup]}
      >
        <div
          ref={floatingRef}
          aria-label={t('ui.cardOptions')}
          data-card-options-dialog=""
          role="toolbar"
          style={popupStyle}
        >
          <div {...stylex.props(cardMenuStyles.row)}>
            <span {...stylex.props(cardMenuStyles.label)}>{t('ui.direction')}</span>
            <SegmentedControl.Root
              aria-label={t('ui.cardDirection')}
              value={selected.delimiter.attrs.direction}
              xstyle={cardMenuStyles.group}
              onValueChange={(value) => {
                if (value === 'forward' || value === 'backward' || value === 'both')
                  runDirectionCommand(value)
              }}
            >
              <SegmentedControl.Item aria-label={t('ui.basicDirection')} data-card-direction-choice="forward" value="forward" xstyle={[cardMenuStyles.button, selected.delimiter.attrs.direction === 'forward' && cardMenuStyles.selected]} onMouseDown={event => event.preventDefault()}>→</SegmentedControl.Item>
              <SegmentedControl.Item aria-label={t('ui.reverseDirection')} data-card-direction-choice="backward" value="backward" xstyle={[cardMenuStyles.button, selected.delimiter.attrs.direction === 'backward' && cardMenuStyles.selected]} onMouseDown={event => event.preventDefault()}>←</SegmentedControl.Item>
              <SegmentedControl.Item aria-label={t('ui.bidirectional')} data-card-direction-choice="both" value="both" xstyle={[cardMenuStyles.button, selected.delimiter.attrs.direction === 'both' && cardMenuStyles.selected]} onMouseDown={event => event.preventDefault()}>↔</SegmentedControl.Item>
            </SegmentedControl.Root>
          </div>
          <div {...stylex.props(cardMenuStyles.row)}>
            <span {...stylex.props(cardMenuStyles.label)}>{t('ui.multiLine')}</span>
            <div {...stylex.props(cardMenuStyles.group)} aria-label={t('ui.cardAnswerPresentation')} role="group">
              <CardMenuButton dataPresentation="set" label={t('ui.setAnswer')} selected={selected.delimiter.presentation === 'set'} onClick={() => runPresentationCommand('set')}>{t('ui.set')}</CardMenuButton>
              <CardMenuButton dataPresentation="list" label={t('ui.listAnswer')} selected={selected.delimiter.presentation === 'list'} onClick={() => runPresentationCommand('list')}>{t('ui.list')}</CardMenuButton>
            </div>
          </div>
        </div>
      </Surface>
    </FloatingPortal>
  )
}
