import type { ReactNode, RefObject } from 'react'
import type { CursorSpringAxis } from './cursor-motion'
import type { EditorModeValue } from './editor-mode'
import type { EditorPlatform } from './editor-platform'
import type { EditorSession } from './editor-session'
import * as stylex from '@stylexjs/stylex'
import { Match } from 'effect'
import i18next from 'i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import { TextSelection } from 'prosekit/pm/state'
import { ProseKit } from 'prosekit/react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { uploadErrorAtom, uploadStatusAtom } from '../state/editor-atoms'
import { BlockHandle } from '../ui/block-handle'
import { ContextMenu } from '../ui/context-menu'
import { DropIndicator } from '../ui/drop-indicator'
import { InlineMenu } from '../ui/inline-menu'
import { SlashMenu } from '../ui/slash-menu'
import { TableHandle } from '../ui/table-handle'
import { TagMenu } from '../ui/tag-menu'
import { EditorTaskMenu } from '../ui/task-menu/editor-task-menu'
import { advanceCriticallyDampedCursorAxis } from './cursor-motion'
import { editorCanvasStyles } from './editor-canvas.stylex'

const CardMenu = lazy(async () => {
  const module = await import('../ui/card-menu')
  return { default: module.CardMenu }
})

const MathClozeMenu = lazy(async () => {
  const module = await import('../ui/math-cloze-menu')
  return { default: module.MathClozeMenu }
})

function selectionBlockId(selection: TextSelection): string | null {
  for (let depth = selection.$from.depth; depth >= 0; depth -= 1) {
    const node = selection.$from.node(depth)
    if (node.type.name !== 'list')
      continue
    const blockId = node.attrs.blockId
    if (typeof blockId !== 'string' || blockId.length === 0)
      throw new Error('The focused editor Block is missing its blockId')
    return blockId
  }
  return null
}

function focusBlock(session: EditorSession, blockId: string, focusEditor: boolean): void {
  if (blockId.length === 0)
    throw new TypeError('Editor focus Block id must be a non-empty string')

  const { doc } = session.editor.state
  let blockPosition: number | undefined
  doc.descendants((node, position) => {
    if (node.type.name !== 'list' || node.attrs.blockId !== blockId)
      return true
    blockPosition = position
    return false
  })
  if (blockPosition === undefined)
    throw new Error(`Unknown editor Block id: ${blockId}`)

  const selection = TextSelection.near(doc.resolve(blockPosition + 1), 1)
  if (!(selection instanceof TextSelection))
    throw new Error(`Editor Block ${blockId} does not contain a text selection position`)
  if (selectionBlockId(selection) !== blockId)
    throw new Error(`Editor Block ${blockId} does not contain a text selection position`)

  const view = session.editor.view
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
  if (focusEditor)
    view.focus()
}

interface CursorPoint { x: number, y: number, height: number }
interface CursorMotion { x: CursorSpringAxis, y: CursorSpringAxis, height: number }
type CursorVfxMode = 'railgun' | 'torpedo' | 'pixiedust' | 'sonicboom' | 'ripple' | 'wireframe'
type CursorParticleKind = 'trail' | 'pixiedust' | 'burst' | 'ripple' | 'wireframe'
interface CursorParticle { el: HTMLSpanElement, x: number, y: number, vx: number, vy: number, age: number, kind: CursorParticleKind }

const MAX_CURSOR_PARTICLES = 128
const CURSOR_WIDTH = 2
const cursorBlinkClass = stylex.props(editorCanvasStyles.cursorBlink).className ?? ''

function cursorVfxMode(value: string | undefined): CursorVfxMode | null {
  return value === 'railgun'
    || value === 'torpedo'
    || value === 'pixiedust'
    || value === 'sonicboom'
    || value === 'ripple'
    || value === 'wireframe'
    ? value
    : null
}

