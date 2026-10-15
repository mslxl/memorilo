import type { PairingResponse } from '@memorilo/sync'
import type { P2pApplication } from '@memorilo/sync/node'
import type { DeviceTodoModule } from './device-todo'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeSyncServerCredentialBundle } from '@memorilo/sync'
import { decodePairingPayload, encodePairingPayload, MemoryPairingStore, PairingManager } from '@memorilo/sync/node'
import argon2 from 'argon2'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteSyncDatabase } from '../infrastructure/database/sqlite'
import { hashDeviceCredential } from '../infrastructure/p2p/server-peer'
import { createSyncServerApp } from './app'

const configs = {
  deviceCredentialTtlMs: 90 * 24 * 60 * 60 * 1000,
  enabledModes: ['relay', 'authoritative'] as ('relay' | 'authoritative')[],
  host: '127.0.0.1',
  maxApiRequestsPerMinute: 600,
  maxAuthAttemptsPerMinute: 10,
  maintenanceMode: 'off' as 'off' | 'read-only',
  metadataDatabase: 'sqlite' as const,
  maxObjectTransfersPerAccount: 4,
  maxSyncSessionsPerAccount: 8,
  mqttTodoTopicPrefix: 'memorilo/todos',
  objectStore: 'filesystem' as const,
  orphanGraceMs: 15 * 60 * 1000,
  orphanIntervalMs: 60_000,
  port: 6000,
  registration: 'disabled' as const,
  s3ForcePathStyle: false,
  s3Region: 'us-east-1',
  sessionIdleTimeoutMs: 30_000,
  sessionTotalTimeoutMs: 120_000,
  trustProxy: false,
}

