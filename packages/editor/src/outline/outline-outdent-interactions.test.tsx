import * as stylex from '@stylexjs/stylex'
import { render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it, vi } from 'vitest'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import { testLayoutStyles } from '../test/test-layout.stylex'
import {
  adapters,
  block,
  blockElement,
  blockWithBody,
  marker,
  outlineDocument,
  paragraph,
  parentBlockId,
  selectedCellText,
  selectedDomBlockId,
  selectedIds,
  table,
} from './outline-interactions.fixture'

describe('outline interactions', () => {
  it('applies Traditional Outdent to one contiguous sibling range', async () => {
    const onDocumentChange = vi.fn()
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={outlineDocument()}
        outline={{ defaultOutdentBehavior: 'traditional' }}
        onDocumentChange={onDocumentChange}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="C"]')).not.toBeNull())

    await userEvent.click(marker(rendered.container, 'B'), { modifiers: ['Meta'] })
    await waitFor(() => expect(selectedIds(rendered.container)).toEqual(['B']))
    await userEvent.click(marker(rendered.container, 'C'), { modifiers: ['Shift'] })
    await waitFor(() => expect(selectedIds(rendered.container)).toEqual(['B', 'C']))
    await userEvent.click(paragraph(rendered.container, 'B'))
    await waitFor(() => expect(selectedIds(rendered.container)).toEqual(['B', 'C']))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBeNull())
    expect(parentBlockId(rendered.container, 'C')).toBeNull()
    expect(parentBlockId(rendered.container, 'D')).toBe('C')
    expect(parentBlockId(rendered.container, 'E')).toBe('C')
    expect(onDocumentChange).toHaveBeenCalledTimes(1)

    await userEvent.click(paragraph(rendered.container, 'B'))
    await userEvent.keyboard(modShortcut('z'))
    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBe('P'))
    expect(parentBlockId(rendered.container, 'C')).toBe('P')
    expect(parentBlockId(rendered.container, 'D')).toBe('P')
    expect(parentBlockId(rendered.container, 'E')).toBe('P')
  })

  it('applies an updated controlled Outdent behavior without remounting the editor', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={outlineDocument()}
        outline={{ outdentBehavior: 'logical' }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="C"]')).not.toBeNull())

    rendered.rerender(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={outlineDocument()}
        outline={{ outdentBehavior: 'traditional' }}
      />,
    )
    await userEvent.click(paragraph(rendered.container, 'B'))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBeNull())
    expect(parentBlockId(rendered.container, 'C')).toBe('B')
  })

  it('uses the selected blocks for Logical Outdent from Shift-Tab', async () => {
    const rendered = render(<Editor adapters={adapters} mode={EditorMode.Outline} initialContent={outlineDocument()} />)
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="D"]')).not.toBeNull())

    await userEvent.click(marker(rendered.container, 'B'), { modifiers: ['Meta'] })
    await userEvent.click(marker(rendered.container, 'D'), { modifiers: ['Meta'] })
    await userEvent.click(paragraph(rendered.container, 'B'))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    await waitFor(() => expect(parentBlockId(rendered.container, 'B')).toBeNull())
    expect(parentBlockId(rendered.container, 'D')).toBeNull()
    expect(parentBlockId(rendered.container, 'C')).toBe('P')
  })

  it('keeps the active block and page viewport stable when Shift-Tab changes its level', async () => {
    const precedingBlocks = Array.from({ length: 20 }, (_, index) => block(`Before ${index}`))
    const followingBlocks = Array.from({ length: 30 }, (_, index) => block(`After ${index}`))
    const rendered = render(
      <div {...stylex.props(testLayoutStyles.fixedEditorViewport)}>
        <Editor
          adapters={adapters}
          mode={EditorMode.Outline}
          initialContent={{
            type: 'doc',
            content: [...precedingBlocks, block('Parent', [block('Target')]), ...followingBlocks],
          }}
        />
      </div>,
    )
    await waitFor(() => expect(blockElement(rendered.container, 'Target')).toBeInTheDocument())

    const targetParagraph = paragraph(rendered.container, 'Target')
    targetParagraph.scrollIntoView({ block: 'center' })
    await userEvent.click(targetParagraph)
    const pageScrollBefore = window.scrollY
    const targetTopBefore = blockElement(rendered.container, 'Target').getBoundingClientRect().top

    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await waitFor(() => expect(parentBlockId(rendered.container, 'Target')).toBeNull())

    expect(window.scrollY - pageScrollBefore).toBe(0)
    expect(selectedDomBlockId()).toBe('Target')
    const targetTopDelta = blockElement(rendered.container, 'Target').getBoundingClientRect().top - targetTopBefore
    expect(Math.abs(targetTopDelta)).toBeLessThanOrEqual(1)
  })

  it('blocks non-contiguous Traditional Outdent from Shift-Tab without changing the document', async () => {
    const onDocumentChange = vi.fn()
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={outlineDocument()}
        outline={{ defaultOutdentBehavior: 'traditional' }}
        onDocumentChange={onDocumentChange}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="D"]')).not.toBeNull())

    await userEvent.click(marker(rendered.container, 'B'), { modifiers: ['Meta'] })
    await userEvent.click(marker(rendered.container, 'D'), { modifiers: ['Meta'] })
    await userEvent.click(page.getByText('B', { exact: true }))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    expect(parentBlockId(rendered.container, 'B')).toBe('P')
    expect(parentBlockId(rendered.container, 'D')).toBe('P')
    expect(selectedIds(rendered.container)).toEqual(['B', 'D'])
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('disables Outdent when a selected block would cross the current Focus root', async () => {
    const onDocumentChange = vi.fn()
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{ type: 'doc', content: [block('F', [block('A', [block('B')])])] }}
        outline={{ defaultFocus: { blockId: 'F' } }}
        onDocumentChange={onDocumentChange}
      />,
    )
    await waitFor(() => expect(blockElement(rendered.container, 'F')).toHaveAttribute('data-outline-focus-root'))

    await userEvent.click(marker(rendered.container, 'A'), { modifiers: ['Meta'] })
    await userEvent.click(paragraph(rendered.container, 'A'))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')

    expect(parentBlockId(rendered.container, 'A')).toBe('F')
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('keeps task controls interactive instead of treating them as Outline markers', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
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
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Task item' }] }],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('button[data-task-status-control][data-status="todo"]')).not.toBeNull())

    await userEvent.click(rendered.container.querySelector('button[data-task-status-control][data-status="todo"]')!)

    await waitFor(() => expect(rendered.container.querySelector('button[data-task-status-control][data-status="doing"]')).toHaveAttribute('aria-pressed', 'false'))
    expect(blockElement(rendered.container, 'Task')).not.toHaveAttribute('data-outline-focus-root')
  })

  it('keeps toggle controls interactive instead of treating them as Outline markers', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [blockWithBody(
            'Toggle',
            { type: 'paragraph', content: [{ type: 'text', text: 'Toggle item' }] },
            [block('Child')],
            'toggle',
          )],
        }}
      />,
    )
    await rendered.findByText('Child')

    await userEvent.click(marker(rendered.container, 'Toggle'))

    await waitFor(() => expect(blockElement(rendered.container, 'Toggle')).toHaveAttribute('data-list-collapsed'))
    expect(rendered.getByText('Child')).not.toBeVisible()
    expect(blockElement(rendered.container, 'Toggle')).not.toHaveAttribute('data-outline-focus-root')
  })

  it('navigates table cells with Tab and Shift-Tab without changing the Outline tree', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Outline}
        initialContent={{
          type: 'doc',
          content: [blockWithBody(
            'Parent',
            { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
            [blockWithBody('Table', table())],
          )],
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
