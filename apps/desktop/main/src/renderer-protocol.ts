import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  memoriloAppHost,
  memoriloAppOrigin,
  memoriloProtocol,
} from '@memorilo/desktop-api/transport'

export const rendererIndexUrl = `${memoriloAppOrigin}/index.html`

const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function isRendererUrl(source: string): boolean {
  try {
    const url = new URL(source)
    return url.protocol === `${memoriloProtocol}:`
      && url.host === memoriloAppHost
      && !url.username
      && !url.password
      && !url.port
  }
  catch {
    return false
  }
}

export function createRendererProtocolHandler(rendererDirectory: string) {
  const root = resolve(rendererDirectory)
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET')
      return new Response(null, { status: 405 })

    let url: URL
    try {
      url = new URL(request.url)
    }
    catch {
      return new Response(null, { status: 400 })
    }
    if (!isRendererUrl(url.toString()) || url.search || url.hash)
      return new Response(null, { status: 400 })

    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    }
    catch {
      return new Response(null, { status: 400 })
    }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0'))
      return new Response(null, { status: 400 })

    const filePath = resolve(root, `.${pathname}`)
    const relativePath = relative(root, filePath)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
      return new Response(null, { status: 400 })

    const contentType = contentTypes[extname(filePath).toLowerCase()]
    if (!contentType)
      return new Response(null, { status: 415 })

    try {
      const data = await readFile(filePath)
      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code === 'ENOENT' || code === 'ENOTDIR')
        return new Response(null, { status: 404 })
      throw error
    }
  }
}
