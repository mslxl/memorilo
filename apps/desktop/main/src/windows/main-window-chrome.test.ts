import { describe, expect, it } from 'vitest'
import { mainWindowChromeOptions, usesCustomWindowChrome } from './main-window-chrome'

describe('main window platform chrome', () => {
  it.each(['win32', 'linux'])('keeps native caption controls with custom chrome on %s', (platform) => {
    expect(usesCustomWindowChrome(platform)).toBe(true)
    expect(mainWindowChromeOptions(platform)).toMatchObject({
      titleBarOverlay: { height: 40 },
      titleBarStyle: 'hidden',
    })
  })

  it('retains the existing macOS traffic lights and inset', () => {
    expect(usesCustomWindowChrome('darwin')).toBe(false)
    expect(mainWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 20 },
    })
    expect(mainWindowChromeOptions('darwin', false)).toEqual(mainWindowChromeOptions('darwin', true))
  })

  it.each(['win32', 'linux'])('restores the native frame when custom chrome is disabled on %s', (platform) => {
    expect(usesCustomWindowChrome(platform, false)).toBe(false)
    expect(mainWindowChromeOptions(platform, false)).toEqual({})
  })

  it('does not override other platforms', () => {
    expect(usesCustomWindowChrome('freebsd')).toBe(false)
    expect(mainWindowChromeOptions('freebsd')).toEqual({})
  })
})