function cursorParticleKind(mode: CursorVfxMode): CursorParticleKind {
  return Match.value(mode).pipe(
    Match.when('railgun', () => 'trail' as const),
    Match.when('torpedo', () => 'trail' as const),
    Match.when('pixiedust', () => 'pixiedust' as const),
    Match.when('sonicboom', () => 'burst' as const),
    Match.when('ripple', () => 'ripple' as const),
    Match.when('wireframe', () => 'wireframe' as const),
    Match.exhaustive,
  )
}

function cursorParticleClass(mode: CursorVfxMode): string {
  const style = mode === 'railgun'
    ? editorCanvasStyles.cursorParticleTrail
    : mode === 'torpedo'
      ? editorCanvasStyles.cursorParticleTorpedo
      : mode === 'pixiedust'
        ? editorCanvasStyles.cursorParticlePixieDust
        : mode === 'sonicboom'
          ? editorCanvasStyles.cursorParticleSonicBoom
          : mode === 'ripple'
            ? editorCanvasStyles.cursorParticleRipple
            : editorCanvasStyles.cursorParticleWireframe
  return stylex.props(editorCanvasStyles.cursorParticle, style).className ?? ''
}

function toggleClassName(element: HTMLElement, className: string, enabled: boolean): void {
  className.split(/\s+/u).forEach(token => token && element.classList.toggle(token, enabled))
}

function numberSetting(name: string, fallback: number): number {
  const value = Number(document.documentElement.dataset[name])
  return Number.isFinite(value) ? value : fallback
}

