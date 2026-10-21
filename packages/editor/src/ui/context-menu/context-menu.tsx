'use client'

import type { BasicExtension } from 'prosekit/basic'
import type { Editor } from 'prosekit/core'
import type { Uploader } from 'prosekit/extensions/file'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { EditorPlatform } from '../../common/editor-platform'
import type { OutlineRuntime } from '../../common/outline-runtime'
import type { EditorAction } from '../editor-actions/index.ts'
import type { ContextMenuPoint } from './context-menu-interactions'
import { ContextMenu as PublicContextMenu } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Match } from 'effect'
import {
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ClipboardPaste,
  Copy,
  ImagePlus,
  Minus,
  Pilcrow,
  Scissors,
  Table2,
  TextSelect,
} from 'lucide-react'
import { AllSelection } from 'prosekit/pm/state'
import { useEditor, useEditorDerivedValue } from 'prosekit/react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { useTranslation } from 'react-i18next'
import { getEditorActions } from '../editor-actions/index.ts'
import { ContextMenuItem, ContextStyleMenu, ImageInsertPanel } from './context-menu-elements'
import {
  blockIdFromContextTarget,
  contextMenuPoint,
  handleContextMenuKeyDown,
  keepContextMenuInViewport,
  moveSelectionToContextPoint,
  positionContextSubmenu,
} from './context-menu-interactions'
import { contextMenuStyles } from './context-menu.stylex'
import { copySelection, cutSelection, pasteClipboard } from './editor-clipboard.ts'

function runAction(editor: Editor<BasicExtension>, action: EditorAction, close: () => void) {
  action.run()
  close()
  editor.focus()
}

