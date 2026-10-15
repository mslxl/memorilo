const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()
const xlinkNamespace = 'http://www.w3.org/1999/xlink'
const epubContentSecurityPolicy = [
  'default-src \'none\'',
  'script-src blob:',
  'style-src blob: \'unsafe-inline\'',
  'img-src blob: data:',
  'font-src blob: data:',
  'media-src blob: data:',
  'connect-src \'none\'',
  'object-src \'none\'',
  'frame-src \'none\'',
  'worker-src \'none\'',
  'form-action \'none\'',
].join('; ')

export function normalizeEpubPath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? ''
  const decoded = decodeURIComponent(withoutQuery).replaceAll('\\', '/')
  const segments: string[] = []
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.')
      continue
    if (segment === '..') {
      if (segments.length === 0)
        throw new Error(`EPUB resource escapes its container: ${path}`)
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

function directoryName(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator + 1)
}

export function resolveEpubPath(basePath: string, reference: string): string {
  return normalizeEpubPath(`${directoryName(basePath)}${reference}`)
}

export function epubMediaTypeForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  const mediaTypes: Record<string, string> = {
    avif: 'image/avif',
    css: 'text/css',
    gif: 'image/gif',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    ncx: 'application/x-dtbncx+xml',
    otf: 'font/otf',
    png: 'image/png',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    xhtml: 'application/xhtml+xml',
    xml: 'application/xml',
  }
  return extension ? (mediaTypes[extension] ?? 'application/octet-stream') : 'application/octet-stream'
}

export function requiresEpubContentRewrite(mediaType: string): boolean {
  return mediaType === 'text/css'
    || mediaType === 'application/xhtml+xml'
    || mediaType === 'text/html'
}

interface RewriteEpubResourceOptions {
  hasResource: (path: string) => boolean
  mediaType: string
  objectUrl: (path: string, stack: ReadonlySet<string>) => Promise<string>
  path: string
  readResource: (path: string) => Promise<Uint8Array>
  stack?: ReadonlySet<string>
}

export async function rewriteEpubResource({
  hasResource,
  mediaType,
  objectUrl,
  path,
  readResource,
  stack = new Set(),
}: RewriteEpubResourceOptions): Promise<Uint8Array> {
  const rewriteReference = async (reference: string): Promise<string> => {
    const trimmed = reference.trim()
    if (!trimmed || isRemoteReference(trimmed))
      return trimmed
    const { path: referencedPath, suffix } = splitReference(trimmed)
    const resolved = resolveEpubPath(path, referencedPath)
    if (!hasResource(resolved))
      return trimmed
    return `${await objectUrl(resolved, stack)}${suffix}`
  }

  if (mediaType === 'text/css') {
    return rewriteCss(
      textDecoder.decode(await readResource(path)),
      rewriteReference,
    )
  }
  if (mediaType === 'application/xhtml+xml' || mediaType === 'text/html') {
    return rewriteHtml(
      path,
      mediaType,
      textDecoder.decode(await readResource(path)),
      rewriteReference,
    )
  }
  return readResource(path)
}

function isRemoteReference(reference: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference.trim())
}

function isActiveReference(reference: string): boolean {
  let compact = ''
  for (const character of reference) {
    const code = character.charCodeAt(0)
    if (code > 0x20 && code !== 0x7F)
      compact += character
  }
  compact = compact.toLowerCase()
  return compact.startsWith('javascript:')
    || compact.startsWith('vbscript:')
    || compact.startsWith('data:text/html')
    || compact.startsWith('data:application/xhtml+xml')
    || compact.startsWith('data:image/svg+xml')
}

function splitReference(reference: string): { path: string, suffix: string } {
  const queryIndex = reference.indexOf('?')
  const fragmentIndex = reference.indexOf('#')
  const indexes = [queryIndex, fragmentIndex].filter(index => index >= 0)
  const separator = indexes.length > 0 ? Math.min(...indexes) : -1
  return separator < 0
    ? { path: reference, suffix: '' }
    : { path: reference.slice(0, separator), suffix: reference.slice(separator) }
}

async function rewriteCss(
  cssSource: string,
  rewriteReference: (reference: string) => Promise<string>,
): Promise<Uint8Array> {
  let css = await replaceAsync(cssSource, /url\(([^)]*)\)/gi, async (match) => {
    const reference = unquoteCssReference(match[1])
    if (reference === undefined)
      return match[0]
    const rewritten = await rewriteReference(reference)
    return `url("${rewritten.replaceAll('"', '%22')}")`
  })
  css = await replaceAsync(css, /@import\s+(['"])(.*?)\1/gi, async (match) => {
    const reference = match[2]
    if (reference === undefined)
      return match[0]
    const rewritten = await rewriteReference(reference)
    return `@import "${rewritten.replaceAll('"', '%22')}"`
  })
  return textEncoder.encode(css)
}

