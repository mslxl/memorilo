import type { RenderResult } from '@testing-library/react'
import type { NodeJSON } from 'prosekit/core'
import type { EditorAdapters } from '../adapters/editor-adapters'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { expect } from 'vitest'
import { userEvent } from '../../test/browser/user-event'

export const adapters: EditorAdapters = {
  uploadImage: async () => 'memory://image',
  tagStorage: {
    search: async () => [],
    create: async tag => tag,
    update: async tag => tag,
  },
}

export const semanticListCases = [
  { kind: 'bullet', order: null },
  { kind: 'ordered', order: 4 },
  { kind: 'task', order: null },
  { kind: 'toggle', order: null },
] as const

export const mixedSemanticListCases = [
  { childKind: 'ordered', childOrder: 4, parentKind: 'bullet', parentOrder: null },
  { childKind: 'task', childOrder: null, parentKind: 'ordered', parentOrder: 4 },
  { childKind: 'toggle', childOrder: null, parentKind: 'task', parentOrder: null },
  { childKind: 'bullet', childOrder: null, parentKind: 'toggle', parentOrder: null },
] as const

export function documentBlock(id: string, body: NodeJSON, kind = 'outline', children: NodeJSON[] = []): NodeJSON {
  const attrs = kind === 'task'
    ? {
        blockId: id,
        checked: false,
        collapsed: false,
        elapsedMs: 0,
        kind,
        order: null,
        startedAt: null,
        status: 'todo',
      }
    : { blockId: id, checked: false, collapsed: false, kind, order: null }
  return {
    type: 'list',
    attrs,
    content: [body, ...children],
  }
}

export function paragraph(text: string): NodeJSON {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

export function richSubtree(targetIsNested: boolean): NodeJSON[] {
  const target = documentBlock('B', paragraph('Target B'), 'bullet', [
    documentBlock('C', {
      type: 'image',
      attrs: { src: 'memory://rich-subtree-image' },
    }, 'bullet', [
      documentBlock('D', {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Basic front' },
          {
            type: 'cardDelimiter',
            attrs: {
              backwardCardId: null,
              definitionId: 'definition-rich-basic',
              direction: 'forward',
              forwardCardId: 'card-rich-basic',
            },
          },
          { type: 'text', text: 'Basic back' },
        ],
      }, 'bullet', [
        documentBlock('E', {
          type: 'paragraph',
          content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Bold level E' }],
        }, 'bullet', [
          documentBlock('F', {
            type: 'paragraph',
            content: [{
              type: 'text',
              marks: [{
                type: 'cloze',
                attrs: {
                  anchorKind: 'rich-content',
                  cardId: 'card-rich-cloze',
                  definitionId: 'definition-rich-cloze',
                  groupId: 'group-rich-cloze',
                },
              }],
              text: 'Cloze level F',
            }],
          }, 'bullet'),
        ]),
      ]),
    ]),
  ])
  const candidates = targetIsNested
    ? [documentBlock('A', paragraph('Previous A'), 'bullet', [target])]
    : [documentBlock('A', paragraph('Previous A'), 'bullet'), target]

  return [
    documentBlock('Root', paragraph('Root'), 'bullet', [
      documentBlock('Level-1', paragraph('Level 1'), 'bullet', [
        documentBlock('Level-2', paragraph('Level 2'), 'bullet', candidates),
      ]),
    ]),
  ]
}

