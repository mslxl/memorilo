import type { NodeViewConstructor } from 'prosekit/pm/view'
import type { EditorTaskActionAdapter } from '../../adapters/editor-adapters'
import * as stylex from '@stylexjs/stylex'
import i18next from 'i18next'
import { Check, MoreHorizontal } from 'lucide'
import { DOMSerializer } from 'prosekit/pm/model'
import { createListNodeView } from 'prosemirror-flat-list'
import { parseTaskRepeatRule } from '../../schema/task-schema'

import { editorButtonAdapterStyles } from '../button/editor-button-adapter.stylex'
import { taskMenuStyles } from '../task-menu/editor-task-menu.stylex'
import { taskStyles } from './task-list-view.stylex'
import { effectiveStatus, formatDuration, nextClickStatus, totalElapsed, transitionAttrs } from './task-status'

function applyStylex(element: HTMLElement, props: ReturnType<typeof stylex.props>, className?: string) {
  element.className = [className, props.className].filter(Boolean).join(' ')
  if (props.style)
    Object.assign(element.style, props.style)
}

function createIcon([tag, attrs, children]: typeof Check) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attrs))
    element.setAttribute(name, String(value))
  for (const [childTag, childAttrs] of children ?? [])
    element.append(createIcon([childTag, childAttrs, []]))
  return element
}

function taskStatusLabel(status: ReturnType<typeof effectiveStatus>) {
  const statusKey = status === 'todo'
    ? 'ui.taskStatusTodo'
    : status === 'doing' ? 'ui.taskStatusDoing' : 'ui.taskStatusDone'
  return i18next.t('ui.taskStatus', {
    ns: 'editor',
    status: i18next.t(statusKey, { ns: 'editor' }),
  })
}

function taskActionsLabel() {
  return i18next.t('taskActions', { ns: 'todo' })
}

function createTaskControl(status: ReturnType<typeof effectiveStatus>) {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', taskStatusLabel(status))
  button.setAttribute('aria-pressed', String(status === 'done'))
  button.dataset.taskStatusControl = ''
  button.dataset.status = status
  applyStylex(button, stylex.props(taskStyles.control))

  const glyph = document.createElement('span')
  glyph.setAttribute('aria-hidden', 'true')
  applyStylex(glyph, stylex.props(taskStyles.glyph))

  if (status === 'done') {
    const [tag, attrs, children] = Check
    const icon = createIcon([tag, { ...attrs, 'width': 12, 'height': 12, 'stroke-width': 3 }, children])
    glyph.append(icon)
  }

  if (status === 'doing') {
    const dot = document.createElement('span')
    applyStylex(dot, stylex.props(taskStyles.doingDot))
    glyph.append(dot)
  }

  button.append(glyph)
  return button
}

