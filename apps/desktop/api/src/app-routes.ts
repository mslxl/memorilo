import type { RuntimeInfo } from './contract'
import { Schema } from 'effect'
import { Hono } from 'hono'
import { encodeDesktopHonoValue } from './wire'

export const RuntimeInfoSchema = Schema.Struct({
  applicationIcon: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  platform: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
})

export interface AppRouteHandlers {
  getRuntimeInfo: () => Promise<RuntimeInfo> | RuntimeInfo
}

export function createAppRoutes(handlers: AppRouteHandlers) {
  return new Hono().get('/runtime', async (context) => {
    const result = await handlers.getRuntimeInfo()
    return context.json(encodeDesktopHonoValue('app.getRuntimeInfo', RuntimeInfoSchema, result))
  })
}