function EditorCursor({ scrollingRef, session, readOnly }: { scrollingRef: RefObject<HTMLDivElement | null>, session: EditorSession, readOnly: boolean }) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const trailRef = useRef<HTMLDivElement>(null)
  const previousTarget = useRef<CursorPoint | null>(null)
  const current = useRef<CursorMotion | null>(null)
  const particles = useRef<CursorParticle[]>([])
  const lastSelection = useRef<number | null>(null)
  const lastInputAt = useRef(Number.NEGATIVE_INFINITY)
  const lastVfxAt = useRef(Number.NEGATIVE_INFINITY)
  const blinkState = useRef<boolean | null>(null)

  useEffect(() => {
    if (readOnly)
      return
    const scrolling = scrollingRef.current
    const content = scrolling?.querySelector<HTMLElement>('[data-editor-content]')
    if (!scrolling || !content)
      return
    const previousCaretColor = content.style.caretColor
    content.style.caretColor = 'transparent'
    let frame = 0
    let lastTime = performance.now()
    let running = true
    let tick: (time: number) => void

    const scheduleFrame = () => {
      if (running && frame === 0) {
        // RAF sleeps while the cursor is idle, so an old timestamp would consume the next move.
        lastTime = performance.now()
        frame = requestAnimationFrame(tick)
      }
    }

    const updateTarget = (allowVfx = true) => {
      const selection = window.getSelection()
      if (!selection || !selection.isCollapsed || !content.contains(document.activeElement)) {
        previousTarget.current = null
        current.current = null
        if (overlayRef.current)
          overlayRef.current.style.opacity = '0'
        if (trailRef.current)
          trailRef.current.style.opacity = '0'
        particles.current.forEach(item => item.el.remove())
        particles.current = []
        return
      }
      try {
        const rect = session.editor.view.coordsAtPos(session.editor.state.selection.from)
        const bounds = scrolling.getBoundingClientRect()
        const next = {
          height: Math.max(12, rect.bottom - rect.top),
          x: rect.left - bounds.left,
          y: rect.top - bounds.top,
        }
        const old = previousTarget.current
        if (old) {
          const dx = next.x - old.x
          const oldCenterX = old.x + CURSOR_WIDTH / 2
          const oldCenterY = old.y + old.height / 2
          const centerDx = dx
          const centerDy = next.y + next.height / 2 - oldCenterY
          const distance = Math.hypot(centerDx, centerDy)
          const mode = cursorVfxMode(document.documentElement.dataset.editorCursorVfxMode)
          const reduceMotion = document.documentElement.dataset.reduceMotion === 'true'
          const now = performance.now()
          if (allowVfx && !reduceMotion && mode && distance > 0.5 && now - lastVfxAt.current >= 16) {
            lastVfxAt.current = now
            const density = numberSetting('editorCursorVfxParticleDensity', 0.7)
            const trail = mode === 'railgun' || mode === 'torpedo' || mode === 'pixiedust'
            const count = density <= 0
              ? 0
              : trail
                ? Math.min(24, Math.max(1, Math.floor(distance / Math.max(8, next.height) * density)))
                : 1
            const overlay = overlayRef.current
            if (overlay && count > 0) {
              const kind = cursorParticleKind(mode)
              const particleClass = cursorParticleClass(mode)
              const spread = mode === 'torpedo' ? 36 : mode === 'pixiedust' ? 44 : mode === 'railgun' ? 4 : 0
              for (let index = 0; index < count; index += 1) {
                const el = document.createElement('span')
                el.dataset.editorCursorParticle = mode
                el.className = particleClass
                overlay.appendChild(el)
                particles.current.push({
                  age: 0,
                  el,
                  kind,
                  vx: spread === 0 ? 0 : (Math.random() - 0.5) * spread,
                  vy: spread === 0 ? 0 : (Math.random() - 0.5) * spread,
                  x: oldCenterX + centerDx * (index + 1) / count,
                  y: oldCenterY + centerDy * (index + 1) / count,
                })
              }
              const overflow = particles.current.splice(0, Math.max(0, particles.current.length - MAX_CURSOR_PARTICLES))
              overflow.forEach(item => item.el.remove())
            }
          }
        }
        previousTarget.current = next
        if (!current.current) {
          current.current = {
            height: next.height,
            x: { position: next.x, velocity: 0 },
            y: { position: next.y, velocity: 0 },
          }
        }
        else {
          current.current.height = next.height
        }
        if (cursorRef.current)
          cursorRef.current.style.height = `${next.height}px`
        if (overlayRef.current)
          overlayRef.current.style.opacity = '1'
        scheduleFrame()
      }
      catch {
        if (overlayRef.current)
          overlayRef.current.style.opacity = '0'
      }
    }

    tick = (time: number) => {
      if (!running)
        return
      frame = 0
      const dt = Math.min(0.05, (time - lastTime) / 1000)
      lastTime = time
      const target = previousTarget.current
      const value = current.current
      if (target && value) {
        const isTypingMove = performance.now() - lastInputAt.current < 120
          && Math.abs(target.y - value.y.position) < 2
        const duration = document.documentElement.dataset.reduceMotion === 'true'
          ? 0
          : numberSetting(isTypingMove ? 'editorCursorShortAnimationLength' : 'editorCursorAnimationLength', isTypingMove ? 0.04 : 0.15)
        const xAnimating = advanceCriticallyDampedCursorAxis(value.x, target.x, dt, duration)
        const yAnimating = advanceCriticallyDampedCursorAxis(value.y, target.y, dt, duration)
        const cursorAnimating = xAnimating || yAnimating
        if (cursorRef.current) {
          const smoothBlink = document.documentElement.dataset.editorCursorSmoothBlink === 'true'
          if (blinkState.current !== smoothBlink && cursorBlinkClass) {
            toggleClassName(cursorRef.current, cursorBlinkClass, smoothBlink)
            blinkState.current = smoothBlink
          }
          cursorRef.current.style.transform = `translate3d(${value.x.position}px, ${value.y.position}px, 0)`
        }
        if (trailRef.current) {
          const dx = target.x - value.x.position
          const dy = target.y - value.y.position
          const length = Math.hypot(dx, dy)
          trailRef.current.style.opacity = String(Math.min(0.35, length / 16))
          trailRef.current.style.transform = `translate3d(${value.x.position}px, ${value.y.position + value.height / 2}px, 0) rotate(${Math.atan2(dy, dx)}rad) scaleX(${length * numberSetting('editorCursorTrailSize', 1)})`
        }
        if (cursorAnimating)
          scheduleFrame()
      }
      if (lastSelection.current !== session.editor.state.selection.from) {
        lastSelection.current = session.editor.state.selection.from
        updateTarget()
      }
      const lifetime = numberSetting('editorCursorVfxParticleLifetime', 0.5)
      const speed = numberSetting('editorCursorVfxParticleSpeed', 10)
      const opacity = numberSetting('editorCursorVfxOpacity', 200) / 255
      particles.current = particles.current.filter((item) => {
        item.age += dt
        item.x += item.vx * speed / 10 * dt
        item.y += item.vy * speed / 10 * dt
        const progress = Math.min(1, item.age / lifetime)
        item.el.style.opacity = String((1 - progress) * opacity)
        const scale = item.kind === 'burst'
          ? 1 + progress * 4
          : item.kind === 'ripple' || item.kind === 'wireframe'
            ? 1 + progress * 2.5
            : 1 - progress * 0.7
        item.el.style.transform = `translate3d(${item.x}px, ${item.y}px, 0) translate(-50%, -50%) scale(${scale})`
        if (item.age >= lifetime) {
          item.el.remove()
          return false
        }
        return true
      })
      if (particles.current.length > 0)
        scheduleFrame()
    }
    const events = ['keydown', 'keyup', 'input', 'pointerup', 'focus', 'blur']
    const updateTargetFromEvent = (event: Event) => {
      if (event.type === 'input')
        lastInputAt.current = performance.now()
      updateTarget()
    }
    const updateTargetOnScroll = () => updateTarget(false)
    events.forEach(event => content.addEventListener(event, updateTargetFromEvent))
    document.addEventListener('selectionchange', updateTargetFromEvent)
    window.addEventListener('resize', updateTargetFromEvent)
    scrolling.addEventListener('scroll', updateTargetOnScroll)
    updateTarget()
    return () => {
      running = false
      cancelAnimationFrame(frame)
      events.forEach(event => content.removeEventListener(event, updateTargetFromEvent))
      document.removeEventListener('selectionchange', updateTargetFromEvent)
      window.removeEventListener('resize', updateTargetFromEvent)
      scrolling.removeEventListener('scroll', updateTargetOnScroll)
      content.style.caretColor = previousCaretColor
      particles.current.forEach(item => item.el.remove())
      particles.current = []
    }
  }, [readOnly, scrollingRef, session])

  return (
    <div ref={overlayRef} {...stylex.props(editorCanvasStyles.cursorOverlay)} aria-hidden="true" style={{ opacity: 0 }}>
      <div ref={trailRef} {...stylex.props(editorCanvasStyles.cursorTrail)} />
      <div ref={cursorRef} {...stylex.props(editorCanvasStyles.cursor)} />
    </div>
  )
}

