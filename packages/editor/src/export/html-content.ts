import type {
  EditorContentRenderer,
  EditorExportMark,
  EditorExportNode,
} from './editor-content'
import { renderEditorContent } from './editor-content'

export interface HtmlContentRendererOptions {
  readonly inlineAsset?: (source: string) => string | undefined
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0)
    return null
  try {
    const url = new URL(value, 'https://memorilo-export.invalid')
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol))
      return null
    return value
  }
  catch {
    return null
  }
}

function mathSource(node: EditorExportNode): string {
  return String(node.attrs?.source ?? node.text ?? (node.content ?? []).map(child => child.text ?? '').join(''))
}

function status(node: EditorExportNode): 'doing' | 'done' | 'todo' | null {
  if (node.attrs?.kind !== 'task')
    return null
  if (node.attrs.status === 'doing' || node.attrs.status === 'done' || node.attrs.status === 'todo')
    return node.attrs.status
  return node.attrs.checked === true ? 'done' : 'todo'
}

function taskMarker(value: 'doing' | 'done' | 'todo'): string {
  const border = value === 'done' ? '#4f46e5' : '#9ca3af'
  const fill = value === 'done' ? '#4f46e5' : 'transparent'
  const glyph = value === 'done' ? '&#10003;' : value === 'doing' ? '&#8226;' : ''
  return `<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:1em;height:1em;margin-top:.15em;border:.08em solid ${border};border-radius:999px;background:${fill};color:#fff;font-size:.72em;line-height:1">${glyph}</span>`
}

function createHtmlRenderer(options: HtmlContentRendererOptions): EditorContentRenderer<string> {
  return {
    renderChildren: children => children.join(''),
    renderMark(mark: EditorExportMark, value: string): string {
      switch (mark.type) {
        case 'bold':
          return `<strong>${value}</strong>`
        case 'italic':
          return `<em>${value}</em>`
        case 'underline':
          return `<u>${value}</u>`
        case 'strike':
          return `<s>${value}</s>`
        case 'code':
          return `<code style="padding:.1em .25em;border-radius:.25em;background:#f1f3f5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${value}</code>`
        case 'inlineHighlight':
          return `<mark style="padding:0 .1em;background:#fff0a8">${value}</mark>`
        case 'link': {
          const href = safeHref(mark.attrs?.href)
          return href === null
            ? value
            : `<a href="${escapeAttribute(href)}" style="color:#2457a6;text-decoration:underline">${value}</a>`
        }
        case 'cloze':
          return `<span style="border-bottom:1px dotted #68707d">${value}</span>`
        default:
          return value
      }
    },
    renderNode(node: EditorExportNode, content: string): string {
      switch (node.type) {
        case 'doc':
          return `<div style="color:#1b1c1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.5">${content}</div>`
        case 'text':
          return content
        case 'paragraph':
          return `<p style="margin:.35em 0">${content}</p>`
        case 'heading': {
          const level = typeof node.attrs?.level === 'number' && node.attrs.level >= 1 && node.attrs.level <= 6
            ? node.attrs.level
            : 2
          return `<h${level} style="margin:.7em 0 .35em;font-weight:650;line-height:1.25">${content}</h${level}>`
        }
        case 'blockquote':
          return `<blockquote style="margin:.6em 0;padding:.15em .8em;border-left:3px solid #c7ccd4;color:#5f6672">${content}</blockquote>`
        case 'codeBlock':
          return `<pre style="margin:.6em 0;padding:.65em .8em;overflow:auto;border-radius:.35em;background:#f1f3f5;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap">${content}</pre>`
        case 'horizontalRule':
          return '<hr style="margin:.8em 0;border:0;border-top:1px solid #d8dce2">'
        case 'list': {
          const kind = node.attrs?.kind
          const taskStatus = status(node)
          if (taskStatus !== null) {
            const textDecoration = taskStatus === 'done' ? 'text-decoration:line-through;color:#68707d;' : ''
            return `<div style="display:grid;grid-template-columns:1.1em minmax(0,1fr);column-gap:.55em;align-items:start;${textDecoration}">${taskMarker(taskStatus)}<div>${content}</div></div>`
          }
          const marker = kind === 'ordered'
            ? `${typeof node.attrs?.order === 'number' ? node.attrs.order : ''}.`
            : '&#8226;'
          return `<div style="display:grid;grid-template-columns:1.1em minmax(0,1fr);column-gap:.55em;align-items:start;margin:.35em 0"><span aria-hidden="true" style="color:#68707d">${marker}</span><div>${content}</div></div>`
        }
        case 'table':
          return `<table style="width:100%;border-collapse:collapse;margin:.6em 0">${content}</table>`
        case 'tableRow':
          return `<tr>${content}</tr>`
        case 'tableCell':
        case 'tableHeaderCell':
          return `<${node.type === 'tableHeaderCell' ? 'th' : 'td'} style="padding:.35em .5em;border:1px solid #d8dce2;text-align:left">${content}</${node.type === 'tableHeaderCell' ? 'th' : 'td'}>`
        case 'hardBreak':
          return '<br>'
        case 'image': {
          const source = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
          const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : 'Image'
          const inlineSource = source.length === 0 ? undefined : options.inlineAsset?.(source)
          return inlineSource === undefined
            ? `<span style="color:#68707d;font-style:italic">[${escapeText(alt)}]</span>`
            : `<img src="${escapeAttribute(inlineSource)}" alt="${escapeAttribute(alt)}" style="display:block;max-width:100%;height:auto;margin:.5em 0">`
        }
        case 'mathInline':
          return `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeText(mathSource(node))}</code>`
        case 'mathBlock':
          return `<div style="margin:.6em 0;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap">${escapeText(mathSource(node))}</div>`
        case 'tag':
          return `<span style="color:#2457a6">#${escapeText(String(node.attrs?.label ?? ''))}</span>`
        case 'cardDelimiter':
          return '<span aria-hidden="true">&#8596;</span>'
        default:
          return content
      }
    },
    renderText: text => escapeText(text),
  }
}

/** Renders the editor tree as a self-contained, inline-styled HTML fragment. */
export function renderHtmlContent(node: EditorExportNode, options: HtmlContentRendererOptions = {}): string {
  return renderEditorContent(node, createHtmlRenderer(options))
}
