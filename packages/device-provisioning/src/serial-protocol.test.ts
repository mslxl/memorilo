import { describe, expect, it } from 'vitest'
import { encodeTodoSyncResponse } from './protocol'
import {
  encodeSerialProvisioningRequest,
  parseSerialProvisioningRequest,
  parseSerialProvisioningRequestBytes,
  parseSerialProvisioningResponse,
  parseSerialProvisioningResponseBytes,
  SERIAL_PROVISIONING_PREFIX,
} from './serial-protocol'

const apply = {
  baseRevision: 3,
  config: { deviceName: 'Kitchen' },
  protocolVersion: 1 as const,
  requestId: 'apply-1',
  requiredCapabilities: ['config-v1'],
}

describe('serial provisioning protocol', () => {
  it('ignores logs and round trips read and apply requests', () => {
    expect(parseSerialProvisioningRequest('I (42) boot: ready')).toBeNull()
    const read = { operation: 'read' as const, protocolVersion: 1 as const, requestId: 'read-1' }
    expect(parseSerialProvisioningRequest(new TextDecoder().decode(encodeSerialProvisioningRequest(read)).trimEnd())).toEqual(read)
    expect(parseSerialProvisioningRequest(new TextDecoder().decode(encodeSerialProvisioningRequest({ operation: 'apply', request: apply })).trimEnd())).toEqual({
      operation: 'apply',
      request: apply,
    })
  })

  it('validates the same envelopes used by Bluetooth', () => {
    const response = `${SERIAL_PROVISIONING_PREFIX}${JSON.stringify({
      deviceInfo: {
        capabilities: ['config-v1'],
        configRevision: 3,
        configSchemaVersion: 2,
        deviceId: 'device-1',
        firmwareVersion: '0.1.0',
        protocolVersion: 1,
      },
      operation: 'read',
      publicConfig: {
        configSchemaVersion: 2,
        deviceName: 'Desk',
        idleSleepSeconds: 600,
        localManagementTokenIsSet: false,
        protocolVersion: 1,
        revision: 3,
        selectionPolicy: 'Remember',
        timezone: 'UTC',
        todoSyncEnabled: true,
        todoSyncPollIntervalSeconds: 900,
        todoSyncTokenIsSet: false,
        todoSyncUrl: '',
        todoSyncView: 'today',
        wifiPasswordIsSet: false,
      },
      requestId: 'read-1',
    })}`
    expect(parseSerialProvisioningResponse(response)).toMatchObject({
      operation: 'read',
      requestId: 'read-1',
      publicConfig: { deviceName: 'Desk', revision: 3 },
    })
  })

  it('round trips Wi-Fi scan requests and validates network results', () => {
    const request = { operation: 'scanWifi' as const, protocolVersion: 1 as const, requestId: 'scan-1' }
    expect(parseSerialProvisioningRequest(new TextDecoder().decode(encodeSerialProvisioningRequest(request)).trimEnd())).toEqual(request)
    expect(parseSerialProvisioningResponse(`${SERIAL_PROVISIONING_PREFIX}${JSON.stringify({
      operation: 'scanWifi',
      requestId: 'scan-1',
      networks: [{ ssid: 'Office', rssi: -42, security: 'secured' }],
    })}`)).toEqual({
      operation: 'scanWifi',
      requestId: 'scan-1',
      networks: [{ ssid: 'Office', rssi: -42, security: 'secured' }],
    })
  })

  it('round trips gallery requests across the serial envelope', () => {
    const request = {
      operation: 'gallery.upload' as const,
      protocolVersion: 1 as const,
      requestId: 'gallery-1',
      name: 'frame',
      createdAtUnixSeconds: 10,
      bytesBase64: 'AAE=',
    }
    const encoded = new TextDecoder().decode(encodeSerialProvisioningRequest(request)).trimEnd()
    expect(parseSerialProvisioningRequest(encoded)).toEqual(request)
    expect(parseSerialProvisioningResponse(`${SERIAL_PROVISIONING_PREFIX}${JSON.stringify({
      operation: 'gallery.upload',
      requestId: 'gallery-1',
      status: 'error',
      error: 'storage-failure',
    })}`)).toMatchObject({ operation: 'gallery.upload', requestId: 'gallery-1', status: 'error' })

    expect(parseSerialProvisioningResponse(`${SERIAL_PROVISIONING_PREFIX}${JSON.stringify({
      operation: 'gallery.upload',
      requestId: 'gallery-1',
      status: 'error',
      error: 'capacity-exceeded',
    })}`)).toMatchObject({
      error: 'capacity-exceeded',
      operation: 'gallery.upload',
      requestId: 'gallery-1',
      status: 'error',
    })
  })

  it('round trips an empty TODO snapshot so it can clear the device', () => {
    const request = {
      operation: 'todo.sync' as const,
      protocolVersion: 1 as const,
      requestId: 'todo-empty-1',
      snapshot: {
        generatedAt: '2026-09-30T00:00:00.000Z',
        timeZoneOffsetMinutes: 480,
        items: [],
        revision: 'empty-revision',
      },
    }
    const encoded = encodeSerialProvisioningRequest(request)
    expect(parseSerialProvisioningRequestBytes(encoded)).toEqual(request)
    const responsePayload = encodeTodoSyncResponse({ operation: 'todo.sync', requestId: request.requestId, status: 'accepted' })
    const response = new Uint8Array(new TextEncoder().encode(SERIAL_PROVISIONING_PREFIX).byteLength + 4 + responsePayload.byteLength)
    const prefixLength = new TextEncoder().encode(SERIAL_PROVISIONING_PREFIX).byteLength
    response.set(new TextEncoder().encode(SERIAL_PROVISIONING_PREFIX))
    new DataView(response.buffer).setUint32(prefixLength, responsePayload.byteLength, true)
    response.set(responsePayload, prefixLength + 4)
    expect(parseSerialProvisioningResponseBytes(response)).toEqual({
      operation: 'todo.sync',
      requestId: request.requestId,
      status: 'accepted',
    })
  })
})
