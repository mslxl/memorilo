import type { EditorCardProjection, TopicReaderSource } from '@memorilo/editor'
import { CardPreview } from '@memorilo/editor'
import * as stylex from '@stylexjs/stylex'
import { Link } from '@tanstack/react-router'
import { Eye, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { noteEditorStyles } from './note-editor.stylex'

export interface ReaderSourceNavigation {
  annotationId: string
  bookTopicId: string
  readingId: string
}

export function CardTopicPreview({ cards }: { cards: readonly EditorCardProjection[] }) {
  const { t } = useTranslation('editor')
  const [open, setOpen] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(cards[0]?.id ?? null)

  useEffect(() => {
    if (!open)
      return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape')
        return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  if (cards.length === 0)
    return null
  const selectedCard = cards.find(card => card.id === selectedCardId) ?? cards[0]
  if (!selectedCard)
    throw new Error('Card Topic preview requires a Card')

  return (
    <>
      <div {...stylex.props(noteEditorStyles.cardTopicToolbar)}>
        <button
          {...stylex.props(noteEditorStyles.cardTopicPreviewTrigger)}
          aria-label={t('ui.cardPreview')}
          title={t('ui.cardPreview')}
          type="button"
          onClick={() => setOpen(true)}
        >
          <Eye aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
      {open
        ? (
            <div
              {...stylex.props(noteEditorStyles.cardTopicPreviewOverlay)}
              onMouseDown={(event) => {
                if (event.currentTarget === event.target)
                  setOpen(false)
              }}
            >
              <section
                {...stylex.props(noteEditorStyles.cardTopicPreviewDialog)}
                aria-label={t('ui.cardPreview')}
                aria-modal="true"
                role="dialog"
              >
                <header {...stylex.props(noteEditorStyles.cardTopicPreviewHeader)}>
                  <span {...stylex.props(noteEditorStyles.cardTopicPreviewTitle)}>
                    <Eye aria-hidden="true" size={15} strokeWidth={1.8} />
                    {t('ui.preview')}
                  </span>
                  <button
                    {...stylex.props(noteEditorStyles.cardTopicPreviewClose)}
                    aria-label={t('ui.closePreview')}
                    title={t('ui.closePreview')}
                    type="button"
                    onClick={() => setOpen(false)}
                  >
                    <X aria-hidden="true" size={16} strokeWidth={1.8} />
                  </button>
                </header>
                {cards.length > 1
                  ? (
                      <div {...stylex.props(noteEditorStyles.cardTopicPreviewSelector)} role="group">
                        {cards.map((card, index) => (
                          <button
                            key={card.id}
                            {...stylex.props(
                              noteEditorStyles.cardTopicPreviewOption,
                              card.id === selectedCard.id && noteEditorStyles.cardTopicPreviewOptionSelected,
                            )}
                            aria-pressed={card.id === selectedCard.id}
                            type="button"
                            onClick={() => setSelectedCardId(card.id)}
                          >
                            {card.kind === 'basic' || card.kind === 'list' || card.kind === 'set'
                              ? card.direction === 'forward' ? t('ui.questionToAnswer') : t('ui.answerToQuestion')
                              : String(index + 1)}
                          </button>
                        ))}
                      </div>
                    )
                  : null}
                <div {...stylex.props(noteEditorStyles.cardTopicPreviewBody)}>
                  <CardPreview key={selectedCard.id} card={selectedCard} />
                </div>
              </section>
            </div>
          )
        : null}
    </>
  )
}

export function ReaderSourceHeader({
  navigation,
  noteId,
  onRemove,
  source,
}: {
  navigation: ReaderSourceNavigation | null
  noteId: string
  onRemove?: () => void
  source: TopicReaderSource
}) {
  const { t } = useTranslation('editor')
  const content = (
    <>
      {source.kind === 'text'
        ? <blockquote {...stylex.props(noteEditorStyles.readerSourceText)}>{source.text}</blockquote>
        : (
            <img
              {...stylex.props(noteEditorStyles.readerSourceImage)}
              alt={source.location}
              src={source.imageSrc}
            />
          )}
      <span {...stylex.props(noteEditorStyles.readerSourceLocation)}>{source.location}</span>
    </>
  )

  return (
    <div {...stylex.props(noteEditorStyles.readerSourceHeader)}>
      {navigation === null
        ? <div {...stylex.props(noteEditorStyles.readerSourceSnapshot)}>{content}</div>
        : (
            <Link
              {...stylex.props(noteEditorStyles.readerSourceLink)}
              aria-label={t('openReaderSource')}
              data-reader-source-link=""
              params={{ readingId: navigation.readingId }}
              search={{
                annotationId: navigation.annotationId,
                noteId,
                topicId: navigation.bookTopicId,
              }}
              title={t('openReaderSource')}
              to="/reader/$readingId"
            >
              {content}
            </Link>
          )}
      {onRemove
        ? (
            <button
              {...stylex.props(noteEditorStyles.readerSourceRemove)}
              aria-label={t('removeReaderSource')}
              title={t('removeReaderSource')}
              type="button"
              onClick={onRemove}
            >
              <X aria-hidden="true" size={16} strokeWidth={1.9} />
            </button>
          )
        : null}
    </div>
  )
}
