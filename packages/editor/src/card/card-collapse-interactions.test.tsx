import { act, render, waitFor, within } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { placeCaretAtStart, userEvent } from '../../test/browser/user-event'
import {
  adapters,
  block,
  paragraph,
} from './card-authoring-interactions.fixture'

describe('card authoring interactions', () => {
  it('collapses a one-answer SetCard back to one line on Backspace at the answer start', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{
            type: 'list',
            attrs: { blockId: 'set-question', checked: false, collapsed: false, kind: 'outline', order: null },
            content: [{
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: null,
                    definitionId: 'set-definition',
                    direction: 'forward',
                    forwardCardId: 'set-forward-card',
                  },
                },
              ],
            }, {
              type: 'list',
              attrs: {
                blockId: 'set-answer',
                cardItemDefinitionId: 'set-definition',
                checked: false,
                collapsed: false,
                kind: 'bullet',
                order: null,
              },
              content: [paragraph('Answer')],
            }],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="set-answer"]')).not.toBeNull())
    const answer = rendered.container.querySelector<HTMLElement>('[data-block-id="set-answer"] > .list-content > p')
    if (!answer)
      throw new Error('SetCard answer paragraph was not rendered')
    await placeCaretAtStart(answer)

    await userEvent.keyboard('{Backspace}')

    await waitFor(() => {
      const sourceParagraph = rendered.container.querySelector('[data-block-id="set-question"] > .list-content > p')
      expect(sourceParagraph).toHaveTextContent('Question→Answer')
      expect(rendered.container.querySelector('[data-block-id="set-answer"]')).toBeNull()
      expect(rendered.container.querySelector('[data-card-item-definition-id="set-definition"]')).toBeNull()
    })
    const delimiter = rendered.container.querySelector('[data-card-delimiter]')
    expect(delimiter).toHaveAttribute('data-card-definition-id', 'set-definition')
    expect(delimiter).toHaveAttribute('data-forward-card-id', 'set-forward-card')
    expect(delimiter).not.toHaveClass('card-delimiter-multiline')
  })

  it('preserves the answer Block Highlight and task history when collapsing a SetCard to one line', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{
            type: 'list',
            attrs: { blockId: 'set-question', checked: false, collapsed: false, kind: 'outline', order: null },
            content: [{
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: null,
                    definitionId: 'set-definition',
                    direction: 'forward',
                    forwardCardId: 'set-forward-card',
                  },
                },
              ],
            }, {
              type: 'list',
              attrs: {
                blockHighlight: 'blue',
                blockId: 'set-answer',
                cardItemDefinitionId: 'set-definition',
                checked: false,
                collapsed: false,
                kind: 'bullet',
                order: null,
              },
              content: [{
                type: 'paragraph',
                attrs: { taskHistory: { elapsedMs: 900, status: 'doing' } },
                content: [{ type: 'text', text: 'Answer' }],
              }],
            }],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="set-answer"]')).not.toBeNull())
    const answer = rendered.container.querySelector<HTMLElement>('[data-block-id="set-answer"] > .list-content > p')
    if (!answer)
      throw new Error('Highlighted SetCard answer paragraph was not rendered')
    await placeCaretAtStart(answer)
    await userEvent.keyboard('{Backspace}')

    await waitFor(() => {
      const source = rendered.container.querySelector('[data-block-id="set-question"]')
      expect(source).toHaveAttribute('data-block-highlight', 'blue')
      expect(source).toHaveTextContent('Question→Answer')
      const sourceParagraph = source?.querySelector(':scope > .list-content > p')
      const taskHistory = sourceParagraph?.getAttribute('data-task-history')
      if (!taskHistory)
        throw new Error('Collapsed SetCard source paragraph did not preserve task history')
      expect(JSON.parse(taskHistory)).toEqual({ elapsedMs: 900, status: 'doing' })
      expect(rendered.container.querySelector('[data-block-id="set-answer"]')).toBeNull()
    })
  })

  it('keeps a SetCard unchanged when Source and Answer Block Highlights cannot be merged without data loss', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{
            type: 'list',
            attrs: {
              blockHighlight: 'yellow',
              blockId: 'set-question',
              checked: false,
              collapsed: false,
              kind: 'outline',
              order: null,
            },
            content: [{
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: null,
                    definitionId: 'set-definition',
                    direction: 'forward',
                    forwardCardId: 'set-forward-card',
                  },
                },
              ],
            }, {
              type: 'list',
              attrs: {
                blockHighlight: 'blue',
                blockId: 'set-answer',
                cardItemDefinitionId: 'set-definition',
                checked: false,
                collapsed: false,
                kind: 'bullet',
                order: null,
              },
              content: [paragraph('Answer')],
            }],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="set-answer"]')).not.toBeNull())
    const answer = rendered.container.querySelector<HTMLElement>('[data-block-id="set-answer"] > .list-content > p')
    if (!answer)
      throw new Error('Conflicting Highlight SetCard answer paragraph was not rendered')
    await placeCaretAtStart(answer)
    await userEvent.keyboard('{Backspace}')

    const source = rendered.container.querySelector('[data-block-id="set-question"]')
    const answerBlock = rendered.container.querySelector('[data-block-id="set-answer"]')
    expect(source).toHaveAttribute('data-block-highlight', 'yellow')
    expect(source).toHaveTextContent('Question→')
    expect(answerBlock).toHaveAttribute('data-block-highlight', 'blue')
    expect(answerBlock).toHaveAttribute('data-card-item-definition-id', 'set-definition')
    expect(answerBlock).toHaveTextContent('Answer')
  })

  it.each(['outline', 'task', 'toggle'] as const)('collapses a %s SetCard member because every non-ordered member is a Set answer', async (kind) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{
            type: 'list',
            attrs: { blockId: 'set-question', checked: false, collapsed: false, kind: 'outline', order: null },
            content: [{
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: null,
                    definitionId: 'set-definition',
                    direction: 'forward',
                    forwardCardId: 'set-forward-card',
                  },
                },
              ],
            }, {
              type: 'list',
              attrs: {
                blockId: 'set-answer',
                cardItemDefinitionId: 'set-definition',
                checked: kind === 'task',
                collapsed: false,
                kind,
                order: null,
                ...(kind === 'task' ? { elapsedMs: 1200, startedAt: null, status: 'done' } : {}),
              },
              content: [paragraph('Answer')],
            }],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="set-answer"]')).not.toBeNull())
    const answer = rendered.container.querySelector<HTMLElement>('[data-block-id="set-answer"] > .list-content > p')
    if (!answer)
      throw new Error(`${kind} SetCard answer paragraph was not rendered`)
    await placeCaretAtStart(answer)
    await userEvent.keyboard('{Backspace}')

    await waitFor(() => {
      const sourceParagraph = rendered.container.querySelector('[data-block-id="set-question"] > .list-content > p')
      expect(sourceParagraph).toHaveTextContent('Question→Answer')
      if (kind === 'task')
        expect(sourceParagraph).toHaveAttribute('data-task-history', JSON.stringify({ status: 'done', elapsedMs: 1200 }))
      expect(rendered.container.querySelector('[data-block-id="set-answer"]')).toBeNull()
    })
  })

  it('collapses a heading Bidirectional SetCard without changing either CardID and keeps the cursor at the answer end', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{
            type: 'list',
            attrs: { blockId: 'set-question', checked: false, collapsed: false, kind: 'outline', order: null },
            content: [{
              type: 'heading',
              attrs: { level: 2 },
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: 'set-backward-card',
                    definitionId: 'set-definition',
                    direction: 'both',
                    forwardCardId: 'set-forward-card',
                  },
                },
              ],
            }, {
              type: 'list',
              attrs: {
                blockId: 'set-answer',
                cardItemDefinitionId: 'set-definition',
                checked: false,
                collapsed: false,
                kind: 'bullet',
                order: null,
              },
              content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Answer' }] }],
            }],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-block-id="set-answer"]')).not.toBeNull())
    const answer = rendered.container.querySelector<HTMLElement>('[data-block-id="set-answer"] > .list-content > h2')
    if (!answer)
      throw new Error('Heading SetCard answer was not rendered')
    await placeCaretAtStart(answer)
    await userEvent.keyboard('{Backspace}!')

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-block-id="set-question"] > .list-content > h2')).toHaveTextContent('Question↔Answer!')
      expect(rendered.container.querySelector('[data-block-id="set-answer"]')).toBeNull()
    })
    const delimiter = rendered.container.querySelector('[data-card-delimiter]')
    expect(delimiter).toHaveAttribute('data-card-definition-id', 'set-definition')
    expect(delimiter).toHaveAttribute('data-forward-card-id', 'set-forward-card')
    expect(delimiter).toHaveAttribute('data-backward-card-id', 'set-backward-card')
  })

  it('opens Preview from the Card hover control rather than the options menu', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [block('capital', {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Capital of France' },
              {
                type: 'cardDelimiter',
                attrs: {
                  backwardCardId: null,
                  definitionId: 'capital-definition',
                  direction: 'forward',
                  forwardCardId: 'capital-forward',
                },
              },
              { type: 'text', text: 'Paris' },
            ],
          })],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-card-delimiter]')).not.toBeNull())
    await userEvent.hover(page.getByText('Capital of France', { exact: false }))
    await waitFor(() => expect(rendered.container.querySelector('button[data-card-control="preview"]')).not.toBeNull())
    const previewButton = rendered.container.querySelector<HTMLButtonElement>('button[data-card-control="preview"]')!
    await waitFor(() => {
      expect(previewButton).toBeVisible()
      expect(rendered.container.querySelector('button[data-card-control="options"]')).toBeVisible()
    })

    await userEvent.click(previewButton)

    await waitFor(() => expect(rendered.baseElement.querySelector('[data-card-preview-dialog]')).not.toBeNull())
    const preview = rendered.baseElement.querySelector<HTMLElement>('[data-card-preview-dialog]')!
    expect(rendered.baseElement.querySelector('[data-card-options-dialog]')).toBeNull()
    expect(rendered.container.querySelector('[data-block-id="capital"]')).toHaveAttribute('data-card-scope-active')
    expect(rendered.container.querySelectorAll('[data-card-scope-active]')).toHaveLength(1)
    expect(within(preview).getByText('Capital of France')).toBeInTheDocument()
    expect(within(preview).getByText('Paris')).not.toBeVisible()
    const previewSurface = preview.querySelector<HTMLElement>('[data-card-id]')
    if (!previewSurface)
      throw new Error('Card Preview surface was not rendered')
    const previewEditor = previewSurface.querySelector('.ProseMirror')
    if (!previewEditor)
      throw new Error('Card Preview did not mount a ProseMirror Editor')

    await act(async () => {
      await userEvent.click(preview.querySelector('button[data-card-action="reveal-answer"]')!)
    })
    await waitFor(() => expect(
      previewSurface.querySelector('[data-card-review-hidden]'),
    ).toBeNull())
    expect(previewSurface).toHaveTextContent('Paris')
    expect(previewSurface.querySelector('.ProseMirror')).toBe(previewEditor)

    await act(async () => {
      await userEvent.keyboard('{Escape}')
    })
    await waitFor(() => {
      expect(rendered.baseElement.querySelector('[data-card-preview-dialog]')).toBeNull()
      expect(rendered.container.querySelector('[data-card-scope-active]')).toBeNull()
    })
  })
})
