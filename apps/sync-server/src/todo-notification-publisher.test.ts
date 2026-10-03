import { EventEmitter } from 'node:events'
import { decodeMemoriloProto } from '@memorilo/sync-protocol'
import { describe, expect, it, vi } from 'vitest'
import { createTodoNotificationPublisher, todoNotificationPayload, todoNotificationTopic } from './todo-notification-publisher'

const mqttMock = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('mqtt', () => ({ default: mqttMock }))

describe('tODO notification topics', () => {
  it('uses a bounded device-scoped topic and does not include account data', () => {
    expect(todoNotificationTopic('memorilo/todos/', 'note4:device/1')).toBe('memorilo/todos/note4%3Adevice%2F1/todos/changed')
  })

  it('keeps the notification bounded and free of task contents', () => {
    const payload = todoNotificationPayload({ changedAt: Date.parse('2026-09-05T00:00:00Z'), revision: 'r'.repeat(128) })
    expect(payload.byteLength).toBeLessThanOrEqual(512)
    expect(decodeMemoriloProto('TodoRefreshHint', payload)).toEqual({
      generatedAt: '2026-09-05T00:00:00.000Z',
      revision: 'r'.repeat(128),
      view: 'all',
    })
  })

  it('rejects invalid notification metadata', () => {
    expect(() => todoNotificationPayload({ changedAt: -1, revision: 'revision' })).toThrow()
    expect(() => todoNotificationPayload({ changedAt: 0, revision: '' })).toThrow()
    expect(() => todoNotificationPayload({ changedAt: 0, revision: 'x'.repeat(129) })).toThrow()
    expect(() => todoNotificationPayload({ changedAt: 0, revision: 'has space' })).toThrow()
  })

  it('publishes after connect, drops while offline, and resumes on reconnect', async () => {
    const client = new FakeMqttClient()
    mqttMock.connect.mockReturnValueOnce(client)
    const publisher = createTodoNotificationPublisher({
      brokerUrl: 'mqtts://broker.example',
      clientId: 'server-test',
      listRecipients: async () => ['device-1'],
      password: 'secret',
      topicPrefix: 'memorilo/todos',
      username: 'server',
    })

    await publisher.publishChanged({ accountId: 'account-1', changedAt: 1, generation: 1, revision: 'revision-1' })
    expect(client.published).toHaveLength(0)

    client.emit('connect')
    await publisher.publishChanged({ accountId: 'account-1', changedAt: 1, generation: 1, revision: 'revision-1' })
    expect(client.published).toHaveLength(1)
    expect(client.published[0]?.topic).toBe('memorilo/todos/device-1/todos/changed')

    client.emit('close')
    await publisher.publishChanged({ accountId: 'account-1', changedAt: 2, generation: 2, revision: 'revision-2' })
    expect(client.published).toHaveLength(1)

    client.emit('connect')
    await publisher.publishChanged({ accountId: 'account-1', changedAt: 2, generation: 2, revision: 'revision-2' })
    await publisher.publishChanged({ accountId: 'account-1', changedAt: 2, generation: 2, revision: 'revision-2' })
    expect(client.published).toHaveLength(3)
    expect(mqttMock.connect).toHaveBeenCalledWith('mqtts://broker.example', expect.objectContaining({
      password: 'secret',
      username: 'server',
    }))
    await publisher.close()
    expect(client.end).toHaveBeenCalledOnce()
  })
})

class FakeMqttClient extends EventEmitter {
  connected = false
  reconnecting = false
  readonly end = vi.fn((_force: boolean, _options: object, callback: (error?: Error) => void) => callback())
  readonly published: Array<{ body: Uint8Array, topic: string }> = []

  publish(topic: string, body: Uint8Array, _options: object, callback: (error?: Error) => void): void {
    this.published.push({ body, topic })
    callback()
  }

  override emit(event: string | symbol, ...arguments_: unknown[]): boolean {
    if (event === 'connect')
      this.connected = true
    if (event === 'close')
      this.connected = false
    return super.emit(event, ...arguments_)
  }
}
