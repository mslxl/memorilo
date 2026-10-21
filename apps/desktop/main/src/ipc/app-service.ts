import type { AppRouteHandlers, RuntimeInfo } from '@memorilo/desktop-api'
import process from 'node:process'
import { Data, Effect } from 'effect'
import { app } from 'electron'

// eslint-disable-next-line unicorn/throw-new-error
class ApplicationIconError extends Data.TaggedError('ApplicationIconError')<{
  cause: unknown
}> {}

export function createAppHandlers(): AppRouteHandlers {
  // The executable's icon is constant for this application process. Reuse the
  // OS-provided image so custom chrome follows the installed app's identity.
  let runtimeInfo: Promise<RuntimeInfo> | undefined
  return {
    getRuntimeInfo() {
      runtimeInfo ??= Effect.runPromise(Effect.gen(function* () {
        const applicationIcon = process.platform === 'win32' || process.platform === 'linux'
          ? yield* Effect.tryPromise({
            try: () => app.getFileIcon(process.execPath, { size: 'small' }),
            catch: cause => new ApplicationIconError({ cause }),
          }).pipe(
            Effect.map(icon => icon.isEmpty() ? null : icon.toDataURL()),
            Effect.catch(error => Effect.sync(() => {
              console.error('Could not read the application icon', error)
              return null
            })),
          )
          : null
        return {
          applicationIcon,
          platform: process.platform,
          version: process.versions.electron,
        }
      }))
      return runtimeInfo
    },
  }
}
