import type { NodeJSON } from 'prosekit/core'
import type { ReactNode } from 'react'
import type { ClozeMarkAttrs, HighlightColor } from './card-model'
import * as stylex from '@stylexjs/stylex'
import i18next from 'i18next'
import { render as renderKaTeX } from 'katex'
import { Fragment, useLayoutEffect, useRef } from 'react'

import { cardPreviewStyles } from './card-preview.stylex'

interface RenderContext {
  clozeCardId?: string
  revealCloze: boolean
}

function readClozeAttrs(node: NodeJSON, cardId: string | undefined): ClozeMarkAttrs | undefined {
  if (!cardId)
    return undefined
  const mark = node.marks?.find(candidate => candidate.type === 'cloze' && candidate.attrs?.cardId === cardId)
  if (!mark)
    return undefined
  const attrs = mark.attrs
  if (!attrs)
    throw new TypeError('Cloze mark attributes are required in Card Preview')
  const anchorKind = attrs.anchorKind
  if (anchorKind !== 'rich-content' && anchorKind !== 'math-source')
    throw new TypeError(`Unsupported Cloze anchor kind in Card Preview: ${String(anchorKind)}`)
  if (typeof attrs.cardId !== 'string' || typeof attrs.definitionId !== 'string' || typeof attrs.groupId !== 'string')
    throw new TypeError('Cloze identities must be strings in Card Preview')
  return {
    anchorKind,
    cardId: attrs.cardId,
    definitionId: attrs.definitionId,
    groupId: attrs.groupId,
  }
}

function hiddenCloze(key: string): ReactNode {
  return (
    <span key={key} {...stylex.props(cardPreviewStyles.hiddenCloze)} aria-label={i18next.t('ui.hiddenCloze', { ns: 'editor' })} data-card-hidden-cloze="">
      ···
    </span>
  )
}

function inlineHighlightStyle(color: HighlightColor) {
  if (color === 'yellow')
    return cardPreviewStyles.inlineYellow
  if (color === 'green')
    return cardPreviewStyles.inlineGreen
  if (color === 'blue')
    return cardPreviewStyles.inlineBlue
  if (color === 'pink')
    return cardPreviewStyles.inlinePink
  if (color === 'orange')
    return cardPreviewStyles.inlineOrange
  return cardPreviewStyles.inlinePurple
}

function applyMarks(node: NodeJSON, content: ReactNode, key: string): ReactNode {
  return node.marks?.reduce<ReactNode>((child, mark, index) => {
    const markKey = `${key}-mark-${index}`
    if (mark.type === 'cloze')
      return child
    if (mark.type === 'bold')
      return <strong key={markKey}>{child}</strong>
    if (mark.type === 'italic')
      return <em key={markKey}>{child}</em>
    if (mark.type === 'underline')
      return <u key={markKey}>{child}</u>
    if (mark.type === 'strike')
      return <s key={markKey}>{child}</s>
    if (mark.type === 'code')
      return <code key={markKey} {...stylex.props(cardPreviewStyles.inlineCode)}>{child}</code>
    if (mark.type === 'link') {
      const href = mark.attrs?.href
      if (typeof href !== 'string' || href.length === 0)
        throw new TypeError('Card Preview links require a non-empty href')
      return <a key={markKey} {...stylex.props(cardPreviewStyles.link)} href={href}>{child}</a>
    }
    if (mark.type === 'inlineHighlight') {
      const color = mark.attrs?.color
      if (color !== 'yellow' && color !== 'green' && color !== 'blue' && color !== 'pink' && color !== 'orange' && color !== 'purple')
        throw new TypeError(`Unsupported inline Highlight color in Card Preview: ${String(color)}`)
      return (
        <mark key={markKey} {...stylex.props(inlineHighlightStyle(color))} data-inline-highlight={color}>
          {child}
        </mark>
      )
    }
    return <span key={markKey} data-editor-mark={mark.type}>{child}</span>
  }, content) ?? content
}