function UploadStatus() {
  const status = useAtomValue(uploadStatusAtom)
  const error = useAtomValue(uploadErrorAtom)
  const setError = useSetAtom(uploadErrorAtom)
  const { t } = useTranslation('editor')

  if (status === 'idle' && !error)
    return null

  return (
    <div {...stylex.props(editorCanvasStyles.uploadStatus, Boolean(error) && editorCanvasStyles.uploadStatusError)} aria-live="polite">
      <span>{error ?? t('ui.uploadingImage')}</span>
      {error
        ? <button {...stylex.props(editorCanvasStyles.uploadStatusButton)} aria-label={t('ui.dismissUploadError')} type="button" onClick={() => setError(null)}>{t('ui.dismiss')}</button>
        : null}
    </div>
  )
}

export function EditorCanvas({
  blockHandles = true,
  embedded,
  focusBlockId,
  mode,
  modeControls,
  modePicker,
  platform,
  readOnly,
  session,
  taskDate,
}: {
  blockHandles?: boolean
  embedded: boolean
  focusBlockId?: string
  mode: EditorModeValue
  modeControls?: ReactNode
  modePicker?: (onActivate: () => void) => ReactNode
  platform?: EditorPlatform
  readOnly: boolean
  session: EditorSession
  taskDate?: string
}) {
  const { configured, editor } = session
  const { t } = useTranslation('editor')
  const [editing, setEditing] = useState(false)
  const scrollingRef = useRef<HTMLDivElement>(null)
  const beginEditing = useCallback(() => setEditing(true), [])
  const contentProps = stylex.props(
    editorCanvasStyles.content,
    embedded && editorCanvasStyles.contentEmbedded,
    modePicker && !editing && editorCanvasStyles.contentChoosingMode,
  )

  useLayoutEffect(() => {
    if (focusBlockId !== undefined)
      focusBlock(session, focusBlockId, !readOnly)
  }, [focusBlockId, readOnly, session])

  // The placeholder (and any other state-dependent plugin text) is evaluated on
  // every editor transaction, so it won't update until the user edits after a
  // language switch. Dispatch a no-op transaction when i18next changes language
  // so decorations re-run and pick up the newly translated strings immediately.
  useEffect(() => {
    const refresh = (): void => {
      const view = session.editor.view
      if (view)
        view.dispatch(view.state.tr)
    }
    i18next.on('languageChanged', refresh)
    return () => i18next.off('languageChanged', refresh)
  }, [session])

  return (
    <>
      {readOnly ? null : <div data-editor-mode-controls="">{modeControls}</div>}
      <ProseKit editor={editor}>
        <div {...stylex.props(
          editorCanvasStyles.viewport,
          embedded && editorCanvasStyles.viewportEmbedded,
          embedded && modePicker && editorCanvasStyles.viewportEmbeddedEmpty,
        )}
        >
          <UploadStatus />
          <div
            ref={scrollingRef}
            {...stylex.props(
              editorCanvasStyles.scrolling,
              embedded && editorCanvasStyles.scrollingEmbedded,
              embedded && modePicker && editorCanvasStyles.scrollingEmbeddedEmpty,
            )}
          >
            {editing ? null : modePicker?.(beginEditing)}
            <div
              ref={editor.mount}
              {...contentProps}
              // React owns this class after mount; preserving it keeps ProseMirror-scoped rules active across rerenders.
              className={contentProps.className ? `ProseMirror ${contentProps.className}` : 'ProseMirror'}
              aria-label={t('ui.editorContent')}
              aria-multiline={readOnly ? undefined : 'true'}
              aria-readonly={readOnly ? 'true' : undefined}
              data-editor-content=""
              role={readOnly ? 'document' : 'textbox'}
              onBlur={() => setEditing(false)}
              onKeyDown={beginEditing}
              onPointerDown={beginEditing}
            />
            <EditorCursor readOnly={readOnly} scrollingRef={scrollingRef} session={session} />
            {readOnly
              ? null
              : (
                  <>
                    <ContextMenu outlineRuntime={session.outlineRuntime} platform={platform} uploader={configured.uploader} />
                    <EditorTaskMenu adapters={session.adapters} taskDate={taskDate} />
                    <InlineMenu learningEnabled={session.learningEnabled} />
                    {session.learningEnabled
                      ? (
                          <Suspense fallback={null}>
                            <MathClozeMenu />
                            <CardMenu adapters={session.adapters} topic={session.topicDocument} />
                          </Suspense>
                        )
                      : null}
                    <SlashMenu learningEnabled={session.learningEnabled} />
                    <TagMenu runtime={configured.tagRuntime} />
                    {blockHandles ? <BlockHandle mode={mode} session={session} /> : null}
                    <TableHandle />
                    <DropIndicator />
                  </>
                )}
          </div>
        </div>
      </ProseKit>
    </>
  )
}
