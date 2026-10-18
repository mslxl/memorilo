import type { DesktopApi } from '@memorilo/desktop-api'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  createPagesTestEnvironment,
  launchPagesTestApplication,
  removePagesTestEnvironment,
} from './pages-test-helpers'

test.describe.configure({ mode: 'parallel' })

type CardTestEnvironment = Awaited<ReturnType<typeof createPagesTestEnvironment>>

async function withCardWindow(
  environment: CardTestEnvironment,
  run: (window: Page) => Promise<void>,
  now?: number,
): Promise<void> {
  const application = await launchPagesTestApplication(environment, { now })
  try {
    await run(await application.firstWindow())
  }
  finally {
    await application.close()
  }
}

async function withCardApplication(
  prefix: string,
  run: (window: Page) => Promise<void>,
): Promise<void> {
  const environment = await createPagesTestEnvironment(prefix, [])
  try {
    await withCardWindow(environment, run)
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
}

async function createNoteEditor(window: Page, title: string): Promise<Locator> {
  await window.locator('a[href*="/journals"]').waitFor()
  await window.keyboard.press('Meta+P')
  await window.locator('input[role=combobox][aria-autocomplete=list]').fill(title)
  await window.locator('[role=listbox] [role=option][id$=\"-create-note\"]').click()

  const editor = window.locator('[data-editor-content]')
  const heading = editor.locator('[data-block-id]').first()
  await expect(heading).toBeVisible()
  await heading.click()
  await window.keyboard.press('End')
  return editor
}

function sourceBlock(editor: Locator, uniqueText: string): Locator {
  return editor.locator('[data-block-id]').filter({ hasText: uniqueText }).first()
}

async function visibleText(root: Locator): Promise<string> {
  return root.evaluate((element) => {
    if (!(element instanceof HTMLElement))
      throw new TypeError('Visible text root must be an HTMLElement')
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const chunks: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent)
        throw new Error('Visible Card text node is missing its parent element')
      let current: Element | null = parent
      let visible = false
      while (current) {
        const style = getComputedStyle(current)
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
          break
        if (current instanceof HTMLElement && current.hidden)
          break
        if (current === element) {
          visible = true
          break
        }
        current = current.parentElement
      }
      if (visible)
        chunks.push(node.textContent ?? '')
    }
    return chunks.join(' ').replace(/\s+/g, ' ').trim()
  })
}

async function openCardTopicPreview(window: Page, kind: string, titlePrefix: string): Promise<Locator> {
  const inspector = window.locator('[data-note-inspector]')
  if (!await inspector.isVisible())
    await window.locator('[data-note-inspector-toggle]').click()
  await expect(inspector).toBeVisible()

  const topic = inspector
    .locator(`[data-card-topic-kind="${kind}"]`)
    .locator('xpath=..')
    .getByRole('link')
    .filter({ hasText: titlePrefix })
    .first()
  await expect(topic).toBeVisible()
  await topic.click()

  const button = window.locator('[data-card-control="preview"]')
  await expect(button).toBeVisible()
  await button.click()
  const preview = window.locator('[role="dialog"][aria-label][data-card-preview-dialog]')
  await expect(preview).toBeVisible()
  return preview
}

async function startNoteReview(window: Page, title: string): Promise<void> {
  await window.locator('a[href="/learning"]').click()
  const study = window.locator('a[href*="/learning/review"]').filter({ hasText: title })
  await expect(study).toBeVisible()
  await study.click()
}

async function rateRevealedCard(window: Page, selectedRating: 'Again' | 'Easy' | 'Good' | 'Hard'): Promise<void> {
  const ratingGroup = window.locator('[data-learning-rating-group]')
  await expect(ratingGroup).toBeVisible()

  for (const rating of ['Again', 'Hard', 'Good', 'Easy'] as const) {
    const button = ratingGroup.locator(`[data-learning-rating="${rating.toLowerCase()}"]`)
    await expect(button).toBeEnabled()
    const interval = button.locator('span').first()
    await expect(interval).not.toHaveText('...')
    await expect(interval).toHaveText(/\d|</)
  }

  await ratingGroup.locator(`[data-learning-rating="${selectedRating.toLowerCase()}"]`).click()
  await expect(ratingGroup).toBeHidden()
}

async function revealAndRate(window: Page, selectedRating: 'Again' | 'Easy' | 'Good' | 'Hard'): Promise<void> {
  await window.locator('[data-learning-action="reveal-answer"]').click()
  await rateRevealedCard(window, selectedRating)
}

async function startGlobalReview(window: Page): Promise<void> {
  await window.locator('a[href="/learning"]').click()
  const study = window.locator('a[href*="/learning/review"]').first()
  await expect(study).toBeVisible()
  await study.click()
}

interface ObservedLearningState {
  cardId: string
  itemBlockId: string | null
  state: Awaited<ReturnType<DesktopApi['learning']['getLearningState']>>
  targetId: string
}

