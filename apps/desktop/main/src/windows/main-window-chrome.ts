import type { BrowserWindowConstructorOptions } from 'electron'

export const mainWindowTitlebarHeight = 40

export function usesCustomWindowChrome(platform: string, redrawTitlebar = true): boolean {
  return redrawTitlebar && (platform === 'win32' || platform === 'linux')
}

export function mainWindowChromeOptions(platform: string, redrawTitlebar = true): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 20 },
    }
  }
  if (usesCustomWindowChrome(platform, redrawTitlebar)) {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#fafaf9', height: mainWindowTitlebarHeight, symbolColor: '#25262a' },
    }
  }
  return {}
}
