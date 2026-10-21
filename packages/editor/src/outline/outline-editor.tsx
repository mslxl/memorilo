import type { RefObject } from 'react'
import type { EditorSession } from '../common/editor-session'
import type { OutlineOptions } from '../common/outline-runtime'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { executeOutlineMove } from '../common/outline-outdent'
import { outlineEditorStyles } from './outline-editor.stylex'
import { observeOutlineMarkerAlignment } from './outline-marker-alignment'
import './outline-content.stylex'

function visibleBlockIds(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'))
    .filter(element => !element.hidden && element.getClientRects().length > 0)
    .map((element) => {
      const blockId = element.dataset.blockId
      if (!blockId)
        throw new Error('A visible outline block is missing its blockId')
      return blockId
    })
}

function currentBlockId(session: EditorSession): string | null {
  const { $from } = session.editor.state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'list')
      continue
    const blockId = node.attrs.blockId
    return typeof blockId === 'string' && blockId.length > 0 ? blockId : null
  }
  return null
}

function focusLabel(root: HTMLElement | null, blockId: string | null): string | null {
  if (!root || !blockId)
    return null
  const element = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)
  const body = element?.querySelector<HTMLElement>(':scope > .list-content > :first-child')
  return body?.textContent?.trim() || blockId
}

function animateFocusChange(root: HTMLElement): Animation {
  const content = root.querySelector<HTMLElement>('[data-editor-content]')
  if (!content)
    throw new Error('Outline focus animation requires mounted editor content')

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return content.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    {
      duration: reducedMotion ? 100 : 500,
      easing: 'ease-in',
    },
  )
}

