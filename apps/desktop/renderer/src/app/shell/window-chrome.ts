import { getPlatform } from '../../shared/platform'

export function hasCustomWindowTitlebar(): boolean {
  const platform = getPlatform()
  // Native frames are fixed at startup; saved preferences apply after restart.
  const enabled = typeof window.desktop === 'undefined' || window.desktop.customTitlebarEnabled !== false
  return enabled && (platform === 'windows' || platform === 'linux')
}
