import { render, waitFor, within } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import {
  adapters,
  block,
  openInlineMathSource,
  paragraph,
  selectTextRange,
} from './card-authoring-interactions.fixture'

function cardSurface(root: HTMLElement): HTMLElement {
  const surface = root.querySelector<HTMLElement>('[data-card-id]')
  if (!surface)
    throw new Error('Card Preview surface was not rendered')
  return surface
}

describe('card authoring interactions', () => {
  it.each([
    { direction: 'forward', mode: EditorMode.Document, modeName: 'Document', symbol: '→', trigger: '：-》' },
    { direction: 'backward', mode: EditorMode.Document, modeName: 'Document', symbol: '←', trigger: '：-《' },
    { direction: 'both', mode: EditorMode.Document, modeName: 'Document', symbol: '↔', trigger: '：《》' },
    { direction: 'forward', mode: EditorMode.Outline, modeName: 'Outline', symbol: '→', trigger: '：-》' },
    { direction: 'backward', mode: EditorMode.Outline, modeName: 'Outline', symbol: '←', trigger: '：-《' },
    { direction: 'both', mode: EditorMode.Outline, modeName: 'Outline', symbol: '↔', trigger: '：《》' },
  ] as const)('creates a $direction Basic Card from $trigger in $modeName mode', async ({ direction, mode, symbol, trigger }) => {
    const rendered = render(
      <Editor
        adapters={adapters}
        mode={mode}
        initialContent={{ type: 'doc', content: [block('question', paragraph('Question'))] }}
      />,
    )
    await rendered.findByText('Question')

    await userEvent.click(rendered.getByText('Question'))
    await userEvent.keyboard(`{End}${trigger} `)

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-card-delimiter]')).toHaveAttribute('data-card-direction', direction)
      expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).toHaveTextContent(`Question${symbol}`)
      expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).not.toHaveTextContent(trigger)
    })
  })

  it('inserts Basic, Reverse, and Bidirectional Cards from the ordinary slash menu', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{ type: 'doc', content: [block('question', paragraph('Question'))] }}
      />,
    )
    await rendered.findByText('Question')

    await userEvent.click(rendered.getByText('Question'))
    await userEvent.keyboard('{End}{Enter}/')

    await waitFor(() => expect(rendered.container.querySelector('[data-slash-command="basic-card"]')).not.toBeNull())
    expect(rendered.container.querySelector('[data-slash-command="basic-card"]')).toBeVisible()
    expect(rendered.container.querySelector('[data-slash-command="reverse-card"]')).toBeVisible()
    expect(rendered.container.querySelector('[data-slash-command="bidirectional-card"]')).toBeVisible()

    await userEvent.click(rendered.container.querySelector('[data-slash-command="basic-card"]')!)

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-card-delimiter]')).toHaveAttribute('data-card-direction', 'forward')
      expect(rendered.container.querySelector<HTMLElement>('[data-editor-content]')!).toHaveTextContent('Question→')
    })
  })

  it('applies Cloze from the selection bubble menu without a separate New Cloze Card action', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{ type: 'doc', content: [block('fact', paragraph('Euler identity'))] }}
      />,
    )
    await rendered.findByText('Euler identity')

    await userEvent.click(rendered.getByText('Euler identity'))
    await userEvent.keyboard(modShortcut('a'))

    const cloze = rendered.container.querySelector<HTMLButtonElement>('button[data-editor-action="cloze"]')!
    expect(rendered.container.querySelector('button[data-card-control="new-cloze"]')).toBeNull()
    await userEvent.click(cloze)

    await waitFor(() => {
      const anchor = rendered.container.querySelector('[data-cloze-group-id]')
      expect(anchor).toHaveTextContent('Euler identity')
      expect(anchor).toHaveAttribute('data-cloze-anchor-kind', 'rich-content')
    })
  })

  it('creates a MathSourceCloze from a selected inline-formula source fragment', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [block('inline-formula', {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Euler: ' },
              { type: 'mathInline', content: [{ type: 'text', text: 'e^{i\\pi} + 1 = 0' }] },
            ],
          })],
        }}
      />,
    )
    await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('.prosemirror-math-inline')
      if (!element)
        throw new Error('Inline formula was not rendered')
      expect(element).toBeVisible()
    })
    const source = await openInlineMathSource(rendered.container)
    await selectTextRange(source, 3, 7)

    await waitFor(() => expect(rendered.baseElement.querySelector('[data-math-cloze-kind]')).not.toBeNull())
    const formulaSelection = rendered.baseElement.querySelector<HTMLElement>('[data-math-cloze-kind]')!
    expect(rendered.baseElement.querySelector('[data-inline-menu="main"]')).toBeNull()
    await userEvent.click(formulaSelection.querySelector('button')!)

    await waitFor(() => {
      const anchor = rendered.container.querySelector('[data-cloze-anchor-kind="math-source"]')
      expect(anchor).toHaveTextContent('i\\pi')
    })
  })

  it('creates a MathSourceCloze from a selected block-formula source fragment', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [
            block('formula-intro', paragraph('Formula:')),
            block('block-formula', {
              type: 'mathBlock',
              content: [{ type: 'text', text: 'e^{i\\pi} + 1 = 0' }],
            }),
          ],
        }}
      />,
    )
    await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('.prosemirror-math-block')
      if (!element)
        throw new Error('Block formula was not rendered')
      expect(element).toBeVisible()
    })
    const source = await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('.prosemirror-math-block .prosemirror-math-source code')
      if (!element)
        throw new Error('Block formula source editor was not rendered')
      expect(element).toBeVisible()
      return element
    })
    await selectTextRange(source, 3, 7)

    await waitFor(() => expect(rendered.baseElement.querySelector('[data-math-cloze-kind]')).not.toBeNull())
    const formulaSelection = rendered.baseElement.querySelector<HTMLElement>('[data-math-cloze-kind]')!
    expect(formulaSelection).toHaveAttribute('data-math-cloze-kind', 'block')
    expect(rendered.baseElement.querySelector('[data-inline-menu="main"]')).toBeNull()
    await userEvent.click(formulaSelection.querySelector('button')!)

    await waitFor(() => {
      const anchor = rendered.container.querySelector('[data-cloze-anchor-kind="math-source"]')
      expect(anchor).toHaveTextContent('i\\pi')
    })
  })

  it('removes an existing MathSourceCloze from the formula selection toolbar', async () => {
    const identity = {
      cardId: 'card-formula',
      definitionId: 'definition-formula',
      groupId: 'group-formula',
    }
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [block('inline-formula', {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Euler: ' },
              {
                type: 'mathInline',
                content: [
                  { type: 'text', text: 'e^{' },
                  {
                    type: 'text',
                    text: 'i\\pi',
                    marks: [{ type: 'cloze', attrs: { anchorKind: 'math-source', ...identity } }],
                  },
                  { type: 'text', text: '} + 1 = 0' },
                ],
              },
            ],
          })],
        }}
      />,
    )
    const formula = await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('.prosemirror-math-inline')
      if (!element)
        throw new Error('Inline formula was not rendered')
      return element
    })
    const display = formula.querySelector<HTMLElement>('.prosemirror-math-display')
    if (!display)
      throw new Error('Inline formula display was not rendered')

    const source = await openInlineMathSource(rendered.container)
    await selectTextRange(source, 3, 7)

    const remove = await rendered.baseElement.querySelector('[data-math-cloze-kind] button')!
    expect(remove).toHaveAttribute('aria-pressed', 'true')
    expect(rendered.baseElement.querySelector('[data-inline-menu="main"]')).toBeNull()
    await userEvent.click(remove)

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-cloze-anchor-kind="math-source"]')).toBeNull()
      expect(source).toHaveTextContent('e^{i\\pi} + 1 = 0')
    })
  })

  it('creates a previewable Card scope when Cloze is applied', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{ type: 'doc', content: [block('fact', paragraph('Euler identity'))] }}
      />,
    )
    await rendered.findByText('Euler identity')

    await userEvent.click(rendered.getByText('Euler identity'))
    await userEvent.keyboard(modShortcut('a'))
    await userEvent.click(await rendered.container.querySelector('button[data-editor-action="cloze"]')!)

    const anchor = await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('[data-cloze-group-id]')
      if (!element)
        throw new Error('Cloze anchor was not rendered')
      return element
    })
    const definitionId = anchor.dataset.clozeDefinitionId
    if (!definitionId)
      throw new Error('Cloze anchor is missing its DefinitionID')
    const source = rendered.container.querySelector<HTMLElement>('[data-block-id="fact"]')
    if (!source)
      throw new Error('Cloze source Block was not rendered')

    expect(source).toHaveAttribute('data-card-definition-scope', definitionId)
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.hover(page.getByText('Euler identity', { exact: true }))
    await waitFor(() => expect(rendered.container.querySelector('button[data-card-control="preview"]')!).toBeVisible())
    expect(rendered.container.querySelector('button[data-card-control="options"]')).toBeNull()

    await userEvent.click(rendered.container.querySelector('button[data-card-control="preview"]')!)
    const dialog = await rendered.findByRole('dialog')
    expect(dialog).toBeVisible()
    expect(dialog.querySelector('[data-card-review-placeholder="cloze"]')!).toBeVisible()
  })

  it('dismisses the selection bubble when Cloze Preview opens', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{ type: 'doc', content: [block('fact', paragraph('Euler identity'))] }}
      />,
    )
    await rendered.findByText('Euler identity')

    await userEvent.click(rendered.getByText('Euler identity'))
    await userEvent.keyboard(modShortcut('a'))
    await userEvent.click(await rendered.container.querySelector('button[data-editor-action="cloze"]')!)

    const source = rendered.container.querySelector<HTMLElement>('[data-block-id="fact"]')
    if (!source)
      throw new Error('Cloze source Block was not rendered')
    await userEvent.hover(source)
    await waitFor(() => expect(rendered.baseElement.querySelector('[data-inline-menu="main"]')).not.toBeNull())

    await userEvent.click(await rendered.container.querySelector('button[data-card-control="preview"]')!)

    expect(await rendered.findByRole('dialog')).toBeVisible()
    expect(rendered.baseElement.querySelector('[data-inline-menu="main"]')).toBeNull()
  })

  it('keeps MathSourceCloze Preview available while an inline formula is rendered', async () => {
    const identity = {
      cardId: 'card-euler-formula',
      definitionId: 'definition-euler-formula',
      groupId: 'group-euler-formula',
    }
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [block('formula', {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Euler identity:' },
              {
                type: 'mathInline',
                content: [
                  { type: 'text', text: 'e^{' },
                  {
                    type: 'text',
                    marks: [{ type: 'cloze', attrs: { anchorKind: 'math-source', ...identity } }],
                    text: 'i\\pi',
                  },
                  { type: 'text', text: '} + 1 = 0' },
                ],
              },
            ],
          })],
        }}
      />,
    )
    await rendered.findByText('Euler identity:')
    const source = rendered.container.querySelector<HTMLElement>('[data-block-id="formula"]')
    if (!source)
      throw new Error('Formula Cloze source Block was not rendered')

    await userEvent.hover(source)
    const preview = await waitFor(() => {
      const control = rendered.container.querySelector<HTMLButtonElement>(
        '[data-block-id="formula"] button[data-card-control="preview"]',
      )
      if (!control)
        throw new Error('MathSourceCloze Preview control was not rendered')
      expect(control).toBeVisible()
      return control
    })

    await userEvent.click(preview)
    const dialog = await rendered.findByRole('dialog')
    expect(dialog).toBeVisible()
    const surface = cardSurface(dialog)
    expect(surface.querySelector('[data-card-hidden-cloze]')).toBeNull()
    expect(surface.querySelector('.prosemirror-math-display')).toHaveAttribute(
      'data-card-review-math-source',
      'e^{\\text{\\ldots}} + 1 = 0',
    )
  })

  it('previews two independent Cloze Cards from one Source Block', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [block('two-clozes', {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                marks: [{
                  type: 'cloze',
                  attrs: {
                    anchorKind: 'rich-content',
                    cardId: 'card-alpha',
                    definitionId: 'definition-alpha',
                    groupId: 'group-alpha',
                  },
                }],
                text: 'Alpha',
              },
              { type: 'text', text: ' and ' },
              {
                type: 'text',
                marks: [{
                  type: 'cloze',
                  attrs: {
                    anchorKind: 'rich-content',
                    cardId: 'card-beta',
                    definitionId: 'definition-beta',
                    groupId: 'group-beta',
                  },
                }],
                text: 'Beta',
              },
            ],
          })],
        }}
      />,
    )
    await rendered.findByText('Alpha')
    const source = rendered.container.querySelector<HTMLElement>('[data-block-id="two-clozes"]')
    if (!source)
      throw new Error('Two-Cloze Source Block was not rendered')
    await userEvent.hover(page.getByText('Alpha', { exact: true }))
    await waitFor(() => expect(rendered.container.querySelectorAll('[data-cloze-card-controls]')).toHaveLength(2))
    for (const definitionId of ['definition-alpha', 'definition-beta']) {
      await waitFor(() => {
        const controlsElement = rendered.container.querySelector<HTMLElement>(`[data-cloze-card-controls="${definitionId}"]`)
        if (!controlsElement)
          throw new Error(`Cloze controls for ${definitionId} were not rendered`)
        expect(controlsElement.querySelector('button[data-card-control="preview"]')!).toBeVisible()
      })
    }

    const currentSource = rendered.container.querySelector<HTMLElement>('[data-block-id="two-clozes"]')
    if (!currentSource)
      throw new Error('Two-Cloze Source Block was replaced unexpectedly')
    const alphaControls = currentSource.querySelector<HTMLElement>('[data-cloze-card-controls="definition-alpha"]')
    const betaControls = currentSource.querySelector<HTMLElement>('[data-cloze-card-controls="definition-beta"]')
    if (!alphaControls || !betaControls)
      throw new Error('Each Cloze definition must render its own Preview controls')
    const alphaPreview = alphaControls.querySelector<HTMLButtonElement>('button[data-card-control="preview"]')!
    const alphaRect = alphaControls.getBoundingClientRect()
    const betaRect = betaControls.getBoundingClientRect()
    expect(Math.min(alphaRect.right, betaRect.right)).toBeLessThanOrEqual(
      Math.max(alphaRect.left, betaRect.left),
    )

    await userEvent.click(alphaPreview)
    const alphaDialog = await rendered.findByRole('dialog')
    expect(alphaDialog.querySelector('[data-card-review-placeholder="cloze"]')!).toBeVisible()
    const alphaSurface = cardSurface(alphaDialog)
    expect(within(alphaSurface).getByText('Beta')).toBeVisible()
    expect(within(alphaSurface).getByText('Alpha')).not.toBeVisible()

    await userEvent.click(alphaDialog.querySelector('button[data-card-action="close-preview"]')!)
    await waitFor(() => expect(rendered.queryByRole('dialog')).toBeNull())
    const currentBetaControls = rendered.container.querySelector<HTMLElement>('[data-cloze-card-controls="definition-beta"]')
    if (!currentBetaControls)
      throw new Error('Beta Cloze controls disappeared after closing Preview')
    await userEvent.click(currentBetaControls.querySelector('button[data-card-control="preview"]')!)
    const betaDialog = await rendered.findByRole('dialog')
    expect(betaDialog.querySelector('[data-card-review-placeholder="cloze"]')!).toBeVisible()
    const betaSurface = cardSurface(betaDialog)
    expect(within(betaSurface).getByText('Alpha')).toBeVisible()
    expect(within(betaSurface).getByText('Beta')).not.toBeVisible()
  })

  it('keeps Basic controls usable when a Cloze shares the Source Block', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [block('basic-and-cloze', {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Question' },
              {
                type: 'cardDelimiter',
                attrs: {
                  backwardCardId: null,
                  definitionId: 'definition-basic',
                  direction: 'forward',
                  forwardCardId: 'card-basic',
                },
              },
              { type: 'text', text: 'Answer with ' },
              {
                type: 'text',
                marks: [{
                  type: 'cloze',
                  attrs: {
                    anchorKind: 'rich-content',
                    cardId: 'card-cloze',
                    definitionId: 'definition-cloze',
                    groupId: 'group-cloze',
                  },
                }],
                text: 'Hint',
              },
            ],
          })],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-card-delimiter]')).not.toBeNull())
    const source = rendered.container.querySelector<HTMLElement>('[data-block-id="basic-and-cloze"]')
    const delimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
    if (!source || !delimiter)
      throw new Error('Basic and Cloze source structure was not rendered')
    await userEvent.hover(page.getByText('Question', { exact: false }))

    await waitFor(() => {
      const currentDelimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
      const clozeControls = rendered.container.querySelector<HTMLElement>('[data-cloze-card-controls="definition-cloze"]')
      if (!currentDelimiter || !clozeControls)
        throw new Error('Shared Source Block controls were not rendered')
      expect(currentDelimiter.querySelector('button[data-card-control="options"]')!).toBeVisible()
      expect(clozeControls.querySelector('button[data-card-control="preview"]')!).toBeVisible()
      expect(clozeControls.querySelector('button[data-card-control="options"]')).toBeNull()
    })

    const currentDelimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
    if (!currentDelimiter)
      throw new Error('Basic delimiter disappeared before opening Card options')
    await userEvent.click(currentDelimiter.querySelector('button[data-card-control="options"]')!)
    await waitFor(() => expect(rendered.baseElement.querySelector('[data-card-options-dialog]')).not.toBeNull())
    expect(rendered.baseElement.querySelector('[data-card-options-dialog]')).toBeVisible()
    expect(rendered.baseElement.querySelector('[data-card-direction-choice="forward"]')!).toHaveAttribute('aria-checked', 'true')
    const selectedDelimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
    if (!selectedDelimiter)
      throw new Error('Basic delimiter disappeared while Card options were open')
    await userEvent.click(selectedDelimiter)
    await userEvent.hover(page.getByText('Question', { exact: false }))
    const previewDelimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
    if (!previewDelimiter)
      throw new Error('Basic delimiter disappeared before opening Preview')
    await userEvent.click(previewDelimiter.querySelector('button[data-card-control="preview"]')!)
    const basicDialog = await rendered.findByRole('dialog')
    expect(basicDialog).toHaveAttribute('data-card-preview-dialog', '')
    expect(cardSurface(basicDialog)).toHaveAttribute('data-card-id', 'card-basic')
    await userEvent.click(basicDialog.querySelector('button[data-card-action="close-preview"]')!)
    await waitFor(() => expect(rendered.queryByRole('dialog')).toBeNull())

    const currentClozeControls = rendered.container.querySelector<HTMLElement>('[data-cloze-card-controls="definition-cloze"]')
    if (!currentClozeControls)
      throw new Error('Cloze Preview controls disappeared after closing Basic Preview')
    await userEvent.click(currentClozeControls.querySelector('button[data-card-control="preview"]')!)
    const clozeDialog = await rendered.findByRole('dialog')
    expect(cardSurface(clozeDialog)).toHaveAttribute('data-card-id', 'card-cloze')
    expect(clozeDialog.querySelector('[data-card-review-placeholder="cloze"]')!).toBeVisible()
  })
})
