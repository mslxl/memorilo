import type { PublicConfigEnvelope } from './protocol'

import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'
import {
  assertCurrentRevision,
  crc32,
  decodeFrame,
  decodeFrameSequence,
  encodeFrames,
  encodeTodoSyncRequest,
  parseApplyConfigEnvelope,
  parseApplyStatusEnvelope,
  parseDeviceInfoEnvelope,
  parsePublicConfigEnvelope,
  parseTodoSyncRequest,
  reassembleFrames,
} from './protocol'

interface SharedVector {
  requestToken: number
  chunkPayloadBytes: number
  jsonUtf8: string
  expectedCrc32: number
  expectedFramesHex: string[]
}

describe('provisioning protocol', () => {
  it('normalizes Rust null option fields while rejecting malformed values', () => {
    const config = {
      protocolVersion: 1,
      configSchemaVersion: 2,
      revision: 0,
      deviceName: 'Desk',
      wifiSsid: null,
      wifiPasswordIsSet: false,
      localManagementTokenIsSet: false,
      timezone: 'UTC',
      idleSleepSeconds: 600,
      selectionPolicy: 'Remember',
      todoSyncEnabled: false,
      todoSyncUrl: '',
      todoSyncTokenIsSet: false,
      todoSyncPollIntervalSeconds: 900,
      todoSyncView: 'today',
      todoSyncMqttBrokerUrl: null,
      todoSyncMqttTopic: null,
      todoSyncMqttUsername: null,
      todoSyncMqttPasswordIsSet: false,
    }
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const parsed = parsePublicConfigEnvelope(bytes(config))
    for (const key of ['wifiSsid', 'todoSyncMqttBrokerUrl', 'todoSyncMqttTopic', 'todoSyncMqttUsername']) {
      expect(parsed).not.toHaveProperty(key)
      expect(() => parsePublicConfigEnvelope(bytes({ ...config, [key]: 42 }))).toThrow()
    }
    const status = { protocolVersion: 1, requestId: 'request-1', revision: 1, status: 'accepted', error: null }
    expect(parseApplyStatusEnvelope(bytes(status))).not.toHaveProperty('error')
    expect(() => parseApplyStatusEnvelope(bytes({ ...status, error: 42 }))).toThrow()
  })

  it('matches the shared Rust and TypeScript vector', async () => {
    const vector = JSON.parse(await readFile(
      new URL('../test-vectors/provisioning-v1.json', import.meta.url),
      'utf8',
    )) as SharedVector
    const json = new TextEncoder().encode(vector.jsonUtf8)

    expect(crc32(json)).toBe(vector.expectedCrc32)
    const encoded = encodeFrames(vector.requestToken, json, vector.chunkPayloadBytes)
    expect(encoded.map(toHex)).toEqual(vector.expectedFramesHex)
    expect(new TextDecoder().decode(reassembleFrames(encoded.map(decodeFrame)))).toBe(vector.jsonUtf8)
    expect(parseApplyConfigEnvelope(json).requestId).toBe('req-20260903-01')
  })

  it('accepts unknown optional configuration fields', () => {
    const request = parseApplyConfigEnvelope(new TextEncoder().encode(JSON.stringify({
      protocolVersion: 1,
      requestId: 'req-optional',
      baseRevision: 0,
      requiredCapabilities: ['config-v1'],
      config: { futureOptional: { enabled: true } },
    })))
    expect(request.config.futureOptional).toEqual({ enabled: true })
  })

  it('rejects unsupported protocol versions and stale revisions', () => {
    const bytes = (protocolVersion: number, baseRevision: number) => new TextEncoder().encode(JSON.stringify({
      protocolVersion,
      requestId: 'req-revision',
      baseRevision,
      requiredCapabilities: ['config-v1'],
      config: {},
    }))

    expect(() => parseApplyConfigEnvelope(bytes(2, 4))).toThrowError(expect.objectContaining({
      code: 'unsupported-protocol',
    }))
    const request = parseApplyConfigEnvelope(bytes(1, 4))
    expect(() => assertCurrentRevision(request, 5)).toThrowError(expect.objectContaining({
      code: 'stale-revision',
    }))
    expect(() => assertCurrentRevision(request, 4)).not.toThrow()
  })

  it('accepts the optional Desktop wall-clock offset on TODO snapshots', () => {
    const request = parseTodoSyncRequest(encodeTodoSyncRequest({ operation: 'todo.sync', protocolVersion: 1, requestId: 'todo-time-1', snapshot: { generatedAt: '2026-09-30T00:00:00.000Z', timeZoneOffsetMinutes: 480, items: [], revision: 'empty' } }))
    expect(request.snapshot.timeZoneOffsetMinutes).toBe(480)
    expect(() => parseTodoSyncRequest(encodeTodoSyncRequest({ operation: 'todo.sync', protocolVersion: 1, requestId: 'todo-time-2', snapshot: { generatedAt: '2026-09-30T00:00:00.000Z', timeZoneOffsetMinutes: 1_000, items: [], revision: 'empty' } }))).toThrow()
  })

  it('models public configuration without readable password material', () => {
    const publicConfig: PublicConfigEnvelope = {
      protocolVersion: 1,
      configSchemaVersion: 2,
      revision: 3,
      deviceName: 'Desk',
      wifiSsid: 'Office',
      wifiPasswordIsSet: true,
      timezone: 'Asia/Shanghai',
      idleSleepSeconds: 600,
      localManagementTokenIsSet: true,
      selectionPolicy: 'Remember',
      weather: { enabled: true, latitudeE6: 31_230_400, locationName: 'Shanghai', longitudeE6: 121_473_700 },
      almanac: { note: 'User note', source: 'Personal calendar' },
      todoSyncEnabled: false,
      todoSyncUrl: '',
      todoSyncTokenIsSet: false,
      todoSyncPollIntervalSeconds: 900,
      todoSyncView: 'today',
    }

    expect(JSON.stringify(publicConfig)).not.toContain('password')
    expect(JSON.stringify(publicConfig)).toContain('wifiPasswordIsSet')
  })

  it('decodes concatenated characteristic frames and validates read envelopes', () => {
    const parse = <Value>(value: Value, parser: (json: Uint8Array) => Value): Value => {
      const json = new TextEncoder().encode(JSON.stringify(value))
      const wire = Uint8Array.from(encodeFrames(9, json, 24).flatMap(frame => [...frame]))
      return parser(reassembleFrames(decodeFrameSequence(wire)))
    }

    expect(parse({
      capabilities: ['config-v1'],
      configRevision: 2,
      configSchemaVersion: 2,
      deviceId: 'device-1',
      firmwareVersion: '0.1.0',
      protocolVersion: 1,
    }, parseDeviceInfoEnvelope).deviceId).toBe('device-1')
    expect(parse({
      configSchemaVersion: 2,
      deviceName: 'Desk',
      idleSleepSeconds: 600,
      localManagementTokenIsSet: false,
      protocolVersion: 1,
      revision: 2,
      selectionPolicy: 'Remember',
      timezone: 'Asia/Shanghai',
      wifiPasswordIsSet: false,
      weather: { enabled: true, latitudeE6: 31_230_400, locationName: 'Shanghai', longitudeE6: 121_473_700 },
      almanac: { note: 'User note', source: 'Personal calendar' },
      todoSyncEnabled: false,
      todoSyncUrl: '',
      todoSyncTokenIsSet: false,
      todoSyncPollIntervalSeconds: 900,
      todoSyncView: 'today',
    }, parsePublicConfigEnvelope).weather?.locationName).toBe('Shanghai')
    expect(parse({
      protocolVersion: 1,
      requestId: 'request-1',
      revision: 3,
      status: 'accepted',
    }, parseApplyStatusEnvelope).status).toBe('accepted')
  })
})

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
