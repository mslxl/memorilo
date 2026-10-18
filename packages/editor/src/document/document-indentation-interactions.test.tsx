import * as stylex from '@stylexjs/stylex'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { EditorModeHarness } from '../../test/browser/editor-mode-harness'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, placeCaretAtStart, redoShortcut, userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import { testLayoutStyles } from '../test/test-layout.stylex'
import {
  adapters,
  blockElement,
  documentBlock,
  expectRichSubtreeContent,
  mixedSemanticListCases,
  paragraph,
  parentBlockId,
  richSubtree,
  rootBlockIds,
  selectedDomBlockId,
  semanticBlock,
  semanticListCases,
} from './document-interactions.fixture'

describe('document interactions', () => {
  it('shows and hides a root Document block bullet with Tab and Shift-Tab', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', { type: 'paragraph', content: [{ type: 'text', text: 'First block' }] }),
            documentBlock('B', { type: 'paragraph', content: [{ type: 'text', text: 'Second block' }] }),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.getByText('Second block')).toBeInTheDocument())

    await userEvent.click(rendered.getByText('Second block'))
    await userEvent.keyboard('{Tab}')

    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', 'bullet'))
    expect(parentBlockId(rendered.container, 'B')).toBeNull()
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(2)

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', 'outline'))
    expect(parentBlockId(rendered.container, 'B')).toBeNull()
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(2)
    expect(rendered.queryByRole('status')).not.toBeInTheDocument()
  })

  it('indents a Document block without revealing the parent bullet', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('Parent block')),
            documentBlock('B', paragraph('Child block')),
          ],
        }}
      />,
    )
    await rendered.findByText('Child block')

    await userEvent.click(rendered.getByText('Child block'))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', 'bullet'))

    await userEvent.keyboard('{Tab}')

    await waitFor(() => {
      expect(parentBlockId(rendered.container, 'B')).toBe('A')
      expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'outline')
    })
  })

  it('indents an eight-level rich Document subtree without losing any descendant content', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: richSubtree(false),
        }}
      />,
    )
    await rendered.findByText('Cloze level F')

    await userEvent.click(rendered.getByText('Target B'))
    await userEvent.keyboard('{Tab}')

    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('A'))
    expect(parentBlockId(rendered.container, 'Root')).toBeNull()
    expect(parentBlockId(rendered.container, 'Level-1')).toBe('Root')
    expect(parentBlockId(rendered.container, 'Level-2')).toBe('Level-1')
    expect(parentBlockId(rendered.container, 'A')).toBe('Level-2')
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
    expect(parentBlockId(rendered.container, 'D')).toBe('C')
    expect(parentBlockId(rendered.container, 'E')).toBe('D')
    expect(parentBlockId(rendered.container, 'F')).toBe('E')
    expect(rootBlockIds(rendered.container)).toEqual(['Root'])
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(9)
    for (const id of ['Root', 'Level-1', 'Level-2', 'A', 'B', 'C', 'D', 'E', 'F'])
      expect(blockElement(rendered.container, id)).toHaveAttribute('data-list-kind', 'bullet')
    expectRichSubtreeContent(rendered.container)
  })

  it.each(['logical', 'traditional'] as const)(
    'outdents an eight-level rich Document subtree without losing any descendant content with %s configured',
    async (outdentBehavior) => {
      const rendered = render(
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{ type: 'doc', content: richSubtree(true) }}
          outline={{ outdentBehavior }}
        />,
      )
      await rendered.findByText('Cloze level F')

      await userEvent.click(rendered.getByText('Target B'))
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

      await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('Level-2'))
      expect(parentBlockId(rendered.container, 'Root')).toBeNull()
      expect(parentBlockId(rendered.container, 'Level-1')).toBe('Root')
      expect(parentBlockId(rendered.container, 'Level-2')).toBe('Level-1')
      expect(parentBlockId(rendered.container, 'A')).toBe('Level-2')
      expect(parentBlockId(rendered.container, 'C')).toBe('B')
      expect(parentBlockId(rendered.container, 'D')).toBe('C')
      expect(parentBlockId(rendered.container, 'E')).toBe('D')
      expect(parentBlockId(rendered.container, 'F')).toBe('E')
      expect(rootBlockIds(rendered.container)).toEqual(['Root'])
      expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(9)
      for (const id of ['Root', 'Level-1', 'Level-2', 'A', 'B', 'C', 'D', 'E', 'F'])
        expect(blockElement(rendered.container, id)).toHaveAttribute('data-list-kind', 'bullet')
      expectRichSubtreeContent(rendered.container)
    },
  )

  it('preserves an eight-level rich subtree through Tab, history, mode switching, and Shift-Tab', async () => {
    const rendered = render(
      <EditorModeHarness
        adapters={adapters}
        initialContent={{ type: 'doc', content: richSubtree(false) }}
      />,
    )
    await rendered.findByText('Cloze level F')

    await userEvent.click(rendered.getByText('Target B'))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('A'))
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
    expect(parentBlockId(rendered.container, 'F')).toBe('E')
    expectRichSubtreeContent(rendered.container)

    await userEvent.keyboard(modShortcut('z'))
    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('Level-2'))
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
    expectRichSubtreeContent(rendered.container)

    await userEvent.keyboard(redoShortcut())
    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('A'))
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
    expectRichSubtreeContent(rendered.container)

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="outline"]')!)
    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="outline"]')).not.toBeNull())
    expect(parentBlockId(rendered.container, 'B')).toBe('A')
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
    expectRichSubtreeContent(rendered.container)

    await userEvent.click(rendered.getByText('Target B'))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('Level-2'))
    expect(parentBlockId(rendered.container, 'A')).toBe('Level-2')
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
    expect(parentBlockId(rendered.container, 'D')).toBe('C')
    expect(parentBlockId(rendered.container, 'E')).toBe('D')
    expect(parentBlockId(rendered.container, 'F')).toBe('E')
    expectRichSubtreeContent(rendered.container)

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="document"]')!)
    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="document"]')).not.toBeNull())
    expect(parentBlockId(rendered.container, 'B')).toBe('Level-2')
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(9)
    expectRichSubtreeContent(rendered.container)
  })

  it('undoes and redoes a Document bullet change through the Loro editor history', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('A', paragraph('Document block'))],
        }}
      />,
    )
    await rendered.findByText('Document block')

    await userEvent.click(rendered.getByText('Document block'))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'bullet'))

    await userEvent.keyboard(modShortcut('z'))
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'outline'))

    await userEvent.keyboard(redoShortcut())
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'bullet'))
  })

  it('keeps a root Document bullet visible while it owns child blocks', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('Parent bullet'), 'bullet', [
              documentBlock('B', paragraph('Child bullet'), 'bullet'),
            ]),
          ],
        }}
      />,
    )
    await rendered.findByText('Parent bullet')

    await userEvent.click(rendered.getByText('Parent bullet'))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'bullet')
    expect(parentBlockId(rendered.container, 'B')).toBe('A')
  })

  it.each(['logical', 'traditional'] as const)(
    'keeps Document Shift-Tab semantics when Outline Outdent behavior is %s',
    async (outdentBehavior) => {
      const rendered = render(
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('P', paragraph('Parent block'), 'outline', [
                semanticBlock('A', 'First child', 'bullet', null),
                semanticBlock('B', 'Target child', 'bullet', null),
                semanticBlock('C', 'Following child', 'bullet', null),
              ]),
              semanticBlock('R', 'Root bullet', 'bullet', null),
            ],
          }}
          outline={{ outdentBehavior }}
        />,
      )
      await rendered.findByText('Target child')

      await userEvent.click(rendered.getByText('Target child'))
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

      await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBeNull())
      expect(parentBlockId(rendered.container, 'A')).toBe('P')
      expect(parentBlockId(rendered.container, 'C')).toBe('B')
      expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', 'bullet')

      await userEvent.click(rendered.getByText('Root bullet'))
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

      await waitFor(() => expect(rendered.container.querySelector('[data-block-id="R"]')).toHaveAttribute('data-list-kind', 'outline'))
      expect(parentBlockId(rendered.container, 'R')).toBeNull()
    },
  )

  it('keeps nested ordinary Document blocks at their existing level for Tab and Shift-Tab', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('P', paragraph('Parent'), 'outline', [
              documentBlock('A', paragraph('First child')),
              documentBlock('B', paragraph('Second child')),
            ]),
          ],
        }}
      />,
    )
    await rendered.findByText('Second child')

    await userEvent.click(rendered.getByText('Second child'))
    await userEvent.keyboard('{Tab}{Shift>}{Tab}{/Shift}')

    expect(parentBlockId(rendered.container, 'A')).toBe('P')
    expect(parentBlockId(rendered.container, 'B')).toBe('P')
  })

  it.each(semanticListCases)('keeps an ordinary Document parent unmarked when indenting a $kind item', async ({ kind, order }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('Ordinary block')),
            semanticBlock('B', 'Semantic item', kind, order),
          ],
        }}
      />,
    )
    await rendered.findByText('Semantic item')

    await userEvent.click(rendered.getByText('Semantic item'))
    await userEvent.keyboard('{Tab}')

    await waitFor(() => {
      expect(parentBlockId(rendered.container, 'B')).toBe('A')
      expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'outline')
    })
  })

  it.each(mixedSemanticListCases)(
    'indents a semantic $childKind item beneath a semantic $parentKind item',
    async ({ childKind, childOrder, parentKind, parentOrder }) => {
      const rendered = render(
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              semanticBlock('A', 'Parent item', parentKind, parentOrder),
              semanticBlock('B', 'Child item', childKind, childOrder),
            ],
          }}
        />,
      )
      await rendered.findByText('Child item')

      await userEvent.click(rendered.getByText('Child item'))
      await userEvent.keyboard('{Tab}')
      await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('A'))
      expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', parentKind)
      expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', childKind)

      await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
      await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBeNull())
    },
  )

  it('does not indent an outer semantic list item when Tab is pressed inside its code block', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('First item'), 'bullet'),
            documentBlock('B', {
              type: 'codeBlock',
              attrs: { language: 'javascript' },
              content: [{ type: 'text', text: 'const value = 1' }],
            }, 'bullet'),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="B"] pre[data-language]')).toHaveTextContent('const value = 1'))
    const codeBlock = rendered.container.querySelector<HTMLElement>('[data-block-id="B"] pre[data-language]')
    if (!codeBlock)
      throw new Error('Expected the second semantic item to contain a code block')
    await userEvent.click(codeBlock)
    await userEvent.keyboard('{Tab}')

    expect(parentBlockId(rendered.container, 'B')).toBeNull()
    expect(codeBlock).toHaveTextContent('const value = 1')
  })

  it('does not outdent an outer semantic list item when Shift-Tab is pressed inside its code block', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('Parent item'), 'bullet', [
              documentBlock('B', {
                type: 'codeBlock',
                attrs: { language: 'javascript' },
                content: [{ type: 'text', text: 'const nested = true' }],
              }, 'bullet'),
            ]),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="B"] pre[data-language]')).toHaveTextContent('const nested = true'))
    const codeBlock = rendered.container.querySelector<HTMLElement>('[data-block-id="B"] pre[data-language]')
    if (!codeBlock)
      throw new Error('Expected the nested semantic item to contain a code block')
    await userEvent.click(codeBlock)
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    expect(parentBlockId(rendered.container, 'B')).toBe('A')
    expect(codeBlock).toHaveTextContent('const nested = true')
  })

  it('does not indent semantic list items from a cross-block text selection', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('First item'), 'bullet'),
            documentBlock('B', paragraph('Second item'), 'bullet'),
            documentBlock('C', paragraph('Third item'), 'bullet'),
          ],
        }}
      />,
    )
    await rendered.findByText('Third item')

    await placeCaretAtStart(rendered.getByText('Second item'))
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(document.getSelection()?.isCollapsed).toBe(false)
    expect(selectedDomBlockId()).toBe('C')

    await userEvent.keyboard('{Tab}')

    expect(rootBlockIds(rendered.container)).toEqual(['A', 'B', 'C'])
  })

  it('keeps a handler-selected block and editor focus unchanged for Tab and Shift-Tab', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('First item'), 'bullet'),
              documentBlock('B', paragraph('Second item'), 'bullet'),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Second item')

    await userEvent.hover(page.getByText('Second item', { exact: true }))
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 250))
    })
    await waitFor(() => expect(rendered.baseElement.querySelector('[data-block-handle-action="drag"]')).not.toBeNull())
    const dragHandle = rendered.baseElement.querySelector<HTMLElement>('[data-block-handle-action="drag"]')!
    await act(async () => {
      fireEvent.pointerDown(dragHandle)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    const selectedBlock = rendered.container.querySelector('[data-block-id="B"]')
    expect(selectedBlock).toHaveClass('ProseMirror-selectednode')

    await userEvent.keyboard('{Tab}')

    expect(rootBlockIds(rendered.container)).toEqual(['A', 'B'])
    expect(selectedBlock).toHaveClass('ProseMirror-selectednode')
    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).toHaveFocus()

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    expect(rootBlockIds(rendered.container)).toEqual(['A', 'B'])
    expect(selectedBlock).toHaveClass('ProseMirror-selectednode')
    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).toHaveFocus()
  })
})
