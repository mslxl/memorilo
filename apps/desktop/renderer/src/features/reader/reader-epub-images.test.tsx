import { Reader } from '@memorilo/editor/reader'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const xlinkNamespace = 'http://www.w3.org/1999/xlink'
const fixtures = {
  html: new URL('./fixtures/svg-images.html.epub', import.meta.url),
  xhtml: new URL('./fixtures/svg-images.xhtml.epub', import.meta.url),
}

describe('epub embedded images', () => {
  it.each(['xhtml', 'html'] as const)('loads SVG cover images from %s content while preserving their namespaces', async (format) => {
    const data = new Uint8Array(await (await fetch(fixtures[format])).arrayBuffer())
    const onError = vi.fn()
    const rendered = render(
      <div style={{ display: 'flex', height: 600, width: 500 }}>
        <Reader initialPresentationMode="publisher" onError={onError} source={{ data, name: 'svg-images.epub' }} />
      </div>,
    )
    let frameDocument: Document | null | undefined
    await waitFor(() => {
      frameDocument = rendered.container.querySelector('iframe')?.contentDocument
      expect(frameDocument?.querySelector('.memorilo-epub-section')).not.toBeNull()
      expect(frameDocument?.querySelectorAll('svg image')).toHaveLength(5)
    })
    for (const id of ['legacy', 'alternate', 'modern']) {
      const image = frameDocument!.querySelector<SVGImageElement>(`#${id}`)!
      expect(image.href.baseVal).toMatch(/^blob:/)
      if (id !== 'modern')
        expect(image.getAttributeNS(xlinkNamespace, 'href')).toBe(image.href.baseVal)
      const decoded = new Image()
      decoded.src = image.href.baseVal
      await decoded.decode()
      expect([decoded.naturalWidth, decoded.naturalHeight]).toEqual([8, 8])
    }
    await waitFor(() => {
      const image = frameDocument!.querySelector<HTMLImageElement>('#ordinary')!
      expect([image.naturalWidth, image.naturalHeight]).toEqual([8, 8])
    })
    for (const id of ['active-legacy', 'active-alternate'])
      expect(frameDocument!.querySelector(`#${id}`)!.hasAttributeNS(xlinkNamespace, 'href')).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })
})
