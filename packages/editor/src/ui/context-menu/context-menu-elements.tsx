'use client'

import type { Uploader } from 'prosekit/extensions/file'
import type { KeyboardEventHandler, MouseEvent as ReactMouseEvent, ReactNode, Ref } from 'react'
import type { EditorAction } from '../editor-actions/index.ts'
import type { ContextMenuPoint } from './context-menu-interactions'
import { Surface } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import {
  Check,
  Code2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageUploadForm } from '../image-upload-popover/index.ts'
import { keepContextMenuInViewport } from './context-menu-interactions'
import { contextMenuStyles } from './context-menu.stylex'

export function ContextMenuItem(props: {
  action?: EditorAction
  buttonRef?: Ref<HTMLButtonElement>
  dataAction?: string
  disabled?: boolean
  expanded?: boolean
  hasSubmenu?: boolean
  icon: ReactNode
  label: string
  open?: boolean
  onMouseEnter?: () => void
  onSelect?: () => void
  shortcut?: string
  trailing?: ReactNode
}) {
  const disabled = props.disabled ?? (props.action ? !props.action.canExec : false)
  const active = props.action?.active ?? false
  const handleClick = props.onSelect ?? props.action?.run

  if (!handleClick)
    throw new Error(`Context menu item "${props.label}" requires an action`)

  return (
    <button
      ref={props.buttonRef}
      {...stylex.props(
        contextMenuStyles.item,
        props.open && contextMenuStyles.itemOpen,
      )}
      aria-expanded={props.hasSubmenu ? props.expanded : undefined}
      aria-haspopup={props.hasSubmenu ? 'menu' : undefined}
      data-editor-action={props.dataAction}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={handleClick}
      onMouseEnter={props.onMouseEnter}
      onMouseDown={event => event.preventDefault()}
    >
      <span {...stylex.props(contextMenuStyles.itemLabel)}>
        <span {...stylex.props(contextMenuStyles.icon)}>{props.icon}</span>
        <span>{props.label}</span>
      </span>
      <span {...stylex.props(contextMenuStyles.trailing)}>
        {props.trailing
          ?? (active
            ? <Check aria-hidden="true" size={15} />
            : props.shortcut
              ? <span {...stylex.props(contextMenuStyles.shortcut)}>{props.shortcut}</span>
              : null)}
      </span>
    </button>
  )
}

export function ImageInsertPanel({ point, uploader, onClose }: {
  point: ContextMenuPoint
  uploader: Uploader<string>
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation('editor')

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel)
      return
    keepContextMenuInViewport(panel, point)
    panel.querySelector<HTMLInputElement>('input')?.focus()
  }, [point])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      {...stylex.props(contextMenuStyles.overlay)}
      onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget)
          onClose()
      }}
    >
      <Surface
        ref={panelRef}
        variant="popover"
        xstyle={contextMenuStyles.imagePanel}
        aria-label={t('ui.insertImage')}
        aria-modal="false"
        data-image-dialog=""
        role="dialog"
      >
        <div {...stylex.props(contextMenuStyles.imageHeader)}>
          <strong>{t('ui.insertImageTitle')}</strong>
          <button
            {...stylex.props(contextMenuStyles.imageClose)}
            aria-label={t('ui.closeImageMenu')}
            data-image-action="close"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <ImageUploadForm uploader={uploader} onComplete={onClose} />
      </Surface>
    </div>
  )
}

export function ContextStyleMenu({ actions, menuRef, onKeyDown, onRun }: {
  actions: {
    blockquote: EditorAction
    bulletList: EditorAction
    codeBlock: EditorAction
    orderedList: EditorAction
    taskList: EditorAction
    toggleList: EditorAction
  }
  menuRef: Ref<HTMLDivElement>
  onKeyDown: KeyboardEventHandler<HTMLDivElement>
  onRun: (action: EditorAction) => void
}) {
  const { t } = useTranslation('editor')

  return (
    <Surface
      ref={menuRef}
      variant="popover"
      xstyle={[contextMenuStyles.popup, contextMenuStyles.submenuPopup]}
      aria-label={t('ui.objectStyles')}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <ContextMenuItem
        action={actions.bulletList}
        icon={<List aria-hidden="true" size={16} />}
        label={t('ui.bulletList')}
        onSelect={() => onRun(actions.bulletList)}
      />
      <ContextMenuItem
        action={actions.orderedList}
        icon={<ListOrdered aria-hidden="true" size={16} />}
        label={t('ui.orderedList')}
        onSelect={() => onRun(actions.orderedList)}
      />
      <ContextMenuItem
        action={actions.taskList}
        icon={<ListChecks aria-hidden="true" size={16} />}
        label={t('ui.taskList')}
        onSelect={() => onRun(actions.taskList)}
      />
      <ContextMenuItem
        action={actions.toggleList}
        icon={<List aria-hidden="true" size={16} />}
        label={t('ui.toggleList')}
        onSelect={() => onRun(actions.toggleList)}
      />

      <div {...stylex.props(contextMenuStyles.separator)} role="separator" />

      <ContextMenuItem
        action={actions.blockquote}
        icon={<Quote aria-hidden="true" size={16} />}
        label={t('ui.blockquote')}
        onSelect={() => onRun(actions.blockquote)}
      />
      <ContextMenuItem
        action={actions.codeBlock}
        icon={<Code2 aria-hidden="true" size={16} />}
        label={t('ui.codeBlock')}
        onSelect={() => onRun(actions.codeBlock)}
      />
    </Surface>
  )
}