export function createTaskListView(taskActions?: EditorTaskActionAdapter): NodeViewConstructor {
  return (initialNode, view, getPos, decorations, innerDecorations) => {
    if (initialNode.attrs.kind !== 'task')
      return createListNodeView(initialNode, view, getPos, decorations, innerDecorations)

    const toDOM = initialNode.type.spec.toDOM
    if (!toDOM)
      throw new Error('The list node is missing its DOM serializer')

    const rendered = DOMSerializer.renderSpec(document, toDOM(initialNode))
    if (!(rendered.dom instanceof HTMLElement) || !(rendered.contentDOM instanceof HTMLElement))
      throw new Error('The task list DOM serializer must return element containers')

    const dom = rendered.dom
    const contentDOM = rendered.contentDOM
    const marker = dom.querySelector(':scope > .list-marker')
    if (!(marker instanceof HTMLElement))
      return createListNodeView(initialNode, view, getPos, decorations, innerDecorations)

    marker.classList.remove('list-marker-click-target')
    const status = effectiveStatus(initialNode.attrs)
    const button = createTaskControl(status)
    const markOccurrenceTrigger = (attrs: Record<string, unknown>) => {
      const repeatRule = parseTaskRepeatRule(attrs.repeatRule)
      if (view.editable && repeatRule) {
        button.dataset.taskOccurrenceTrigger = ''
        button.setAttribute('aria-haspopup', 'dialog')
      }
      else {
        delete button.dataset.taskOccurrenceTrigger
        button.removeAttribute('aria-haspopup')
      }
    }
    markOccurrenceTrigger(initialNode.attrs)
    marker.replaceChildren(button)

    const time = document.createElement('span')
    time.contentEditable = 'false'
    time.dataset.status = status
    time.hidden = status === 'todo'
    applyStylex(
      time,
      stylex.props(taskStyles.time, status === 'doing' && taskStyles.timeDoing),
      'task-time',
    )
    const meta = document.createElement('span')
    meta.contentEditable = 'false'
    meta.dataset.taskMeta = ''
    applyStylex(meta, stylex.props(taskStyles.meta))
    meta.append(time)

    const menuButton = document.createElement('button')
    if (view.editable) {
      menuButton.type = 'button'
      menuButton.contentEditable = 'false'
      menuButton.dataset.taskMenuTrigger = ''
      menuButton.dataset.visible = 'false'
      menuButton.setAttribute('aria-expanded', 'false')
      menuButton.setAttribute('aria-haspopup', 'dialog')
      menuButton.setAttribute('aria-label', taskActionsLabel())
      menuButton.title = taskActionsLabel()
      applyStylex(menuButton, stylex.props(editorButtonAdapterStyles.action, taskMenuStyles.trigger))
      const [tag, attrs, children] = MoreHorizontal
      const icon = createIcon([tag, { ...attrs, 'width': 16, 'height': 16, 'stroke-width': 1.8 }, children])
      icon.setAttribute('aria-hidden', 'true')
      menuButton.append(icon)
      meta.append(menuButton)
    }
    contentDOM.before(meta)

    let node = initialNode
    let completionPending = false
    const renderTime = () => {
      const elapsed = totalElapsed(node.attrs)
      time.hidden = status === 'todo' || elapsed <= 0
      time.textContent = elapsed > 0 ? formatDuration(elapsed, status === 'doing') : ''
    }
    renderTime()

    const timer = status === 'doing' ? window.setInterval(renderTime, 1000) : null
    const missingStartTimer = status === 'doing' && typeof initialNode.attrs.startedAt !== 'number'
      ? window.setTimeout(() => {
          const pos = getPos()
          if (typeof pos !== 'number')
            return
          const currentNode = view.state.doc.nodeAt(pos)
          if (!currentNode || effectiveStatus(currentNode.attrs) !== 'doing' || typeof currentNode.attrs.startedAt === 'number')
            return
          const attrs = transitionAttrs(currentNode.attrs, 'doing')
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, ...attrs }))
        }, 0)
      : null
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0)
        event.preventDefault()
    }
    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      const pos = getPos()
      if (typeof pos !== 'number')
        return

      const currentStatus = effectiveStatus(node.attrs)
      const blockId = node.attrs.blockId
      if (currentStatus !== 'todo' && parseTaskRepeatRule(node.attrs.repeatRule) !== null && taskActions) {
        if (typeof blockId !== 'string' || blockId.length === 0)
          throw new Error('Recurring task completion requires a Block id')
        if (completionPending)
          return
        completionPending = true
        button.disabled = true
        void taskActions.completeRecurring({ blockId }).catch((error) => {
          console.error(`Failed to complete recurring task ${blockId}`, error)
        }).finally(() => {
          completionPending = false
          button.disabled = false
        })
        return
      }

      const nextStatus = nextClickStatus(currentStatus)
      const attrs = transitionAttrs(node.attrs, nextStatus)
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
    }

    const renderTranslation = () => {
      button.setAttribute('aria-label', taskStatusLabel(effectiveStatus(node.attrs)))
      markOccurrenceTrigger(node.attrs)
      if (view.editable) {
        menuButton.setAttribute('aria-label', taskActionsLabel())
        menuButton.title = taskActionsLabel()
      }
    }
    const showMenuButton = () => {
      if (view.editable)
        menuButton.dataset.visible = 'true'
    }
    const hideMenuButton = () => {
      if (!view.editable
        || menuButton.getAttribute('aria-expanded') === 'true'
        || document.activeElement === menuButton) {
        return
      }
      menuButton.dataset.visible = 'false'
    }
    const onTaskFocusOut = () => queueMicrotask(hideMenuButton)
    i18next.on('languageChanged', renderTranslation)
    button.addEventListener('mousedown', onMouseDown)
    button.addEventListener('click', onClick)
    if (view.editable) {
      menuButton.addEventListener('mousedown', onMouseDown)
      dom.addEventListener('mouseenter', showMenuButton)
      dom.addEventListener('mouseleave', hideMenuButton)
      dom.addEventListener('focusin', showMenuButton)
      dom.addEventListener('focusout', onTaskFocusOut)
    }

    const nested = initialNode.firstChild?.type === initialNode.type
    const singleChild = initialNode.childCount === 1

    return {
      dom,
      contentDOM,
      update: (nextNode) => {
        if (!nextNode.sameMarkup(node))
          return false
        if ((nextNode.firstChild?.type === nextNode.type) !== nested)
          return false
        if ((nextNode.childCount === 1) !== singleChild)
          return false

        node = nextNode
        renderTranslation()
        return true
      },
      ignoreMutation: mutation => meta.contains(mutation.target),
      destroy: () => {
        i18next.off('languageChanged', renderTranslation)
        if (timer !== null)
          window.clearInterval(timer)
        if (missingStartTimer !== null)
          window.clearTimeout(missingStartTimer)
        button.removeEventListener('mousedown', onMouseDown)
        button.removeEventListener('click', onClick)
        if (view.editable) {
          menuButton.removeEventListener('mousedown', onMouseDown)
          dom.removeEventListener('mouseenter', showMenuButton)
          dom.removeEventListener('mouseleave', hideMenuButton)
          dom.removeEventListener('focusin', showMenuButton)
          dom.removeEventListener('focusout', onTaskFocusOut)
        }
      },
    }
  }
}
