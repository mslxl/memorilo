import type { PairingInvitation, PairingResponse, SyncAuditStore } from '@memorilo/sync'
import type { P2pApplication } from '@memorilo/sync/node'
import type { Context, Next } from 'hono'
import type { AuthenticatedBrowserAccount, BrowserAuthOptions } from '../infrastructure/auth/browser-auth'
import type { SyncServerConfig } from './config'
import type { DeviceTodoModule } from './device-todo'
import type { SyncPeerMetrics, SyncServerMetrics } from './metrics'
import type { RateLimiter } from './rate-limiter'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { encodeSyncServerCredentialBundle } from '@memorilo/sync'
import { encodeMemoriloProto } from '@memorilo/sync-protocol'
import { decodePairingPayload, verifyPairingResponse } from '@memorilo/sync/node'
import { Effect } from 'effect'
import { Hono } from 'hono'
import { createBrowserAuth } from '../infrastructure/auth/browser-auth'
import { withDatabaseFailureMetrics } from '../infrastructure/metrics'
import { hashDeviceCredential, hashPairingSharedSecret, newDeviceCredential } from '../infrastructure/p2p/server-peer'
import { DeviceTodoError } from './device-todo'
import { createSyncServerMetrics } from './metrics'
import { createRateLimiter } from './rate-limiter'
import { todoNotificationTopic } from './todo-notification-publisher'

interface SyncServerVariables {
  readonly config: SyncServerConfig
  readonly remoteAddress: string | null
  readonly requestId: string
}

interface SyncServerBindings {
  readonly incoming?: {
    readonly socket?: {
      readonly remoteAddress?: string
    }
  }
}

interface SyncServerEnvironment {
  Bindings: SyncServerBindings
  Variables: SyncServerVariables
}

export type SyncServerApp = Hono<SyncServerEnvironment>

async function runDeviceTodo<Result>(effect: Effect.Effect<Result, DeviceTodoError>): Promise<{ readonly ok: true, readonly value: Result } | { readonly ok: false, readonly error: DeviceTodoError }> {
  try {
    return { ok: true, value: await Effect.runPromise(effect) }
  }
  catch (error) {
    return { ok: false, error: error instanceof DeviceTodoError ? error : new DeviceTodoError('internal_error', 'Device Todo operation failed', { cause: error }) }
  }
}

export interface SyncServerAppServices extends BrowserAuthOptions {
  readonly audit: SyncAuditStore
  readonly metrics?: SyncServerMetrics
  readonly peerMetrics?: () => SyncPeerMetrics
  readonly rateLimiter?: RateLimiter
  readonly renderWeb?: () => Promise<string> | string
  readonly webRoot?: string
  readonly peer?: P2pApplication
  readonly closeAccountSyncSessions?: (accountId: string) => Promise<void>
  readonly closeDeviceSyncSessions?: (accountId: string, deviceId: string) => Promise<void>
  readonly isReady?: () => boolean
  readonly deviceTodo?: DeviceTodoModule
}

const rateLimitWindowMs = 60_000

function requestRemoteAddress(context: { readonly env: SyncServerBindings, readonly req: { readonly header: (name: string) => string | undefined } }, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = context.req.header('x-forwarded-for')?.split(',', 1)[0]?.trim()
    if (forwarded)
      return forwarded.slice(0, 128)
  }
  return context.env?.incoming?.socket?.remoteAddress?.slice(0, 128) ?? null
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
}

