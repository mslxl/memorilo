import { act, render, waitFor } from '@testing-library/react'
import { page } from '@vitest/browser/context'
import { describe, expect, it } from 'vitest'
import { EditorTestHarness as Editor } from '../../test/browser/editor-test-harness'
import { modShortcut, userEvent } from '../../test/browser/user-event'
import {
  adapters,
  block,
  paragraph,
} from './card-authoring-interactions.fixture'

describe('card authoring interactions', () => {
  it('applies inline Highlight from the same selection bubble menu', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{ type: 'doc', content: [block('fact', paragraph('Important fact'))] }}
      />,
    )
    await rendered.findByText('Important fact')

    await userEvent.click(rendered.getByText('Important fact'))
    await userEvent.keyboard(modShortcut('a'))
    await waitFor(() => expect(rendered.container.querySelector('button[data-editor-action="highlight"]')).not.toBeNull())
    await userEvent.click(rendered.container.querySelector('button[data-editor-action="highlight"]')!)

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-inline-highlight="yellow"]')).toHaveTextContent('Important fact')
    })
  })

  it('applies whole-block Highlight from the ordinary command menu', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{ type: 'doc', content: [block('fact', paragraph('Important block'))] }}
      />,
    )
    await rendered.findByText('Important block')

    await userEvent.click(rendered.getByText('Important block'))
    await userEvent.keyboard('{End}{Enter}/')
    await waitFor(() => expect(rendered.container.querySelector('[data-slash-command="block-highlight"]')).not.toBeNull())
    await userEvent.click(rendered.container.querySelector('[data-slash-command="block-highlight"]')!)

    await waitFor(() => {
      expect(rendered.container.querySelector('[data-block-highlight="yellow"]')).not.toBeNull()
    })
  })

  it('uses the separate Card options control to convert an inline Card into a ListCard', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [block('planets', paragraph('First planet'))],
        }}
      />,
    )
    await rendered.findByText('First planet')
    await userEvent.click(rendered.getByText('First planet'))
    await userEvent.keyboard('{End}:-> Mercury')
    await waitFor(() => expect(rendered.container.querySelector('[data-card-delimiter]')).not.toBeNull())
    const delimiter = rendered.container.querySelector<HTMLElement>('[data-card-delimiter]')
    if (!delimiter)
      throw new Error('Inline Card delimiter was not rendered')
    const definitionId = delimiter.dataset.cardDefinitionId
    if (!definitionId)
      throw new Error('Inline Card delimiter is missing its DefinitionID')
    expect(delimiter).not.toHaveClass('card-delimiter-multiline')

    await userEvent.hover(page.getByText('First planet', { exact: false }))
    await waitFor(() => expect(rendered.container.querySelector('[data-card-control="options"]')).not.toBeNull())
    const openOptions = rendered.container.querySelector<HTMLButtonElement>('[data-card-control="options"]')!
    expect(rendered.container.querySelector('[data-card-control="preview"]')).toBeVisible()
    expect(openOptions).toBeVisible()

    await userEvent.click(delimiter)
    expect(rendered.baseElement.querySelector('[data-card-options-dialog]')).toBeNull()

    await userEvent.click(openOptions)
    await waitFor(() => expect(rendered.baseElement.querySelector('[data-card-options-dialog]')).not.toBeNull())
    const listAnswer = rendered.baseElement.querySelector<HTMLButtonElement>('[data-card-presentation="list"]')!
    const basicDirection = rendered.baseElement.querySelector<HTMLElement>('[data-card-direction-choice="forward"]')!
    const reverseDirection = rendered.baseElement.querySelector<HTMLElement>('[data-card-direction-choice="backward"]')!
    expect(rendered.baseElement.querySelector('[data-card-options-dialog]')).toBeVisible()
    expect(
      rendered.baseElement.querySelector(
        '[data-card-options-dialog] button[data-card-control="preview"]',
      ),
    ).toBeNull()
    expect(rendered.baseElement.querySelector('[data-inline-menu="main"]')).toBeNull()
    expect(listAnswer).toHaveAttribute('aria-pressed', 'false')
    expect(basicDirection).toHaveAttribute('aria-checked', 'true')
    expect(reverseDirection).toHaveAttribute('aria-checked', 'false')
    expect(getComputedStyle(basicDirection).boxShadow).toContain('inset')
    expect(Number.parseInt(getComputedStyle(basicDirection).fontWeight, 10)).toBeGreaterThan(
      Number.parseInt(getComputedStyle(reverseDirection).fontWeight, 10),
    )
    await act(async () => {
      await userEvent.click(listAnswer)
    })

    await waitFor(() => {
      const member = rendered.container.querySelector(`[data-card-item-definition-id="${definitionId}"]`)
      expect(member).toHaveAttribute('data-list-kind', 'ordered')
      expect(member).toHaveTextContent('Mercury')
      expect(rendered.container.querySelector('[data-card-delimiter]')).toHaveClass('card-delimiter-multiline')
      expect(rendered.container.querySelector('[data-block-id="planets"] > .list-content > p')).toHaveTextContent('First planet→')
    })
  })

  it('uses one liquid-glass scope when any part of a multi-line Card is hovered', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [{
            type: 'list',
            attrs: { blockId: 'capital', checked: false, collapsed: false, kind: 'outline', order: null },
            content: [{
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
              ],
            }, {
              type: 'list',
              attrs: {
                blockId: 'capital-answer-one',
                cardItemDefinitionId: 'capital-definition',
                checked: false,
                collapsed: false,
                kind: 'bullet',
                order: null,
              },
              content: [paragraph('Paris')],
            }, {
              type: 'list',
              attrs: {
                blockId: 'capital-answer-two',
                cardItemDefinitionId: 'capital-definition',
                checked: false,
                collapsed: false,
                kind: 'bullet',
                order: null,
              },
              content: [paragraph('Lyon')],
            }],
          }],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-card-delimiter]')).not.toBeNull())
    const source = rendered.container.querySelector<HTMLElement>('[data-block-id="capital"]')
    if (!source)
      throw new Error('Card source was not rendered')

    expect(source).toHaveAttribute('data-card-definition-scope', 'capital-definition')
    expect(rendered.container.querySelectorAll('[data-card-definition-scope]')).toHaveLength(1)
    expect(rendered.container.querySelector('[data-block-id="capital-answer-one"]')).not.toHaveAttribute('data-card-definition-scope')
    expect(rendered.container.querySelector('[data-block-id="capital-answer-two"]')).not.toHaveAttribute('data-card-definition-scope')

    await userEvent.hover(page.getByText('Lyon', { exact: true }))
    expect(source.matches(':hover')).toBe(true)
    await waitFor(() => {
      const contentStyle = getComputedStyle(source)
      const material = source.querySelector<HTMLElement>('[data-card-material="capital-definition"]')
      if (!material)
        throw new Error('Multi-line Card has no dedicated glass material element')
      const materialStyle = getComputedStyle(material)
      expect(contentStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(materialStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(materialStyle.backdropFilter).toContain('blur(')
      expect(materialStyle.boxShadow).not.toBe('none')
    })

    const controls = rendered.container.querySelector<HTMLElement>('[data-card-hover-controls]')
    if (!controls)
      throw new Error('Card controls were not rendered')
    const sourceRect = source.getBoundingClientRect()
    const controlsRect = controls.getBoundingClientRect()
    expect(controlsRect.right).toBeGreaterThanOrEqual(sourceRect.right - 4)
    expect(controlsRect.right).toBeLessThanOrEqual(sourceRect.right + 12)
    expect(controlsRect.top).toBeLessThanOrEqual(sourceRect.top + 4)
    expect(rendered.container.querySelectorAll('[data-card-scope-hover]')).toHaveLength(0)
  })

  it('keeps single-line Card text vertically balanced inside its glass material', async () => {
    const rendered = render(
      <Editor
        adapters={adapters}
        initialContent={{
          type: 'doc',
          content: [
            block('single-line-card', {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Question' },
                {
                  type: 'cardDelimiter',
                  attrs: {
                    backwardCardId: null,
                    definitionId: 'single-line-definition',
                    direction: 'forward',
                    forwardCardId: 'single-line-forward',
                  },
                },
                { type: 'text', text: 'Answer' },
              ],
            }),
            block('ordinary-block', paragraph('Ordinary text')),
          ],
        }}
      />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-card-delimiter]')).not.toBeNull())
    const source = rendered.container.querySelector<HTMLElement>('[data-card-definition-scope="single-line-definition"]')
    if (!source)
      throw new Error('Single-line Card source was not rendered')
    await userEvent.hover(source)
    await waitFor(() => {
      const currentSource = rendered.container.querySelector<HTMLElement>('[data-card-definition-scope="single-line-definition"]')
      const material = currentSource?.querySelector<HTMLElement>('[data-card-material="single-line-definition"]')
      const sourceParagraph = currentSource?.querySelector<HTMLElement>(':scope > .list-content > p')
      const textNode = sourceParagraph
        ? Array.from(sourceParagraph.childNodes).find(node => node.nodeType === Node.TEXT_NODE && typeof node.textContent === 'string' && node.textContent.includes('Question'))
        : undefined
      const currentOrdinaryParagraph = rendered.container.querySelector<HTMLElement>('[data-block-id="ordinary-block"] > .list-content > p')
      const currentOrdinaryTextNode = currentOrdinaryParagraph?.firstChild
      if (!material || !textNode || !currentOrdinaryTextNode)
        throw new Error('Card geometry nodes are not available')
      const range = document.createRange()
      range.selectNodeContents(textNode)
      const ordinaryRange = document.createRange()
      ordinaryRange.selectNodeContents(currentOrdinaryTextNode)
      const textRect = range.getBoundingClientRect()
      const materialRect = material.getBoundingClientRect()
      const ordinaryTextRect = ordinaryRange.getBoundingClientRect()
      const topGap = textRect.top - materialRect.top
      const bottomGap = materialRect.bottom - textRect.bottom

      expect(topGap).toBeGreaterThanOrEqual(7.5)
      expect(topGap).toBeLessThanOrEqual(12.5)
      expect(bottomGap).toBeGreaterThanOrEqual(7.5)
      expect(bottomGap).toBeLessThanOrEqual(12.5)
      expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(2)
      expect(ordinaryTextRect.top - materialRect.bottom).toBeGreaterThanOrEqual(2)
    })
  })
})
