import { render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, placeCaretAtStart, userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import {
  adapters,
  documentBlock,
  marker,
  paragraph,
  parentBlockId,
  rootBlockIds,
  selectedCellText,
  selectedDomBlockId,
  semanticBlock,
  semanticListCases,
  table,
} from './document-interactions.fixture'

describe('document interactions', () => {
  it('uses the configured formatting shortcut and disables the replaced default', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        shortcuts={{ bold: 'Alt+B' }}
        initialContent={{
          type: 'doc',
          content: [documentBlock('formatting', paragraph('Format me'))],
        }}
      />,
    )
    await rendered.findByText('Format me')

    await userEvent.click(rendered.getByText('Format me'))
    await userEvent.keyboard('{Home}{Shift>}{End}{/Shift}')
    await userEvent.keyboard(modShortcut('b'))
    expect(rendered.container.querySelector('strong')).toBeNull()
    await userEvent.keyboard('{Alt>}b{/Alt}')

    await waitFor(() => expect(rendered.container.querySelector('strong')).toHaveTextContent('Format me'))
  })

  it.each([
    { binding: 'code', key: 'e', mark: 'code', selector: 'code' },
    { binding: 'italic', key: 'i', mark: 'italic', selector: 'em' },
    { binding: 'strike', key: 's', mark: 'strike', selector: 's' },
    { binding: 'underline', key: 'u', mark: 'underline', selector: 'u' },
  ])('supports rebinding the $mark formatting shortcut', async ({ binding, key, selector }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        shortcuts={{ [binding]: `Alt+${key.toUpperCase()}` }}
        initialContent={{
          type: 'doc',
          content: [documentBlock('formatting', paragraph('Format me'))],
        }}
      />,
    )
    await rendered.findByText('Format me')

    await userEvent.click(rendered.getByText('Format me'))
    await userEvent.keyboard('{Home}{Shift>}{End}{/Shift}')
    await userEvent.keyboard(`{Alt>}${key}{/Alt}`)

    await waitFor(() => expect(rendered.container.querySelector(selector)).toHaveTextContent('Format me'))
  })

  it('creates a semantic Card answer child when Enter follows a typed Card delimiter', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('question', paragraph('Question'))],
        }}
      />,
    )
    await rendered.findByText('Question')

    await userEvent.click(rendered.getByText('Question'))
    await userEvent.keyboard('{End}:-> {Enter}Answer')

    await waitFor(() => expect(rendered.getByText('Answer')).toBeInTheDocument())
    const delimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
    const definitionId = delimiter?.dataset.cardDefinitionId
    if (!definitionId)
      throw new Error('Typed Basic Card is missing its stable DefinitionID')
    const member = rendered.container.querySelector<HTMLElement>(`[data-card-item-definition-id="${definitionId}"]`)
    const memberId = member?.dataset.blockId
    if (!memberId)
      throw new Error('Card answer member is missing its stable BlockID')

    expect(delimiter).toHaveAttribute('data-card-direction', 'forward')
    expect(member).toHaveAttribute('data-list-kind', 'outline')
    expect(member).toHaveTextContent('Answer')
    expect(parentBlockId(rendered.container, memberId)).toBe('question')
  })

  it('keeps content after delimiter-adjacent spaces in an outline Card answer member', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('question', paragraph('Question'))],
        }}
      />,
    )
    await rendered.findByText('Question')

    await userEvent.click(rendered.getByText('Question'))
    await userEvent.keyboard('{End}:->    Answer')
    const delimiter = await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
      expect(element).not.toBeNull()
      return element
    })
    const definitionId = delimiter?.dataset.cardDefinitionId
    if (!definitionId)
      throw new Error('Spaced Basic Card is missing its stable DefinitionID')
    for (let index = 0; index < 'Answer'.length; index += 1)
      await userEvent.keyboard('{ArrowLeft}')

    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      const member = rendered.container.querySelector<HTMLElement>(`[data-card-item-definition-id="${definitionId}"]`)
      const memberId = member?.dataset.blockId
      if (!memberId)
        throw new Error('Spaced Card answer is missing its stable BlockID')
      expect(member).toHaveAttribute('data-list-kind', 'outline')
      expect(member).toHaveTextContent('Answer')
      expect(parentBlockId(rendered.container, memberId)).toBe('question')
      expect(rendered.container.querySelector('[data-block-id="question"] > .list-content > p')).toHaveTextContent('Question→')
    })
  })

  it('continues Card answer membership when Enter creates another direct member', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('question', paragraph('Question'))],
        }}
      />,
    )
    await rendered.findByText('Question')

    await userEvent.click(rendered.getByText('Question'))
    await userEvent.keyboard('{End}:-> {Enter}First answer{Enter}Second answer')

    await waitFor(() => expect(rendered.getByText('Second answer')).toBeInTheDocument())
    const delimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
    const definitionId = delimiter?.dataset.cardDefinitionId
    if (!definitionId)
      throw new Error('Typed Card is missing its stable DefinitionID')
    const members = rendered.container.querySelectorAll(`[data-card-item-definition-id="${definitionId}"]`)

    expect(members).toHaveLength(2)
    expect(members[0]).toHaveAttribute('data-list-kind', 'outline')
    expect(members[1]).toHaveAttribute('data-list-kind', 'outline')
    expect(members[0]).toHaveTextContent('First answer')
    expect(members[1]).toHaveTextContent('Second answer')
  })

  it('uses Tab on a following Document block as an explicit Add to Card Back command', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('question', {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: null,
                    definitionId: 'definition-question',
                    direction: 'forward',
                    forwardCardId: 'card-question',
                  },
                },
              ],
            }),
            documentBlock('answer', paragraph('Existing answer block')),
          ],
        }}
      />,
    )
    await rendered.findByText('Existing answer block')

    await userEvent.click(rendered.getByText('Existing answer block'))
    await userEvent.keyboard('{Tab}')

    await waitFor(() => {
      expect(parentBlockId(rendered.container, 'answer')).toBe('question')
      expect(rendered.container.querySelector('[data-block-id="answer"]')).toHaveAttribute(
        'data-card-item-definition-id',
        'definition-question',
      )
      expect(rendered.container.querySelector('[data-block-id="answer"]')).toHaveAttribute('data-list-kind', 'outline')
    })
  })

  it('preserves a task Block kind when Tab adds it to a Set Card Back', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('question', {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: null,
                    definitionId: 'definition-question',
                    direction: 'forward',
                    forwardCardId: 'card-question',
                  },
                },
              ],
            }),
            documentBlock('answer', paragraph('Task answer block'), 'task'),
          ],
        }}
      />,
    )
    await rendered.findByText('Task answer block')

    await userEvent.click(rendered.getByText('Task answer block'))
    await userEvent.keyboard('{Tab}')

    await waitFor(() => {
      const answer = rendered.container.querySelector('[data-block-id="answer"]')
      expect(parentBlockId(rendered.container, 'answer')).toBe('question')
      expect(answer).toHaveAttribute('data-card-item-definition-id', 'definition-question')
      expect(answer).toHaveAttribute('data-list-kind', 'task')
    })
  })

  it('keeps the first ordinary Document block wrapped at its start on Backspace', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('A')),
            documentBlock('B', paragraph('B')),
          ],
        }}
      />,
    )
    await rendered.findByText('A')

    await placeCaretAtStart(rendered.getByText('A', { exact: true }))
    await userEvent.keyboard('{Backspace}')

    await waitFor(() => {
      const rootChildren = Array.from(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!.children)
      expect(rootChildren).toHaveLength(2)
      expect(rootChildren.map(element => element.getAttribute('data-block-id'))).toEqual(['A', 'B'])
      expect(rootChildren.map(element => element.textContent)).toEqual(['A', 'B'])
      expect(rootChildren.every(element => element.matches('[data-list-kind="outline"]'))).toBe(true)
    })
    expect(selectedDomBlockId()).toBe('A')
  })

  it('merges an ordinary Document block into its predecessor on Backspace at its start', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('A')),
            documentBlock('B', paragraph('B')),
          ],
        }}
      />,
    )
    await rendered.findByText('B')

    await placeCaretAtStart(rendered.getByText('B', { exact: true }))
    await userEvent.keyboard('{Backspace}')

    await waitFor(() => {
      const rootChildren = Array.from(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!.children)
      expect(rootChildren).toHaveLength(1)
      expect(rootChildren[0]).toHaveAttribute('data-block-id', 'A')
      expect(rootChildren[0]).toHaveAttribute('data-list-kind', 'outline')
      expect(rootChildren[0]).toHaveTextContent('AB')
      expect(rendered.container.querySelector('[data-block-id="B"]')).toBeNull()
    })
    expect(selectedDomBlockId()).toBe('A')
  })

  it('merges an ordinary paragraph into the preceding heading without leaving bare content', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Heading' }],
            }),
            documentBlock('B', paragraph('Following paragraph')),
          ],
        }}
      />,
    )
    await rendered.findByText('Following paragraph')

    await placeCaretAtStart(rendered.getByText('Following paragraph'))
    await userEvent.keyboard('{Backspace}')

    expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveTextContent('HeadingFollowing paragraph')
    expect(rendered.container.querySelector('[data-block-id="B"]')).toBeNull()
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(1)
    expect(rendered.container.querySelector('[data-editor-content] > p')).toBeNull()
  })

  it('turns a heading into a paragraph on Backspace while preserving its Document block id', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Heading' }],
            }),
          ],
        }}
      />,
    )
    await rendered.findByRole('heading', { name: 'Heading' })

    await placeCaretAtStart(rendered.getByRole('heading', { name: 'Heading' }))
    await userEvent.keyboard('{Backspace}')

    expect(rendered.queryByRole('heading', { name: 'Heading' })).not.toBeInTheDocument()
    expect(rendered.container.querySelector('[data-block-id="A"] > .list-content > p')).toHaveTextContent('Heading')
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(1)
  })

  it.each([
    { kind: 'bullet', order: null },
    { kind: 'ordered', order: 4 },
  ])('turns a root $kind item into an ordinary Document block on Backspace without changing its id', async ({ kind, order }) => {
    const item = documentBlock('A', paragraph('List item'), kind)
    item.attrs = { ...item.attrs, order }
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{ type: 'doc', content: [item] }}
      />,
    )
    await rendered.findByText('List item')

    await placeCaretAtStart(rendered.getByText('List item'))
    await userEvent.keyboard('{Backspace}')

    expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', 'outline')
    expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveTextContent('List item')
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(1)
    expect(rendered.container.querySelector('[data-editor-content] > p')).toBeNull()
  })

  it.each([
    { kind: 'bullet', order: null },
    { kind: 'ordered', order: 4 },
  ])('merges a root $kind item into its preceding list item on Backspace', async ({ kind, order }) => {
    const first = documentBlock('A', paragraph('First item'), kind)
    const second = documentBlock('B', paragraph('Second item'), kind)
    first.attrs = { ...first.attrs, order }
    second.attrs = { ...second.attrs, order }
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{ type: 'doc', content: [first, second] }}
      />,
    )
    await rendered.findByText('Second item')

    await placeCaretAtStart(rendered.getByText('Second item'))
    await userEvent.keyboard('{Backspace}')

    expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveTextContent('First itemSecond item')
    expect(rendered.container.querySelector('[data-block-id="A"]')).toHaveAttribute('data-list-kind', kind)
    expect(rendered.container.querySelector('[data-block-id="B"]')).toBeNull()
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(1)
  })

  it('outdents a nested semantic list item on Backspace without changing block ids', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('A', paragraph('Parent item'), 'bullet', [
              documentBlock('B', paragraph('Child item'), 'bullet'),
            ]),
          ],
        }}
      />,
    )
    await rendered.findByText('Child item')

    await placeCaretAtStart(rendered.getByText('Child item'))
    await userEvent.keyboard('{Backspace}')

    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBeNull())
    expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', 'bullet')
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(2)
  })

  it.each(semanticListCases)('indents a semantic $kind list only beneath a real preceding item', async ({ kind, order }) => {
    const first = semanticBlock('A', 'First item', kind, order)
    const second = semanticBlock('B', 'Second item', kind, order)
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{ type: 'doc', content: [first, second] }}
      />,
    )
    await rendered.findByText('Second item')

    await userEvent.click(rendered.getByText('Second item'))
    await userEvent.keyboard('{Tab}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('A'))

    await userEvent.keyboard('{Tab}{Tab}')
    await waitFor(() => {
      expect(parentBlockId(rendered.container, 'B')).toBe('A')
      expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(2)
    })
    expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-kind', kind)
    if (kind === 'ordered')
      expect(rendered.container.querySelector('[data-block-id="B"]')).toHaveAttribute('data-list-order', '4')

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBeNull())
    expect(rendered.container.querySelectorAll('[data-block-id]')).toHaveLength(2)
  })

  it.each(semanticListCases)('keeps the first semantic $kind item at the root for Tab and Shift-Tab', async ({ kind, order }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            semanticBlock('A', 'First item', kind, order),
            semanticBlock('B', 'Second item', kind, order),
          ],
        }}
      />,
    )
    await rendered.findByText('First item')

    await userEvent.click(rendered.getByText('First item'))
    await userEvent.keyboard('{Tab}{Shift>}{Tab}{/Shift}')

    expect(rootBlockIds(rendered.container)).toEqual(['A', 'B'])
  })

  it('keeps task controls interactive in Document mode', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [{
            type: 'list',
            attrs: {
              blockId: 'Task',
              checked: false,
              collapsed: false,
              elapsedMs: 0,
              kind: 'task',
              order: null,
              startedAt: null,
              status: 'todo',
            },
            content: [paragraph('Task item')],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('button[data-task-status-control][data-status="todo"]')).not.toBeNull())

    await userEvent.click(rendered.container.querySelector('button[data-task-status-control][data-status="todo"]')!)

    await waitFor(() => expect(rendered.container.querySelector('button[data-task-status-control][data-status="doing"]')).toHaveAttribute('aria-pressed', 'false'))
  })

  it('keeps toggle controls interactive in Document mode', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('Toggle', paragraph('Toggle item'), 'toggle', [documentBlock('Child', paragraph('Child item'))])],
        }}
      />,
    )
    await rendered.findByText('Child item')

    await userEvent.click(page.getByText('Toggle item', { exact: true }))
    await userEvent.click(marker(rendered.container, 'Toggle'))

    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="Toggle"]')).toHaveAttribute('data-list-collapsed'))
    expect(rendered.getByText('Child item')).not.toBeVisible()
  })

  it('navigates table cells with Tab and Shift-Tab without changing the Document tree', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('Parent', paragraph('Parent'), 'outline', [documentBlock('Table', table())])],
        }}
      />,
    )
    await rendered.findByText('A1')
    await userEvent.click(page.getByText('A1', { exact: true }))

    await userEvent.keyboard('{Tab}')
    expect(selectedCellText()).toBe('A2')
    expect(parentBlockId(rendered.container, 'Table')).toBe('Parent')

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(selectedCellText()).toBe('A1')
    expect(parentBlockId(rendered.container, 'Table')).toBe('Parent')

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(selectedCellText()).toBe('A1')
    expect(parentBlockId(rendered.container, 'Table')).toBe('Parent')
  })
})
