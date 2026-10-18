import * as stylex from '@stylexjs/stylex'
import { PanelRight, Star } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { noteInspectorActionsStyles } from './note-inspector-actions.stylex'

const actionSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.22,
} as const

export function NoteInspectorActions({
  favorite,
  favoritePending,
  inspectorVisible,
  onToggleFavorite,
  onToggleInspector,
}: {
  favorite: boolean
  favoritePending: boolean
  inspectorVisible: boolean
  onToggleFavorite: () => void
  onToggleInspector: () => void
}) {
  const { t } = useTranslation('editor')
  const shouldReduceMotion = useReducedMotion()

  return (
    <>
      <AnimatePresence initial={false}>
        {inspectorVisible
          ? (
              <motion.div
                {...stylex.props(noteInspectorActionsStyles.expandingFavorite)}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, width: 32, x: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, width: 0, x: 8 }}
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, width: 0, x: 8 }}
                transition={shouldReduceMotion ? { duration: 0.1 } : actionSpring}
              >
                <button
                  {...stylex.props(
                    noteInspectorActionsStyles.button,
                    favorite && noteInspectorActionsStyles.favoriteActive,
                  )}
                  aria-label={favorite ? t('removeFromFavorites') : t('addToFavorites')}
                  aria-pressed={favorite}
                  disabled={favoritePending}
                  title={favorite ? t('removeFromFavorites') : t('addToFavorites')}
                  type="button"
                  onClick={onToggleFavorite}
                >
                  <Star
                    aria-hidden="true"
                    fill={favorite ? 'currentColor' : 'none'}
                    size={16}
                    strokeWidth={1.8}
                  />
                </button>
              </motion.div>
            )
          : null}
      </AnimatePresence>
      <button
        {...stylex.props(
          noteInspectorActionsStyles.button,
          inspectorVisible && noteInspectorActionsStyles.buttonActive,
        )}
        aria-label={inspectorVisible ? t('hideNoteInspector') : t('showNoteInspector')}
        aria-pressed={inspectorVisible}
        data-note-inspector-toggle=""
        title={inspectorVisible ? t('hideNoteInspector') : t('showNoteInspector')}
        type="button"
        onClick={onToggleInspector}
      >
        <PanelRight aria-hidden="true" size={17} strokeWidth={1.8} />
      </button>
    </>
  )
}