async function learningStates(window: Page, cardIds: readonly string[]): Promise<readonly ObservedLearningState[]> {
  return window.evaluate(async (requestedCardIds) => {
    const request = async <Result>(method: string, args: readonly unknown[]): Promise<Result> => {
      const response = await fetch(`memorilo://api/rpc/learning/${method}`, {
        body: JSON.stringify({ args }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok)
        throw new Error(`Desktop request failed with status ${response.status}`)
      return response.json() as Promise<Result>
    }
    const byCard = await Promise.all(requestedCardIds.map(async (cardId) => {
      const targets = await request<Awaited<ReturnType<DesktopApi['learning']['listTargets']>>>('listTargets', [cardId])
      return Promise.all(targets.map(async target => ({
        cardId,
        itemBlockId: target.itemBlockId,
        state: await request<Awaited<ReturnType<DesktopApi['learning']['getLearningState']>>>('getLearningState', [target.targetId]),
        targetId: target.targetId,
      })))
    }))
    return byCard.flat()
  }, cardIds)
}

async function waitForLearningTargets(
  window: Page,
  expectedCounts: Readonly<Record<string, number>>,
): Promise<void> {
  await expect.poll(async () => {
    try {
      const states = await learningStates(window, Object.keys(expectedCounts))
      return Object.fromEntries(Object.keys(expectedCounts).map(cardId => [
        cardId,
        states.filter(state => state.cardId === cardId).length,
      ]))
    }
    catch {
      return {}
    }
  }).toEqual(expectedCounts)
}

type VisibleRating = 'Again' | 'Easy' | 'Good' | 'Hard'

interface StudyOutcome {
  cardIds: readonly string[]
  targetIds: readonly string[]
}

async function studyAvailableCards(
  window: Page,
  selectRating: (targetId: string, previousRatings: number) => VisibleRating,
): Promise<StudyOutcome> {
  const completed = window.locator('[data-learning-review-state="complete"]')
  const ratingsByTarget = new Map<string, number>()
  const cardIds = new Set<string>()
  const targetIds = new Set<string>()

  for (let iteration = 0; iteration < 50; iteration += 1) {
    if (await completed.isVisible())
      return { cardIds: [...cardIds], targetIds: [...targetIds] }

    const session = window.locator('[data-active-review-target-id]')
    await expect(session).toBeVisible()
    const cardId = await session.getAttribute('data-active-review-card-id')
    const targetId = await session.getAttribute('data-active-review-target-id')
    if (!cardId || !targetId)
      throw new Error('The active Review session is missing its Card or Review Target identity')
    const material = window.locator(`[data-review-target-id="${targetId}"]`)
    const surface = material.locator('[data-card-surface="review"]')
    await expect(surface).toHaveAttribute('data-card-id', cardId)
    await expect(surface).toBeVisible()

    cardIds.add(cardId)
    targetIds.add(targetId)
    const previousRatings = ratingsByTarget.get(targetId) ?? 0
    const rating = selectRating(targetId, previousRatings)
    ratingsByTarget.set(targetId, previousRatings + 1)
    await revealAndRate(window, rating)
    await expect.poll(async () => {
      if (await completed.isVisible())
        return 'complete'
      if (await window.locator('[data-learning-action="reveal-answer"]').isVisible())
        return 'active'
      return 'transitioning'
    }).not.toBe('transitioning')
  }

  throw new Error('Review did not complete within 50 Ratings')
}

function nextStudyDay(now: number): number {
  const boundary = new Date(now)
  boundary.setHours(4, 1, 0, 0)
  if (boundary.getTime() <= now)
    boundary.setDate(boundary.getDate() + 1)
  return boundary.getTime()
}

async function expectDelimiter(
  surface: Locator,
  direction: 'backward' | 'both' | 'forward',
  symbol: '←' | '↔' | '→',
  multiline = false,
): Promise<void> {
  await expect(surface.locator('[data-card-delimiter]:visible')).toHaveCount(1)
  const delimiter = surface.locator('[data-card-review-source] [data-card-delimiter]')
  await expect(delimiter).toHaveCount(1)
  await expect(delimiter).toBeVisible()
  await expect(delimiter).toHaveAttribute('data-card-direction', direction)
  await expect(delimiter.locator('[data-card-direction-symbol]')).toHaveText(symbol)
  if (multiline) {
    await expect(delimiter).toHaveClass(/card-delimiter-multiline/)
    const transform = await delimiter.locator('[data-card-direction-symbol]').evaluate(element => getComputedStyle(element).transform)
    expect(transform).not.toBe('none')
    expect(transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)')
  }
  else {
    await expect(delimiter).not.toHaveClass(/card-delimiter-multiline/)
  }
}

async function markEditorMount(surface: Locator, marker: string): Promise<void> {
  await surface.locator('.ProseMirror').evaluate((element, value) => {
    element.setAttribute('data-e2e-editor-mount', value)
  }, marker)
}

async function expectEditorMount(surface: Locator, marker: string): Promise<void> {
  await expect(surface.locator('.ProseMirror')).toHaveAttribute('data-e2e-editor-mount', marker)
}

async function convertToMultiLineCard(
  window: Page,
  editor: Locator,
  presentation: 'List answer' | 'Set answer',
  prompt: string,
  firstItem: string,
  secondItem: string,
): Promise<Locator> {
  await window.keyboard.type(`${prompt}:-> `)
  await window.keyboard.press('Enter')
  await window.keyboard.type(firstItem)
  await window.keyboard.press('Enter')
  await window.keyboard.type(secondItem)
  const source = sourceBlock(editor, prompt)
  const delimiter = source.locator('[data-card-delimiter]')
  await expect(delimiter).toHaveCount(1)
  const definitionId = await delimiter.getAttribute('data-card-definition-id')
  if (!definitionId)
    throw new Error(`${presentation} Card is missing its definition ID`)

  const members = source.locator(`[data-card-item-definition-id="${definitionId}"]`)
  await expect(members).toHaveCount(2)
  await source.hover()
  await source.locator('[data-card-control="options"]').click()
  await window.locator(`[data-card-presentation="${presentation.toLowerCase()}"]`).click()
  return source
}

async function createTwoClozeCards(window: Page, editor: Locator): Promise<readonly [string, string]> {
  await window.keyboard.type('Alpha Beta')
  await editor.click()
  await window.keyboard.press('Meta+ArrowDown')
  await window.keyboard.down('Shift')
  for (let index = 0; index < 'Beta'.length; index += 1)
    await window.keyboard.press('ArrowLeft')
  await window.keyboard.up('Shift')
  await window.locator('[data-inline-menu="main"] [data-editor-action="cloze"]').click()

  await editor.click()
  await window.keyboard.press('Meta+ArrowDown')
  for (let index = 0; index < ' Beta'.length; index += 1)
    await window.keyboard.press('ArrowLeft')
  await window.keyboard.down('Shift')
  for (let index = 0; index < 'Alpha'.length; index += 1)
    await window.keyboard.press('ArrowLeft')
  await window.keyboard.up('Shift')
  await window.locator('[data-inline-menu="main"] [data-editor-action="cloze"]').click()

  const source = sourceBlock(editor, 'Alpha')
  const clozes = source.locator('[data-cloze-card-id]')
  await expect(clozes).toHaveCount(2)
  const cardIds = await clozes.evaluateAll(elements => elements.map(element => (
    element.getAttribute('data-cloze-card-id')
  )))
  const [firstCardId, secondCardId] = cardIds
  if (!firstCardId || !secondCardId || firstCardId === secondCardId)
    throw new Error('The multi-Cloze Source Block did not create two distinct sibling Cards')
  return [firstCardId, secondCardId]
}

test('previews multi-line Basic Cards with forward, reverse, and bidirectional Card Topics', async () => {
  await withCardApplication('memorilo-card-directions-', async (window) => {
    const editor = await createNoteEditor(window, 'Card direction coverage')

    await window.keyboard.type('Forward question line one')
    await window.keyboard.press('Shift+Enter')
    await window.keyboard.type('Forward question line two:-> Forward answer line one')
    await window.keyboard.press('Shift+Enter')
    await window.keyboard.type('Forward answer line two')
    await window.keyboard.press('Enter')
    await window.keyboard.type('Reverse prompt:-< Reverse answer')
    await window.keyboard.press('Enter')
    await window.keyboard.type('Bidirectional prompt:<> Bidirectional answer')
    await expect(editor.locator('[data-card-delimiter]')).toHaveCount(3)

    const forwardPreview = await openCardTopicPreview(window, 'basic', 'Forward question')
    const forwardSurface = forwardPreview.locator('[data-card-id]').first()
    expect(await visibleText(forwardSurface)).toContain('Forward question line one')
    expect(await visibleText(forwardSurface)).toContain('Forward question line two')
    expect(await visibleText(forwardSurface)).not.toContain('Forward answer line one')
    const questionBreakVisibility = await forwardSurface.locator('br:not(.ProseMirror-trailingBreak)').evaluateAll(elements => (
      elements.map(element => getComputedStyle(element).display !== 'none')
    ))
    expect(questionBreakVisibility).toEqual([true])
    await forwardPreview.locator('[data-card-action="reveal-answer"]').click()
    expect(await visibleText(forwardSurface)).toContain('Forward answer line one')
    expect(await visibleText(forwardSurface)).toContain('Forward answer line two')
    const revealedBreakVisibility = await forwardSurface.locator('br:not(.ProseMirror-trailingBreak)').evaluateAll(elements => (
      elements.map(element => getComputedStyle(element).display !== 'none')
    ))
    expect(revealedBreakVisibility).toEqual([true, true])
    await forwardPreview.locator('[data-card-action="close-preview"]').click()

    const reversePreview = await openCardTopicPreview(window, 'basic', 'Reverse prompt')
    const reverseSurface = reversePreview.locator('[data-card-id]').first()
    expect(await visibleText(reverseSurface)).toContain('Reverse answer')
    expect(await visibleText(reverseSurface)).not.toContain('Reverse prompt')
    await reversePreview.locator('[data-card-action="reveal-answer"]').click()
    expect(await visibleText(reverseSurface)).toContain('Reverse prompt')
    await reversePreview.locator('[data-card-action="close-preview"]').click()

    const bidirectionalPreview = await openCardTopicPreview(window, 'basic', 'Bidirectional prompt')
    const bidirectionalSurface = bidirectionalPreview.locator('[data-card-id]').first()
    expect(await visibleText(bidirectionalSurface)).toContain('Bidirectional prompt')
    expect(await visibleText(bidirectionalSurface)).not.toContain('Bidirectional answer')
    await bidirectionalPreview.locator('[data-card-direction="backward"]').click()
    expect(await visibleText(bidirectionalSurface)).toContain('Bidirectional answer')
    expect(await visibleText(bidirectionalSurface)).not.toContain('Bidirectional prompt')
    await bidirectionalPreview.locator('[data-card-action="reveal-answer"]').click()
    expect(await visibleText(bidirectionalSurface)).toContain('Bidirectional prompt')
  })
})

test('previews a ListCard by revealing ordered items one at a time', async () => {
  await withCardApplication('memorilo-list-card-preview-', async (window) => {
    const editor = await createNoteEditor(window, 'ListCard coverage')
    await convertToMultiLineCard(
      window,
      editor,
      'List answer',
      'First two planets',
      'Mercury',
      'Venus',
    )

    const preview = await openCardTopicPreview(window, 'list', 'First two planets')
    const surface = preview.locator('[data-card-id]').first()
    expect(await visibleText(surface)).toContain('First two planets')
    expect(await visibleText(surface)).not.toContain('Mercury')
    expect(await visibleText(surface)).not.toContain('Venus')

    await preview.locator('[data-card-action="reveal-next"]').click()
    expect(await visibleText(surface)).toContain('Mercury')
    expect(await visibleText(surface)).not.toContain('Venus')
    await preview.locator('[data-card-action="reveal-next"]').click()
    const revealedText = await visibleText(surface)
    expect(revealedText.indexOf('Mercury')).toBeLessThan(revealedText.indexOf('Venus'))
  })
})

test('previews a SetCard by revealing all unordered items together', async () => {
  await withCardApplication('memorilo-set-card-preview-', async (window) => {
    const editor = await createNoteEditor(window, 'SetCard coverage')
    await convertToMultiLineCard(
      window,
      editor,
      'Set answer',
      'Primary colors',
      'Red',
      'Blue',
    )

    const preview = await openCardTopicPreview(window, 'set', 'Primary colors')
    const surface = preview.locator('[data-card-id]').first()
    expect(await visibleText(surface)).toContain('Primary colors')
    expect(await visibleText(surface)).not.toContain('Red')
    expect(await visibleText(surface)).not.toContain('Blue')

    await preview.locator('[data-card-action="reveal-answer"]').click()
    expect(await visibleText(surface)).toContain('Red')
    expect(await visibleText(surface)).toContain('Blue')
  })
})

test('previews and reveals a Cloze Card through the real Editor workflow', async () => {
  await withCardApplication('memorilo-cloze-preview-', async (window) => {
    const editor = await createNoteEditor(window, 'Cloze coverage')
    await window.keyboard.type('The closest planet is Mercury.')
    await window.keyboard.press('ArrowLeft')
    await window.keyboard.down('Shift')
    for (let index = 0; index < 'Mercury'.length; index += 1)
      await window.keyboard.press('ArrowLeft')
    await window.keyboard.up('Shift')
    await window.locator('[data-inline-menu="main"] [data-editor-action="cloze"]').click()

    const source = sourceBlock(editor, 'The closest planet')
    await expect(source.locator('[data-cloze-group-id]')).toHaveText('Mercury')
    const preview = await openCardTopicPreview(window, 'cloze', 'Mercury')
    const surface = preview.locator('[data-card-id]').first()
    await expect(surface.locator('[data-card-hidden-cloze]')).toBeVisible()
    expect(await visibleText(surface)).not.toContain('Mercury')
    await expect(surface.locator('[data-card-delimiter]')).toHaveCount(0)

    await preview.locator('[data-card-action="reveal-answer"]').click()
    await expect(surface.locator('[data-card-hidden-cloze]')).toHaveCount(0)
    expect(await visibleText(surface)).toContain('Mercury')
  })
})

test('keeps a multi-line Basic delimiter visible while moving from editing into Learning Review', async () => {
  await withCardApplication('memorilo-learning-review-card-', async (window) => {
    const title = 'Learning Review card coverage'
    const editor = await createNoteEditor(window, title)
    await window.keyboard.type('Review question line one')
    await window.keyboard.press('Shift+Enter')
    await window.keyboard.type('Review question line two:-> Review answer line one')
    await window.keyboard.press('Shift+Enter')
    await window.keyboard.type('Review answer line two')
    await expect(editor.locator('[data-card-delimiter]')).toHaveCount(1)

    await window.locator('a[href="/learning"]').click()
    await window.locator('a[href*="/learning/review"]').filter({ hasText: title }).click()

    const surface = window.locator('[data-card-surface="review"]')
    await expect(surface).toHaveAttribute('data-card-side', 'question')
    await expectDelimiter(surface, 'forward', '→')
    await markEditorMount(surface, 'learning-review')
    expect(await visibleText(surface)).toContain('Review question line one')
    expect(await visibleText(surface)).toContain('Review question line two')
    expect(await visibleText(surface)).not.toContain('Review answer line one')

    await window.locator('[data-learning-action="reveal-answer"]').click()
    await expect(surface).toHaveAttribute('data-card-side', 'answer')
    expect(await visibleText(surface)).toContain('Review answer line one')
    expect(await visibleText(surface)).toContain('Review answer line two')
    await expectEditorMount(surface, 'learning-review')
    await expectDelimiter(surface, 'forward', '→')
  })
})

test('persists FSRS Ratings, advances the Review Queue, and remains complete after relaunch', async () => {
  const environment = await createPagesTestEnvironment('memorilo-review-rating-chain-', [])
  const title = 'Persistent Rating coverage'
  try {
    await withCardWindow(environment, async (window) => {
      const editor = await createNoteEditor(window, title)
      await window.keyboard.type('First persistent prompt:-> First persistent answer')
      await window.keyboard.press('Enter')
      await window.keyboard.type('Second persistent prompt:-> Second persistent answer')
      await expect(editor.locator('[data-card-delimiter]')).toHaveCount(2)

      await startNoteReview(window, title)
      const surface = window.locator('[data-card-surface="review"]')
      await expect(surface).toHaveAttribute('data-card-side', 'question')
      expect(await visibleText(surface)).toContain('First persistent prompt')
      expect(await visibleText(surface)).not.toContain('First persistent answer')

      await revealAndRate(window, 'Easy')
      await expect(surface).toHaveAttribute('data-card-side', 'question')
      await expect.poll(() => visibleText(surface)).toContain('Second persistent prompt')
      expect(await visibleText(surface)).not.toContain('First persistent prompt')
      await expect(window.locator('[data-learning-progress]'))
        .toHaveAttribute('aria-valuenow', '1')
    })

    await withCardWindow(environment, async (window) => {
      await startNoteReview(window, title)
      const surface = window.locator('[data-card-surface="review"]')
      await expect(surface).toHaveAttribute('data-card-side', 'question')
      expect(await visibleText(surface)).toContain('Second persistent prompt')
      expect(await visibleText(surface)).not.toContain('First persistent prompt')
      await expect(window.locator('[data-learning-progress]'))
        .toHaveAttribute('aria-valuenow', '1')

      await revealAndRate(window, 'Easy')
      await expect(window.locator('[data-learning-review-state="complete"]')).toBeVisible()
      await expect(window.locator('[data-learning-review-state="complete"]')).toBeVisible()
    })

    await withCardWindow(environment, async (window) => {
      await startNoteReview(window, title)
      await expect(window.locator('[data-learning-review-state="complete"]')).toBeVisible()
      await expect(window.locator('[data-card-surface="review"]')).toHaveCount(0)
    })
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})

test('rates Reverse and both Bidirectional directions through FSRS with sibling bury and relaunch', async () => {
  test.setTimeout(120_000)
  const environment = await createPagesTestEnvironment('memorilo-direction-rating-chain-', [])
  const initialReviewAt = Date.now() + 60_000
  const title = 'Directional Rating coverage'
  let reverseCardId = ''
  let bidirectionalForwardCardId = ''
  let bidirectionalBackwardCardId = ''

  try {
    await withCardWindow(environment, async (window) => {
      const editor = await createNoteEditor(window, title)
      await window.keyboard.type('Reverse prompt:-< Reverse answer')
      await window.keyboard.press('Enter')
      await window.keyboard.type('Bidirectional prompt:<> Bidirectional answer')
      await expect(editor.locator('[data-card-delimiter]')).toHaveCount(2)

      const reverseDelimiter = sourceBlock(editor, 'Reverse prompt').locator('[data-card-delimiter]')
      reverseCardId = await reverseDelimiter.getAttribute('data-backward-card-id') ?? ''
      const bidirectionalDelimiter = sourceBlock(editor, 'Bidirectional prompt').locator('[data-card-delimiter]')
      bidirectionalForwardCardId = await bidirectionalDelimiter.getAttribute('data-forward-card-id') ?? ''
      bidirectionalBackwardCardId = await bidirectionalDelimiter.getAttribute('data-backward-card-id') ?? ''
      if (!reverseCardId || !bidirectionalForwardCardId || !bidirectionalBackwardCardId)
        throw new Error('Directional Cards are missing stable Card IDs')

      await startNoteReview(window, title)
      const session = window.locator('[data-active-review-card-id]')
      const surface = window.locator('[data-card-surface="review"]')

      await expect(session).toHaveAttribute('data-active-review-card-id', reverseCardId)
      await expect(surface).toHaveAttribute('data-card-side', 'question')
      await expectDelimiter(surface, 'backward', '←')
      await expect.poll(() => visibleText(surface)).toContain('Reverse answer')
      expect(await visibleText(surface)).not.toContain('Reverse prompt')

      await window.locator('[data-learning-action="reveal-answer"]').click()
      await expect(surface).toHaveAttribute('data-card-side', 'answer')
      await expect.poll(() => visibleText(surface)).toContain('Reverse prompt')
      await expectDelimiter(surface, 'backward', '←')
      await rateRevealedCard(window, 'Easy')

      await expect(session).toHaveAttribute('data-active-review-card-id', bidirectionalForwardCardId)
      await expect(surface).toHaveAttribute('data-card-side', 'question')
      await expectDelimiter(surface, 'both', '↔')
      await expect.poll(() => visibleText(surface)).toContain('Bidirectional prompt')
      expect(await visibleText(surface)).not.toContain('Bidirectional answer')

      await window.locator('[data-learning-action="reveal-answer"]').click()
      await expect(surface).toHaveAttribute('data-card-side', 'answer')
      await expect.poll(() => visibleText(surface)).toContain('Bidirectional answer')
      await expectDelimiter(surface, 'both', '↔')
      await rateRevealedCard(window, 'Easy')

      await expect(window.locator('[data-learning-review-state="complete"]')).toBeVisible()
      await expect(window.locator('[data-card-surface="review"]')).toHaveCount(0)
    }, initialReviewAt)

    await withCardWindow(environment, async (window) => {
      await startNoteReview(window, title)
      await expect(window.locator('[data-learning-review-state="complete"]')).toBeVisible()
      await expect(window.locator('[data-card-surface="review"]')).toHaveCount(0)
    }, initialReviewAt)

    const siblingStudyAt = nextStudyDay(initialReviewAt)
    await withCardWindow(environment, async (window) => {
      await startNoteReview(window, title)
      const session = window.locator('[data-active-review-card-id]')
      const surface = window.locator('[data-card-surface="review"]')

      await expect(session).toHaveAttribute('data-active-review-card-id', bidirectionalBackwardCardId)
      await expect(surface).toHaveAttribute('data-card-side', 'question')
      await expectDelimiter(surface, 'both', '↔')
      await expect.poll(() => visibleText(surface)).toContain('Bidirectional answer')
      expect(await visibleText(surface)).not.toContain('Bidirectional prompt')

      await window.locator('[data-learning-action="reveal-answer"]').click()
      await expect(surface).toHaveAttribute('data-card-side', 'answer')
      await expect.poll(() => visibleText(surface)).toContain('Bidirectional prompt')
      await expectDelimiter(surface, 'both', '↔')
      await rateRevealedCard(window, 'Easy')

      await expect(window.locator('[data-learning-review-state="complete"]')).toBeVisible()
    }, siblingStudyAt)

    await withCardWindow(environment, async (window) => {
      await startNoteReview(window, title)
      await expect(window.locator('[data-learning-review-state="complete"]')).toBeVisible()
      await expect(window.locator('[data-card-surface="review"]')).toHaveCount(0)
    }, siblingStudyAt)
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})

test('learns List, Set, and sibling Cloze Cards across Study Days, then reviews and optimizes FSRS', async () => {
  test.setTimeout(300_000)
  const environment = await createPagesTestEnvironment('memorilo-fsrs-sibling-chain-', [])
  const initialReviewAt = Date.now() + 60_000
  const listTitle = 'FSRS List chain'
  const setTitle = 'FSRS Set chain'
  const clozeTitle = 'FSRS Cloze siblings'
  let listCardId = ''
  let setCardId = ''
  let clozeCardIds: readonly [string, string] = ['', '']
  let firstDayStates: readonly ObservedLearningState[] = []
  let secondDayStates: readonly ObservedLearningState[] = []
  let buriedNewClozeCardId = ''
  let buriedReviewClozeCardId = ''
  let reviewDayStates: readonly ObservedLearningState[] = []

  try {
    await withCardWindow(environment, async (window) => {
      const listEditor = await createNoteEditor(window, listTitle)
      const listSource = await convertToMultiLineCard(
        window,
        listEditor,
        'List answer',
        'Ordered launch sequence',
        'Ignition',
        'Liftoff',
      )
      listCardId = await listSource.locator('[data-card-delimiter]').getAttribute('data-forward-card-id') ?? ''
      if (!listCardId)
        throw new Error('The ListCard is missing its forward CardID')

      const setEditor = await createNoteEditor(window, setTitle)
      const setSource = await convertToMultiLineCard(
        window,
        setEditor,
        'Set answer',
        'Primary pigments',
        'Cyan',
        'Magenta',
      )
      setCardId = await setSource.locator('[data-card-delimiter]').getAttribute('data-forward-card-id') ?? ''
      if (!setCardId)
        throw new Error('The SetCard is missing its forward CardID')

      const clozeEditor = await createNoteEditor(window, clozeTitle)
      clozeCardIds = await createTwoClozeCards(window, clozeEditor)
      await waitForLearningTargets(window, {
        [clozeCardIds[0]]: 1,
        [clozeCardIds[1]]: 1,
        [listCardId]: 3,
        [setCardId]: 3,
      })

      const initialQueue = await window.evaluate(async (now) => {
        const response = await fetch('memorilo://api/rpc/learning/listQueue', {
          body: JSON.stringify({ args: [{ limit: 100, now }] }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
        if (!response.ok)
          throw new Error(`Desktop request failed with status ${response.status}`)
        return response.json() as Promise<Awaited<ReturnType<DesktopApi['learning']['listQueue']>>>
      }, initialReviewAt)
      const initiallyQueuedCards = new Set(initialQueue
        .filter(item => item.kind === 'review')
        .map(item => item.cardId))
      expect(initiallyQueuedCards.has(listCardId)).toBe(true)
      expect(initiallyQueuedCards.has(setCardId)).toBe(true)
      expect(clozeCardIds.filter(cardId => initiallyQueuedCards.has(cardId))).toHaveLength(1)

      await startGlobalReview(window)
      const outcome = await studyAvailableCards(
        window,
        (_targetId, previousRatings) => previousRatings < 2 ? 'Again' : 'Easy',
      )
      const shownCards = new Set(outcome.cardIds)
      expect(shownCards.has(listCardId)).toBe(true)
      expect(shownCards.has(setCardId)).toBe(true)
      const shownClozeCards = clozeCardIds.filter(cardId => shownCards.has(cardId))
      expect(shownClozeCards).toHaveLength(1)
      buriedNewClozeCardId = clozeCardIds.find(cardId => !shownCards.has(cardId)) ?? ''
      if (!buriedNewClozeCardId)
        throw new Error('New sibling bury did not withhold exactly one Cloze Card')

      firstDayStates = await learningStates(window, [listCardId, setCardId, ...clozeCardIds])
      expect(firstDayStates).toHaveLength(8)
      for (const observed of firstDayStates) {
        if (observed.cardId === buriedNewClozeCardId) {
          expect(observed.state.phase).toBe('new')
          expect(observed.state.reps).toBe(0)
          expect(observed.state.winningEventId).toBeNull()
          continue
        }
        expect(observed.state.phase).toBe('review')
        expect(observed.state.reps).toBeGreaterThanOrEqual(3)
        expect(observed.state.dueAt).toBeGreaterThan(initialReviewAt)
      }
    }, initialReviewAt)

    const firstReviewDueAt = Math.min(...firstDayStates
      .filter(observed => observed.cardId !== buriedNewClozeCardId)
      .map(observed => observed.state.dueAt))
    const siblingStudyAt = nextStudyDay(initialReviewAt)
    expect(siblingStudyAt).toBeLessThan(firstReviewDueAt)

    await withCardWindow(environment, async (window) => {
      await startGlobalReview(window)
      const outcome = await studyAvailableCards(
        window,
        () => 'Easy',
      )
      expect(new Set(outcome.cardIds)).toEqual(new Set([buriedNewClozeCardId]))

      secondDayStates = await learningStates(window, [listCardId, setCardId, ...clozeCardIds])
      for (const observed of secondDayStates) {
        expect(observed.state.phase).toBe('review')
        expect(observed.state.dueAt).toBeGreaterThan(siblingStudyAt)
      }
    }, siblingStudyAt)

    const reviewAt = Math.max(...secondDayStates.map(observed => observed.state.dueAt)) + 86_400_000
    await withCardWindow(environment, async (window) => {
      await startGlobalReview(window)
      const outcome = await studyAvailableCards(window, () => 'Good')
      const reviewedCards = new Set(outcome.cardIds)
      expect(reviewedCards.has(listCardId)).toBe(true)
      expect(reviewedCards.has(setCardId)).toBe(true)
      const reviewedClozeCards = clozeCardIds.filter(cardId => reviewedCards.has(cardId))
      expect(reviewedClozeCards).toHaveLength(1)
      buriedReviewClozeCardId = clozeCardIds.find(cardId => !reviewedCards.has(cardId)) ?? ''
      if (!buriedReviewClozeCardId)
        throw new Error('Review sibling bury did not withhold exactly one due Cloze Card')

      reviewDayStates = await learningStates(window, [listCardId, setCardId, ...clozeCardIds])
      const beforeByTarget = new Map(secondDayStates.map(observed => [observed.targetId, observed]))
      for (const observed of reviewDayStates) {
        const before = beforeByTarget.get(observed.targetId)
        if (!before)
          throw new Error(`Review Target ${observed.targetId} disappeared during Review`)
        if (observed.cardId === buriedReviewClozeCardId) {
          expect(observed.state.winningEventId).toBe(before.state.winningEventId)
          expect(observed.state.dueAt).toBe(before.state.dueAt)
          expect(observed.state.dueAt).toBeLessThanOrEqual(reviewAt)
          continue
        }
        expect(observed.state.winningEventId).not.toBe(before.state.winningEventId)
        expect(observed.state.phase).toBe('review')
        expect(observed.state.dueAt).toBeGreaterThan(reviewAt)
      }
    }, reviewAt)

    const finalReviewAt = nextStudyDay(reviewAt)
    const nextOtherReviewAt = Math.min(...reviewDayStates
      .filter(observed => observed.cardId !== buriedReviewClozeCardId)
      .map(observed => observed.state.dueAt))
    expect(finalReviewAt).toBeLessThan(nextOtherReviewAt)

    await withCardWindow(environment, async (window) => {
      await startGlobalReview(window)
      const outcome = await studyAvailableCards(window, () => 'Good')
      expect(new Set(outcome.cardIds)).toEqual(new Set([buriedReviewClozeCardId]))

      const allCardIds = [listCardId, setCardId, ...clozeCardIds]
      const finalStates = await learningStates(window, allCardIds)
      for (const observed of finalStates) {
        expect(observed.state.phase).toBe('review')
        expect(observed.state.dueAt).toBeGreaterThan(finalReviewAt)
      }

      const optimization = await window.evaluate(async ({ at, cardIds, noteTitle }) => {
        const request = async <Result>(method: string, args: readonly unknown[]): Promise<Result> => {
          const response = await fetch(`memorilo://api/rpc/learning/${method}`, {
            body: JSON.stringify({ args }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
          if (!response.ok)
            throw new Error(`Desktop request failed with status ${response.status}`)
          return response.json() as Promise<Result>
        }
        const note = (await request<Awaited<ReturnType<DesktopApi['learning']['listNotesWithCards']>>>('listNotesWithCards', []))
          .find(candidate => candidate.noteTitle === noteTitle)
        if (!note)
          throw new Error(`Could not find Learning Note ${noteTitle}`)
        const before = await request<Awaited<ReturnType<DesktopApi['learning']['getNoteOptimizer']>>>('getNoteOptimizer', [note.noteId])
        const optimized = await request<Awaited<ReturnType<DesktopApi['learning']['optimizeOptimizer']>>>('optimizeOptimizer', [{
          optimizerId: before.id,
          rescheduleNow: true,
          timeoutMilliseconds: 10_000,
        }])
        const states = (await Promise.all(cardIds.map(async (cardId) => {
          const targets = await request<Awaited<ReturnType<DesktopApi['learning']['listTargets']>>>('listTargets', [cardId])
          return Promise.all(targets.map(target => request<Awaited<ReturnType<DesktopApi['learning']['getLearningState']>>>('getLearningState', [target.targetId])))
        }))).flat()
        const queue = await request<Awaited<ReturnType<DesktopApi['learning']['listQueue']>>>('listQueue', [{ now: at }])
        return {
          beforeRevisionId: before.revisionId,
          optimized,
          queue,
          states,
        }
      }, { at: finalReviewAt, cardIds: allCardIds, noteTitle: listTitle })

      expect(optimization.optimized.revisionId).not.toBe(optimization.beforeRevisionId)
      expect(optimization.optimized.configuration.fsrsParameters).toHaveLength(21)
      expect(optimization.optimized.configuration.fsrsParameters.every(Number.isFinite)).toBe(true)
      expect(optimization.queue).toEqual([])
      for (const state of optimization.states) {
        expect(state.optimizerRevisionId).toBe(optimization.optimized.revisionId)
        expect(state.phase).toBe('review')
        expect(state.dueAt).toBeGreaterThan(finalReviewAt)
      }
    }, finalReviewAt)
  }
  finally {
    await removePagesTestEnvironment(environment)
  }
})
