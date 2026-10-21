import type {
  BasicEditorCardProjection,
  ClozeEditorCardProjection,
  MultiLineEditorCardProjection,
} from './card-model'
import { render, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { userEvent } from '../../test/browser/user-event'

import { CardPreview } from './card-preview'

const basicCard: BasicEditorCardProjection = {
  back: [{
    type: 'paragraph',
    content: [{
      type: 'text',
      marks: [{ type: 'inlineHighlight', attrs: { color: 'yellow' } }],
      text: 'A typed language for the web',
    }],
  }],
  blockHighlight: 'blue',
  definitionId: 'definition-typescript',
  direction: 'forward',
  front: [{ type: 'paragraph', content: [{ type: 'text', text: 'TypeScript' }] }],
  id: 'card-typescript',
  kind: 'basic',
  sourceBlockId: 'block-typescript',
}

describe('card preview', () => {
  it('reveals a Basic answer while retaining inline and whole-block Highlights', async () => {
    const rendered = render(<CardPreview card={basicCard} />)

    expect(rendered.getByText('TypeScript')).toBeInTheDocument()
    expect(rendered.queryByText('A typed language for the web')).toBeNull()
    expect(rendered.container.querySelector('[data-card-id]')).toHaveAttribute('data-block-highlight', 'blue')

    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-answer"]')!)

    const answer = rendered.getByText('A typed language for the web')
    expect(answer).toHaveAttribute('data-inline-highlight', 'yellow')
    expect(rendered.container.querySelector('button[data-card-action="reveal-answer"]')).toBeNull()
  })

  it('renders a Reverse Card projection with its answer-side content on the front', async () => {
    const reverse: BasicEditorCardProjection = {
      ...basicCard,
      back: basicCard.front,
      direction: 'backward',
      front: basicCard.back,
      id: 'card-typescript-backward',
    }
    const rendered = render(<CardPreview card={reverse} />)

    expect(rendered.getByText('A typed language for the web')).toBeInTheDocument()
    expect(rendered.queryByText('TypeScript')).toBeNull()

    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-answer"]')!)
    expect(rendered.getByText('TypeScript')).toBeInTheDocument()
  })

  it('synchronously reveals mixed RichContentCloze and MathSourceCloze anchors', async () => {
    const identity = {
      cardId: 'card-euler',
      definitionId: 'definition-euler',
      groupId: 'group-euler',
    }
    const card: ClozeEditorCardProjection = {
      blockHighlight: null,
      clozeGroupId: identity.groupId,
      content: [{
        type: 'paragraph',
        content: [
          {
            type: 'text',
            marks: [{ type: 'cloze', attrs: { anchorKind: 'rich-content', ...identity } }],
            text: 'Euler',
          },
          { type: 'text', text: ' proved ' },
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
      }],
      definitionId: identity.definitionId,
      id: identity.cardId,
      kind: 'cloze',
      sourceBlockId: 'block-euler',
    }
    const rendered = render(<CardPreview card={card} />)

    expect(rendered.container.querySelectorAll('[data-card-hidden-cloze]')).toHaveLength(1)
    expect(rendered.container.querySelector('[data-math-source]')).toBeInTheDocument()
    expect(rendered.queryByText('Euler')).toBeNull()

    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-answer"]')!)

    expect(rendered.container.querySelector('[data-card-hidden-cloze]')).toBeNull()
    expect(rendered.getByText('Euler')).toHaveAttribute('data-cloze-revealed', 'rich-content')
    expect(rendered.container.querySelector('[data-math-source][data-cloze-revealed="math-source"]')).toHaveAttribute('data-cloze-revealed', 'math-source')
  })

  it('hides an entire formula selected through the RichContentCloze path', async () => {
    const identity = {
      anchorKind: 'rich-content',
      cardId: 'card-formula',
      definitionId: 'definition-formula',
      groupId: 'group-formula',
    }
    const card: ClozeEditorCardProjection = {
      blockHighlight: null,
      clozeGroupId: identity.groupId,
      content: [{
        type: 'paragraph',
        content: [{
          type: 'mathInline',
          content: [{ type: 'text', marks: [{ type: 'cloze', attrs: identity }], text: 'E = mc^2' }],
        }],
      }],
      definitionId: identity.definitionId,
      id: identity.cardId,
      kind: 'cloze',
      sourceBlockId: 'block-formula',
    }
    const rendered = render(<CardPreview card={card} />)

    expect(rendered.container.querySelector('[data-card-hidden-cloze]')).toBeInTheDocument()
    expect(rendered.container.querySelector('[data-math-source]')).toBeNull()

    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-answer"]')!)
    expect(rendered.container.querySelector('[data-math-source][data-cloze-revealed="rich-content"]')).toHaveAttribute('data-cloze-revealed', 'rich-content')
  })

  it('preserves block-formula layout while revealing a local MathSourceCloze', async () => {
    const identity = {
      anchorKind: 'math-source',
      cardId: 'card-block-formula',
      definitionId: 'definition-block-formula',
      groupId: 'group-block-formula',
    }
    const card: ClozeEditorCardProjection = {
      blockHighlight: null,
      clozeGroupId: identity.groupId,
      content: [{
        type: 'mathBlock',
        attrs: { language: 'tex' },
        content: [
          { type: 'text', text: 'e^{' },
          { type: 'text', marks: [{ type: 'cloze', attrs: identity }], text: 'i\\pi' },
          { type: 'text', text: '} + 1 = 0' },
        ],
      }],
      definitionId: identity.definitionId,
      id: identity.cardId,
      kind: 'cloze',
      sourceBlockId: 'block-formula',
    }
    const rendered = render(<CardPreview card={card} />)

    const hiddenFormula = rendered.container.querySelector<HTMLElement>('[data-math-source]')!
    expect(hiddenFormula).toHaveAttribute('data-math-source', 'e^{\\text{\\ldots}} + 1 = 0')

    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-answer"]')!)

    const revealedFormula = rendered.container.querySelector<HTMLElement>('[data-math-source][data-cloze-revealed="math-source"]')!
    expect(revealedFormula).toHaveAttribute('data-cloze-revealed', 'math-source')
    expect(revealedFormula).toHaveAttribute('data-math-source', 'e^{i\\pi} + 1 = 0')
  })

  it('reveals ListCard items one at a time in stable child order', async () => {
    const card: MultiLineEditorCardProjection = {
      blockHighlight: null,
      definitionId: 'definition-list',
      direction: 'forward',
      id: 'card-list',
      items: [
        { blockId: 'item-one', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mercury' }] }] },
        { blockId: 'item-two', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Venus' }] }] },
        { blockId: 'item-three', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Earth' }] }] },
      ],
      kind: 'list',
      prompt: [{ type: 'paragraph', content: [{ type: 'text', text: 'First three planets' }] }],
      sourceBlockId: 'block-list',
    }
    const rendered = render(<CardPreview card={card} />)

    expect(rendered.queryByRole('listitem')).toBeNull()
    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-next"]')!)
    expect(rendered.getByRole('list').tagName).toBe('OL')
    expect(rendered.getAllByRole('listitem')).toHaveLength(1)
    expect(rendered.getByText('Mercury')).toBeInTheDocument()

    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-next"]')!)
    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-next"]')!)
    expect(rendered.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Mercury', 'Venus', 'Earth'])
    expect(rendered.queryByRole('button')).toBeNull()
  })

  it('reveals every SetCard item together', async () => {
    const card: MultiLineEditorCardProjection = {
      blockHighlight: null,
      definitionId: 'definition-set',
      direction: 'forward',
      id: 'card-set',
      items: [
        { blockId: 'item-red', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Red' }] }] },
        { blockId: 'item-blue', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Blue' }] }] },
      ],
      kind: 'set',
      prompt: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primary colors' }] }],
      sourceBlockId: 'block-set',
    }
    const rendered = render(<CardPreview card={card} />)

    expect(rendered.queryByRole('listitem')).toBeNull()
    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-answer"]')!)

    const list = rendered.getByRole('list')
    expect(list.tagName).toBe('UL')
    expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Red', 'Blue'])
  })

  it('renders a backward ListCard with items on the front and its prompt as the answer', async () => {
    const card: MultiLineEditorCardProjection = {
      blockHighlight: null,
      definitionId: 'definition-list-backward',
      direction: 'backward',
      id: 'card-list-backward',
      items: [
        { blockId: 'item-mercury', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mercury' }] }] },
        { blockId: 'item-venus', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Venus' }] }] },
      ],
      kind: 'list',
      prompt: [{ type: 'paragraph', content: [{ type: 'text', text: 'First two planets' }] }],
      sourceBlockId: 'block-list-backward',
    }
    const rendered = render(<CardPreview card={card} />)

    expect(rendered.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Mercury', 'Venus'])
    expect(rendered.queryByText('First two planets')).toBeNull()

    await userEvent.click(rendered.container.querySelector('button[data-card-action="reveal-answer"]')!)
    expect(rendered.getByText('First two planets')).toBeInTheDocument()
  })
})
