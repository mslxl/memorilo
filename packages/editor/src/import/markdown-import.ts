import type { NodeJSON } from 'prosekit/core'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

export type MarkdownImportFlavor = 'commonmark' | 'gfm'

export interface MarkdownImportOptions {
  flavor?: MarkdownImportFlavor
  mapTasks?: boolean
}

export interface MarkdownImportDiagnostic {
  line: number
  message: string
  severity: 'warning'
}

export interface MarkdownImportResult {
  diagnostics: readonly MarkdownImportDiagnostic[]
  document: NodeJSON
  noteTitleCandidate: string
  topicTitleCandidate: string
}

interface MarkdownPosition {
  start?: { line?: number }
}

interface MarkdownNode {
  align?: Array<'center' | 'left' | 'right' | null>
  alt?: string | null
  checked?: boolean | null
  children?: MarkdownNode[]
  depth?: number
  lang?: string | null
  ordered?: boolean
  position?: MarkdownPosition
  start?: number | null
  type: string
  url?: string
  value?: string
}

const networkProtocols = new Set(['http:', 'https:'])

function lineOf(node: MarkdownNode): number {
  const line = node.position?.start?.line
  return typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? line : 1
}

function textNode(text: string, marks?: NodeJSON['marks']): NodeJSON {
  return {
    ...(marks && marks.length > 0 ? { marks } : {}),
    text,
    type: 'text',
  }
}

function paragraph(text: string): NodeJSON {
  return {
    content: text.length === 0 ? [] : [textNode(text)],
    type: 'paragraph',
  }
}

function nodeText(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code' || node.type === 'html')
    return node.value ?? ''
  return (node.children ?? []).map(nodeText).join('')
}

function titleFromFileName(fileName: string): string {
  const base = fileName.replaceAll('\\', '/').split('/').pop() ?? fileName
  const title = base.replace(/\.(?:markdown|md)$/iu, '').trim()
  return title.length > 0 ? title : 'Untitled'
}

function addDiagnostic(
  diagnostics: MarkdownImportDiagnostic[],
  node: MarkdownNode,
  message: string,
): void {
  diagnostics.push({ line: lineOf(node), message, severity: 'warning' })
}

function mark(type: string, attrs?: Record<string, unknown>): NonNullable<NodeJSON['marks']>[number] {
  return attrs === undefined ? { type } : { attrs, type }
}

function inlineNodes(
  nodes: readonly MarkdownNode[],
  diagnostics: MarkdownImportDiagnostic[],
  marks: NonNullable<NodeJSON['marks']> = [],
): NodeJSON[] {
  const result: NodeJSON[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        if ((node.value ?? '').length > 0)
          result.push(textNode(node.value ?? '', marks))
        break
      case 'emphasis':
        result.push(...inlineNodes(node.children ?? [], diagnostics, [...marks, mark('italic')]))
        break
      case 'strong':
        result.push(...inlineNodes(node.children ?? [], diagnostics, [...marks, mark('bold')]))
        break
      case 'delete':
        result.push(...inlineNodes(node.children ?? [], diagnostics, [...marks, mark('strike')]))
        break
      case 'inlineCode':
        if ((node.value ?? '').length > 0)
          result.push(textNode(node.value ?? '', [...marks, mark('code')]))
        break
      case 'link':
      case 'linkReference':
        result.push(...inlineNodes(
          node.children ?? [],
          diagnostics,
          [...marks, mark('link', { href: node.url ?? '' })],
        ))
        break
      case 'break':
        result.push({ type: 'hardBreak' })
        break
      case 'image': {
        const source = node.url ?? ''
        if (source.length === 0) {
          addDiagnostic(diagnostics, node, 'Image has no source URL')
          break
        }
        try {
          const protocol = new URL(source).protocol
          if (!networkProtocols.has(protocol))
            addDiagnostic(diagnostics, node, `Local image path requires asset import: ${source}`)
        }
        catch {
          addDiagnostic(diagnostics, node, `Local image path requires asset import: ${source}`)
        }
        result.push({ attrs: { src: source }, type: 'image' })
        break
      }
      case 'html':
        addDiagnostic(diagnostics, node, 'HTML is not supported and was imported as text')
        if ((node.value ?? '').length > 0)
          result.push(textNode(node.value ?? '', marks))
        break
      case 'footnoteReference':
        addDiagnostic(diagnostics, node, 'Footnotes are not supported and were imported as text')
        result.push(textNode(`[^${node.value ?? ''}]`, marks))
        break
      default:
        addDiagnostic(diagnostics, node, `Unsupported inline Markdown node: ${node.type}`)
        if (nodeText(node).length > 0)
          result.push(textNode(nodeText(node), marks))
        break
    }
  }
  return result
}

function taskAttrs(checked: boolean): Record<string, unknown> {
  return {
    schedule: { kind: 'none' },
    checked,
    elapsedMs: 0,
    reminderMinutes: null,
    reminders: null,
    repeatRule: null,
    startedAt: null,
    status: checked ? 'done' : 'todo',
  }
}

function blockNodes(
  nodes: readonly MarkdownNode[],
  diagnostics: MarkdownImportDiagnostic[],
  mapTasks: boolean,
): NodeJSON[] {
  const result: NodeJSON[] = []
  for (const node of nodes) {
    if (node.type === 'list') {
      result.push(...listBlocks(node, diagnostics, mapTasks))
      continue
    }
    result.push(blockNode(node, diagnostics, mapTasks))
  }
  return result
}