async function rewriteHtml(
  path: string,
  mediaType: string,
  htmlSource: string,
  rewriteReference: (reference: string) => Promise<string>,
): Promise<Uint8Array> {
  const parserType = mediaType === 'text/html' ? 'text/html' : 'application/xhtml+xml'
  const document = new DOMParser().parseFromString(htmlSource, parserType)
  const parseError = document.querySelector('parsererror')
  if (parseError)
    throw new Error(`Invalid EPUB content document ${path}`)

  document.querySelectorAll([
    'applet',
    'base',
    'embed',
    'iframe',
    'meta[http-equiv="refresh" i]',
    'object',
    'script',
  ].join(', ')).forEach(element => element.remove())
  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase()
      if (attributeName.startsWith('on')
        || attributeName === 'srcdoc'
        || ((attributeName === 'href'
          || attributeName === 'xlink:href'
          || (attribute.localName === 'href' && attribute.namespaceURI === xlinkNamespace)
          || attributeName === 'src'
          || attributeName === 'action'
          || attributeName === 'formaction')
        && isActiveReference(attribute.value))) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  let head = Array.from(document.querySelectorAll('*')).find(element => element.localName === 'head')
  if (!head) {
    const root = document.documentElement
    head = document.createElementNS(root.namespaceURI, 'head')
    root.prepend(head)
  }
  const csp = document.createElementNS(head.namespaceURI, 'meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', epubContentSecurityPolicy)
  head.prepend(csp)

  const targets: Array<{ attribute: string, namespace?: string, selector: string }> = [
    { attribute: 'src', selector: 'audio[src], embed[src], iframe[src], img[src], input[src], source[src], track[src], video[src]' },
    { attribute: 'poster', selector: 'video[poster]' },
    { attribute: 'data', selector: 'object[data]' },
    { attribute: 'href', selector: 'image[href], use[href]' },
    // XML attribute selectors must match the namespace independently of its prefix.
    { attribute: 'href', namespace: xlinkNamespace, selector: '[*|href]' },
  ]
  for (const target of targets) {
    for (const element of Array.from(document.querySelectorAll(target.selector))) {
      const attribute = target.namespace
        ? element.getAttributeNodeNS(target.namespace, target.attribute)
        : element.getAttributeNode(target.attribute)
      const value = attribute?.value
      if (!value)
        continue
      if (isActiveReference(value)) {
        element.removeAttributeNode(attribute)
        continue
      }
      const rewritten = await rewriteReference(value)
      if (target.namespace)
        element.setAttributeNS(target.namespace, attribute.name, rewritten)
      else
        element.setAttribute(attribute.name, rewritten)
    }
  }

  for (const element of Array.from(document.querySelectorAll('link[href]'))) {
    const relation = element.getAttribute('rel')?.toLowerCase().split(/\s+/) ?? []
    if (!relation.includes('stylesheet'))
      continue
    const href = element.getAttribute('href')
    if (href)
      element.setAttribute('href', await rewriteReference(href))
  }

  for (const element of Array.from(document.querySelectorAll('[srcset]'))) {
    const srcset = element.getAttribute('srcset')
    if (!srcset)
      continue
    const candidates = await Promise.all(srcset.split(',').map(async (candidate) => {
      const [reference, ...descriptor] = candidate.trim().split(/\s+/)
      if (!reference)
        return candidate
      const rewritten = await rewriteReference(reference)
      return [rewritten, ...descriptor].join(' ')
    }))
    element.setAttribute('srcset', candidates.join(', '))
  }

  for (const element of Array.from(document.querySelectorAll('[style]'))) {
    const style = element.getAttribute('style')
    if (style)
      element.setAttribute('style', textDecoder.decode(await rewriteCss(style, rewriteReference)))
  }
  for (const element of Array.from(document.querySelectorAll('style'))) {
    element.textContent = textDecoder.decode(
      await rewriteCss(element.textContent ?? '', rewriteReference),
    )
  }

  return textEncoder.encode(new XMLSerializer().serializeToString(document))
}

function unquoteCssReference(value: string | undefined): string | undefined {
  if (value === undefined)
    return undefined
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed.at(-1)
  return (first === '"' && last === '"') || (first === '\'' && last === '\'')
    ? trimmed.slice(1, -1)
    : trimmed
}

async function replaceAsync(
  input: string,
  expression: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
  const matches = [...input.matchAll(expression)]
  if (matches.length === 0)
    return input
  const replacements = await Promise.all(matches.map(match => replacer(match)))
  let result = ''
  let cursor = 0
  matches.forEach((match, index) => {
    const at = match.index ?? 0
    result += input.slice(cursor, at)
    result += replacements[index]
    cursor = at + match[0].length
  })
  return result + input.slice(cursor)
}
