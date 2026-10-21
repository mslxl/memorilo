import type { DesktopTitlebarAppearance, ShowDesktopApplicationMenuInput } from '@memorilo/desktop-api'
import { Data, Effect } from 'effect'
import { desktopRequests } from '../../shared/desktop-requests'

// eslint-disable-next-line unicorn/throw-new-error
class WindowTitlebarRequestError extends Data.TaggedError('WindowTitlebarRequestError')<{
  cause: unknown
  operation: 'appearance' | 'icon' | 'menu'
}> {}

export function loadWindowApplicationIcon() {
  return Effect.tryPromise({
    try: () => desktopRequests.getRuntimeInfo(),
    catch: cause => new WindowTitlebarRequestError({ cause, operation: 'icon' }),
  }).pipe(Effect.map(info => info.applicationIcon ?? null))
}

export function openWindowTitlebarMenu(input: ShowDesktopApplicationMenuInput) {
  return Effect.tryPromise({
    try: () => desktopRequests.showApplicationMenu(input),
    catch: cause => new WindowTitlebarRequestError({ cause, operation: 'menu' }),
  })
}

export function updateWindowTitlebarAppearance(input: DesktopTitlebarAppearance) {
  return Effect.tryPromise({
    try: () => desktopRequests.setTitlebarAppearance(input),
    catch: cause => new WindowTitlebarRequestError({ cause, operation: 'appearance' }),
  })
}

export function opaqueHexColor(color: string): string | null {
  if (/^#[\da-f]{6}$/i.test(color))
    return color
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color)
  if (!match)
    return null
  return `#${match.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`
}
