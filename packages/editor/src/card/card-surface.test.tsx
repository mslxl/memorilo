import type { NodeJSON } from 'prosekit/core'
import type { EditorAdapters } from '../adapters/editor-adapters'
import type { EditorCardProjection } from './card-model'
import type { CardSurfaceProps } from './card-surface'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { userEvent } from '../../test/browser/user-event'
import { EditorMode } from '../common/editor-mode'
import { createEditorNote } from '../note/editor-note'
import { projectEditorCards } from './card-model'
import { CardSurface } from './card-surface'

const adapters: EditorAdapters = {
  uploadImage: async () => 'memory://image',
  tagStorage: {
    create: async tag => tag,
    search: async () => [],
    update: async tag => tag,
  },
}

function block(id: string, content: readonly NodeJSON[], attrs: Record<string, unknown> = {}): NodeJSON {
  return {
    type: 'list',
    attrs: {
      blockHighlight: null,
      blockHighlightId: null,
      blockId: id,
      cardItemDefinitionId: null,
      checked: false,
      collapsed: false,
      kind: 'outline',
      order: null,
      ...attrs,
    },
    content: [...content],
  }
}

function delimiter(
  definitionId: string,
  direction: 'backward' | 'both' | 'forward',
  forwardCardId: string | null,
  backwardCardId: string | null,
): NodeJSON {
  return {
    type: 'cardDelimiter',
    attrs: { backwardCardId, definitionId, direction, forwardCardId },
  }
}

function paragraph(content: readonly NodeJSON[]): NodeJSON {
  return { type: 'paragraph', content: [...content] }
}

function text(value: string, marks?: NodeJSON['marks']): NodeJSON {
  return { type: 'text', ...(marks ? { marks } : {}), text: value }
}

function createFixture(document: NodeJSON): {
  cards: readonly EditorCardProjection[]
  topic: CardSurfaceProps['topic']
} {
  const note = createEditorNote({ id: crypto.randomUUID() })
  const topicId = note.createTopic({
    initialContent: document,
    mode: EditorMode.Outline,
    title: 'Card surface test',
  })
  return {
    cards: projectEditorCards(document),
    topic: note.getTopic(topicId),
  }
}

function findCard(cards: readonly EditorCardProjection[], cardId: string): EditorCardProjection {
  const card = cards.find(candidate => candidate.id === cardId)
  if (!card)
    throw new Error(`Card fixture is missing ${cardId}`)
  return card
}

function cardSurface(container: HTMLElement): HTMLElement {
  const surface = container.querySelector<HTMLElement>('[data-card-surface]')
  if (!surface)
    throw new Error('CardSurface did not render its root element')
  return surface
}

function reviewSource(surface: HTMLElement): HTMLElement {
  const source = surface.querySelector<HTMLElement>('[data-card-review-source]')
  if (!source)
    throw new Error('CardSurface did not render its review Source Block')
  return source
}

function isVisuallyRendered(element: Element, root: HTMLElement): boolean {
  let current: Element | null = element
  while (current) {
    const style = getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
      return false
    if (current instanceof HTMLElement && current.hidden)
      return false
    if (current === root)
      return true
    current = current.parentElement
  }
  throw new Error('Visible text node is outside its asserted root')
}

function visibleText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const chunks: string[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent)
      throw new Error('CardSurface text node is missing its parent element')
    if (isVisuallyRendered(parent, root))
      chunks.push(node.textContent ?? '')
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim()
}

function authoredBreaks(source: HTMLElement): readonly HTMLBRElement[] {
  return [...source.querySelectorAll('br')].filter(element => !element.classList.contains('ProseMirror-trailingBreak'))
}

function expectDelimiter(
  surface: HTMLElement,
  direction: 'backward' | 'both' | 'forward',
  symbol: '←' | '↔' | '→',
  multiline = false,
): HTMLElement {
  const element = surface.querySelector<HTMLElement>('[data-card-delimiter]')
  if (!element)
    throw new Error(`CardSurface did not render the ${direction} delimiter`)
  expect(element).toBeVisible()
  expect(element).toHaveAttribute('data-card-direction', direction)
  expect(element).toHaveTextContent(symbol)
  expect(getComputedStyle(element).display).toBe('inline-flex')
  expect(element.classList.contains('card-delimiter-multiline')).toBe(multiline)

  const directionSymbol = element.querySelector<HTMLElement>('[data-card-direction-symbol]')
  if (!directionSymbol)
    throw new Error(`CardSurface ${direction} delimiter is missing its direction symbol`)
  const transform = getComputedStyle(directionSymbol).transform
  if (multiline) {
    expect(transform).not.toBe('none')
    expect(transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
  }
  else {
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform)
  }
  return element
}