export default function ContextMenu({ outlineRuntime, platform = 'other', uploader }: { outlineRuntime: OutlineRuntime, platform?: EditorPlatform, uploader: Uploader<string> }) {
  const editor = useEditor<BasicExtension>()
  const actions = useEditorDerivedValue(getEditorActions)
  const { t } = useTranslation('editor')
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint | null>(null)
  const [imagePoint, setImagePoint] = useState<ContextMenuPoint | null>(null)
  const [outlineBlockId, setOutlineBlockId] = useState<string | null>(null)
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const styleTriggerRef = useRef<HTMLButtonElement>(null)
  const styleMenuRef = useRef<HTMLDivElement>(null)
  const focusStyleMenuRef = useRef(false)

  const closeMenu = () => {
    setMenuPoint(null)
    setOutlineBlockId(null)
    setStyleMenuOpen(false)
  }
  const closeImagePanel = () => {
    setImagePoint(null)
    editor.focus()
  }
  const openStyleMenu = (focusFirstItem: boolean) => {
    focusStyleMenuRef.current = focusFirstItem
    setStyleMenuOpen(true)
  }
  const closeStyleMenu = () => {
    focusStyleMenuRef.current = false
    setStyleMenuOpen(false)
    styleTriggerRef.current?.focus()
  }
  const handleClipboardAction = (label: string, task: () => Promise<void>) => {
    closeMenu()
    void task().then(
      () => editor.focus(),
      (error) => {
        console.error(`[editor] ${label} failed`, error)
        editor.focus()
      },
    )
  }
  const handleMainMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' && document.activeElement === styleTriggerRef.current) {
      event.preventDefault()
      openStyleMenu(true)
      return
    }

    handleContextMenuKeyDown(event)
  }
  const handleStyleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeStyleMenu()
      return
    }

    handleContextMenuKeyDown(event)
  }
  const hasSelection = !editor.state.selection.empty
  const canReadClipboard = typeof navigator.clipboard?.read === 'function'
  const canWriteClipboard = typeof navigator.clipboard?.write === 'function'
    && typeof ClipboardItem !== 'undefined'
  const primaryModifier = Match.value(platform).pipe(
    Match.when('macos', () => '⌘'),
    Match.orElse(() => 'Ctrl+'),
  )
  const outlineSnapshot = useSyncExternalStore(
    outlineRuntime.subscribe,
    outlineRuntime.getSnapshot,
    outlineRuntime.getSnapshot,
  )
  const outlineCollapseBlockIds = outlineBlockId && outlineSnapshot.active
    ? outlineSnapshot.selectedBlockIds.includes(outlineBlockId)
      ? outlineSnapshot.selectedBlockIds
      : [outlineBlockId]
    : []
  const shouldCollapseOutlineBlocks = outlineCollapseBlockIds.some(blockId => !outlineSnapshot.collapsedBlockIds.includes(blockId))

  useEffect(() => {
    const editorElement = editor.view.dom
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      const point = contextMenuPoint(editor, event)
      const targetBlockId = blockIdFromContextTarget(event.target)
      const selectedBlockId = moveSelectionToContextPoint(editor, point)
      setOutlineBlockId(targetBlockId ?? selectedBlockId)
      setImagePoint(null)
      setStyleMenuOpen(false)
      setMenuPoint(point)
    }

    editorElement.addEventListener('contextmenu', handleContextMenu)
    return () => editorElement.removeEventListener('contextmenu', handleContextMenu)
  }, [editor])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu || !menuPoint)
      return

    keepContextMenuInViewport(menu, menuPoint)
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [menuPoint])

  useLayoutEffect(() => {
    const submenu = styleMenuRef.current
    const trigger = styleTriggerRef.current
    if (!styleMenuOpen || !submenu || !trigger)
      return

    positionContextSubmenu(submenu, trigger)
    if (focusStyleMenuRef.current) {
      focusStyleMenuRef.current = false
      submenu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }
  }, [styleMenuOpen])

  if (!menuPoint && !imagePoint)
    return null

  return createPortal(
    <>
      {menuPoint
        ? (
            <PublicContextMenu.Root
              open
              position={menuPoint}
              onEscapeKeyDown={(event) => {
                if (styleMenuOpen) {
                  event.preventDefault()
                  closeStyleMenu()
                }
              }}
              onOpenChange={(open) => {
                if (!open) {
                  closeMenu()
                  editor.focus()
                }
              }}
              onPointerDownOutside={(event) => {
                if (event.target instanceof Node && styleMenuRef.current?.contains(event.target))
                  event.preventDefault()
              }}
            >
              <PublicContextMenu.Portal>
                <PublicContextMenu.Content asChild>
                  <div
                    ref={menuRef}
                    aria-label={t('ui.editorActions')}
                    role="menu"
                    tabIndex={-1}
                    onKeyDown={handleMainMenuKeyDown}
                  >
                    <ContextMenuItem
                      disabled={!hasSelection || !canWriteClipboard}
                      icon={<Scissors aria-hidden="true" size={16} />}
                      label={t('ui.cut')}
                      onMouseEnter={() => setStyleMenuOpen(false)}
                      onSelect={() => handleClipboardAction('Cut', () => cutSelection(editor))}
                      shortcut={`${primaryModifier}X`}
                    />
                    <ContextMenuItem
                      disabled={!hasSelection || !canWriteClipboard}
                      icon={<Copy aria-hidden="true" size={16} />}
                      label={t('ui.copy')}
                      onMouseEnter={() => setStyleMenuOpen(false)}
                      onSelect={() => handleClipboardAction('Copy', () => copySelection(editor))}
                      shortcut={`${primaryModifier}C`}
                    />
                    <ContextMenuItem
                      dataAction="paste"
                      disabled={!canReadClipboard}
                      icon={<ClipboardPaste aria-hidden="true" size={16} />}
                      label={t('ui.paste')}
                      onMouseEnter={() => setStyleMenuOpen(false)}
                      onSelect={() => handleClipboardAction('Paste', () => pasteClipboard(editor))}
                      shortcut={`${primaryModifier}V`}
                    />

                    <div {...stylex.props(contextMenuStyles.separator)} role="separator" />

                    <ContextMenuItem
                      dataAction="select-all"
                      icon={<TextSelect aria-hidden="true" size={16} />}
                      label={t('ui.selectAll')}
                      onMouseEnter={() => setStyleMenuOpen(false)}
                      onSelect={() => {
                        editor.view.dispatch(
                          editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
                        )
                        closeMenu()
                        editor.focus()
                      }}
                      shortcut={`${primaryModifier}A`}
                    />

                    {outlineCollapseBlockIds.length > 0
                      ? (
                          <>
                            <div {...stylex.props(contextMenuStyles.separator)} role="separator" />
                            <ContextMenuItem
                              icon={shouldCollapseOutlineBlocks
                                ? <ChevronsUp aria-hidden="true" size={16} />
                                : <ChevronsDown aria-hidden="true" size={16} />}
                              label={shouldCollapseOutlineBlocks ? t('ui.collapse') : t('ui.expand')}
                              onMouseEnter={() => setStyleMenuOpen(false)}
                              onSelect={() => {
                                outlineRuntime.toggleCollapsed(outlineCollapseBlockIds)
                                closeMenu()
                                editor.focus()
                              }}
                            />
                          </>
                        )
                      : null}

                    <div {...stylex.props(contextMenuStyles.separator)} role="separator" />

                    <ContextMenuItem
                      buttonRef={styleTriggerRef}
                      expanded={styleMenuOpen}
                      hasSubmenu
                      icon={<Pilcrow aria-hidden="true" size={16} />}
                      label={t('ui.style')}
                      open={styleMenuOpen}
                      onMouseEnter={() => openStyleMenu(false)}
                      onSelect={() => openStyleMenu(true)}
                      trailing={<ChevronRight aria-hidden="true" size={15} />}
                    />

                    {!hasSelection
                      ? (
                          <>
                            <div {...stylex.props(contextMenuStyles.separator)} role="separator" />

                            <ContextMenuItem
                              action={actions.insert.table}
                              icon={<Table2 aria-hidden="true" size={16} />}
                              label={t('ui.insertTable')}
                              onMouseEnter={() => setStyleMenuOpen(false)}
                              onSelect={() => runAction(editor, actions.insert.table, closeMenu)}
                            />
                            <ContextMenuItem
                              action={actions.insert.divider}
                              icon={<Minus aria-hidden="true" size={16} />}
                              label={t('ui.insertDivider')}
                              onMouseEnter={() => setStyleMenuOpen(false)}
                              onSelect={() => runAction(editor, actions.insert.divider, closeMenu)}
                            />
                            <ContextMenuItem
                              disabled={!actions.insert.image.canExec}
                              dataAction="insert-image"
                              icon={<ImagePlus aria-hidden="true" size={16} />}
                              label={t('ui.insertImageELLIPSIS')}
                              onMouseEnter={() => setStyleMenuOpen(false)}
                              onSelect={() => {
                                setImagePoint(menuPoint)
                                closeMenu()
                              }}
                            />
                          </>
                        )
                      : null}
                  </div>
                </PublicContextMenu.Content>

                {styleMenuOpen
                  ? (
                      <ContextStyleMenu
                        actions={actions.block}
                        menuRef={styleMenuRef}
                        onKeyDown={handleStyleMenuKeyDown}
                        onRun={action => runAction(editor, action, closeMenu)}
                      />
                    )
                  : null}
              </PublicContextMenu.Portal>
            </PublicContextMenu.Root>
          )
        : null}

      {imagePoint
        ? <ImageInsertPanel point={imagePoint} uploader={uploader} onClose={closeImagePanel} />
        : null}
    </>,
    document.body,
  )
}
