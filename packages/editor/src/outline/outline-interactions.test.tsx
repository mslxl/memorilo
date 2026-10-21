import * as stylex from '@stylexjs/stylex'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { EditorModeHarness } from '../../test/browser/editor-mode-harness'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, redoShortcut, userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import { testLayoutStyles } from '../test/test-layout.stylex'
import {
  adapters,
  block,
  blockElement,
  blockWithBody,
  emptyBlock,
  expectRichSubtreeContent,
  listKindBlock,
  outlineBodyCases,
  outlineDepth,
  outlineListKindCases,
  paragraph,
  parentBlockId,
  richSubtree,
  selectedDomBlockId,
} from './outline-interactions.fixture'

describe('outline interactions', () => {
  it('keeps the slash menu working after switching to Outline mode', async () => {
    const rendered = render(
      <EditorModeHarness
        adapters={adapters}
        initialContent={{ type: 'doc', content: [block('Before')] }}
      />,
    )
    await rendered.findByText('Before')

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="outline"]')!)
    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="outline"]')).not.toBeNull())
    const before = rendered.getByText('Before')
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(before)
    await userEvent.keyboard('{End}{Enter}/')

    expect(editor).toHaveTextContent('Before/')
    await waitFor(() => expect(rendered.container.querySelector('[data-slash-command="paragraph"]')).not.toBeNull())
    expect(rendered.container.querySelector('[data-slash-command="paragraph"]')).toBeVisible()
    expect(rendered.container.querySelector('[data-slash-command="blockquote"]')).toBeVisible()
  })

  it('moves the slash menu highlight with ArrowDown in Outline mode', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{ type: 'doc', content: [block('Before')] }}
      />,
    )
    await rendered.findByText('Before')
    await userEvent.click(page.getByText('Before', { exact: true }))
    await userEvent.keyboard('{End}{Enter}/')

    await waitFor(() => expect(rendered.container.querySelector('[data-slash-command="paragraph"]')).not.toBeNull())
    const textOption = rendered.container.querySelector<HTMLElement>('[data-slash-command="paragraph"]')!
    const headingOption = rendered.container.querySelector<HTMLElement>('[data-slash-command="heading-1"]')!
    await waitFor(() => expect(textOption).toHaveAttribute('data-highlighted'))

    await userEvent.keyboard('{ArrowDown}')

    await waitFor(() => {
      expect(textOption).not.toHaveAttribute('data-highlighted')
      expect(headingOption).toHaveAttribute('data-highlighted')
    })
  })

  it('creates a top-level Outline sibling from the block handle add control', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Outline}
          initialContent={{ type: 'doc', content: [block('Before'), block('After')] }}
        />
      </div>,
    )
    await rendered.findByText('Before')

    await userEvent.hover(page.getByText('Before', { exact: true }))
    await waitFor(() => expect(rendered.baseElement.querySelector('button[data-block-handle-action="add"]')).not.toBeNull())
    await userEvent.click(rendered.baseElement.querySelector<HTMLButtonElement>('button[data-block-handle-action="add"]')!)

    await waitFor(() => {
      const rootChildren = Array.from(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!.children)
      expect(rootChildren).toHaveLength(3)
      expect(rootChildren.every(element => element.matches('[data-list-kind="outline"][data-block-id]'))).toBe(true)
      expect(rootChildren.map(element => element.textContent)).toEqual(['Before', '', 'After'])
    })

    const ids = Array.from(rendered.container.querySelectorAll<HTMLElement>('[data-block-id]')).map((element) => {
      const id = element.dataset.blockId
      if (!id)
        throw new Error('A block-handle-created Outline item is missing its stable id')
      return id
    })
    expect(new Set(ids).size).toBe(3)
    expect(selectedDomBlockId()).toBe(ids[1])
  })

  it('reparents an Outline block when it is dragged onto another block', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Outline}
          initialContent={{
            type: 'doc',
            content: [
              block('A', [block('C')]),
              block('B'),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('B')

    await userEvent.hover(page.getByText('B', { exact: true }))
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
    expect(blockElement(rendered.container, 'B')).toHaveClass('ProseMirror-selectednode')

    const target = rendered.getByText('C', { exact: true })
    const targetRect = target.getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    const dragEventInit = {
      clientX: targetRect.left + 1,
      clientY: targetRect.bottom - 1,
      dataTransfer,
    }
    await act(async () => {
      fireEvent.dragStart(dragHandle, dragEventInit)
      fireEvent.dragOver(target, dragEventInit)
      fireEvent.drop(target, dragEventInit)
      fireEvent.dragEnd(dragHandle, dragEventInit)
      await new Promise<void>(resolve => setTimeout(resolve, 50))
    })

    await waitFor(() => {
      expect(parentBlockId(rendered.container, 'A')).toBeNull()
      expect(parentBlockId(rendered.container, 'C')).toBe('A')
      expect(parentBlockId(rendered.container, 'B')).toBe('C')
    })
  })

  it('keeps creating top-level Outline siblings when Enter is repeated on empty items', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{ type: 'doc', content: [block('Before'), block('After')] }}
      />,
    )
    await rendered.findByText('Before')

    await userEvent.click(rendered.getByText('Before', { exact: true }))
    await userEvent.keyboard('{End}{Enter}{Enter}{Enter}')

    await waitFor(() => {
      const rootChildren = Array.from(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!.children)
      expect(rootChildren).toHaveLength(5)
      expect(rootChildren.every(element => element.matches('[data-list-kind="outline"][data-block-id]'))).toBe(true)
      expect(rootChildren.map(element => element.textContent)).toEqual(['Before', '', '', '', 'After'])
    })

    const ids = Array.from(rendered.container.querySelectorAll<HTMLElement>('[data-block-id]')).map((element) => {
      const id = element.dataset.blockId
      if (!id)
        throw new Error('An Enter-created Outline item is missing its stable id')
      return id
    })
    expect(new Set(ids).size).toBe(5)
    expect(selectedDomBlockId()).toBe(ids[3])
  })

  it('keeps Enter inside a code block instead of creating another Outline item', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [
            blockWithBody('Code', {
              type: 'codeBlock',
              attrs: { language: 'javascript' },
              content: [{ type: 'text', text: 'const branch = true' }],
            }),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('pre[data-language]')).not.toBeNull())
    const code = rendered.container.querySelector<HTMLElement>('pre[data-language]')
    if (!code)
      throw new Error('Expected a rendered Outline code block')

    await userEvent.click(code)
    await userEvent.keyboard('{End}{Enter}return branch')

    await waitFor(() => expect(rendered.container.querySelector('pre[data-language]')?.textContent).toBe('const branch = true\nreturn branch'))
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(1)
  })

  it('outdents a trailing nested empty branch on Enter like Logseq', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [block('Root', [emptyBlock('Empty', [block('Child')])])],
        }}
      />,
    )
    await rendered.findByText('Child')

    await userEvent.click(paragraph(rendered.container, 'Empty'))
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(parentBlockId(rendered.container, 'Empty')).toBeNull()
      expect(parentBlockId(rendered.container, 'Child')).toBe('Empty')
      expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(3)
    })
  })

  it('keeps an empty branch intact and editable through repeated Enter and Tab operations', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{ type: 'doc', content: [block('Before'), emptyBlock('Branch', [block('Child')])] }}
      />,
    )
    await waitFor(() => expect(blockElement(rendered.container, 'Child')).toBeInTheDocument())

    await userEvent.click(paragraph(rendered.container, 'Branch'))
    await userEvent.keyboard('{Enter}{Tab}{Enter}{Tab}')
    await userEvent.keyboard('Still editing')

    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).toBeInTheDocument()
    expect(rendered.getByText('Still editing')).toBeInTheDocument()
    expect(parentBlockId(rendered.container, 'Child')).toBe('Branch')
    const ids = Array.from(rendered.container.querySelectorAll<HTMLElement>('[data-block-id]')).map((element) => {
      const id = element.dataset.blockId
      if (!id)
        throw new Error('An Outline block lost its stable block id')
      return id
    })
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('indents a new sibling with Tab and outdents the current item with Shift-Tab', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{ type: 'doc', content: [block('Parent')] }}
      />,
    )
    await waitFor(() => expect(rendered.getByText('Parent')).toBeInTheDocument())

    await userEvent.click(rendered.getByText('Parent'))
    await userEvent.keyboard('{End}{Enter}New child')
    await waitFor(() => expect(rendered.getByText('New child')).toBeInTheDocument())
    const child = rendered.getByText('New child').closest<HTMLElement>('[data-block-id]')
    const childId = child?.dataset.blockId
    if (!childId)
      throw new Error('The new Outline item is missing its stable id')

    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(rendered.container, childId)).toBe('Parent'))

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(parentBlockId(rendered.container, childId)).toBeNull())
  })

  it('indents an eight-level rich Outline subtree without losing any descendant content', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: richSubtree(false),
        }}
      />,
    )
    await rendered.findByText('Cloze level F')

    await userEvent.click(paragraph(rendered.container, 'B'))
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
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(9)
    for (const id of ['Root', 'Level-1', 'Level-2', 'A', 'B', 'C', 'D', 'E', 'F'])
      expect(blockElement(rendered.container, id)).toHaveAttribute('data-list-kind', 'bullet')
    expectRichSubtreeContent(rendered.container)
  })

  it.each(['logical', 'traditional'] as const)(
    'outdents an eight-level rich Outline subtree without losing any descendant content in %s mode',
    async (outdentBehavior) => {
      const rendered = render(
        <Editor
          adapters={adapters}
          mode={EditorMode.Outline}
          initialContent={{ type: 'doc', content: richSubtree(true) }}
          outline={{ outdentBehavior }}
        />,
      )
      await rendered.findByText('Cloze level F')

      await userEvent.click(paragraph(rendered.container, 'B'))
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
      expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(9)
      for (const id of ['Root', 'Level-1', 'Level-2', 'A', 'B', 'C', 'D', 'E', 'F'])
        expect(blockElement(rendered.container, id)).toHaveAttribute('data-list-kind', 'bullet')
      expectRichSubtreeContent(rendered.container)
    },
  )

  it.each(outlineListKindCases)('indents and outdents a $kind list item in Outline mode', async ({ kind, order }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [
            listKindBlock('Previous', kind, order),
            listKindBlock('Target', kind, order),
          ],
        }}
      />,
    )
    await rendered.findByText('Target')

    await userEvent.click(rendered.getByText('Previous'))
    await userEvent.keyboard('{Tab}{Shift>}{Tab}{/Shift}')
    expect(parentBlockId(rendered.container, 'Previous')).toBeNull()
    expect(parentBlockId(rendered.container, 'Target')).toBeNull()

    await userEvent.click(rendered.getByText('Target'))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'Target')).toBe('Previous'))
    expect(blockElement(rendered.container, 'Target')).toHaveAttribute('data-list-kind', kind)

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'Target')).toBeNull())
  })

  it.each(outlineBodyCases)('indents and outdents an Outline item with a $name body', async ({ body, selector }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [
            block('Previous'),
            blockWithBody('Target', body),
          ],
        }}
      />,
    )
    await waitFor(() => expect(blockElement(rendered.container, 'Target').querySelector(selector)).not.toBeNull())
    const target = blockElement(rendered.container, 'Target').querySelector<HTMLElement>(selector)
    if (!target)
      throw new Error(`Outline target body ${selector} was not rendered`)

    await userEvent.click(target)
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'Target')).toBe('Previous'))

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'Target')).toBeNull())
  })

  it('limits repeated Tab presses on a new item to one Logseq-style indent', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{ type: 'doc', content: [block('Parent')] }}
      />,
    )
    await rendered.findByText('Parent')

    await userEvent.click(rendered.getByText('Parent'))
    await userEvent.keyboard('{End}{Enter}')
    await userEvent.keyboard('{Tab}{Tab}{Tab}')
    await userEvent.keyboard('Child')
    const childText = await rendered.findByText('Child')
    const child = childText.closest<HTMLElement>('[data-block-id]')
    const childId = child?.dataset.blockId
    if (!childId)
      throw new Error('The repeatedly indented Outline item is missing its stable id')

    await waitFor(() => {
      expect(parentBlockId(rendered.container, childId)).toBe('Parent')
      expect(outlineDepth(rendered.container, childId)).toBe(1)
      expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(2)
    })
  })

  it('undoes and redoes empty-branch Enter as one structural edit', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{ type: 'doc', content: [block('Before'), emptyBlock('Branch', [block('Child')])] }}
      />,
    )
    await waitFor(() => expect(blockElement(rendered.container, 'Child')).toBeInTheDocument())

    await userEvent.click(paragraph(rendered.container, 'Branch'))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(4))
    expect(parentBlockId(rendered.container, 'Child')).toBe('Branch')

    await userEvent.keyboard(modShortcut('z'))
    await waitFor(() => expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(3))
    expect(parentBlockId(rendered.container, 'Child')).toBe('Branch')

    await userEvent.keyboard(redoShortcut())
    await waitFor(() => expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(4))
    expect(parentBlockId(rendered.container, 'Child')).toBe('Branch')
  })

  it.each([
    { kind: 'bullet', order: null, text: 'Outline bullet' },
    { kind: 'ordered', order: 6, text: 'Outline ordered' },
  ])('continues a semantic $kind list on Enter in Outline mode', async ({ kind, order, text }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [
            {
              type: 'list',
              attrs: { blockId: kind, checked: false, collapsed: false, kind, order },
              content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
            },
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.getByText(text)).toBeInTheDocument())

    await userEvent.click(rendered.getByText(text))
    await userEvent.keyboard('{End}{Enter}Next semantic item')

    await waitFor(() => expect(rendered.container.querySelectorAll(`[data-list-kind="${kind}"]`)).toHaveLength(2))
    expect(rendered.getByText('Next semantic item').closest('[data-list-kind]')).toHaveAttribute('data-list-kind', kind)
    if (kind === 'ordered')
      expect(rendered.container.querySelector('[data-block-id="ordered"]')).toHaveAttribute('data-list-order', '6')
  })
})
