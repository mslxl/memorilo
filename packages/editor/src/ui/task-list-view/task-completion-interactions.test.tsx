import type { NodeJSON } from 'prosekit/core'
import type { EditorAdapters } from '../../adapters/editor-adapters'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { isApple } from 'prosekit/core'
import { describe, expect, it, vi } from 'vitest'
import { EditorTestHarness as Editor } from '../../../test/browser/editor-test-harness'
import { userEvent } from '../../../test/browser/user-event'

function recurringTask(blockId: string, status: 'doing' | 'done' = 'doing'): NodeJSON {
  return {
    attrs: {
      blockId,
      checked: status === 'done',
      collapsed: false,
      schedule: { date: '2026-08-18', kind: 'deadline', time: null },
      elapsedMs: 100,
      kind: 'task',
      order: null,
      repeatRule: { interval: 1, mode: 'due', unit: 'day' },
      startedAt: status === 'doing' ? 1 : null,
      status,
    },
    content: [{ content: [{ text: 'Recurring task', type: 'text' }], type: 'paragraph' }],
    type: 'list',
  }
}

function editorAdapters(
  completeRecurring: (input: { blockId: string }) => Promise<void>,
): EditorAdapters {
  return {
    tagStorage: {
      create: async tag => tag,
      search: async () => [],
      update: async tag => tag,
    },
    taskActions: { completeRecurring },
    uploadImage: async () => 'memory://image',
  }
}

function renderRecurringTask(completeRecurring: (input: { blockId: string }) => Promise<void>) {
  return render(
    <Editor
      adapters={editorAdapters(completeRecurring)}
      initialContent={{ content: [recurringTask('recurring-task')], type: 'doc' }}
      taskDate="2026-08-18"
    />,
  )
}

function renderCompletedRecurringTask(completeRecurring: (input: { blockId: string }) => Promise<void>) {
  return render(
    <Editor
      adapters={editorAdapters(completeRecurring)}
      initialContent={{ content: [recurringTask('completed-recurring-task', 'done')], type: 'doc' }}
      taskDate="2026-08-18"
    />,
  )
}

describe('recurring task completion entry points', () => {
  it('uses the recurring completion adapter from the task status button', async () => {
    const completeRecurring = vi.fn(async () => undefined)
    const rendered = renderRecurringTask(completeRecurring)
    await rendered.findByText('Recurring task')
    const status = rendered.container.querySelector<HTMLButtonElement>('button[data-status="doing"]')
    if (!status)
      throw new Error('Recurring task status button was not rendered')

    fireEvent.click(status)

    await waitFor(() => expect(completeRecurring).toHaveBeenCalledWith({ blockId: 'recurring-task' }))
    expect(completeRecurring).toHaveBeenCalledOnce()
  })

  it('uses the recurring completion adapter from Cmd/Ctrl+Enter', async () => {
    const completeRecurring = vi.fn(async () => undefined)
    const rendered = renderRecurringTask(completeRecurring)
    await rendered.findByText('Recurring task')

    await userEvent.click(page.getByText('Recurring task', { exact: true }))
    fireEvent.keyDown(rendered.getByRole('textbox', { name: 'Editor content' }), {
      ctrlKey: !isApple,
      key: 'Enter',
      metaKey: isApple,
    })

    await waitFor(() => expect(completeRecurring).toHaveBeenCalledWith({ blockId: 'recurring-task' }))
    expect(completeRecurring).toHaveBeenCalledOnce()
  })

  it('uses the recurring completion adapter from the task status context menu', async () => {
    const completeRecurring = vi.fn(async () => undefined)
    const rendered = renderRecurringTask(completeRecurring)
    await rendered.findByText('Recurring task')

    const status = rendered.container.querySelector<HTMLButtonElement>('button[data-status="doing"]')
    if (!status)
      throw new Error('Recurring task status button was not rendered')
    fireEvent.contextMenu(status)
    fireEvent.click(await rendered.findByRole('button', { name: 'Complete and schedule next' }))

    await waitFor(() => expect(completeRecurring).toHaveBeenCalledWith({ blockId: 'recurring-task' }))
    expect(completeRecurring).toHaveBeenCalledOnce()
  })

  it('repairs a completed recurring task from the task status button', async () => {
    const completeRecurring = vi.fn(async () => undefined)
    const rendered = renderCompletedRecurringTask(completeRecurring)
    await rendered.findByText('Recurring task')
    const status = rendered.container.querySelector<HTMLButtonElement>('button[data-status="done"]')
    if (!status)
      throw new Error('Completed recurring task status button was not rendered')

    fireEvent.click(status)

    await waitFor(() => expect(completeRecurring).toHaveBeenCalledWith({ blockId: 'completed-recurring-task' }))
    expect(completeRecurring).toHaveBeenCalledOnce()
  })

  it('repairs a completed recurring task from Cmd/Ctrl+Enter', async () => {
    const completeRecurring = vi.fn(async () => undefined)
    const rendered = renderCompletedRecurringTask(completeRecurring)
    await rendered.findByText('Recurring task')

    await userEvent.click(page.getByText('Recurring task', { exact: true }))
    fireEvent.keyDown(rendered.getByRole('textbox', { name: 'Editor content' }), {
      ctrlKey: !isApple,
      key: 'Enter',
      metaKey: isApple,
    })

    await waitFor(() => expect(completeRecurring).toHaveBeenCalledWith({ blockId: 'completed-recurring-task' }))
    expect(completeRecurring).toHaveBeenCalledOnce()
  })
})