export function blockElement(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-block-id="${id}"]`)
  if (!element)
    throw new Error(`Document block ${id} was not rendered`)
  return element
}

export function expectRichSubtreeContent(container: HTMLElement): void {
  expect(blockElement(container, 'C').querySelector('img')).toHaveAttribute('src', 'memory://rich-subtree-image')
  expect(blockElement(container, 'D')).toHaveTextContent('Basic front')
  expect(blockElement(container, 'D')).toHaveTextContent('Basic back')
  expect(blockElement(container, 'D').querySelector('[data-card-delimiter]')).toMatchObject({
    dataset: {
      cardDefinitionId: 'definition-rich-basic',
      cardDirection: 'forward',
      forwardCardId: 'card-rich-basic',
    },
  })
  expect(blockElement(container, 'E').querySelector('strong')).toHaveTextContent('Bold level E')
  expect(blockElement(container, 'F').querySelector('[data-cloze-group-id="group-rich-cloze"]')).toMatchObject({
    dataset: {
      clozeAnchorKind: 'rich-content',
      clozeCardId: 'card-rich-cloze',
      clozeDefinitionId: 'definition-rich-cloze',
    },
    textContent: 'Cloze level F',
  })
}

export function semanticBlock(id: string, text: string, kind: 'bullet' | 'ordered' | 'task' | 'toggle', order: number | null): NodeJSON {
  const attrs = kind === 'task'
    ? {
        blockId: id,
        checked: false,
        collapsed: false,
        elapsedMs: 0,
        kind,
        order,
        startedAt: null,
        status: 'todo',
      }
    : { blockId: id, checked: false, collapsed: false, kind, order }
  return {
    type: 'list',
    attrs,
    content: [paragraph(text)],
  }
}

export function table(): NodeJSON {
  const cell = (text: string): NodeJSON => ({
    type: 'tableCell',
    attrs: {},
    content: [paragraph(text)],
  })
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('A1'), cell('A2')] },
      { type: 'tableRow', content: [cell('B1'), cell('B2')] },
    ],
  }
}

export function marker(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-block-id="${id}"] > .list-marker`)
  if (!element)
    throw new Error(`Document block ${id} has no marker`)
  return element
}

export function selectedCellText(): string | null {
  const focusNode = document.getSelection()?.focusNode
  if (!focusNode)
    return null
  const focusElement = focusNode instanceof Element ? focusNode : focusNode.parentElement
  return focusElement?.closest('td')?.textContent ?? null
}

export function parentBlockId(container: HTMLElement, id: string): string | null {
  const block = container.querySelector<HTMLElement>(`[data-block-id="${id}"]`)
  if (!block)
    throw new Error(`Document block ${id} was not rendered`)
  return block.parentElement?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null
}

export function rootBlockIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-editor-content] > [data-block-id]')).map((block) => {
    const id = block.dataset.blockId
    if (!id)
      throw new Error('A root Document block is missing its stable id')
    return id
  })
}

export async function dragBlockToText(rendered: RenderResult, sourceText: string, targetText: string, targetEdge: 'top' | 'middle' | 'bottom'): Promise<void> {
  await userEvent.hover(page.getByText(sourceText, { exact: true }))
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 250))
  })

  await waitFor(() => expect(rendered.baseElement.querySelector('[data-block-handle-action="drag"]')).not.toBeNull())
  const dragHandle = rendered.baseElement.querySelector<HTMLElement>('[data-block-handle-action="drag"]')!
  expect(dragHandle).toBeVisible()
  await act(async () => {
    fireEvent.pointerDown(dragHandle)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  })

  const target = rendered.getByText(targetText, { exact: true })
  const targetRect = target.getBoundingClientRect()
  const dataTransfer = new DataTransfer()
  const dragEventInit = {
    clientX: targetRect.left + 1,
    clientY: targetEdge === 'top'
      ? targetRect.top + 1
      : targetEdge === 'middle'
        ? targetRect.top + targetRect.height / 2
        : targetRect.bottom - 1,
    dataTransfer,
  }
  await act(async () => {
    fireEvent.dragStart(dragHandle, dragEventInit)
    fireEvent.dragOver(target, dragEventInit)
    fireEvent.drop(target, dragEventInit)
    fireEvent.dragEnd(dragHandle, dragEventInit)
    await new Promise<void>(resolve => setTimeout(resolve, 50))
  })
}

export function selectedDomBlockId(): string | null {
  const focusNode = document.getSelection()?.focusNode
  if (!focusNode)
    return null
  const focusElement = focusNode.nodeType === Node.ELEMENT_NODE ? focusNode as Element : focusNode.parentElement
  return focusElement?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null
}