function json(body: unknown, status = 200, headers = new Headers()): Response {
  headers.set('content-type', 'application/json; charset=UTF-8')
  return new Response(JSON.stringify(body), { headers, status })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function deviceTodoErrorStatus(error: DeviceTodoError): 400 | 401 | 403 | 500 | 503 {
  switch (error.code) {
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'invalid_request':
      return 400
    case 'account_not_authoritative':
      return 503
    case 'internal_error':
      return 500
  }
}

export function createSyncServerApp(config: SyncServerConfig, services: SyncServerAppServices): SyncServerApp {
  const app = new Hono<SyncServerEnvironment>()
  const now = services.now ?? Date.now
  const metrics = services.metrics ?? createSyncServerMetrics()
  const auth = withDatabaseFailureMetrics(services.auth, metrics.peerRecorder)
  const repository = withDatabaseFailureMetrics(services.repository, metrics.peerRecorder)
  const audit = withDatabaseFailureMetrics(services.audit, metrics.peerRecorder)
  const browserAuth = createBrowserAuth({ ...services, auth, defaultEnabledModes: config.enabledModes, repository })
  const requireAccount = async (context: Context<SyncServerEnvironment>): Promise<AuthenticatedBrowserAccount | Response> => {
    const account = await browserAuth.current(context.req.raw)
    return account ?? context.json({ code: 'unauthorized' }, 401)
  }
  const requireCsrf = async (context: Context<SyncServerEnvironment>, account: AuthenticatedBrowserAccount): Promise<Response | null> => {
    try {
      await browserAuth.requireCsrf(context.req.raw, account)
      return null
    }
    catch {
      return context.json({ code: 'csrf_invalid' }, 403)
    }
  }
  const requireAccountWithCsrf = async (context: Context<SyncServerEnvironment>): Promise<AuthenticatedBrowserAccount | Response> => {
    const account = await requireAccount(context)
    if (account instanceof Response)
      return account
    const csrfError = await requireCsrf(context, account)
    return csrfError ?? account
  }
  const rateLimiter = services.rateLimiter ?? createRateLimiter(services.now)
  const deviceTodo = services.deviceTodo
  const peerMetrics = (): SyncPeerMetrics => services.peerMetrics?.() ?? { activeObjectTransfers: 0, activeSyncSessions: 0 }
  const renderIndex = async (body: Uint8Array): Promise<Response> => {
    let html = Buffer.from(body).toString('utf8')
    if (services.renderWeb) {
      const marker = '<div id="root"></div>'
      if (!html.includes(marker))
        throw new Error('Sync server web index is missing the SSR root marker')
      html = html.replace(marker, `<div id="root">${await services.renderWeb()}</div>`)
    }
    return new Response(html, {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=UTF-8',
      },
    })
  }
  const recordAudit = async (input: {
    readonly accountId: string | null
    readonly action: string
    readonly actorId: string | null
    readonly actorType: 'anonymous' | 'browser' | 'device' | 'system'
    readonly details?: Readonly<Record<string, boolean | number | string | null>>
    readonly outcome: 'success' | 'denied' | 'failure'
    readonly remoteAddress: string | null
    readonly requestId: string
  }): Promise<void> => {
    try {
      await audit.append({
        ...input,
        createdAt: now(),
        details: input.details ?? {},
        id: randomUUID(),
      })
    }
    catch (error) {
      console.error('Failed to persist sync server security audit event', error)
    }
  }
  app.use('*', async (context, next) => {
    context.set('config', config)
    context.set('remoteAddress', requestRemoteAddress(context, config.trustProxy))
    context.set('requestId', context.req.header('x-request-id')?.slice(0, 128) || randomUUID())
    const end = metrics.beginHttpRequest()
    try {
      await next()
      if (context.res.status >= 500)
        metrics.httpFailed()
      context.res.headers.set('x-request-id', context.get('requestId'))
    }
    finally {
      end()
    }
  })
  app.use('/api/*', async (context, next) => {
    if (services.isReady?.() === false)
      return context.json({ code: 'server_draining' }, 503)
    const readOnlyException = context.req.path === '/api/auth/login' || context.req.path === '/api/auth/logout'
    if (config.maintenanceMode === 'read-only'
      && !['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)
      && !readOnlyException) {
      return context.json({ code: 'server_read_only' }, 503)
    }
    const decision = rateLimiter.check('api', context.get('remoteAddress') ?? 'unknown', config.maxApiRequestsPerMinute, rateLimitWindowMs)
    context.header('ratelimit-limit', String(decision.limit))
    context.header('ratelimit-remaining', String(decision.remaining))
    context.header('ratelimit-reset', String(Math.ceil(decision.resetAt / 1000)))
    if (!decision.allowed) {
      metrics.rateLimitRejected()
      if (decision.firstRejected) {
        await recordAudit({
          accountId: null,
          action: 'rate-limit.api',
          actorId: null,
          actorType: 'anonymous',
          outcome: 'denied',
          remoteAddress: context.get('remoteAddress'),
          requestId: context.get('requestId'),
        })
      }
      context.header('retry-after', String(Math.max(1, Math.ceil((decision.resetAt - now()) / 1000))))
      return context.json({ code: 'rate_limited' }, 429)
    }
    await next()
  })
  const limitAuthentication = async (context: Context<SyncServerEnvironment>, next: Next): Promise<Response | void> => {
    const decision = rateLimiter.check('authentication', context.get('remoteAddress') ?? 'unknown', config.maxAuthAttemptsPerMinute, rateLimitWindowMs)
    if (decision.allowed)
      return next()
    metrics.rateLimitRejected()
    if (decision.firstRejected) {
      await recordAudit({
        accountId: null,
        action: 'rate-limit.authentication',
        actorId: null,
        actorType: 'anonymous',
        outcome: 'denied',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
    }
    context.header('retry-after', String(Math.max(1, Math.ceil((decision.resetAt - now()) / 1000))))
    return context.json({ code: 'rate_limited' }, 429)
  }
  app.use('/api/setup', limitAuthentication)
  app.use('/api/auth/login', limitAuthentication)
  app.use('/api/auth/register', limitAuthentication)
  app.get('/livez', context => context.json({ status: 'ok' }))
  app.get('/readyz', context => services.isReady?.() === false
    ? context.json({ status: 'draining' }, 503)
    : context.json({ status: 'ready' }))
  app.get('/healthz', context => context.json({
    enabledModes: config.enabledModes,
    maintenanceMode: config.maintenanceMode,
    metadataDatabase: config.metadataDatabase,
    objectStore: config.objectStore,
    registration: config.registration,
    peerId: services.peer?.localDevice().peerId ?? null,
    status: services.isReady?.() === false ? 'draining' : 'ok',
  }))
  app.get('/metrics', (context) => {
    if (config.metricsToken === undefined)
      return context.notFound()
    if (!bearerMatches(context.req.header('authorization'), config.metricsToken)) {
      metrics.authenticationRejected()
      return context.json({ code: 'unauthorized' }, 401)
    }
    return context.text(metrics.renderPrometheus(peerMetrics()), 200, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; version=0.0.4; charset=UTF-8',
    })
  })
  app.get('/api/setup', async (context) => {
    return context.json({ available: await auth.countAccounts() === 0 })
  })
  app.post('/api/setup', async (context) => {
    if (await auth.countAccounts() !== 0)
      return context.json({ code: 'setup_unavailable' }, 409)
    const body = await context.req.json<{ username?: unknown, password?: unknown }>()
    if (typeof body.username !== 'string' || typeof body.password !== 'string')
      return context.json({ code: 'invalid_setup_payload' }, 400)
    try {
      const account = await browserAuth.createInitialAccount(body.username, body.password)
      await recordAudit({
        accountId: account.accountId,
        action: 'account.setup',
        actorId: account.accountId,
        actorType: 'browser',
        outcome: 'success',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({ created: true }, 201)
    }
    catch (error) {
      await recordAudit({
        accountId: null,
        action: 'account.setup',
        actorId: null,
        actorType: 'anonymous',
        outcome: 'failure',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({ code: 'setup_failed', message: errorMessage(error, 'Setup failed') }, 400)
    }
  })
  app.post('/api/auth/register', async (context) => {
    if (config.registration === 'disabled')
      return context.json({ code: 'registration_disabled' }, 403)
    const body = await context.req.json<{ username?: unknown, password?: unknown, inviteToken?: unknown }>()
    if (typeof body.username !== 'string' || typeof body.password !== 'string')
      return context.json({ code: 'invalid_registration_payload' }, 400)
    const inviteToken = body.inviteToken === undefined ? undefined : body.inviteToken
    if (config.registration === 'invite-only' && typeof inviteToken !== 'string')
      return context.json({ code: 'registration_unavailable' }, 400)
    if (inviteToken !== undefined && typeof inviteToken !== 'string')
      return context.json({ code: 'registration_unavailable' }, 400)
    try {
      const account = await browserAuth.register(body.username, body.password, inviteToken)
      await recordAudit({
        accountId: account.accountId,
        action: 'account.register',
        actorId: account.accountId,
        actorType: 'browser',
        details: { registration: config.registration },
        outcome: 'success',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({ registered: true }, 201)
    }
    catch (error) {
      await recordAudit({
        accountId: null,
        action: 'account.register',
        actorId: null,
        actorType: 'anonymous',
        details: { registration: config.registration },
        outcome: 'failure',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      const message = errorMessage(error, 'Registration failed')
      if (message === 'Invalid registration invite')
        return context.json({ code: 'registration_unavailable' }, 400)
      if (message.includes('UNIQUE constraint failed: sync_users.username')
        || (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505')) {
        return context.json({ code: 'registration_unavailable' }, 400)
      }
      return context.json({ code: 'registration_failed' }, 400)
    }
  })
  app.post('/api/auth/invites', async (context) => {
    const account = await requireAccountWithCsrf(context)
    if (account instanceof Response)
      return account
    if (config.registration !== 'invite-only')
      return context.json({ code: 'invite_registration_disabled' }, 409)
    const result = await browserAuth.createInvite()
    await recordAudit({
      accountId: account.accountId,
      action: 'invite.create',
      actorId: account.accountId,
      actorType: 'browser',
      details: { expiresAt: result.invite.expiresAt },
      outcome: 'success',
      remoteAddress: context.get('remoteAddress'),
      requestId: context.get('requestId'),
    })
    return context.json({ expiresAt: result.invite.expiresAt, token: result.token }, 201)
  })
  app.post('/api/auth/login', async (context) => {
    const body = await context.req.json<{ username?: unknown, password?: unknown }>()
    if (typeof body.username !== 'string' || typeof body.password !== 'string')
      return context.json({ code: 'invalid_login_payload' }, 400)
    const headers = new Headers()
    const account = await browserAuth.login(body.username, body.password, context.req.raw, headers)
    if (!account) {
      metrics.authenticationRejected()
      await recordAudit({
        accountId: null,
        action: 'auth.login',
        actorId: null,
        actorType: 'anonymous',
        outcome: 'denied',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return json({ code: 'invalid_credentials' }, 401)
    }
    await recordAudit({
      accountId: account.accountId,
      action: 'auth.login',
      actorId: account.accountId,
      actorType: 'browser',
      outcome: 'success',
      remoteAddress: context.get('remoteAddress'),
      requestId: context.get('requestId'),
    })
    return json(account, 200, headers)
  })
  app.get('/api/auth/me', async (context) => {
    const account = await browserAuth.current(context.req.raw)
    return account ? context.json(account) : context.json({ code: 'unauthorized' }, 401)
  })
  app.get('/api/sync/state', async (context) => {
    const account = await requireAccount(context)
    if (account instanceof Response)
      return account
    const state = await repository.getAccountState(account.accountId)
    return state ? context.json({ ...state, availableModes: config.enabledModes }) : context.json({ code: 'account_not_found' }, 404)
  })
  app.get('/api/audit-events', async (context) => {
    const account = await requireAccount(context)
    if (account instanceof Response)
      return account
    const requestedLimit = Number(context.req.query('limit') ?? 50)
    const beforeValue = context.req.query('before')
    const before = beforeValue === undefined ? undefined : Number(beforeValue)
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100
      || (before !== undefined && (!Number.isSafeInteger(before) || before < 0))) {
      return context.json({ code: 'invalid_audit_query' }, 400)
    }
    const events = await audit.listForAccount(account.accountId, requestedLimit, before)
    return context.json({ events })
  })
  app.get('/api/devices', async (context) => {
    const account = await requireAccount(context)
    if (account instanceof Response)
      return account
    const devices = (await auth.listDeviceCredentials(account.accountId))
      .filter(device => device.revokedAt === null)
      .map(device => ({
        addedAt: device.createdAt,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        expiresAt: device.expiresAt,
        lastSeenAt: null,
        membershipEpoch: device.membershipEpoch,
        peerId: device.peerId,
      }))
    return context.json({ devices })
  })
  app.post('/api/devices/todo-token', async (context) => {
    const account = await browserAuth.current(context.req.raw)
    if (!account)
      return context.json({ code: 'unauthorized' }, 401)
    try {
      await browserAuth.requireCsrf(context.req.raw, account)
    }
    catch {
      return context.json({ code: 'csrf_invalid' }, 403)
    }
    if (!deviceTodo)
      return context.json({ code: 'device_todo_unavailable' }, 503)
    let body: { deviceName?: unknown, expiresAt?: unknown, scopes?: unknown }
    try {
      body = await context.req.json<{ deviceName?: unknown, expiresAt?: unknown, scopes?: unknown }>()
    }
    catch {
      return context.json({ code: 'invalid_request' }, 400)
    }
    const result = await runDeviceTodo(deviceTodo.issueToken({
      accountId: account.accountId,
      deviceName: typeof body.deviceName === 'string' ? body.deviceName : '',
      expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : Number.NaN,
      scopes: Array.isArray(body.scopes) ? body.scopes as never : [],
    }))
    if (!result.ok)
      return context.json({ code: result.error.code }, deviceTodoErrorStatus(result.error))
    await recordAudit({ accountId: account.accountId, action: 'device.todo-token.issue', actorId: account.accountId, actorType: 'browser', details: { deviceId: result.value.credential.deviceId }, outcome: 'success', remoteAddress: context.get('remoteAddress'), requestId: context.get('requestId') })
    return context.json({
      credential: result.value.token,
      device: {
        deviceId: result.value.credential.deviceId,
        deviceName: result.value.credential.deviceName,
        mqttTopic: config.mqttTodoBrokerUrl === undefined
          ? null
          : todoNotificationTopic(config.mqttTodoTopicPrefix, result.value.credential.deviceId),
      },
      expiresAt: result.value.credential.expiresAt,
      scopes: result.value.credential.scopes,
    }, 201)
  })
  app.get('/api/devices/todo-tokens', async (context) => {
    const account = await browserAuth.current(context.req.raw)
    if (!account)
      return context.json({ code: 'unauthorized' }, 401)
    if (!deviceTodo)
      return context.json({ code: 'device_todo_unavailable' }, 503)
    const result = await runDeviceTodo(deviceTodo.listTokens(account.accountId))
    if (!result.ok)
      return context.json({ code: result.error.code }, deviceTodoErrorStatus(result.error))
    return context.json({ tokens: result.value.filter(token => token.revokedAt === null).map(token => ({ createdAt: token.createdAt, deviceId: token.deviceId, deviceName: token.deviceName, expiresAt: token.expiresAt, scopes: token.scopes })) })
  })
  app.post('/api/devices/todo-tokens/:deviceId/revoke', async (context) => {
    const account = await browserAuth.current(context.req.raw)
    if (!account)
      return context.json({ code: 'unauthorized' }, 401)
    try {
      await browserAuth.requireCsrf(context.req.raw, account)
    }
    catch {
      return context.json({ code: 'csrf_invalid' }, 403)
    }
    if (!deviceTodo)
      return context.json({ code: 'device_todo_unavailable' }, 503)
    const result = await runDeviceTodo(deviceTodo.revokeToken(account.accountId, context.req.param('deviceId')))
    if (!result.ok)
      return context.json({ code: result.error.code }, deviceTodoErrorStatus(result.error))
    return result.value ? context.json({ revoked: true }) : context.json({ code: 'device_not_found' }, 404)
  })
  app.get('/api/device/v1/todos', async (context) => {
    if (!deviceTodo)
      return context.json({ code: 'device_todo_unavailable' }, 503)
    const token = context.req.header('authorization')?.startsWith('Bearer ')
      ? context.req.header('authorization')!.slice(7)
      : ''
    const rateLimitKey = token === ''
      ? context.get('remoteAddress') || 'unknown'
      : createHash('sha256').update(token).digest('hex')
    const decision = rateLimiter.check('device-todos', rateLimitKey, 60, rateLimitWindowMs)
    context.header('ratelimit-limit', String(decision.limit))
    context.header('ratelimit-remaining', String(decision.remaining))
    context.header('ratelimit-reset', String(Math.ceil(decision.resetAt / 1000)))
    if (!decision.allowed) {
      context.header('retry-after', String(Math.max(1, Math.ceil((decision.resetAt - now()) / 1000))))
      return context.json({ code: 'rate_limited' }, 429)
    }
    const date = context.req.query('date') ?? new Date(now()).toISOString().slice(0, 10)
    const view = context.req.query('view') === 'all' ? 'all' : 'today'
    const limit = Number(context.req.query('limit') ?? 20)
    const result = await runDeviceTodo(deviceTodo.list({ date, limit, token, view }))
    if (!result.ok)
      return context.json({ code: result.error.code }, deviceTodoErrorStatus(result.error))
    const tag = `"${result.value.revision}"`
    context.header('etag', tag)
    context.header('cache-control', 'private, max-age=0')
    if (context.req.header('if-none-match') === tag)
      return new Response(null, { status: 304, headers: { etag: tag } })
    const body = encodeMemoriloProto('TodoSnapshot', {
      generatedAt: result.value.generatedAt,
      items: result.value.items.map(item => ({
        allDay: item.allDay,
        dueDate: item.dueDate ?? undefined,
        dueTime: item.dueTime ?? undefined,
        id: item.id,
        noteTitle: item.noteTitle,
        parentId: item.parentId ?? undefined,
        revision: item.revision,
        status: item.status === 'todo' ? 1 : item.status === 'doing' ? 2 : 3,
        text: item.text,
        topicTitle: item.topicTitle,
      })),
      revision: result.value.revision,
    })
    return new Response(new Uint8Array(body).buffer, { status: 200, headers: { 'cache-control': 'private, max-age=0', 'content-type': 'application/x-protobuf', 'etag': tag } })
  })
  app.post('/api/devices/pairing', async (context) => {
    const account = await requireAccountWithCsrf(context)
    if (account instanceof Response)
      return account
    if (!services.peer)
      return context.json({ code: 'peer_unavailable' }, 503)
    const state = await repository.getAccountState(account.accountId)
    if (!state)
      return context.json({ code: 'account_not_found' }, 404)
    const invitation = await services.peer.createInvitation(state.membershipEpoch)
    const decoded = decodePairingPayload<PairingInvitation>(invitation)
    await auth.createPairingSession({
      accountId: account.accountId,
      createdAt: now(),
      expiresAt: decoded.expiresAt,
      pairingId: decoded.pairingId,
    })
    await recordAudit({
      accountId: account.accountId,
      action: 'pairing.start',
      actorId: account.accountId,
      actorType: 'browser',
      details: { pairingId: decoded.pairingId },
      outcome: 'success',
      remoteAddress: context.get('remoteAddress'),
      requestId: context.get('requestId'),
    })
    return context.json({ invitation }, 201)
  })
  app.post('/api/devices/pairing/complete', async (context) => {
    const account = await requireAccountWithCsrf(context)
    if (account instanceof Response)
      return account
    if (!services.peer)
      return context.json({ code: 'peer_unavailable' }, 503)
    const body = await context.req.json<{ response?: unknown }>()
    if (typeof body.response !== 'string')
      return context.json({ code: 'invalid_pairing_payload' }, 400)
    try {
      const response = decodePairingPayload<PairingResponse>(body.response)
      const timestamp = services.now?.() ?? Date.now()
      if (!verifyPairingResponse(response))
        return context.json({ code: 'pairing_signature_invalid' }, 400)
      if (!await auth.findPairingSession(response.pairingId, account.accountId, timestamp))
        return context.json({ code: 'pairing_not_owned' }, 403)
      const state = await repository.getAccountState(account.accountId)
      if (!state || response.membershipEpoch !== state.membershipEpoch)
        return context.json({ code: 'pairing_membership_stale' }, 409)
      if (!await auth.consumePairingSession(response.pairingId, account.accountId, timestamp))
        return context.json({ code: 'pairing_not_owned' }, 403)
      const device = await services.peer.completePairing(body.response)
      const credentialValue = newDeviceCredential()
      const credential = await auth.createDeviceCredential({
        accountId: account.accountId,
        createdAt: timestamp,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        expiresAt: timestamp + config.deviceCredentialTtlMs,
        membershipEpoch: state.membershipEpoch,
        pairingId: device.pairingId,
        peerId: device.peerId,
        credentialHash: hashDeviceCredential(credentialValue),
        scopes: ['sync', 'object'],
        sharedSecretHash: hashPairingSharedSecret(device.sharedSecret),
        signingPublicKey: device.signingPublicKey,
      })
      await services.closeDeviceSyncSessions?.(account.accountId, credential.deviceId)
      await recordAudit({
        accountId: account.accountId,
        action: 'pairing.complete',
        actorId: account.accountId,
        actorType: 'browser',
        details: { deviceId: credential.deviceId, peerId: credential.peerId },
        outcome: 'success',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({
        credential: encodeSyncServerCredentialBundle({
          credential: credentialValue,
          generation: state.generation,
          membershipEpoch: state.membershipEpoch,
          modes: state.enabledModes,
          peerId: services.peer.localDevice().peerId,
          policyEpoch: state.policyEpoch,
          version: 1,
        }),
        device: { deviceId: credential.deviceId, deviceName: device.deviceName, peerId: credential.peerId },
        expiresAt: credential.expiresAt,
      }, 201)
    }
    catch (error) {
      await recordAudit({
        accountId: account.accountId,
        action: 'pairing.complete',
        actorId: account.accountId,
        actorType: 'browser',
        outcome: 'failure',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({ code: 'pairing_failed', message: errorMessage(error, 'Pairing failed') }, 400)
    }
  })
  app.post('/api/devices/:deviceId/revoke', async (context) => {
    const account = await requireAccountWithCsrf(context)
    if (account instanceof Response)
      return account
    const body = await context.req.json<{ password?: unknown }>().catch(() => null)
    if (!body || typeof body.password !== 'string')
      return context.json({ code: 'invalid_revoke_payload' }, 400)
    if (!await browserAuth.verifyPassword(account.accountId, body.password)) {
      await recordAudit({
        accountId: account.accountId,
        action: 'device.revoke',
        actorId: account.accountId,
        actorType: 'browser',
        details: { deviceId: context.req.param('deviceId') },
        outcome: 'denied',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({ code: 'reauthentication_failed' }, 403)
    }
    const credential = await auth.findDeviceCredentialByDevice(account.accountId, context.req.param('deviceId'))
    if (!credential || credential.revokedAt !== null)
      return context.json({ code: 'device_not_found' }, 404)
    const membershipEpoch = await auth.revokeDeviceCredential(
      account.accountId,
      credential.credentialHash,
      now(),
    )
    if (membershipEpoch === null)
      return context.json({ code: 'device_not_found' }, 404)
    await services.closeAccountSyncSessions?.(account.accountId)
    await services.peer?.removeDevice(credential.deviceId)
    await recordAudit({
      accountId: account.accountId,
      action: 'device.revoke',
      actorId: account.accountId,
      actorType: 'browser',
      details: { deviceId: credential.deviceId, membershipEpoch },
      outcome: 'success',
      remoteAddress: context.get('remoteAddress'),
      requestId: context.get('requestId'),
    })
    return context.json({ membershipEpoch, revoked: true })
  })
  app.patch('/api/sync/policy', async (context) => {
    const account = await requireAccountWithCsrf(context)
    if (account instanceof Response)
      return account
    const body = await context.req.json<{ enabledModes?: unknown, password?: unknown, policyEpoch?: unknown, transition?: unknown }>()
    if (!Array.isArray(body.enabledModes)
      || !body.enabledModes.every(mode => mode === 'relay' || mode === 'authoritative')
      || typeof body.password !== 'string'
      || !Number.isSafeInteger(body.policyEpoch)
      || !['unchanged', 'start-authoritative', 'retain-authoritative', 'clear-authoritative'].includes(body.transition as string)) {
      return context.json({ code: 'invalid_policy_payload' }, 400)
    }
    if (!await browserAuth.verifyPassword(account.accountId, body.password))
      return context.json({ code: 'reauthentication_failed' }, 403)
    const enabledModes = body.enabledModes as ('relay' | 'authoritative')[]
    if (enabledModes.some(mode => !config.enabledModes.includes(mode)))
      return context.json({ code: 'mode_disabled_by_server' }, 409)
    const policyEpoch = body.policyEpoch as number
    const transition = body.transition as 'unchanged' | 'start-authoritative' | 'retain-authoritative' | 'clear-authoritative'
    try {
      const result = await repository.updateAccountPolicy(account.accountId, {
        enabledModes,
        expectedPolicyEpoch: policyEpoch,
        ...(transition === 'start-authoritative' || transition === 'clear-authoritative'
          ? { reset: { createdAt: now(), jobId: randomUUID() } }
          : {}),
        transition,
      })
      await services.closeAccountSyncSessions?.(account.accountId)
      await recordAudit({
        accountId: account.accountId,
        action: 'sync.policy.update',
        actorId: account.accountId,
        actorType: 'browser',
        details: { enabledModes: enabledModes.join(','), policyEpoch: result.state.policyEpoch, transition },
        outcome: 'success',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({
        ...result.state,
        availableModes: config.enabledModes,
        resetJobId: result.resetJob?.id ?? null,
      })
    }
    catch (error) {
      const message = errorMessage(error, 'Policy update failed')
      return context.json({ code: message.includes('changed') ? 'policy_conflict' : 'policy_update_failed', message }, message.includes('changed') ? 409 : 400)
    }
  })
  app.post('/api/sync/reset', async (context) => {
    const account = await requireAccountWithCsrf(context)
    if (account instanceof Response)
      return account
    const body = await context.req.json<{ password?: unknown, confirmation?: unknown, generation?: unknown }>()
    if (typeof body.password !== 'string' || body.confirmation !== 'CLEAR SERVER DATA' || !Number.isSafeInteger(body.generation))
      return context.json({ code: 'invalid_reset_payload' }, 400)
    if (!await browserAuth.verifyPassword(account.accountId, body.password))
      return context.json({ code: 'reauthentication_failed' }, 403)
    const accountState = await repository.getAccountState(account.accountId)
    if (!accountState)
      return context.json({ code: 'account_not_found' }, 404)
    if (!accountState.enabledModes.includes('authoritative'))
      return context.json({ code: 'authoritative_mode_required' }, 409)
    const generation = body.generation as number
    try {
      const reset = await repository.requestGenerationReset(account.accountId, generation, randomUUID(), now())
      await services.closeAccountSyncSessions?.(account.accountId)
      const state = await repository.getAccountState(account.accountId)
      if (!state)
        throw new Error('Sync account disappeared after reset')
      await recordAudit({
        accountId: account.accountId,
        action: 'sync.data.reset',
        actorId: account.accountId,
        actorType: 'browser',
        details: { generation: reset.generation, jobId: reset.job.id },
        outcome: 'success',
        remoteAddress: context.get('remoteAddress'),
        requestId: context.get('requestId'),
      })
      return context.json({
        ...state,
        availableModes: config.enabledModes,
        jobId: reset.job.id,
        recoverableOffline: false,
        status: reset.job.status,
      }, 202)
    }
    catch (error) {
      const message = errorMessage(error, 'Reset failed')
      return context.json({ code: message.includes('changed') ? 'generation_conflict' : 'reset_failed', message }, message.includes('changed') ? 409 : 400)
    }
  })
  app.get('/api/sync/reset/:jobId', async (context) => {
    const account = await requireAccount(context)
    if (account instanceof Response)
      return account
    const job = await repository.getResetJob(account.accountId, context.req.param('jobId'))
    return job ? context.json(job) : context.json({ code: 'reset_job_not_found' }, 404)
  })
  app.post('/api/auth/logout', async (context) => {
    const account = await requireAccountWithCsrf(context)
    if (account instanceof Response)
      return account
    const headers = new Headers()
    await browserAuth.logout(context.req.raw, headers)
    await recordAudit({
      accountId: account.accountId,
      action: 'auth.logout',
      actorId: account.accountId,
      actorType: 'browser',
      outcome: 'success',
      remoteAddress: context.get('remoteAddress'),
      requestId: context.get('requestId'),
    })
    return json({ loggedOut: true }, 200, headers)
  })
  app.get('*', async (context) => {
    if (!services.webRoot)
      return context.text('Memorilo Sync Server')
    const requestPath = context.req.path === '/' ? '/index.html' : context.req.path
    const relativePath = requestPath.replace(/^\/+/u, '')
    if (relativePath.includes('..'))
      return context.notFound()
    try {
      const body = await readFile(join(services.webRoot, relativePath))
      const contentType = context.req.path.endsWith('.js')
        ? 'text/javascript; charset=UTF-8'
        : extname(context.req.path) === '.css'
          ? 'text/css; charset=UTF-8'
          : 'text/html; charset=UTF-8'
      return contentType.startsWith('text/html')
        ? renderIndex(body)
        : new Response(body, { headers: { 'content-type': contentType } })
    }
    catch {
      if (context.req.method === 'GET') {
        const body = await readFile(join(services.webRoot, 'index.html'))
        return renderIndex(body)
      }
      return context.notFound()
    }
  })
  return app
}