function listBlocks(
  node: MarkdownNode,
  diagnostics: MarkdownImportDiagnostic[],
  mapTasks: boolean,
): NodeJSON[] {
  const children = node.children ?? []
  const ordered = node.ordered === true
  const start = typeof node.start === 'number' ? node.start : 1
  return children.map((item, index) => {
    const itemChildren = item.children ?? []
    const nested = itemChildren.filter(child => child.type === 'list')
    const body = itemChildren.filter(child => child.type !== 'list')
    const checked = item.checked
    const kind = mapTasks && checked !== null && checked !== undefined
      ? 'task'
      : ordered ? 'ordered' : 'bullet'
    const content = blockNodes(body, diagnostics, mapTasks)
    if (content.length === 0)
      content.push(paragraph(''))
    if (!mapTasks && checked !== null && checked !== undefined && content[0]?.type === 'paragraph') {
      content[0] = {
        ...content[0],
        content: [textNode(checked ? '[x] ' : '[ ] '), ...(content[0].content ?? [])],
      }
    }
    const attrs: Record<string, unknown> = {
      ...(kind === 'task' ? taskAttrs(checked === true) : {}),
      kind,
      order: ordered ? start + index : null,
    }
    return {
      attrs,
      content: [...content, ...nested.flatMap(child => listBlocks(child, diagnostics, mapTasks))],
      type: 'list',
    }
  })
}

function tableNode(
  node: MarkdownNode,
  diagnostics: MarkdownImportDiagnostic[],
): NodeJSON {
  return {
    content: (node.children ?? []).map((row, rowIndex) => ({
      content: (row.children ?? []).map(cell => ({
        attrs: {},
        content: [{
          content: inlineNodes(cell.children ?? [], diagnostics),
          type: 'paragraph',
        }],
        type: rowIndex === 0 ? 'tableHeaderCell' : 'tableCell',
      })),
      type: 'tableRow',
    })),
    type: 'table',
  }
}

function blockNode(
  node: MarkdownNode,
  diagnostics: MarkdownImportDiagnostic[],
  mapTasks: boolean,
): NodeJSON {
  switch (node.type) {
    case 'paragraph':
      return { content: inlineNodes(node.children ?? [], diagnostics), type: 'paragraph' }
    case 'heading':
      return {
        attrs: { level: Math.min(6, Math.max(1, node.depth ?? 1)) },
        content: inlineNodes(node.children ?? [], diagnostics),
        type: 'heading',
      }
    case 'blockquote':
      return { content: blockNodes(node.children ?? [], diagnostics, mapTasks), type: 'blockquote' }
    case 'code':
      return {
        attrs: { language: node.lang ?? '' },
        content: node.value === undefined ? [] : [textNode(node.value)],
        type: 'codeBlock',
      }
    case 'thematicBreak':
      return { type: 'horizontalRule' }
    case 'table':
      return tableNode(node, diagnostics)
    case 'html':
      addDiagnostic(diagnostics, node, 'HTML is not supported and was imported as text')
      return paragraph(node.value ?? '')
    case 'yaml':
    case 'toml':
    case 'definition':
      addDiagnostic(diagnostics, node, `${node.type} metadata is not supported and was imported as text`)
      return paragraph(node.value ?? nodeText(node))
    case 'footnoteDefinition':
      addDiagnostic(diagnostics, node, 'Footnotes are not supported and were imported as text')
      return paragraph(nodeText(node))
    default:
      addDiagnostic(diagnostics, node, `Unsupported Markdown node: ${node.type}`)
      return paragraph(nodeText(node))
  }
}

function firstHeading(nodes: readonly MarkdownNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'heading' && node.depth === 1) {
      const title = nodeText(node).trim()
      if (title.length > 0)
        return title
    }
  }
  return null
}

export function parseMarkdownImport(
  source: string,
  fileName: string,
  options: MarkdownImportOptions = {},
): MarkdownImportResult {
  const flavor = options.flavor ?? 'gfm'
  const mapTasks = options.mapTasks ?? true
  const diagnostics: MarkdownImportDiagnostic[] = []
  const parsed = fromMarkdown(source, flavor === 'gfm'
    ? { extensions: [gfm()], mdastExtensions: gfmFromMarkdown() }
    : undefined) as unknown as MarkdownNode
  const children = parsed.children ?? []
  const frontmatter = /^\uFEFF?(?<marker>---|\+\+\+)\r?\n[\s\S]*?\r?\n\k<marker>(?:\r?\n|$)/u.exec(source)
  if (frontmatter) {
    diagnostics.push({
      line: 1,
      message: 'Frontmatter is not supported and was imported as text',
      severity: 'warning',
    })
  }
  const document: NodeJSON = {
    content: blockNodes(children, diagnostics, mapTasks),
    type: 'doc',
  }
  const fileTitle = titleFromFileName(fileName)
  const headingTitle = firstHeading(children)
  return {
    diagnostics,
    document,
    noteTitleCandidate: fileTitle,
    topicTitleCandidate: headingTitle ?? fileTitle,
  }
}
