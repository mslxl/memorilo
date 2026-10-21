import type { ReactNode } from 'react'
import { Button, ButtonGroup } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { LoaderCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { learningReviewSpring, learningReviewPageStyles as styles } from './learning-review-page.stylex'

export type ReviewCardRatingTone = 'again' | 'easy' | 'good' | 'hard'

export interface ReviewCardRating<Rating extends number | string> {
  id: Rating
  interval: ReactNode
  label: ReactNode
  tone: ReviewCardRatingTone
}

type ReviewDataAttributes = Record<`data-${string}`, number | string>

function ratingToneStyle(tone: ReviewCardRatingTone) {
  if (tone === 'again')
    return styles.rating_again
  if (tone === 'hard')
    return styles.rating_hard
  if (tone === 'good')
    return styles.rating_good
  return styles.rating_easy
}

export function ReviewCardSession<Rating extends number | string>({
  actionError,
  actionPending,
  ariaLabel,
  children,
  dataAttributes,
  materialAriaLabel,
  materialDataAttributes,
  materialKey,
  onRate,
  onReveal,
  rateAriaLabel,
  ratingsDisabled = false,
  ratings,
  revealed,
  revealDisabled = false,
  pendingLabel,
  shouldReduceMotion,
  showAnswerLabel,
}: {
  actionError: ReactNode | null
  actionPending: boolean
  ariaLabel: string
  children: ReactNode
  dataAttributes?: ReviewDataAttributes
  materialAriaLabel: string
  materialDataAttributes?: ReviewDataAttributes
  materialKey: string
  onRate: (rating: Rating) => void
  onReveal: () => void
  rateAriaLabel: string
  ratingsDisabled?: boolean
  ratings: readonly ReviewCardRating<Rating>[]
  revealed: boolean
  revealDisabled?: boolean
  pendingLabel: string
  shouldReduceMotion: boolean | null
  showAnswerLabel: string
}) {
  return (
    <main
      {...stylex.props(styles.page, styles.session)}
      {...dataAttributes}
      aria-label={ariaLabel}
    >
      <div {...stylex.props(styles.materialViewport)}>
        <AnimatePresence initial={false} mode="wait">
          <motion.section
            key={materialKey}
            {...stylex.props(styles.material)}
            {...materialDataAttributes}
            animate={{ opacity: 1, y: 0 }}
            aria-label={materialAriaLabel}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
            transition={shouldReduceMotion ? { duration: 0.08 } : learningReviewSpring}
          >
            {children}
          </motion.section>
        </AnimatePresence>
      </div>

      <div {...stylex.props(styles.dockRegion)}>
        <div {...stylex.props(styles.reviewDock)}>
          {actionError
            ? <p {...stylex.props(styles.inlineError)} role="alert">{actionError}</p>
            : null}
          {!revealed
            ? (
                <Button
                  data-learning-action="reveal-answer"
                  disabled={revealDisabled}
                  variant="plain"
                  xstyle={styles.showAnswerButton}
                  onClick={onReveal}
                >
                  {showAnswerLabel}
                </Button>
              )
            : (
                <ButtonGroup aria-label={rateAriaLabel} data-learning-rating-group="" xstyle={styles.ratingGrid}>
                  {ratings.map(rating => (
                    <Button
                      key={String(rating.id)}
                      data-learning-rating={rating.id}
                      disabled={actionPending || ratingsDisabled}
                      variant="plain"
                      xstyle={[styles.ratingButton, ratingToneStyle(rating.tone)]}
                      onClick={() => onRate(rating.id)}
                    >
                      <span {...stylex.props(styles.ratingInterval)}>{rating.interval}</span>
                      <span {...stylex.props(styles.ratingLabel)}>{rating.label}</span>
                    </Button>
                  ))}
                </ButtonGroup>
              )}
          {actionPending
            ? <LoaderCircle {...stylex.props(styles.dockSpinner, styles.spinner)} aria-label={pendingLabel} size={15} />
            : null}
        </div>
      </div>
    </main>
  )
}