function mathSource(node: NodeJSON, context: RenderContext): {
  accessible: string
  hasTargetCloze: boolean
  source: string
} {
  let accessible = ''
  let source = ''
  let hasTargetCloze = false
  for (const child of node.content ?? []) {
    if (child.type !== 'text' || typeof child.text !== 'string')
      throw new TypeError('Math nodes may only contain text source in Card Preview')
    const cloze = readClozeAttrs(child, context.clozeCardId)
    if (cloze?.anchorKind === 'math-source') {
      hasTargetCloze = true
      if (!context.revealCloze) {
        accessible += '[…]'
        source += '\\text{\\ldots}'
        continue
      }
    }
    accessible += child.text
    source += child.text
  }
  return { accessible, hasTargetCloze, source }
}

function MathContent({
  accessible,
  displayMode,
  revealedKind,
  source,
}: {
  accessible: string
  displayMode: boolean
  revealedKind?: ClozeMarkAttrs['anchorKind']
  source: string
}) {
  const elementRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element)
      throw new Error('Card Preview math element is missing')
    renderKaTeX(source, element, {
      displayMode,
      output: 'mathml',
      throwOnError: false,
    })
  }, [displayMode, source])

  return (
    <span
      ref={elementRef}
      {...stylex.props(cardPreviewStyles.formula, displayMode && cardPreviewStyles.formulaBlock, revealedKind && cardPreviewStyles.revealedCloze)}
      aria-label={`Formula: ${accessible}`}
      data-cloze-revealed={revealedKind}
      data-math-source={source}
      role="math"
    />
  )
}

function renderMath(node: NodeJSON, key: string, context: RenderContext, displayMode: boolean): ReactNode {
  const ownCloze = readClozeAttrs(node, context.clozeCardId)
  const sourceRichCloze = node.content
    ?.map(child => readClozeAttrs(child, context.clozeCardId))
    .find(cloze => cloze?.anchorKind === 'rich-content')
  if ((ownCloze?.anchorKind === 'rich-content' || sourceRichCloze) && !context.revealCloze)
    return hiddenCloze(key)

  const source = mathSource(node, context)
  const revealedKind = ownCloze?.anchorKind === 'rich-content' || sourceRichCloze
    ? 'rich-content'
    : source.hasTargetCloze && context.revealCloze ? 'math-source' : undefined
  return (
    <MathContent
      key={key}
      accessible={source.accessible}
      displayMode={displayMode}
      revealedKind={revealedKind}
      source={source.source}
    />
  )
}

function renderChildren(node: NodeJSON, key: string, context: RenderContext): ReactNode[] {
  return node.content?.map((child, index) => renderNode(child, `${key}-${index}`, context)) ?? []
}

function renderText(node: NodeJSON, key: string, context: RenderContext): ReactNode {
  if (typeof node.text !== 'string')
    throw new TypeError('Text nodes require text in Card Preview')
  const cloze = readClozeAttrs(node, context.clozeCardId)
  if (cloze && !context.revealCloze)
    return hiddenCloze(key)
  const marked = applyMarks(node, node.text, key)
  if (!cloze)
    return <Fragment key={key}>{marked}</Fragment>
  return (
    <span key={key} {...stylex.props(cardPreviewStyles.revealedCloze)} data-cloze-revealed={cloze.anchorKind}>
      {marked}
    </span>
  )
}