export function OutlineEditor({
  options,
  readOnly,
  rootRef,
  session,
}: {
  options?: OutlineOptions
  readOnly: boolean
  rootRef: RefObject<HTMLDivElement | null>
  session: EditorSession
}) {
  const markerStylesRef = useRef<HTMLStyleElement>(null)
  const focusAnimationRef = useRef<Animation>(null)
  const previousFocusBlockIdRef = useRef<string | null>(null)
  const focusAnimationMountedRef = useRef(false)
  const runtime = session.outlineRuntime
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const { t } = useTranslation('editor')
  const controlledFocus = Boolean(options && Object.prototype.hasOwnProperty.call(options, 'focus'))
  const showFocusNavigation = options?.focusPresentation !== 'content-only'
  const onFocusChange = options?.onFocusChange
  const focusCollapsed = snapshot.focusBlockId !== null
    && snapshot.collapsedBlockIds.includes(snapshot.focusBlockId)

  const requestFocus = useCallback((blockId: string | null) => {
    if (!controlledFocus)
      runtime.setFocus(blockId)
    onFocusChange?.(blockId ? { blockId } : null)
  }, [controlledFocus, onFocusChange, runtime])
  const toggleFocusCollapsed = () => {
    const focusBlockId = snapshot.focusBlockId
    if (!focusBlockId)
      throw new Error('Cannot collapse Outline Focus without a focus root')
    runtime.toggleCollapsed([focusBlockId])
  }

  useEffect(() => {
    if (readOnly)
      return
    const root = rootRef.current
    const markerStyles = markerStylesRef.current
    if (!root || !markerStyles)
      throw new Error('Outline marker alignment requires a mounted editor root')
    return observeOutlineMarkerAlignment(root, markerStyles)
  }, [readOnly, rootRef])

  useLayoutEffect(() => {
    const previousFocusBlockId = previousFocusBlockIdRef.current
    previousFocusBlockIdRef.current = snapshot.focusBlockId

    if (!focusAnimationMountedRef.current) {
      focusAnimationMountedRef.current = true
      return
    }
    if (previousFocusBlockId === snapshot.focusBlockId)
      return

    const root = rootRef.current
    if (!root)
      throw new Error('Outline focus animation requires a mounted editor')

    focusAnimationRef.current?.cancel()
    const animation = animateFocusChange(root)
    focusAnimationRef.current = animation

    return () => {
      animation.cancel()
      if (focusAnimationRef.current === animation)
        focusAnimationRef.current = null
    }
  }, [rootRef, snapshot.focusBlockId])

  useLayoutEffect(() => {
    const handleMarkerClick = (event: MouseEvent) => {
      const root = rootRef.current
      if (!root)
        return
      const target = event.target
      if (!(target instanceof Element))
        return
      const marker = target.closest('.list-marker')
      if (!marker || !root.contains(marker))
        return
      const block = marker.parentElement
      if (!block)
        throw new Error('An outline marker is not attached to a stable block')
      const blockId = block.getAttribute('data-block-id')
      if (!blockId)
        throw new Error('An outline marker is attached to a block without a stable id')
      const listKind = block.getAttribute('data-list-kind')
      if (listKind === 'task' || listKind === 'toggle')
        return

      event.preventDefault()
      event.stopPropagation()
      if (event.altKey) {
        runtime.toggleCollapsed([blockId])
        return
      }
      if (event.metaKey || event.ctrlKey) {
        runtime.selectBlock(blockId, 'toggle', visibleBlockIds(root))
        return
      }
      if (event.shiftKey) {
        runtime.selectBlock(blockId, 'range', visibleBlockIds(root))
        return
      }
      requestFocus(blockId)
    }

    document.addEventListener('click', handleMarkerClick, true)
    return () => document.removeEventListener('click', handleMarkerClick, true)
  }, [readOnly, requestFocus, rootRef, runtime])

  useEffect(() => {
    if (readOnly)
      return
    const root = rootRef.current
    if (!root)
      throw new Error('Outline keyboard shortcuts require a mounted editor root')
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.altKey && (event.metaKey || event.ctrlKey)))
        return
      const ids = visibleBlockIds(root)
      if (ids.length === 0)
        return
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === 'a') {
        event.preventDefault()
        event.stopPropagation()
        runtime.selectAllVisible(ids)
        return
      }
      const currentId = currentBlockId(session)
      const selected = snapshot.selectedBlockIds.length > 0
        ? [...snapshot.selectedBlockIds]
        : currentId ? [currentId] : []
      if (selected.length === 0)
        return

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        event.stopPropagation()
        executeOutlineMove(session.editor.state, session.editor.view.dispatch, runtime, event.key === 'ArrowUp' ? 'up' : 'down', selected)
        return
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        event.stopPropagation()
        runtime.setCollapsed(selected, event.key === 'ArrowUp')
        return
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === ';') {
        event.preventDefault()
        event.stopPropagation()
        runtime.toggleCollapsed(selected)
        return
      }

      if (event.altKey && !event.metaKey && !event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (!currentId)
          return
        const currentIndex = ids.indexOf(currentId)
        if (currentIndex < 0)
          return
        const nextId = ids[Math.max(0, Math.min(ids.length - 1, currentIndex + (event.key === 'ArrowUp' ? -1 : 1)))]
        if (!nextId || nextId === currentId)
          return
        event.preventDefault()
        event.stopPropagation()
        if (snapshot.selectedBlockIds.length === 0)
          runtime.selectBlock(currentId, 'toggle', ids)
        runtime.selectBlock(nextId, 'range', ids)
      }
    }
    root.addEventListener('keydown', handleKeyDown, true)
    return () => root.removeEventListener('keydown', handleKeyDown, true)
  }, [readOnly, rootRef, runtime, session, snapshot.selectedBlockIds])

  return (
    <>
      <style ref={markerStylesRef} data-outline-marker-alignment="" />
      {snapshot.focusBlockId && !readOnly && showFocusNavigation
        ? (
            <div {...stylex.props(outlineEditorStyles.focusNavigation)}>
              <button
                {...stylex.props(outlineEditorStyles.backButton)}
                aria-label={t('ui.showAllBlocks')}
                data-outline-action="show-all"
                title={t('ui.showAllBlocks')}
                type="button"
                onClick={() => requestFocus(null)}
              >
                <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.9} />
              </button>
              <div {...stylex.props(outlineEditorStyles.breadcrumbs)} aria-label={t('ui.outlineLocation')}>
                <span>{t('ui.allBlocks')}</span>
                <span aria-hidden="true">/</span>
                <span {...stylex.props(outlineEditorStyles.focusLabel)}>{focusLabel(rootRef.current, snapshot.focusBlockId) ?? snapshot.focusBlockId}</span>
              </div>
              <button
                {...stylex.props(outlineEditorStyles.collapseButton)}
                aria-label={focusCollapsed ? t('ui.expandFocusedBlock') : t('ui.collapseFocusedBlock')}
                type="button"
                onClick={toggleFocusCollapsed}
              >
                {focusCollapsed ? t('ui.expand') : t('ui.collapse')}
              </button>
            </div>
          )
        : null}
    </>
  )
}
