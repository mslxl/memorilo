import type { AddShelfSourceInput, ShelfSource, UpdateShelfSourceInput } from '@memorilo/shelf'
import { Button, Dialog } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shelfSharedStyles } from '../shelf-shared.stylex'
import { shelfSourceSheetSpring } from './shelf-source-dialog'
import { shelfSourceDialogStyles } from './shelf-source-dialog.stylex'
import { ShelfSourceEditor } from './shelf-source-editor'
import { ShelfSourceList } from './shelf-source-list'
import { shelfSourceManagerStyles } from './shelf-source-manager-sheet.stylex'

type SourceEditor = 'add' | ShelfSource | null

export function SourceManagerSheet({
  addErrorMessage,
  initialMode,
  isPending,
  onAdd,
  onClose,
  onRemove,
  onUpdate,
  open,
  sources,
  updateErrorMessage,
}: {
  addErrorMessage: string | null
  initialMode: 'add' | 'list'
  isPending: boolean
  onAdd: (input: AddShelfSourceInput) => Promise<void>
  onClose: () => void
  onRemove: (source: ShelfSource) => void
  onUpdate: (input: UpdateShelfSourceInput) => Promise<void>
  open: boolean
  sources: readonly ShelfSource[]
  updateErrorMessage: string | null
}) {
  const { t } = useTranslation('app')
  const [editor, setEditor] = useState<SourceEditor>(initialMode === 'add' ? 'add' : null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const sheetAnimate = shouldReduceMotion ? { opacity: 1 } : { filter: 'blur(0px)', opacity: 1, scale: 1, y: 0 }
  const sheetExit = shouldReduceMotion ? { opacity: 0 } : { filter: 'blur(2px)', opacity: 0, scale: 0.98, y: 10 }

  const openEditor = (value: Exclude<SourceEditor, null>) => {
    setEditor(value)
    requestAnimationFrame(() => urlInputRef.current?.focus())
  }

  const cancelEditor = () => {
    if (editor === 'add' && initialMode === 'add') {
      onClose()
      return
    }
    setEditor(null)
    requestAnimationFrame(() => closeButtonRef.current?.focus())
  }

  const editorSource = editor === 'add' || editor === null ? null : editor
  const title = editor === 'add'
    ? t('shelfAddBookSource')
    : editorSource
      ? t('shelfEditBookSource')
      : t('shelfBookSources')

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isPending)
          onClose()
      }}
    >
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {open
            ? (
                <motion.div
                  {...stylex.props(shelfSourceDialogStyles.sheetLayer)}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <Dialog.Overlay
                    variant="sheet"
                    onPointerDown={(event) => {
                      if (isPending)
                        event.preventDefault()
                    }}
                  />
                  <Dialog.Content aria-labelledby="shelf-source-manager-title" asChild position="custom" variant="sheet" xstyle={shelfSourceManagerStyles.sheet}>
                    <motion.section
                      data-shelf-source-manager=""
                      animate={sheetAnimate}
                      exit={sheetExit}
                      initial={sheetExit}
                      transition={shouldReduceMotion ? { duration: 0.16 } : shelfSourceSheetSpring}
                    >
                      <header {...stylex.props(shelfSourceManagerStyles.sheetHeader)}>
                        <div {...stylex.props(shelfSourceManagerStyles.managerHeading)}>
                          <div>
                            <h2 id="shelf-source-manager-title" {...stylex.props(shelfSourceManagerStyles.sheetTitle)}>{title}</h2>
                            <p {...stylex.props(shelfSourceManagerStyles.sheetSubtitle)}>
                              {editor === null
                                ? t('shelfChooseSourceToUpdate')
                                : t('shelfRemoteListingsHint')}
                            </p>
                          </div>
                        </div>
                        {editor === null
                          ? (
                              <Button
                                ref={closeButtonRef}
                                aria-label={t('shelfClose')}
                                disabled={isPending}
                                variant="toolbar"
                                xstyle={shelfSharedStyles.iconButton}
                                onClick={onClose}
                              >
                                <X size={17} strokeWidth={1.9} aria-hidden="true" />
                              </Button>
                            )
                          : null}
                      </header>
                      {editor === null
                        ? (
                            <ShelfSourceList
                              sources={sources}
                              onAdd={() => openEditor('add')}
                              onEdit={openEditor}
                              onRemove={onRemove}
                            />
                          )
                        : (
                            <ShelfSourceEditor
                              key={editor === 'add' ? 'add' : editor.id}
                              editor={editor}
                              errorMessage={editor === 'add' ? addErrorMessage : updateErrorMessage}
                              isPending={isPending}
                              urlInputRef={urlInputRef}
                              onAdd={onAdd}
                              onCancel={cancelEditor}
                              onComplete={() => {
                                if (editor === 'add')
                                  onClose()
                                else
                                  setEditor(null)
                              }}
                              onUpdate={onUpdate}
                            />
                          )}
                    </motion.section>
                  </Dialog.Content>
                </motion.div>
              )
            : null}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