function renderNode(node: NodeJSON, key: string, context: RenderContext): ReactNode {
  if (node.type === 'text')
    return renderText(node, key, context)
  if (node.type === 'mathInline')
    return renderMath(node, key, context, false)
  if (node.type === 'mathBlock')
    return renderMath(node, key, context, true)

  const ownCloze = readClozeAttrs(node, context.clozeCardId)
  if (ownCloze?.anchorKind === 'rich-content' && !context.revealCloze)
    return hiddenCloze(key)

  const children = renderChildren(node, key, context)
  let content: ReactNode
  if (node.type === 'paragraph') {
    content = <p key={key} {...stylex.props(cardPreviewStyles.paragraph)}>{children}</p>
  }
  else if (node.type === 'heading') {
    const level = node.attrs?.level
    if (level === 1)
      content = <h1 key={key} {...stylex.props(cardPreviewStyles.heading)}>{children}</h1>
    else if (level === 2)
      content = <h2 key={key} {...stylex.props(cardPreviewStyles.heading)}>{children}</h2>
    else if (level === 3)
      content = <h3 key={key} {...stylex.props(cardPreviewStyles.heading)}>{children}</h3>
    else if (level === 4)
      content = <h4 key={key} {...stylex.props(cardPreviewStyles.heading)}>{children}</h4>
    else if (level === 5)
      content = <h5 key={key} {...stylex.props(cardPreviewStyles.heading)}>{children}</h5>
    else if (level === 6)
      content = <h6 key={key} {...stylex.props(cardPreviewStyles.heading)}>{children}</h6>
    else
      throw new TypeError(`Unsupported heading level in Card Preview: ${String(level)}`)
  }
  else if (node.type === 'blockquote') {
    content = <blockquote key={key} {...stylex.props(cardPreviewStyles.blockquote)}>{children}</blockquote>
  }
  else if (node.type === 'codeBlock') {
    content = <pre key={key} {...stylex.props(cardPreviewStyles.codeBlock)}><code>{node.text ?? node.content?.map(child => child.text).join('')}</code></pre>
  }
  else if (node.type === 'hardBreak') {
    content = <br key={key} />
  }
  else if (node.type === 'horizontalRule') {
    content = <hr key={key} />
  }
  else if (node.type === 'image') {
    const src = node.attrs?.src
    if (typeof src !== 'string' || src.length === 0)
      throw new TypeError('Card Preview images require a non-empty src')
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
    content = <img key={key} {...stylex.props(cardPreviewStyles.image)} alt={alt} src={src} />
  }
  else if (node.type === 'tag') {
    const label = node.attrs?.label
    if (typeof label !== 'string')
      throw new TypeError('Card Preview tags require a label')
    content = (
      <span key={key}>
        #
        {label}
      </span>
    )
  }
  else if (node.type === 'list') {
    const kind = node.attrs?.kind
    const List = kind === 'ordered' ? 'ol' : 'ul'
    content = (
      <List key={key} {...stylex.props(cardPreviewStyles.nestedList)} data-list-kind={typeof kind === 'string' ? kind : undefined}>
        <li>{children}</li>
      </List>
    )
  }
  else if (node.type === 'table') {
    content = <table key={key} {...stylex.props(cardPreviewStyles.table)}><tbody>{children}</tbody></table>
  }
  else if (node.type === 'tableRow') {
    content = <tr key={key}>{children}</tr>
  }
  else if (node.type === 'tableCell') {
    content = <td key={key} {...stylex.props(cardPreviewStyles.tableCell)}>{children}</td>
  }
  else if (node.type === 'tableHeader') {
    content = <th key={key} {...stylex.props(cardPreviewStyles.tableCell)}>{children}</th>
  }
  else {
    content = <span key={key} data-editor-node={node.type}>{children}</span>
  }

  if (!ownCloze)
    return content
  return (
    <span key={`${key}-cloze`} {...stylex.props(cardPreviewStyles.revealedCloze)} data-cloze-revealed={ownCloze.anchorKind}>
      {content}
    </span>
  )
}

export function CardRichContent({ clozeCardId, nodes, revealCloze = true }: {
  clozeCardId?: string
  nodes: readonly NodeJSON[]
  revealCloze?: boolean
}) {
  const context = { clozeCardId, revealCloze }
  return <div {...stylex.props(cardPreviewStyles.content)}>{nodes.map((node, index) => renderNode(node, `node-${index}`, context))}</div>
}
