import type { NodeJSON } from 'prosekit/core'
import type { EditorAdapters } from './adapters/editor-adapters'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it, vi } from 'vitest'
import { EditorModeHarness } from '../test/browser/editor-mode-harness'
import { EditorTestHarness as Editor } from '../test/browser/editor-test-harness'
import { modShortcut, redoShortcut, userEvent } from '../test/browser/user-event'

import { EditorMode } from './common/editor-mode'
import { Editor as TopicEditor } from './editor'
import { createEditorNote } from './note/editor-note'

const adapters: EditorAdapters = {
  uploadImage: async () => 'memory://image',
  tagStorage: {
    search: async () => [],
    create: async tag => tag,
    update: async tag => tag,
  },
}

function modeDocument(): NodeJSON {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Plain block' }] },
      {
        type: 'list',
        attrs: { blockId: 'ordered-1', checked: false, collapsed: false, kind: 'ordered', order: 3 },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordered block' }] }],
      },
    ],
  }
}

function listMarker(block: HTMLElement): HTMLElement {
  const marker = block.querySelector<HTMLElement>(':scope > .list-marker')
  if (!marker)
    throw new Error('Expected a rendered list marker')
  return marker
}

function markerAlignmentDelta(block: HTMLElement, firstLineCenter: number): number {
  const markerRect = listMarker(block).getBoundingClientRect()
  const markerCenter = markerRect.top + markerRect.height / 2
  return markerCenter - firstLineCenter
}

function elementCenter(element: HTMLElement): number {
  const rect = element.getBoundingClientRect()
  return rect.top + rect.height / 2
}

function codeFirstLineCenter(code: HTMLElement): number {
  const rect = code.getBoundingClientRect()
  const style = getComputedStyle(code)
  const paddingTop = Number.parseFloat(style.paddingTop)
  const lineHeight = Number.parseFloat(style.lineHeight)
  if (!Number.isFinite(paddingTop) || !Number.isFinite(lineHeight))
    throw new Error('Expected numeric code-block padding and line height')
  return rect.top + paddingTop + lineHeight / 2
}