describe('sync server management API', () => {
  const directories: string[] = []

  function localRequest(
    app: ReturnType<typeof createSyncServerApp>,
    path: string,
    init?: RequestInit,
    remoteAddress = '127.0.0.1',
  ): Promise<Response> {
    return Promise.resolve(app.request(`http://127.0.0.1${path}`, init, {
      incoming: { socket: { remoteAddress } },
    }))
  }

  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
  })

  async function fixture(
    registration: 'disabled' | 'invite-only' | 'public' = 'disabled',
    overrides: Partial<typeof configs> = {},
    peer?: P2pApplication,
    now?: () => number,
    deviceTodo?: DeviceTodoModule,
    isReady?: () => boolean,
  ) {
    const directory = await mkdtemp(join(tmpdir(), 'memorilo-sync-server-test-'))
    directories.push(directory)
    const database = createSqliteSyncDatabase({ filename: join(directory, 'sync.sqlite') })
    database.migrate()
    const app = createSyncServerApp({ ...configs, ...overrides, dataDir: directory, registration }, {
      audit: database.audit,
      auth: database.auth,
      ...(now === undefined ? {} : { now }),
      ...(isReady === undefined ? {} : { isReady }),
      peer,
      repository: database.repository,
      deviceTodo,
    })
    return { app, database }
  }

  it('issues a scoped device credential only after a signed one-time pairing response', async () => {
    const serverPairing = new PairingManager(
      { deviceId: 'server-device', deviceName: 'Server', peerId: 'server-peer', role: 'server' },
      new MemoryPairingStore(),
    )
    const clientPairing = new PairingManager(
      { deviceId: 'client-device', deviceName: 'Client', peerId: 'client-peer' },
      new MemoryPairingStore(),
    )
    await Promise.all([serverPairing.load(), clientPairing.load()])
    const peer = {
      completePairing: (response: string) => serverPairing.completeInvitation(response),
      createInvitation: async (membershipEpoch?: number) => serverPairing.createInvitation(10 * 60 * 1000, membershipEpoch),
      localDevice: () => ({ deviceId: 'server-device', deviceName: 'Server', peerId: 'server-peer' }),
    } as P2pApplication
    const { app, database } = await fixture('disabled', {}, peer)
    await database.auth.provisionAccount({
      accountId: 'pairing-account',
      createdAt: 1,
      enabledModes: ['authoritative'],
      passwordHash: await argon2.hash('correct horse battery'),
      requireEmpty: true,
      username: 'owner',
    })
    const session = await login(app)
    const headers = { 'content-type': 'application/json', 'cookie': session.cookie, 'x-csrf-token': session.csrfToken }
    let response = await app.request('http://127.0.0.1/api/devices/pairing', { headers, method: 'POST' })
    expect(response.status).toBe(201)
    const invitation = (await response.json() as { invitation: string }).invitation
    const accepted = await clientPairing.acceptInvitation(invitation)

    const signedResponse = decodePairingPayload<PairingResponse>(accepted.response)
    response = await app.request('http://127.0.0.1/api/devices/pairing/complete', {
      body: JSON.stringify({ response: encodePairingPayload({ ...signedResponse, deviceName: 'Tampered client' }) }),
      headers,
      method: 'POST',
    })
    expect(response.status).toBe(400)

    response = await app.request('http://127.0.0.1/api/devices/pairing/complete', {
      body: JSON.stringify({ response: accepted.response }),
      headers,
      method: 'POST',
    })
    expect(response.status).toBe(201)
    const issued = await response.json() as { credential: string, expiresAt: number }
    const bundle = decodeSyncServerCredentialBundle(issued.credential)
    expect(bundle).toMatchObject({
      generation: 0,
      membershipEpoch: 1,
      modes: ['authoritative'],
      peerId: 'server-peer',
      policyEpoch: 0,
      version: 1,
    })
    const credential = await database.auth.findDeviceCredential(hashDeviceCredential(bundle.credential))
    expect(credential).toMatchObject({
      accountId: 'pairing-account',
      deviceId: 'client-device',
      membershipEpoch: 1,
      scopes: ['sync', 'object'],
      signingPublicKey: clientPairing.signer.publicKey,
    })
    expect(credential?.expiresAt).toBe(issued.expiresAt)

    response = await app.request('http://127.0.0.1/api/devices/pairing/complete', {
      body: JSON.stringify({ response: accepted.response }),
      headers,
      method: 'POST',
    })
    expect(response.status).toBe(403)
    database.close()
  })

  it('consumes device request nonces atomically', async () => {
    const { database } = await fixture()
    const nonce = {
      createdAt: 100,
      credentialHash: 'credential-hash',
      expiresAt: 200,
      nonceHash: 'nonce-hash',
    }
    await expect(database.auth.consumeDeviceNonce(nonce)).resolves.toBe(true)
    await expect(database.auth.consumeDeviceNonce(nonce)).resolves.toBe(false)
    database.close()
  })

  async function login(
    app: ReturnType<typeof createSyncServerApp>,
    username = 'owner',
    password = 'correct horse battery',
  ): Promise<{ cookie: string, csrfToken: string }> {
    const response = await app.request('http://127.0.0.1/api/auth/login', {
      body: JSON.stringify({ password, username }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { csrfToken: string }
    const cookie = response.headers.get('set-cookie')
    expect(cookie).toBeTruthy()
    return { cookie: cookie!.split(';', 1)[0]!, csrfToken: body.csrfToken }
  }

  it('creates the initial account from any address atomically and exposes policy/reset controls', async () => {
    const { app, database } = await fixture()
    let response = await localRequest(app, '/api/setup', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'owner' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(201)
    const session = await login(app)
    const headers = { 'content-type': 'application/json', 'cookie': session.cookie, 'x-csrf-token': session.csrfToken }
    response = await app.request('http://127.0.0.1/api/sync/state', { headers })
    const state = await response.json() as { generation: number, policyEpoch: number }
    response = await app.request('http://127.0.0.1/api/sync/policy', {
      body: JSON.stringify({
        enabledModes: ['authoritative'],
        password: 'correct horse battery',
        policyEpoch: state.policyEpoch,
        transition: 'unchanged',
      }),
      headers,
      method: 'PATCH',
    })
    expect(response.status).toBe(200)
    response = await app.request('http://127.0.0.1/api/sync/reset', {
      body: JSON.stringify({ confirmation: 'CLEAR SERVER DATA', generation: state.generation, password: 'correct horse battery' }),
      headers: { 'content-type': 'application/json', 'cookie': session.cookie },
      method: 'POST',
    })
    expect(response.status).toBe(403)
    response = await app.request('http://127.0.0.1/api/sync/reset', {
      body: JSON.stringify({ confirmation: 'CLEAR SERVER DATA', generation: state.generation, password: 'correct horse battery' }),
      headers,
      method: 'POST',
    })
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      generation: 1,
      membershipEpoch: 2,
      recoverableOffline: false,
    })
    response = await app.request('http://127.0.0.1/api/audit-events', { headers })
    expect(response.status).toBe(200)
    const audit = await response.json() as { events: Array<{ action: string }> }
    expect(audit.events.map(event => event.action)).toEqual(expect.arrayContaining([
      'account.setup',
      'auth.login',
      'sync.data.reset',
      'sync.policy.update',
    ]))
    database.close()
  })

  it('supports public registration and rejects duplicate usernames', async () => {
    const { app, database } = await fixture('public')
    let response = await localRequest(app, '/api/setup', undefined, '203.0.113.10')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ available: true })

    response = await localRequest(app, '/api/setup', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'owner' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, '203.0.113.10')
    expect(response.status).toBe(201)

    response = await app.request('http://127.0.0.1/api/setup')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ available: false })

    response = await app.request('http://127.0.0.1/api/auth/register', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'alice' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(201)
    response = await app.request('http://127.0.0.1/api/auth/register', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'alice' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(400)
    database.close()
  })

  it('rejects registration when the server policy is disabled', async () => {
    const { app, database } = await fixture('disabled')
    const response = await app.request('http://127.0.0.1/api/auth/register', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'alice' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: 'registration_disabled' })
    await expect(database.auth.countAccounts()).resolves.toBe(0)
    database.close()
  })

  it('expires browser sessions before serving account data', async () => {
    let timestamp = 1_000_000
    const { app, database } = await fixture('disabled', {}, undefined, () => timestamp)
    const setup = await localRequest(app, '/api/setup', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'owner' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(setup.status).toBe(201)
    const session = await login(app)
    let response = await app.request('http://127.0.0.1/api/auth/me', { headers: { cookie: session.cookie } })
    expect(response.status).toBe(200)

    timestamp += 8 * 24 * 60 * 60 * 1000
    response = await app.request('http://127.0.0.1/api/auth/me', { headers: { cookie: session.cookie } })
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ code: 'unauthorized' })
    response = await app.request('http://127.0.0.1/api/sync/state', { headers: { cookie: session.cookie } })
    expect(response.status).toBe(401)
    database.close()
  })

  it('rejects an expired pairing response before consuming or issuing a credential', async () => {
    let timestamp = 1_000_000
    const serverPairing = new PairingManager(
      { deviceId: 'server-device', deviceName: 'Server', peerId: 'server-peer', role: 'server' },
      new MemoryPairingStore(),
      () => timestamp,
    )
    await serverPairing.load()
    const peer = {
      completePairing: (response: string) => serverPairing.completeInvitation(response),
      createInvitation: async (membershipEpoch?: number) => serverPairing.createInvitation(60_000, membershipEpoch),
      localDevice: () => ({ deviceId: 'server-device', deviceName: 'Server', peerId: 'server-peer' }),
    } as P2pApplication
    const { app, database } = await fixture('disabled', {}, peer, () => timestamp)
    await database.auth.provisionAccount({
      accountId: 'pairing-account',
      createdAt: timestamp,
      enabledModes: ['authoritative'],
      passwordHash: await argon2.hash('correct horse battery'),
      requireEmpty: true,
      username: 'owner',
    })
    const session = await login(app)
    const headers = { 'content-type': 'application/json', 'cookie': session.cookie, 'x-csrf-token': session.csrfToken }
    const invitationResponse = await app.request('http://127.0.0.1/api/devices/pairing', { headers, method: 'POST' })
    expect(invitationResponse.status).toBe(201)
    const invitation = (await invitationResponse.json() as { invitation: string }).invitation
    const clientPairing = new PairingManager(
      { deviceId: 'client-device', deviceName: 'Client', peerId: 'client-peer' },
      new MemoryPairingStore(),
      () => timestamp,
    )
    await clientPairing.load()
    const accepted = await clientPairing.acceptInvitation(invitation)
    timestamp += 61_000
    const response = await app.request('http://127.0.0.1/api/devices/pairing/complete', {
      body: JSON.stringify({ response: accepted.response }),
      headers,
      method: 'POST',
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: 'pairing_not_owned' })
    await expect(database.auth.listDeviceCredentials('pairing-account')).resolves.toEqual([])
    database.close()
  })

  it('requires CSRF on every authenticated browser mutation', async () => {
    const serverPairing = new PairingManager(
      { deviceId: 'server-device', deviceName: 'Server', peerId: 'server-peer', role: 'server' },
      new MemoryPairingStore(),
    )
    await serverPairing.load()
    const peer = {
      completePairing: (response: string) => serverPairing.completeInvitation(response),
      createInvitation: async (membershipEpoch?: number) => serverPairing.createInvitation(10 * 60 * 1000, membershipEpoch),
      localDevice: () => ({ deviceId: 'server-device', deviceName: 'Server', peerId: 'server-peer' }),
    } as P2pApplication
    const { app, database } = await fixture('invite-only', {}, peer)
    await database.auth.provisionAccount({
      accountId: 'csrf-account',
      createdAt: 1,
      enabledModes: ['authoritative'],
      passwordHash: await argon2.hash('correct horse battery'),
      requireEmpty: true,
      username: 'owner',
    })
    const session = await login(app)
    const headers = { 'content-type': 'application/json', 'cookie': session.cookie }
    const mutations: Array<Response | Promise<Response>> = [
      app.request('http://127.0.0.1/api/auth/invites', { headers, method: 'POST' }),
      app.request('http://127.0.0.1/api/devices/pairing', { headers, method: 'POST' }),
      app.request('http://127.0.0.1/api/devices/pairing/complete', { body: JSON.stringify({ response: 'invalid' }), headers, method: 'POST' }),
      app.request('http://127.0.0.1/api/devices/device-1/revoke', { body: JSON.stringify({ password: 'correct horse battery' }), headers, method: 'POST' }),
      app.request('http://127.0.0.1/api/sync/policy', { body: JSON.stringify({ enabledModes: ['authoritative'], password: 'correct horse battery', policyEpoch: 0, transition: 'unchanged' }), headers, method: 'PATCH' }),
      app.request('http://127.0.0.1/api/sync/reset', { body: JSON.stringify({ confirmation: 'CLEAR SERVER DATA', generation: 0, password: 'correct horse battery' }), headers, method: 'POST' }),
      app.request('http://127.0.0.1/api/auth/logout', { headers, method: 'POST' }),
    ]
    for (const response of await Promise.all(mutations)) {
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ code: 'csrf_invalid' })
    }
    database.close()
  })

  it('bootstraps an invite-only server from any address and consumes each invitation once', async () => {
    const { app, database } = await fixture('invite-only')
    let response = await localRequest(app, '/api/setup', undefined, '203.0.113.10')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ available: true })

    response = await localRequest(app, '/api/setup', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'owner' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }, '203.0.113.10')
    expect(response.status).toBe(201)
    const session = await login(app)
    response = await app.request('http://127.0.0.1/api/auth/invites', {
      headers: { cookie: session.cookie },
      method: 'POST',
    })
    expect(response.status).toBe(403)
    response = await app.request('http://127.0.0.1/api/auth/invites', {
      headers: { 'cookie': session.cookie, 'x-csrf-token': session.csrfToken },
      method: 'POST',
    })
    expect(response.status).toBe(201)
    const invitation = await response.json() as { token: string }

    response = await app.request('http://127.0.0.1/api/auth/register', {
      body: JSON.stringify({ password: 'another correct password', username: 'alice' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(400)
    response = await app.request('http://127.0.0.1/api/auth/register', {
      body: JSON.stringify({ inviteToken: invitation.token, password: 'another correct password', username: 'alice' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(201)
    response = await app.request('http://127.0.0.1/api/auth/register', {
      body: JSON.stringify({ inviteToken: invitation.token, password: 'third correct password', username: 'bob' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(400)
    await expect(database.auth.countAccounts()).resolves.toBe(2)
    database.close()
  })

  it('isolates devices, revocation, reset jobs, and audit events between accounts', async () => {
    const { app, database } = await fixture('public')
    const createdAt = Date.now()
    for (const [accountId, username, password] of [
      ['account-alice', 'alice', 'alice correct password'],
      ['account-bob', 'bob', 'bob correct password'],
    ] as const) {
      await database.auth.provisionAccount({
        accountId,
        createdAt,
        enabledModes: ['authoritative'],
        passwordHash: await argon2.hash(password),
        username,
      })
      await database.auth.createDeviceCredential({
        accountId,
        createdAt,
        credentialHash: `credential-${username}`,
        deviceId: 'shared-device-id',
        deviceName: `${username} device`,
        expiresAt: createdAt + 60_000,
        membershipEpoch: 1,
        pairingId: `pairing-${username}`,
        peerId: `peer-${username}`,
        scopes: ['sync', 'object'],
        sharedSecretHash: `secret-${username}`,
        signingPublicKey: `public-key-${username}`,
      })
    }
    const alice = await login(app, 'alice', 'alice correct password')
    const bob = await login(app, 'bob', 'bob correct password')
    const aliceHeaders = { 'content-type': 'application/json', 'cookie': alice.cookie, 'x-csrf-token': alice.csrfToken }

    let response = await app.request('http://127.0.0.1/api/devices', { headers: { cookie: alice.cookie } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ devices: [{ deviceName: 'alice device' }] })
    response = await app.request('http://127.0.0.1/api/devices/shared-device-id/revoke', {
      body: JSON.stringify({ password: 'wrong password' }),
      headers: aliceHeaders,
      method: 'POST',
    })
    expect(response.status).toBe(403)
    await expect(database.auth.findDeviceCredential('credential-alice')).resolves.toMatchObject({ revokedAt: null })
    response = await app.request('http://127.0.0.1/api/devices/shared-device-id/revoke', {
      body: JSON.stringify({ password: 'alice correct password' }),
      headers: aliceHeaders,
      method: 'POST',
    })
    expect(response.status).toBe(200)
    await expect(database.auth.findDeviceCredential('credential-alice')).resolves.toMatchObject({ revokedAt: expect.any(Number) })
    await expect(database.auth.findDeviceCredential('credential-bob')).resolves.toMatchObject({ revokedAt: null })

    response = await app.request('http://127.0.0.1/api/sync/reset', {
      body: JSON.stringify({ confirmation: 'CLEAR SERVER DATA', generation: 0, password: 'alice correct password' }),
      headers: aliceHeaders,
      method: 'POST',
    })
    expect(response.status).toBe(202)
    const { jobId } = await response.json() as { jobId: string }
    response = await app.request(`http://127.0.0.1/api/sync/reset/${jobId}`, { headers: { cookie: bob.cookie } })
    expect(response.status).toBe(404)
    response = await app.request('http://127.0.0.1/api/audit-events', { headers: { cookie: bob.cookie } })
    const audit = await response.json() as { events: Array<{ action: string }> }
    expect(audit.events.map(event => event.action)).not.toContain('sync.data.reset')
    database.close()
  })

  it('enforces server-enabled modes and rate limits expensive authentication', async () => {
    const { app, database } = await fixture('disabled', {
      enabledModes: ['authoritative'],
      maxAuthAttemptsPerMinute: 1,
    })
    let response = await localRequest(app, '/api/setup', {
      body: JSON.stringify({ password: 'correct horse battery', username: 'owner' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(201)
    response = await localRequest(app, '/api/auth/login', {
      body: JSON.stringify({ password: 'wrong password', username: 'owner' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(429)
    const account = await database.auth.findAccountByUsername('owner')
    expect(account).not.toBeNull()
    expect((await database.repository.getAccountState(account!.accountId))?.enabledModes).toEqual(['authoritative'])
    database.close()
  })

  it('keeps reads and login available while rejecting management mutations in maintenance mode', async () => {
    const { app, database } = await fixture('disabled', { maintenanceMode: 'read-only' })
    await database.auth.provisionAccount({
      accountId: 'maintenance-account',
      createdAt: 1,
      enabledModes: ['authoritative'],
      passwordHash: await argon2.hash('correct horse battery'),
      requireEmpty: true,
      username: 'owner',
    })
    const session = await login(app)
    let response = await app.request('http://127.0.0.1/api/sync/state', { headers: { cookie: session.cookie } })
    expect(response.status).toBe(200)
    response = await app.request('http://127.0.0.1/api/sync/reset', {
      body: JSON.stringify({ confirmation: 'CLEAR SERVER DATA', generation: 0, password: 'correct horse battery' }),
      headers: { 'content-type': 'application/json', 'cookie': session.cookie, 'x-csrf-token': session.csrfToken },
      method: 'POST',
    })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ code: 'server_read_only' })
    database.close()
  })

  it('serves the public Todo ICS URL with rolling options and conditional caching', async () => {
    const credential = {
      accountId: 'feed-account',
      createdAt: 1,
      deviceId: 'calendar:desktop-1:credential',
      deviceName: 'Desktop',
      expiresAt: Date.parse('2027-01-01T00:00:00Z'),
      revokedAt: null,
      scopes: ['todos:calendar:read'] as const,
      tokenHash: 'hash',
    }
    const issueCalendarToken = vi.fn(() => Effect.succeed({ credential, token: 'memorilo-calendar-v1.secret' }))
    const revokeCalendarToken = vi.fn(() => Effect.succeed(true))
    const calendar = vi.fn(() => Effect.succeed({
      body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      revision: 'todos-revision-1',
    }))
    const deviceTodo = { calendar, issueCalendarToken, revokeCalendarToken } as unknown as DeviceTodoModule
    const { app, database } = await fixture(
      'disabled',
      {},
      undefined,
      () => Date.parse('2026-09-01T08:00:00Z'),
      deviceTodo,
    )
    await database.auth.provisionAccount({ accountId: 'feed-account', createdAt: 1, enabledModes: ['authoritative'], passwordHash: await argon2.hash('correct horse battery'), requireEmpty: true, username: 'owner' })
    const session = await login(app)
    const managementHeaders = { 'content-type': 'application/json', 'cookie': session.cookie, 'x-csrf-token': session.csrfToken }
    let response: Response
    response = await localRequest(app, '/api/devices/todo-calendar-token', {
      body: JSON.stringify({ deviceId: 'desktop-1', deviceName: 'Desktop' }),
      headers: managementHeaders,
      method: 'POST',
    })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ credential: 'memorilo-calendar-v1.secret', scopes: ['todos:calendar:read'] })
    expect(issueCalendarToken).toHaveBeenCalledWith({ accountId: 'feed-account', deviceId: 'desktop-1', deviceName: 'Desktop' })
    await database.auth.createDeviceCredential({
      accountId: 'feed-account',
      createdAt: 1,
      credentialHash: hashDeviceCredential('sync-device-secret'),
      deviceId: 'desktop-1',
      deviceName: 'Desktop',
      expiresAt: Date.parse('2027-01-01T00:00:00Z'),
      membershipEpoch: 1,
      pairingId: 'pairing-feed',
      peerId: 'desktop-peer',
      scopes: ['sync', 'object'],
      sharedSecretHash: 'shared-secret',
      signingPublicKey: 'public-key',
    })
    response = await localRequest(app, '/api/device/v1/todo-calendar-token', {
      body: JSON.stringify({ deviceName: 'Desktop client' }),
      headers: { 'authorization': 'Bearer sync-device-secret', 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(201)
    expect(issueCalendarToken).toHaveBeenLastCalledWith({ accountId: 'feed-account', deviceId: 'desktop-1', deviceName: 'Desktop client' })
    response = await localRequest(app, '/api/device/v1/todo-calendar-token', {
      headers: { authorization: 'Bearer revoked-or-invalid' },
      method: 'POST',
    })
    expect(response.status).toBe(401)
    const path = '/calendar/memorilo-calendar-v1.secret.ics?tz=Asia%2FShanghai&beforeDays=7&afterDays=14&completed=show&undated=hide'
    response = await localRequest(app, path)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/calendar')
    expect(response.headers.get('cache-control')).toBe('private, max-age=0')
    const etag = response.headers.get('etag')
    expect(etag).toBeTruthy()
    await expect(response.text()).resolves.toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    expect(calendar).toHaveBeenCalledWith({
      options: {
        afterDays: 14,
        beforeDays: 7,
        completed: 'show',
        from: '2026-08-25',
        through: '2026-09-15',
        timeZone: 'Asia/Shanghai',
        undated: 'hide',
        undatedDate: '2026-09-01',
      },
      token: 'memorilo-calendar-v1.secret',
    })

    response = await localRequest(app, path, { headers: { 'if-none-match': etag! } })
    expect(response.status).toBe(304)
    await expect(response.text()).resolves.toBe('')
    expect(calendar).toHaveBeenCalledTimes(2)

    response = await localRequest(app, '/calendar/memorilo-calendar-v1.secret.ics?tz=Not%2FAZone')
    expect(response.status).toBe(400)
    response = await localRequest(app, '/calendar/memorilo-calendar-v1.secret.txt')
    expect(response.status).toBe(404)
    response = await localRequest(app, '/api/devices/todo-calendar-tokens/desktop-1/revoke', { headers: managementHeaders, method: 'POST' })
    expect(response.status).toBe(200)
    expect(revokeCalendarToken).toHaveBeenCalledWith({ accountId: 'feed-account', deviceId: 'desktop-1' })
    response = await localRequest(app, '/api/device/v1/todo-calendar-token/revoke', {
      headers: { authorization: 'Bearer sync-device-secret' },
      method: 'POST',
    })
    expect(response.status).toBe(200)
    database.close()
  })

  it('drains the public Todo ICS URL while the server is not ready', async () => {
    const calendar = vi.fn(() => Effect.succeed({ body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', revision: 'revision' }))
    const deviceTodo = {
      calendar,
    } as unknown as DeviceTodoModule
    const { app, database } = await fixture('disabled', {}, undefined, undefined, deviceTodo, () => false)

    const response = await localRequest(app, '/calendar/memorilo-calendar-v1.secret.ics')
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ code: 'server_draining' })
    expect(calendar).not.toHaveBeenCalled()
    database.close()
  })
})