function basicDocument(direction: 'backward' | 'both' | 'forward'): NodeJSON {
  const definitionId = `definition-basic-${direction}`
  return {
    type: 'doc',
    content: [block(`source-basic-${direction}`, [paragraph([
      text('Question line one'),
      { type: 'hardBreak' },
      text('Question line two'),
      delimiter(
        definitionId,
        direction,
        direction === 'backward' ? null : `card-basic-${direction}-forward`,
        direction === 'forward' ? null : `card-basic-${direction}-backward`,
      ),
      text('Answer line one'),
      { type: 'hardBreak' },
      text('Answer line two'),
    ])])],
  }
}

describe('card surface', () => {
  it.each([
    {
      cardId: 'card-basic-forward-forward',
      delimiterDirection: 'forward',
      hiddenText: 'Answer line one',
      name: 'forward Basic Card',
      questionBreaks: [true, false],
      symbol: '→',
      visibleText: 'Question line one',
    },
    {
      cardId: 'card-basic-backward-backward',
      delimiterDirection: 'backward',
      hiddenText: 'Question line one',
      name: 'Reverse Basic Card',
      questionBreaks: [false, true],
      symbol: '←',
      visibleText: 'Answer line one',
    },
    {
      cardId: 'card-basic-both-forward',
      delimiterDirection: 'both',
      hiddenText: 'Answer line one',
      name: 'Bidirectional forward Card',
      questionBreaks: [true, false],
      symbol: '↔',
      visibleText: 'Question line one',
    },
    {
      cardId: 'card-basic-both-backward',
      delimiterDirection: 'both',
      hiddenText: 'Question line one',
      name: 'Bidirectional reverse Card',
      questionBreaks: [false, true],
      symbol: '↔',
      visibleText: 'Answer line one',
    },
  ] as const)('keeps the Editor delimiter and multi-line layout for a $name', async ({
    cardId,
    delimiterDirection,
    hiddenText,
    questionBreaks,
    symbol,
    visibleText: expectedQuestionText,
  }) => {
    const direction = cardId.includes('-both-')
      ? 'both'
      : cardId.includes('-backward-') ? 'backward' : 'forward'
    const fixture = createFixture(basicDocument(direction))
    const card = findCard(fixture.cards, cardId)
    const rendered = render(
      <CardSurface adapters={adapters} card={card} side="question" topic={fixture.topic} />,
    )
    await waitFor(() => expect(cardSurface(rendered.container).querySelector('.ProseMirror')).not.toBeNull())
    const surface = cardSurface(rendered.container)
    const source = reviewSource(surface)
    const mountedEditor = surface.querySelector('.ProseMirror')
    if (!mountedEditor)
      throw new Error('CardSurface did not mount its Editor')

    expect(visibleText(source)).toContain(expectedQuestionText)
    expect(visibleText(source)).not.toContain(hiddenText)
    expect(authoredBreaks(source).map(element => isVisuallyRendered(element, source))).toEqual(questionBreaks)
    expectDelimiter(surface, delimiterDirection, symbol)

    rendered.rerender(
      <CardSurface adapters={adapters} card={card} side="answer" topic={fixture.topic} />,
    )
    await waitFor(() => expect(source.querySelector('[data-card-review-hidden]')).toBeNull())

    expect(visibleText(source)).toContain('Question line one')
    expect(visibleText(source)).toContain('Question line two')
    expect(visibleText(source)).toContain('Answer line one')
    expect(visibleText(source)).toContain('Answer line two')
    expect(authoredBreaks(source).map(element => isVisuallyRendered(element, source))).toEqual([true, true])
    expect(surface.querySelector('.ProseMirror')).toBe(mountedEditor)
    expectDelimiter(surface, delimiterDirection, symbol)
  })

  it('reveals a forward ListCard in stable item order while retaining its downward delimiter', async () => {
    const document: NodeJSON = {
      type: 'doc',
      content: [block('source-list', [
        paragraph([text('First two planets'), delimiter('definition-list', 'forward', 'card-list', null)]),
        block('list-mercury', [paragraph([text('Mercury')])], {
          cardItemDefinitionId: 'definition-list',
          kind: 'ordered',
          order: 1,
        }),
        block('list-venus', [paragraph([text('Venus')])], {
          cardItemDefinitionId: 'definition-list',
          kind: 'ordered',
          order: 2,
        }),
        block('list-unrelated', [paragraph([text('Unrelated child')])]),
      ])],
    }
    const fixture = createFixture(document)
    const card = findCard(fixture.cards, 'card-list')
    const rendered = render(
      <CardSurface
        adapters={adapters}
        card={card}
        revealedItemBlockIds={[]}
        side="question"
        topic={fixture.topic}
      />,
    )
    await waitFor(() => expect(cardSurface(rendered.container).querySelectorAll('[data-card-review-placeholder="item"]')).toHaveLength(2))
    const surface = cardSurface(rendered.container)
    const source = reviewSource(surface)
    const mountedEditor = surface.querySelector('.ProseMirror')
    if (!mountedEditor)
      throw new Error('ListCard did not mount its Editor')

    expect(visibleText(source)).toContain('First two planets')
    expect(visibleText(source)).not.toContain('Mercury')
    expect(visibleText(source)).not.toContain('Venus')
    expect(visibleText(source)).not.toContain('Unrelated child')
    expectDelimiter(surface, 'forward', '→', true)

    rendered.rerender(
      <CardSurface
        adapters={adapters}
        card={card}
        revealedItemBlockIds={['list-mercury']}
        side="question"
        topic={fixture.topic}
      />,
    )
    await waitFor(() => expect(visibleText(source)).toContain('Mercury'))
    expect(visibleText(source)).not.toContain('Venus')
    expect(surface.querySelector('.ProseMirror')).toBe(mountedEditor)

    rendered.rerender(
      <CardSurface adapters={adapters} card={card} side="answer" topic={fixture.topic} />,
    )
    await waitFor(() => expect(source.querySelector('[data-card-review-placeholder="item"]')).toBeNull())
    expect(visibleText(source)).toContain('First two planets')
    expect(visibleText(source).indexOf('Mercury')).toBeLessThan(visibleText(source).indexOf('Venus'))
    expect(visibleText(source)).not.toContain('Unrelated child')
    expect(surface.querySelector('.ProseMirror')).toBe(mountedEditor)
    expectDelimiter(surface, 'forward', '→', true)
  })

  it('shows a Reverse ListCard before revealing its prompt with an upward delimiter', async () => {
    const document: NodeJSON = {
      type: 'doc',
      content: [block('source-reverse-list', [
        paragraph([text('First two planets'), delimiter('definition-reverse-list', 'backward', null, 'card-reverse-list')]),
        block('reverse-list-mercury', [paragraph([text('Mercury')])], {
          cardItemDefinitionId: 'definition-reverse-list',
          kind: 'ordered',
          order: 1,
        }),
        block('reverse-list-venus', [paragraph([text('Venus')])], {
          cardItemDefinitionId: 'definition-reverse-list',
          kind: 'ordered',
          order: 2,
        }),
      ])],
    }
    const fixture = createFixture(document)
    const card = findCard(fixture.cards, 'card-reverse-list')
    const rendered = render(
      <CardSurface adapters={adapters} card={card} side="question" topic={fixture.topic} />,
    )
    await waitFor(() => expect(visibleText(reviewSource(cardSurface(rendered.container)))).toContain('Mercury'))
    const surface = cardSurface(rendered.container)
    const source = reviewSource(surface)
    const mountedEditor = surface.querySelector('.ProseMirror')
    if (!mountedEditor)
      throw new Error('Reverse ListCard did not mount its Editor')

    expect(visibleText(source)).toContain('Mercury')
    expect(visibleText(source)).toContain('Venus')
    expect(visibleText(source)).not.toContain('First two planets')
    expectDelimiter(surface, 'backward', '←', true)

    rendered.rerender(
      <CardSurface adapters={adapters} card={card} side="answer" topic={fixture.topic} />,
    )
    await waitFor(() => expect(visibleText(source)).toContain('First two planets'))
    expect(visibleText(source)).toContain('Mercury')
    expect(visibleText(source)).toContain('Venus')
    expect(surface.querySelector('.ProseMirror')).toBe(mountedEditor)
    expectDelimiter(surface, 'backward', '←', true)
  })

  it('reveals a SetCard together and exposes answer-item selection without replacing the Editor', async () => {
    const document: NodeJSON = {
      type: 'doc',
      content: [block('source-set', [
        paragraph([text('Primary colors'), delimiter('definition-set', 'forward', 'card-set', null)]),
        block('set-red', [paragraph([text('Red')])], {
          cardItemDefinitionId: 'definition-set',
          kind: 'bullet',
        }),
        block('set-blue', [paragraph([text('Blue')])], {
          cardItemDefinitionId: 'definition-set',
          kind: 'bullet',
        }),
      ])],
    }
    const fixture = createFixture(document)
    const card = findCard(fixture.cards, 'card-set')
    const rendered = render(
      <CardSurface adapters={adapters} card={card} side="question" topic={fixture.topic} />,
    )
    await waitFor(() => expect(cardSurface(rendered.container).querySelectorAll('[data-card-review-placeholder="item"]')).toHaveLength(2))
    const surface = cardSurface(rendered.container)
    const source = reviewSource(surface)
    const mountedEditor = surface.querySelector('.ProseMirror')
    if (!mountedEditor)
      throw new Error('SetCard did not mount its Editor')

    expect(visibleText(source)).toContain('Primary colors')
    expect(visibleText(source)).not.toContain('Red')
    expect(visibleText(source)).not.toContain('Blue')
    expectDelimiter(surface, 'forward', '→', true)

    const onToggle = vi.fn<(itemBlockId: string) => void>()
    rendered.rerender(
      <CardSurface
        adapters={adapters}
        card={card}
        itemSelection={{
          label: (itemBlockId, selected) => `${selected ? 'Remembered' : 'Forgotten'} ${itemBlockId}`,
          onToggle,
          selectedItemBlockIds: ['set-red'],
        }}
        side="answer"
        topic={fixture.topic}
      />,
    )
    const redToggle = rendered.container.querySelector<HTMLButtonElement>('[data-card-review-item="set-red"] [data-card-review-item-toggle]')!
    const blueToggle = rendered.container.querySelector<HTMLButtonElement>('[data-card-review-item="set-blue"] [data-card-review-item-toggle]')!
    expect(redToggle).toHaveAttribute('aria-pressed', 'true')
    expect(blueToggle).toHaveAttribute('aria-pressed', 'false')
    expect(visibleText(source)).toContain('Red')
    expect(visibleText(source)).toContain('Blue')
    expect(surface.querySelector('.ProseMirror')).toBe(mountedEditor)

    await userEvent.click(blueToggle)
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledWith('set-blue')
  })

  it('masks and reveals RichContentCloze and MathSourceCloze anchors in the same mounted Editor', async () => {
    const identity = {
      cardId: 'card-cloze-euler',
      definitionId: 'definition-cloze-euler',
      groupId: 'group-cloze-euler',
    }
    const richCloze = { type: 'cloze', attrs: { anchorKind: 'rich-content', ...identity } }
    const mathCloze = { type: 'cloze', attrs: { anchorKind: 'math-source', ...identity } }
    const unrelatedIdentity = {
      anchorKind: 'rich-content',
      cardId: 'card-cloze-unrelated',
      definitionId: 'definition-cloze-unrelated',
      groupId: 'group-cloze-unrelated',
    }
    const document: NodeJSON = {
      type: 'doc',
      content: [block('source-cloze', [paragraph([
        text('Euler', [richCloze]),
        text(' proved '),
        {
          type: 'mathInline',
          content: [
            text('e^{'),
            text('i\\pi', [mathCloze]),
            text('} + 1 = 0'),
          ],
        },
        text(' while '),
        text('Gauss', [{ type: 'cloze', attrs: unrelatedIdentity }]),
        text(' remained visible.'),
      ])])],
    }
    const fixture = createFixture(document)
    const card = findCard(fixture.cards, identity.cardId)
    const rendered = render(
      <CardSurface adapters={adapters} card={card} side="question" topic={fixture.topic} />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-card-review-placeholder="cloze"]')).toBeVisible())
    const surface = cardSurface(rendered.container)
    const source = reviewSource(surface)
    const mountedEditor = surface.querySelector('.ProseMirror')
    if (!mountedEditor)
      throw new Error('Cloze Card did not mount its Editor')

    expect(rendered.container.querySelector('[data-card-review-placeholder="cloze"]')).toBeVisible()
    expect(visibleText(source)).not.toContain('Euler')
    expect(visibleText(source)).toContain('Gauss')
    expect(surface.querySelector('[data-card-delimiter]')).toBeNull()
    expect(surface.querySelector('.prosemirror-math-display')).toHaveAttribute(
      'data-card-review-math-source',
      'e^{\\text{\\ldots}} + 1 = 0',
    )

    rendered.rerender(
      <CardSurface adapters={adapters} card={card} side="answer" topic={fixture.topic} />,
    )
    await waitFor(() => expect(rendered.container.querySelector('[data-card-review-placeholder="cloze"]')).toBeNull())
    expect(visibleText(source)).toContain('Euler')
    expect(visibleText(source)).toContain('Gauss')
    expect(surface.querySelector('.prosemirror-math-display')).toHaveAttribute(
      'data-card-review-math-source',
      'e^{i\\pi} + 1 = 0',
    )
    expect(surface.querySelector('.ProseMirror')).toBe(mountedEditor)
  })
})
