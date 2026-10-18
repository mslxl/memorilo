import type { ShelfSource } from '@memorilo/shelf'
import { DropdownMenu } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Check, Globe2, LibraryBig, Settings2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { shelfSourceMenuStyles as shelfSourceStyles } from './shelf-source-menu.stylex'

const menuSpring = {
  bounce: 0,
  type: 'spring',
  visualDuration: 0.2,
} as const

const allSourcesValue = '__all_sources__'

export interface ShelfSourceMenuProps {
  onClose: () => void
  onManage: () => void
  onSelect: (sourceId: string | null) => void
  open: boolean
  selectedSourceId: string | null
  sources: readonly ShelfSource[]
}

export function ShelfSourceMenu({
  onClose,
  onManage,
  onSelect,
  open,
  selectedSourceId,
  sources,
}: ShelfSourceMenuProps) {
  const { t } = useTranslation('app')
  const shouldReduceMotion = useReducedMotion()
  const animate = shouldReduceMotion ? { opacity: 1 } : { filter: 'blur(0px)', opacity: 1, scale: 1, y: 0 }
  const exit = shouldReduceMotion ? { opacity: 0 } : { filter: 'blur(3px)', opacity: 0, scale: 0.97, y: -5 }

  return (
    <DropdownMenu.Portal forceMount>
      <AnimatePresence>
        {open
          ? (
              <DropdownMenu.Content
                aria-label={t('shelfBookSources')}
                asChild
                forceMount
                sideOffset={8}
                xstyle={shelfSourceStyles.sourceMenu}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    onClose()
                  }
                }}
              >
                <motion.div
                  animate={animate}
                  exit={exit}
                  initial={exit}
                  transition={shouldReduceMotion ? { duration: 0.12 } : menuSpring}
                >
                  <DropdownMenu.RadioGroup
                    value={selectedSourceId ?? allSourcesValue}
                    onValueChange={(value) => {
                      onSelect(value === allSourcesValue ? null : value)
                    }}
                  >
                    <DropdownMenu.RadioItem
                      asChild
                      value={allSourcesValue}
                      xstyle={[shelfSourceStyles.sourceMenuItem, selectedSourceId === null && shelfSourceStyles.sourceMenuItemSelected]}
                    >
                      <button data-shelf-source-value={allSourcesValue} type="button">
                        <LibraryBig size={16} strokeWidth={1.8} aria-hidden="true" />
                        <span {...stylex.props(shelfSourceStyles.sourceMenuLabel)}>{t('shelfAllSources')}</span>
                        {selectedSourceId === null ? <Check size={15} strokeWidth={2} aria-hidden="true" /> : null}
                      </button>
                    </DropdownMenu.RadioItem>

                    <DropdownMenu.Separator />
                    <div {...stylex.props(shelfSourceStyles.sourceMenuScroll)}>
                      {sources.map(source => (
                        <DropdownMenu.RadioItem
                          key={source.id}
                          asChild
                          value={source.id}
                          xstyle={[shelfSourceStyles.sourceMenuItem, selectedSourceId === source.id && shelfSourceStyles.sourceMenuItemSelected]}
                        >
                          <button data-shelf-source-value={source.id} type="button">
                            <Globe2 size={16} strokeWidth={1.8} aria-hidden="true" />
                            <span {...stylex.props(shelfSourceStyles.sourceMenuLabel)}>
                              <strong>{source.name}</strong>
                              <small>{source.username ?? new URL(source.url).host}</small>
                            </span>
                            {selectedSourceId === source.id ? <Check size={15} strokeWidth={2} aria-hidden="true" /> : null}
                          </button>
                        </DropdownMenu.RadioItem>
                      ))}
                    </div>

                    <DropdownMenu.Separator />
                    <DropdownMenu.Item asChild xstyle={shelfSourceStyles.sourceMenuItem} onSelect={() => onManage()}>
                      <button type="button">
                        <Settings2 size={16} strokeWidth={1.8} aria-hidden="true" />
                        <span {...stylex.props(shelfSourceStyles.sourceMenuLabel)}>{t('shelfManageSources')}</span>
                      </button>
                    </DropdownMenu.Item>
                  </DropdownMenu.RadioGroup>
                </motion.div>
              </DropdownMenu.Content>
            )
          : null}
      </AnimatePresence>
    </DropdownMenu.Portal>
  )
}