describe('editor modes', () => {
  it('reads the mode from its Topic without rendering mode controls', async () => {
    const note = createEditorNote({ id: 'editor-mode-topic' })
    const topicId = note.createTopic({ initialContent: modeDocument(), mode: EditorMode.Document, title: 'Mode Topic' })
    const topic = note.getTopic(topicId)
    const rendered = render(
      <TopicEditor
        adapters={adapters}
        topic={topic}
      />,
    )
    await within(rendered.container).findByText('Plain block')

    expect(rendered.container.querySelector('[data-editor-mode-picker]')).toBeNull()
    expect(rendered.container.querySelector('[data-editor-mode="document"]')).not.toBeNull()

    act(() => topic.setMode(EditorMode.Outline))
    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="outline"]')).not.toBeNull())
  })

  it('switches a non-empty document between projections without changing the document', async () => {
    const onDocumentChange = vi.fn()
    const rendered = render(
      <EditorModeHarness
        adapters={adapters}
        initialContent={modeDocument()}
        onDocumentChange={onDocumentChange}
      />,
    )

    await within(rendered.container).findByText('Plain block')
    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="document"]')).not.toBeNull())
    expect(rendered.container.querySelector('[data-list-kind="ordered"]')).not.toBeNull()

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="outline"]')!)

    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="outline"]')).not.toBeNull())
    await waitFor(() => expect(rendered.container.querySelector('[data-list-kind="outline"] > .list-marker')).not.toBeNull())
    expect(rendered.container.querySelector('[data-list-kind="ordered"]')).not.toBeNull()

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="document"]')!)

    await within(rendered.container).findByText('Plain block')
    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="document"]')).not.toBeNull())
    expect(rendered.container.querySelector('[data-list-kind="ordered"]')).not.toBeNull()
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('keeps default Outline bullets distinct from semantic bullet and ordered lists', async () => {
    const rendered = render(
      <EditorModeHarness
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Ordinary block' }] },
            {
              type: 'list',
              attrs: { blockId: 'bullet', kind: 'bullet' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Semantic bullet' }] }],
            },
            {
              type: 'list',
              attrs: { blockId: 'ordered', kind: 'ordered', order: 7 },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Semantic ordered' }] }],
            },
          ],
        }}
      />,
    )
    await within(rendered.container).findByText('Ordinary block')

    const ordinary = rendered.container.querySelector<HTMLElement>('[data-list-kind="outline"]')
    const bullet = rendered.container.querySelector<HTMLElement>('[data-block-id="bullet"]')
    const ordered = rendered.container.querySelector<HTMLElement>('[data-block-id="ordered"]')
    if (!ordinary || !bullet || !ordered)
      throw new Error('Expected ordinary, bullet, and ordered blocks to render')
    expect(getComputedStyle(listMarker(ordinary)).display).toBe('none')
    expect(bullet).toHaveAttribute('data-list-kind', 'bullet')
    expect(ordered).toHaveAttribute('data-list-kind', 'ordered')
    expect(ordered).toHaveAttribute('data-list-order', '7')

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="outline"]')!)
    await waitFor(() => {
      const outlineOrdinary = rendered.container.querySelector<HTMLElement>('[data-list-kind="outline"]')
      if (!outlineOrdinary)
        throw new Error('Expected the ordinary block in Outline mode')
      const markerStyle = getComputedStyle(listMarker(outlineOrdinary))
      const bulletStyle = getComputedStyle(listMarker(outlineOrdinary), '::before')
      expect(markerStyle.display).not.toBe('none')
      expect(bulletStyle.display).toBe('block')
      expect(bulletStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(bulletStyle.borderRadius).not.toBe('0px')
    })
    expect(rendered.container.querySelector('[data-block-id="bullet"]')).toHaveAttribute('data-list-kind', 'bullet')
    expect(rendered.container.querySelector('[data-block-id="ordered"]')).toHaveAttribute('data-list-kind', 'ordered')
    expect(rendered.container.querySelector('[data-block-id="ordered"]')).toHaveAttribute('data-list-order', '7')
  })

  it('aligns Outline markers with the first visible line of headings, code blocks, and quotes', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Marker heading' }],
            },
            {
              type: 'codeBlock',
              attrs: { language: 'javascript' },
              content: [{ type: 'text', text: 'const marker = true' }],
            },
            {
              type: 'blockquote',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Marker quote' }],
                },
              ],
            },
          ],
        }}
      />,
    )

    const heading = await within(rendered.container).findByRole('heading', { name: 'Marker heading' })
    await within(rendered.container).findByText('Marker quote')

    await waitFor(() => {
      const code = rendered.container.querySelector<HTMLElement>('pre[data-language]')
      const quote = rendered.container.querySelector<HTMLElement>('blockquote p')
      const blocks = [heading.closest<HTMLElement>('[data-block-id]'), code?.closest<HTMLElement>('[data-block-id]'), quote?.closest<HTMLElement>('[data-block-id]')]
      if (!code || !quote || blocks.some(block => !block))
        throw new Error('Expected heading, code, and quote Outline blocks')
      const firstLineCenters = [elementCenter(heading), codeFirstLineCenter(code), elementCenter(quote)]
      for (const [index, block] of (blocks as HTMLElement[]).entries())
        expect(Math.abs(markerAlignmentDelta(block, firstLineCenters[index]!))).toBeLessThanOrEqual(1)
    })
  })

  it('creates a new default Outline block with a unique stable id on Enter', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First block' }] }],
        }}
      />,
    )
    await within(rendered.container).findByText('First block')

    await userEvent.click(page.getByText('First block'))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(rendered.container.querySelectorAll('[data-list-kind="outline"]')).toHaveLength(2)
    })
    const newParagraph = rendered.container.querySelector<HTMLElement>('[data-list-kind="outline"]:last-child p')
    if (!newParagraph)
      throw new Error('Expected Enter to create a second Outline paragraph')

    await waitFor(() => {
      const block = newParagraph.closest<HTMLElement>('[data-block-id]')
      if (!block)
        throw new Error('Expected the new paragraph inside an Outline block')
      expect(Math.abs(markerAlignmentDelta(block, elementCenter(newParagraph)))).toBeLessThanOrEqual(1)
    })

    await userEvent.keyboard('Second block')

    await within(rendered.container).findByText('Second block')
    const blocks = Array.from(rendered.container.querySelectorAll<HTMLElement>('[data-list-kind="outline"]'))
    expect(blocks).toHaveLength(2)
    const ids = blocks.map((block) => {
      const id = block.dataset.blockId
      if (!id)
        throw new Error('A split Outline block is missing its stable id')
      return id
    })
    expect(new Set(ids).size).toBe(2)
  })

  it.each([
    { entry: 'Cmd+A', mode: EditorMode.Document, name: 'Document' },
    { entry: 'Cmd+A', mode: EditorMode.Outline, name: 'Outline' },
    { entry: 'Select all action', mode: EditorMode.Document, name: 'Document' },
    { entry: 'Select all action', mode: EditorMode.Outline, name: 'Outline' },
  ])('keeps a canonical editable root after $entry and Delete in $name mode', async ({ entry, mode }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={mode}
        initialContent={{
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'First root' }] },
            {
              type: 'list',
              attrs: { blockId: 'second-root', kind: 'bullet' },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Second root' }] },
                {
                  type: 'list',
                  attrs: { blockId: 'nested-child', kind: 'bullet' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested child' }] }],
                },
              ],
            },
          ],
        }}
      />,
    )
    await rendered.findByText('Nested child')

    if (entry === 'Cmd+A') {
      await userEvent.click(page.getByText('First root', { exact: true }))
      await userEvent.keyboard(modShortcut('a'))
    }
    else {
      fireEvent.contextMenu(rendered.getByText('First root', { exact: true }), { clientX: 320, clientY: 180 })
      await waitFor(() => expect(rendered.baseElement.querySelector('button[data-editor-action="select-all"]')).not.toBeNull())
      await userEvent.click(rendered.baseElement.querySelector<HTMLButtonElement>('button[data-editor-action="select-all"]')!)
    }
    await userEvent.keyboard('{Delete}')

    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await waitFor(() => {
      expect(editor.querySelectorAll('[data-block-id]')).toHaveLength(1)
      expect(editor.children).toHaveLength(1)
      expect(editor.firstElementChild).toMatchObject({
        dataset: { listKind: 'outline' },
        textContent: '',
      })
      expect(editor.querySelector(':scope > [data-block-id] > .list-content > p')).not.toBeNull()
    })

    await userEvent.keyboard('Replacement')
    expect(editor).toHaveTextContent('Replacement')
    expect(editor.querySelectorAll('[data-block-id]')).toHaveLength(1)
  })

  it.each([
    { kind: 'bullet', label: 'Bullet list' },
    { kind: 'ordered', label: 'Ordered list' },
  ])('creates a semantic $kind list from Outline mode and preserves it in Document mode', async ({ kind, label }) => {
    const rendered = render(
      <EditorModeHarness
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{ type: 'paragraph' }],
        }}
        initialMode={EditorMode.Outline}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-list-kind="outline"] p')).not.toBeNull())
    const paragraph = rendered.container.querySelector<HTMLElement>('[data-list-kind="outline"] p')
    if (!paragraph)
      throw new Error('Expected an empty Outline paragraph')

    await userEvent.click(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!)
    await userEvent.keyboard('/')
    await userEvent.click(page.getByText(label, { exact: true }))

    await waitFor(() => expect(rendered.container.querySelector(`[data-list-kind="${kind}"]`)).not.toBeNull())
    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="document"]')!)
    await waitFor(() => expect(rendered.container.querySelector(`[data-list-kind="${kind}"]`)).not.toBeNull())
  })

  it('keeps undo and redo history when switching a non-empty document between modes', async () => {
    const rendered = render(
      <EditorModeHarness
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'History block' }] }],
        }}
        initialMode={EditorMode.Outline}
      />,
    )
    await rendered.findByText('History block')

    await userEvent.click(page.getByText('History block'))
    await userEvent.keyboard('{End} changed')
    expect(await within(rendered.container).findByText('History block changed')).toBeInTheDocument()

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="document"]')!)
    await userEvent.click(page.getByText('History block changed'))
    await userEvent.keyboard(modShortcut('z'))
    expect(await within(rendered.container).findByText('History block')).toBeInTheDocument()
    expect(within(rendered.container).queryByText('History block changed')).not.toBeInTheDocument()

    await userEvent.keyboard(redoShortcut())
    expect(await within(rendered.container).findByText('History block changed')).toBeInTheDocument()
  })
})
