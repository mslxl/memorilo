import type { DesktopApi, DesktopNoteExternalUpdate } from './contract'
import type { DesktopIpcClient } from './ipc-contract'
import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from './desktop-api'

function serviceStub(): DesktopIpcClient {
  return {
    transport: { fetch: vi.fn() },
    whiteboardLibrary: {
      load: vi.fn(),
      save: vi.fn(),
    },
  }
}

describe('desktop preload API', () => {
  it.each(['windows', 'linux', 'macos', 'other'] as const)('exposes the actual frame choice on %s', (platform) => {
    const api = createDesktopApi(
      platform,
      serviceStub(),
      vi.fn(() => vi.fn()),
      vi.fn(() => vi.fn()),
      vi.fn(() => vi.fn()),
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(api.customTitlebarEnabled).toBe(platform === 'windows' || platform === 'linux')
  })
  it('exposes the user Whiteboard Library transport unchanged', async () => {
    const services = serviceStub()
    const library = {
      libraryItems: [{
        created: 123,
        elements: [{
          height: 60,
          id: 'rectangle-1',
          isDeleted: false,
          link: null,
          type: 'rectangle',
          width: 80,
          x: 10,
          y: 20,
        }],
        id: 'library-item-1',
        status: 'unpublished' as const,
      }],
    }
    vi.mocked(services.whiteboardLibrary.load).mockResolvedValue(library)
    vi.mocked(services.whiteboardLibrary.save).mockResolvedValue()
    const api = createDesktopApi(
      'windows',
      services,
      vi.fn(() => vi.fn()),
      vi.fn(() => vi.fn()),
      vi.fn(() => vi.fn()),
    )

    await expect(api.loadWhiteboardLibrary()).resolves.toEqual(library)
    await expect(api.saveWhiteboardLibrary(library)).resolves.toBeUndefined()
    expect(services.whiteboardLibrary.save).toHaveBeenCalledWith(library)
  })

  it('exposes the Hono Fetch transport and external Note update subscriptions unchanged', async () => {
    const services = serviceStub()
    let noteListener: ((update: DesktopNoteExternalUpdate) => void) | undefined
    const stopNoteUpdates = vi.fn()
    const subscribeNoteUpdates = vi.fn((listener: Parameters<DesktopApi['subscribeNoteUpdates']>[0]) => {
      noteListener = listener
      return stopNoteUpdates
    })
    const api = createDesktopApi(
      'macos',
      services,
      vi.fn(() => vi.fn()),
      vi.fn(() => vi.fn()),
      subscribeNoteUpdates,
    )
    const request = {
      body: '{"args":[]}',
      headers: [['content-type', 'application/json']] as const,
      method: 'POST',
      url: 'memorilo://api/rpc/notes/openMostRecentNote',
    }
    const response = {
      body: '{}',
      headers: [['content-type', 'application/json']] as const,
      status: 200,
      statusText: 'OK',
    }
    vi.mocked(services.transport.fetch).mockResolvedValue(response)
    await expect(api.request(request)).resolves.toEqual(response)
    expect(services.transport.fetch).toHaveBeenCalledWith(request)

    const listener = vi.fn()
    const unsubscribe = api.subscribeNoteUpdates(listener)
    const update = { noteId: 'note-1', update: Uint8Array.from([1, 2, 3]), updatedAt: 42 }
    noteListener?.(update)
    expect(listener).toHaveBeenCalledWith(update)
    unsubscribe()
    expect(stopNoteUpdates).toHaveBeenCalledTimes(1)
  })
})
