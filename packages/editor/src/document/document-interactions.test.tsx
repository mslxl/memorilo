import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it, vi } from 'vitest'
import { EditorModeHarness } from '../../test/browser/editor-mode-harness'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, redoShortcut, userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import {
  adapters,
  documentBlock,
  paragraph,
} from './document-interactions.fixture'

describe('document interactions', () => {
  it('preserves task attributes when serializing mixed list types to clipboard HTML', async () => {
    const taskBlock = (id: string, text: string, status: 'todo' | 'doing' | 'done') => ({
      type: 'list' as const,
      attrs: {
        blockId: id,
        checked: status === 'done',
        collapsed: false,
        elapsedMs: 0,
        kind: 'task' as const,
        order: null,
        startedAt: null,
        status,
      },
      content: [paragraph(text)],
    })
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('bullet-before', paragraph('Bullet before'), 'bullet'),
            taskBlock('task-todo', 'Task todo', 'todo'),
            documentBlock('ordered-middle', paragraph('Ordered middle'), 'ordered', []),
            taskBlock('task-doing', 'Task doing', 'doing'),
            documentBlock('bullet-after', paragraph('Bullet after'), 'bullet'),
            taskBlock('task-done', 'Task done', 'done'),
          ],
        }}
      />,
    )
    await rendered.findByText('Bullet before')
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(rendered.getByText('Bullet before'))
    await userEvent.keyboard(modShortcut('a'))

    const clipboardData = new DataTransfer()
    fireEvent(editor, new ClipboardEvent('copy', { bubbles: true, clipboardData }))

    const document = new DOMParser().parseFromString(clipboardData.getData('text/html'), 'text/html')
    expect([...document.querySelectorAll('li.prosemirror-flat-list')].map(list => ({
      kind: list.getAttribute('data-list-kind'),
      status: list.getAttribute('data-task-status'),
      text: list.textContent,
    }))).toEqual([
      { kind: 'bullet', status: null, text: 'Bullet before' },
      { kind: 'task', status: 'todo', text: 'Task todo' },
      { kind: 'ordered', status: null, text: 'Ordered middle' },
      { kind: 'task', status: 'doing', text: 'Task doing' },
      { kind: 'bullet', status: null, text: 'Bullet after' },
      { kind: 'task', status: 'done', text: 'Task done' },
    ])
  })

  it('only replaces images added by the current network paste', async () => {
    let resolveImport!: (source: string) => void
    const importNetworkImage = vi.fn(() => new Promise<string>((resolve) => {
      resolveImport = resolve
    }))
    const rendered = render(
      <Editor
        adapters={{ ...adapters, importNetworkImage, networkImagePasteBehavior: 'download' }}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [
            documentBlock('existing', {
              type: 'image',
              attrs: { src: 'https://example.com/image.png' },
            }),
            documentBlock('before', paragraph('Before')),
          ],
        }}
      />,
    )
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(rendered.getByText('Before'))
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', '<img src="https://example.com/image.png">')
    clipboardData.setData('text/plain', 'https://example.com/image.png')
    fireEvent(editor, new ClipboardEvent('paste', { bubbles: true, clipboardData }))

    await waitFor(() => {
      expect(editor.querySelectorAll('img')).toHaveLength(2)
      expect(importNetworkImage).toHaveBeenCalledOnce()
    })
    await act(async () => {
      resolveImport('memory://downloaded-image')
      await Promise.resolve()
    })
    await waitFor(() => {
      expect([...editor.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([
        'https://example.com/image.png',
        'memory://downloaded-image',
      ])
    })
  })

  it('applies a completed network import when an undone paste is redone', async () => {
    let resolveImport!: (source: string) => void
    const importNetworkImage = vi.fn(() => new Promise<string>((resolve) => {
      resolveImport = resolve
    }))
    const rendered = render(
      <Editor
        adapters={{ ...adapters, importNetworkImage, networkImagePasteBehavior: 'download' }}
        mode={EditorMode.Document}
        initialContent={{ type: 'doc', content: [documentBlock('before', paragraph('Before'))] }}
      />,
    )
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(rendered.getByText('Before'))
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'https://example.com/image.png')
    fireEvent(editor, new ClipboardEvent('paste', { bubbles: true, clipboardData }))
    await waitFor(() => expect(editor.querySelector('img')).not.toBeNull())

    await userEvent.keyboard(modShortcut('z'))
    await waitFor(() => expect(editor.querySelector('img')).toBeNull())
    await act(async () => {
      resolveImport('memory://downloaded-image')
      await Promise.resolve()
    })
    await userEvent.keyboard(redoShortcut())

    await waitFor(() => expect(editor.querySelector('img')).toHaveAttribute('src', 'memory://downloaded-image'))
  })

  it.each([
    { behavior: 'download', expectedSource: 'memory://downloaded-image', uploadCount: 1 },
    { behavior: 'url', expectedSource: 'https://example.com/image.png', uploadCount: 0 },
  ] as const)('$behavior policy handles a pasted network image URL', async ({ behavior, expectedSource, uploadCount }) => {
    const importNetworkImage = vi.fn(async () => 'memory://downloaded-image')
    const rendered = render(
      <Editor
        adapters={{ ...adapters, importNetworkImage, networkImagePasteBehavior: behavior }}
        mode={EditorMode.Document}
        initialContent={{ type: 'doc', content: [documentBlock('before', paragraph('Before'))] }}
      />,
    )
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(rendered.getByText('Before'))
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', '<img src="https://example.com/image.png">')
    clipboardData.setData('text/plain', 'https://example.com/image.png')
    fireEvent(editor, new ClipboardEvent('paste', { bubbles: true, clipboardData }))

    await waitFor(() => expect(editor.querySelector('img')).toHaveAttribute('src', expectedSource))
    expect(importNetworkImage).toHaveBeenCalledTimes(uploadCount)
  })

  it.each([
    { behavior: 'download', expectedSource: 'memory://downloaded-image', importCount: 1 },
    { behavior: 'url', expectedSource: 'https://example.com/image.png', importCount: 0 },
  ] as const)('$behavior policy handles a pure pasted network image URL', async ({ behavior, expectedSource, importCount }) => {
    const importNetworkImage = vi.fn(async () => 'memory://downloaded-image')
    const rendered = render(
      <Editor
        adapters={{ ...adapters, importNetworkImage, networkImagePasteBehavior: behavior }}
        mode={EditorMode.Document}
        initialContent={{ type: 'doc', content: [documentBlock('before', paragraph('Before'))] }}
      />,
    )
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(rendered.getByText('Before'))
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'https://example.com/image.png')
    fireEvent(editor, new ClipboardEvent('paste', { bubbles: true, clipboardData }))

    await waitFor(() => expect(editor.querySelector('img')).toHaveAttribute('src', expectedSource))
    expect(importNetworkImage).toHaveBeenCalledTimes(importCount)
  })

  it('leaves pasted image files to the local image uploader', async () => {
    const importNetworkImage = vi.fn(async () => 'memory://downloaded-image')
    const rendered = render(
      <Editor
        adapters={{ ...adapters, importNetworkImage, networkImagePasteBehavior: 'download' }}
        mode={EditorMode.Document}
        initialContent={{ type: 'doc', content: [documentBlock('before', paragraph('Before'))] }}
      />,
    )
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(rendered.getByText('Before'))
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File([Uint8Array.from([1, 2, 3])], 'clipboard.png', { type: 'image/png' }))
    clipboardData.setData('text/html', '<img src="https://example.com/image.png">')
    fireEvent(editor, new ClipboardEvent('paste', { bubbles: true, clipboardData }))

    await waitFor(() => expect(editor.querySelector('img')).toHaveAttribute('src', 'memory://image'))
    expect(importNetworkImage).not.toHaveBeenCalled()
  })

  it('keeps the slash menu working after switching back to Document mode', async () => {
    const rendered = render(
      <EditorModeHarness
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
      />,
    )
    await rendered.findByText('Before')

    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="outline"]')!)
    await waitFor(() => expect(rendered.container.querySelector('[data-editor-mode="outline"]')).not.toBeNull())
    await userEvent.click(rendered.container.querySelector('button[data-editor-mode-control="document"]')!)
    const before = await rendered.findByText('Before')
    const editor = rendered.container.querySelector<HTMLElement>('[data-editor-content]')!
    await userEvent.click(before)
    await userEvent.keyboard('{End}{Enter}/')

    expect(editor).toHaveTextContent('Before/')
    await waitFor(() => expect(rendered.container.querySelector('[data-slash-command="paragraph"]')).not.toBeNull())
    expect(rendered.container.querySelector('[data-slash-command="paragraph"]')).toBeVisible()
    expect(rendered.container.querySelector('[data-slash-command="blockquote"]')).toBeVisible()
  })

  it('moves the slash menu highlight with ArrowDown in Document mode', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
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

  it('filters slash commands from user input and runs the remaining result with Enter', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
      />,
    )
    await rendered.findByText('Before')
    await userEvent.click(page.getByText('Before', { exact: true }))

    await userEvent.keyboard('{End}{Enter}/quote')

    expect(rendered.container.querySelector('[data-slash-command="blockquote"]')).toBeVisible()
    expect(rendered.container.querySelector('[data-slash-command="paragraph"]')).toHaveAttribute('hidden')
    expect(rendered.container.querySelector('[data-slash-command="heading-1"]')).toHaveAttribute('hidden')

    await userEvent.keyboard('{Enter}')

    expect(rendered.container.querySelectorAll('blockquote')).toHaveLength(1)
    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).not.toHaveTextContent('/quote')
  })

  it('searches slash commands by aliases such as h1', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
      />,
    )
    await rendered.findByText('Before')
    await userEvent.click(page.getByText('Before', { exact: true }))

    await userEvent.keyboard('{End}{Enter}/h1')

    expect(rendered.container.querySelector('[data-slash-command="heading-1"]')).toBeVisible()
    expect(rendered.container.querySelector('[data-slash-command="heading-2"]')).toHaveAttribute('hidden')

    await userEvent.keyboard('{Enter}')

    expect(rendered.container.querySelectorAll('h1')).toHaveLength(1)
    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).not.toHaveTextContent('/h1')
  })

  it('creates inline math when the user types a dollar-delimited expression', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
      />,
    )
    await rendered.findByText('Before')
    await userEvent.click(page.getByText('Before', { exact: true }))

    await userEvent.keyboard('{End} $E=mc^2$')

    const inlineMath = rendered.container.querySelector('.prosemirror-math-inline')
    expect(inlineMath).toHaveTextContent('E=mc^2')
    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).not.toHaveTextContent('$E=mc^2$')
  })

  it('creates editable inline math when the user types double dollar followed by Space', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
      />,
    )
    await rendered.findByText('Before')
    await userEvent.click(page.getByText('Before', { exact: true }))

    await userEvent.keyboard('{End} $$ ')

    expect(rendered.container.querySelectorAll('.prosemirror-math-inline')).toHaveLength(1)
    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).not.toHaveTextContent('$$')

    await userEvent.keyboard('x^2')

    expect(rendered.container.querySelector('.prosemirror-math-inline')).toHaveTextContent('x^2')
  })

  it('creates inline math from a filtered slash command', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
      />,
    )
    await rendered.findByText('Before')
    await userEvent.click(page.getByText('Before', { exact: true }))
    await userEvent.keyboard('{End}{Enter}/inline')

    await waitFor(() => expect(rendered.container.querySelector('[data-slash-command="inline-math"]')).not.toBeNull())
    const inlineMathOption = rendered.container.querySelector<HTMLElement>('[data-slash-command="inline-math"]')!
    expect(inlineMathOption).toBeVisible()
    await userEvent.click(inlineMathOption)

    expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).not.toHaveTextContent('/inline')
    expect(rendered.container.querySelectorAll('.prosemirror-math-inline')).toHaveLength(1)

    await userEvent.keyboard('x^2')

    expect(rendered.container.querySelector('.prosemirror-math-inline')).toHaveTextContent('x^2')
  })

  it('deletes an empty math block with Backspace and restores an editable paragraph', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={EditorMode.Document}
        initialContent={{
          type: 'doc',
          content: [documentBlock('before', paragraph('Before'))],
        }}
      />,
    )
    await rendered.findByText('Before')
    await userEvent.click(page.getByText('Before', { exact: true }))

    await userEvent.keyboard('{End}{Enter}$$')
    await userEvent.keyboard('{Enter}')

    expect(rendered.container.querySelectorAll('.prosemirror-math-block')).toHaveLength(1)

    await userEvent.keyboard('{Backspace}After')

    expect(rendered.container.querySelectorAll('.prosemirror-math-block')).toHaveLength(0)
    expect(rendered.getByText('After')).toBeVisible()
  })
})
