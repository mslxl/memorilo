import * as stylex from '@stylexjs/stylex'
import { render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, redoShortcut, userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import { testLayoutStyles } from '../test/test-layout.stylex'
import {
  adapters,
  documentBlock,
  dragBlockToText,
  paragraph,
  parentBlockId,
  rootBlockIds,
  selectedDomBlockId,
  semanticBlock,
  semanticListCases,
} from './document-interactions.fixture'

describe('document interactions', () => {
  it('creates a wrapped ordinary Document block from the block handle add control', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('Before', paragraph('Before')),
              documentBlock('After', paragraph('After')),
            ],
          }}
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
        throw new Error('A block-handle-created Document block is missing its stable id')
      return id
    })
    expect(new Set(ids).size).toBe(3)
    expect(selectedDomBlockId()).toBe(ids[1])
  })

  it('keeps ordinary Document blocks flat when one block is dragged onto another', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('First block'), 'outline', [
                documentBlock('C', paragraph('Existing child')),
              ]),
              documentBlock('B', paragraph('Second block')),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Second block')
    await dragBlockToText(rendered, 'Second block', 'Existing child', 'bottom')

    await waitFor(() => {
      expect(rootBlockIds(rendered.container)).toEqual(['A', 'B'])
      expect(parentBlockId(rendered.container, 'A')).toBeNull()
      expect(parentBlockId(rendered.container, 'B')).toBeNull()
      expect(parentBlockId(rendered.container, 'C')).toBe('A')
    })
  })

  it('nests a bulleted Document block when it is dragged onto another bulleted block', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('Parent bullet'), 'bullet'),
              documentBlock('B', paragraph('Child bullet'), 'bullet'),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Child bullet')

    await dragBlockToText(rendered, 'Child bullet', 'Parent bullet', 'middle')

    await waitFor(() => {
      expect(rootBlockIds(rendered.container)).toEqual(['A'])
      expect(parentBlockId(rendered.container, 'B')).toBe('A')
      expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', 'bullet')
    })
  })

  it.each(semanticListCases)('nests a $kind Document item beneath an unmarked block without marking the parent', async ({ kind, order }) => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('Document paragraph')),
              semanticBlock('B', 'Visible list item', kind, order),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Visible list item')

    await dragBlockToText(rendered, 'Visible list item', 'Document paragraph', 'middle')

    await waitFor(() => {
      expect(rootBlockIds(rendered.container)).toEqual(['A'])
      expect(parentBlockId(rendered.container, 'B')).toBe('A')
      expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'outline')
      expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', kind)
    })
  })

  it('keeps a nested Document block under its parent when it is dragged toward the root', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('Parent block'), 'outline', [
                documentBlock('C', paragraph('Nested block')),
              ]),
              documentBlock('B', paragraph('Root sibling')),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Nested block')
    await dragBlockToText(rendered, 'Nested block', 'Root sibling', 'bottom')

    await waitFor(() => {
      expect(rootBlockIds(rendered.container)).toEqual(['A', 'B'])
      expect(parentBlockId(rendered.container, 'C')).toBe('A')
    })
  })

  it.each(semanticListCases)('outdents a nested $kind Document item when it is dragged toward the root', async ({ kind, order }) => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('Parent block'), 'outline', [
                semanticBlock('C', 'Nested list item', kind, order),
              ]),
              documentBlock('B', paragraph('Root sibling')),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Nested list item')

    await dragBlockToText(rendered, 'Nested list item', 'Root sibling', 'bottom')

    await waitFor(() => {
      expect(rootBlockIds(rendered.container)).toEqual(['A', 'B', 'C'])
      expect(parentBlockId(rendered.container, 'C')).toBeNull()
      expect(rendered.container.querySelector('[data-block-id="C"]')).toHaveAttribute('data-list-kind', kind)
    })
  })

  it('reorders Document blocks when a block is dragged within the same parent', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('First block'), 'outline', [
                documentBlock('C', paragraph('Existing child')),
              ]),
              documentBlock('B', paragraph('Second block')),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Second block')
    await dragBlockToText(rendered, 'Second block', 'First block', 'top')

    await waitFor(() => {
      expect(rootBlockIds(rendered.container)).toEqual(['B', 'A'])
      expect(parentBlockId(rendered.container, 'C')).toBe('A')
    })
  })

  it('does not turn a top-level Document block into a child when dropped inside sibling text', async () => {
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.blockHandleOffset)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Document}
          initialContent={{
            type: 'doc',
            content: [
              documentBlock('A', paragraph('First block')),
              documentBlock('B', paragraph('Second block')),
              documentBlock('C', paragraph('Third block')),
            ],
          }}
        />
      </div>,
    )
    await rendered.findByText('Third block')

    await dragBlockToText(rendered, 'Third block', 'Second block', 'middle')

    await waitFor(() => {
      expect(new Set(rootBlockIds(rendered.container))).toEqual(new Set(['A', 'B', 'C']))
      expect(parentBlockId(rendered.container, 'C')).toBeNull()
    })
  })

  it('splits an ordinary block on Enter and keeps the split undoable', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('paragraph', {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Document paragraph' }],
            }),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.getByText('Document paragraph')).toBeInTheDocument())

    await userEvent.click(rendered.getByText('Document paragraph'))
    await userEvent.keyboard('{End}{Enter}')

    await waitFor(() => expect(rendered.container.querySelectorAll('[data-list-kind="outline"]')).toHaveLength(2))
    const ids = Array.from(rendered.container.querySelectorAll<HTMLElement>('[data-block-id]')).map((element) => {
      const id = element.dataset.blockId
      if (!id)
        throw new Error('A Document block lost its stable id')
      return id
    })
    expect(new Set(ids).size).toBe(2)

    await userEvent.keyboard(modShortcut('z'))
    await waitFor(() => expect(rendered.container.querySelectorAll('[data-list-kind="outline"]')).toHaveLength(1))
    await userEvent.keyboard(redoShortcut())
    await waitFor(() => expect(rendered.container.querySelectorAll('[data-list-kind="outline"]')).toHaveLength(2))
  })

  it('keeps repeated Enter inside wrapped ordinary Document blocks', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('paragraph', paragraph('Document paragraph'))],
        }}
      />,
    )
    await rendered.findByText('Document paragraph')

    await userEvent.click(rendered.getByText('Document paragraph'))
    await userEvent.keyboard('{End}{Enter}{Enter}{Enter}')

    await waitFor(() => {
      const rootChildren = Array.from(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!.children)
      expect(rootChildren).toHaveLength(4)
      expect(rootChildren.every(element => element.matches('[data-list-kind="outline"][data-block-id]'))).toBe(true)
      expect(rootChildren.map(element => element.textContent)).toEqual(['Document paragraph', '', '', ''])
    })

    const ids = Array.from(rendered.container.querySelectorAll<HTMLElement>('[data-block-id]')).map((element) => {
      const id = element.dataset.blockId
      if (!id)
        throw new Error('A repeated-Enter Document block is missing its stable id')
      return id
    })
    expect(new Set(ids).size).toBe(4)
    expect(selectedDomBlockId()).toBe(ids[3])
  })

  it('keeps Enter inside a code block instead of creating another Document block', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('code', {
              type: 'codeBlock',
              attrs: { language: 'javascript' },
              content: [{ type: 'text', text: 'const value = 1' }],
            }),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('pre[data-language]')).not.toBeNull())
    const code = rendered.container.querySelector<HTMLElement>('pre[data-language]')
    if (!code)
      throw new Error('Expected a rendered code block')

    await userEvent.click(code)
    await userEvent.keyboard('{End}{Enter}return value')

    await waitFor(() => expect(rendered.container.querySelector('pre[data-language]')?.textContent).toBe('const value = 1\nreturn value'))
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(1)
  })

  it('keeps the heading and creates a following paragraph when Enter is pressed at its end', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('heading', {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Document heading' }],
            }),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.getByRole('heading', { name: 'Document heading' })).toBeInTheDocument())

    await userEvent.click(rendered.getByRole('heading', { name: 'Document heading' }))
    await userEvent.keyboard('{End}{Enter}Following paragraph')

    expect(rendered.getByRole('heading', { name: 'Document heading' }).tagName).toBe('H2')
    await waitFor(() => expect(rendered.getByText('Following paragraph').tagName).toBe('P'))
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(2)
  })

  it('extends a quote with Enter and exits it from an empty quoted paragraph', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('quote', {
              type: 'blockquote',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Quoted line' }] },
              ],
            }),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.getByText('Quoted line')).toBeInTheDocument())

    await userEvent.click(rendered.getByText('Quoted line'))
    await userEvent.keyboard('{End}{Enter}Second quoted line')
    await waitFor(() => expect(rendered.container.querySelectorAll('blockquote p')).toHaveLength(2))

    await userEvent.keyboard('{End}{Enter}{Enter}After quote')
    await waitFor(() => expect(rendered.getByText('After quote')).toBeInTheDocument())
    expect(rendered.container.querySelectorAll('blockquote p')).toHaveLength(2)
    expect(rendered.getByText('After quote').closest('blockquote')).toBeNull()
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(1)
  })

  it.each([
    { kind: 'bullet', order: null, text: 'Bullet item' },
    { kind: 'ordered', order: 4, text: 'Ordered item' },
  ])('continues a semantic $kind list on Enter', async ({ kind, order, text }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            {
              ...documentBlock(kind, {
                type: 'paragraph',
                content: [{ type: 'text', text }],
              }, kind),
              attrs: { blockId: kind, checked: false, collapsed: false, kind, order },
            },
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.getByText(text)).toBeInTheDocument())

    await userEvent.click(rendered.getByText(text))
    await userEvent.keyboard('{End}{Enter}Next item')

    await waitFor(() => expect(rendered.container.querySelectorAll(`[data-list-kind="${kind}"]`)).toHaveLength(2))
    expect(rendered.getByText('Next item').closest('[data-list-kind]')).toHaveAttribute('data-list-kind', kind)
    if (kind === 'ordered')
      expect(rendered.container.querySelector('[data-block-id="ordered"]')).toHaveAttribute('data-list-order', '4')
  })

  it('splits a Todo into a fresh Todo sibling and keeps both blocks keyboard-accessible', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('first', paragraph('First line'))],
        }}
      />,
    )
    await rendered.findByText('First line')

    await userEvent.click(rendered.getByText('First line'))
    await userEvent.keyboard(modShortcut('{Enter}'))
    await waitFor(() => expect(rendered.container.querySelector('button[data-task-status-control][data-status="todo"]')).not.toBeNull())

    await userEvent.keyboard('{End}{Enter}Second line')

    await waitFor(() => {
      const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
      const blocks = Array.from(editor.children)
      expect(blocks).toHaveLength(2)
      expect(blocks.map(block => block.getAttribute('data-list-kind'))).toEqual(['task', 'task'])
      expect(blocks.map(block => block.getAttribute('data-task-status'))).toEqual(['todo', 'todo'])
      expect(blocks.map(block => block.querySelector(':scope > .list-content')?.textContent)).toEqual(['First line', 'Second line'])
      expect(blocks[0]).toHaveAttribute('data-block-id', 'first')
      expect(blocks[1]).toHaveAttribute('data-block-id')
      expect(blocks[1]?.getAttribute('data-block-id')).not.toBe('first')
    })

    const secondBlockId = rendered.getByText('Second line').closest<HTMLElement>('[data-block-id]')?.dataset.blockId
    if (!secondBlockId)
      throw new Error('The split Todo is missing its stable block ID')

    await userEvent.keyboard(modShortcut('{Enter}'))
    await waitFor(() => expect(rendered.container.querySelector(`[data-block-id="${secondBlockId}"]`)).toHaveAttribute('data-task-status', 'doing'))
    expect(rendered.container.querySelector('[data-block-id="first"]')).toHaveAttribute('data-task-status', 'todo')

    await userEvent.click(rendered.getByText('First line'))
    await userEvent.keyboard('{End}{ArrowDown}')
    await waitFor(() => expect(selectedDomBlockId()).toBe(secondBlockId))
  })

  it('exits an empty Todo without leaking task attributes and keeps its timing history', async () => {
    const rendered = render(
      <Editor adapters={adapters} mode={EditorMode.Document} />,
    )
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!

    await userEvent.click(editor)
    await userEvent.keyboard(modShortcut('{Enter}'))
    await waitFor(() => expect(rendered.container.querySelector('button[data-task-status-control][data-status="todo"]')).not.toBeNull())
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      const block = editor.firstElementChild
      expect(block).toHaveAttribute('data-list-kind', 'outline')
      expect(block).not.toHaveAttribute('data-task-status')
      expect(block?.querySelector(':scope > .list-content > p')).toHaveAttribute(
        'data-task-history',
        JSON.stringify({ status: 'todo', elapsedMs: 0 }),
      )
    })

    await userEvent.keyboard('{Enter}{Enter}')
    await waitFor(() => {
      expect(editor.children).toHaveLength(3)
      expect(Array.from(editor.children).every(block => block.getAttribute('data-list-kind') === 'outline')).toBe(true)
    })
  })

  it('preserves elapsed time when an empty Todo is exited', async () => {
    const task = documentBlock('timed', { type: 'paragraph' }, 'task')
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [{
            ...task,
            attrs: {
              ...task.attrs,
              elapsedMs: 1200,
              startedAt: null,
              status: 'todo',
            },
          }],
        }}
      />,
    )
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!

    await userEvent.click(editor)
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      const block = editor.firstElementChild
      expect(block).toHaveAttribute('data-list-kind', 'outline')
      expect(block).not.toHaveAttribute('data-task-status')
      expect(block?.querySelector(':scope > .list-content > p')).toHaveAttribute(
        'data-task-history',
        JSON.stringify({ status: 'todo', elapsedMs: 1200 }),
      )
    })

    await userEvent.keyboard(modShortcut('{Enter}'))
    await waitFor(() => {
      const block = editor.firstElementChild
      expect(block).toHaveAttribute('data-list-kind', 'task')
      expect(block).toHaveAttribute('data-task-status', 'todo')
      expect(block).toHaveAttribute('data-task-elapsed', '1200')
    })
  })

  it.each([
    { kind: 'bullet', order: null, text: 'Bullet item' },
    { kind: 'ordered', order: 4, text: 'Ordered item' },
  ])('exits an empty semantic $kind item into a wrapped ordinary Document block', async ({ kind, order, text }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            {
              ...documentBlock(kind, paragraph(text), kind),
              attrs: { blockId: kind, checked: false, collapsed: false, kind, order },
            },
          ],
        }}
      />,
    )
    await rendered.findByText(text)

    await userEvent.click(rendered.getByText(text))
    await userEvent.keyboard('{End}{Enter}')
    await waitFor(() => expect(rendered.container.querySelectorAll(`[data-list-kind="${kind}"]`)).toHaveLength(2))
    const emptyItem = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!.lastElementChild
    const emptyItemId = emptyItem?.getAttribute('data-block-id')
    if (!emptyItemId)
      throw new Error(`The empty ${kind} item is missing its stable id before exiting the list`)

    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      const rootChildren = Array.from(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!.children)
      expect(rootChildren).toHaveLength(2)
      expect(rootChildren.map(element => element.getAttribute('data-list-kind'))).toEqual([kind, 'outline'])
      expect(rootChildren.map(element => element.textContent)).toEqual([text, ''])
      expect(rootChildren[1]).toHaveAttribute('data-block-id', emptyItemId)
    })
    expect(selectedDomBlockId()).toBe(emptyItemId)
  })
})
