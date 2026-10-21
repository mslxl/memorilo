import { Buffer } from 'node:buffer'
import { encodeMemoriloProto } from '@memorilo/sync-protocol'
import mqtt from 'mqtt'

export interface TodoNotificationPublisher {
  readonly publishChanged: (input: {
    readonly accountId: string
    readonly generation: number
    readonly revision: string
    readonly changedAt: number
  }) => Promise<void>
  readonly close: () => Promise<void>
}

export interface TodoNotificationPublisherOptions {
  readonly brokerUrl: string
  readonly username?: string
  readonly password?: string
  readonly topicPrefix: string
  readonly listRecipients: (accountId: string) => Promise<readonly string[]>
  readonly clientId?: string
}

const maxNotificationBytes = 512

export function todoNotificationPayload(input: {
  readonly changedAt: number
  readonly revision: string
}): Uint8Array {
  if (!Number.isSafeInteger(input.changedAt) || input.changedAt < 0)
    throw new Error('TODO notification changedAt must be a non-negative timestamp')
  if (input.revision.length === 0 || input.revision.length > 128 || !/^[\x21-\x7E]+$/u.test(input.revision))
    throw new Error('TODO notification revision is invalid')
  const payload = encodeMemoriloProto('TodoRefreshHint', {
    generatedAt: new Date(input.changedAt).toISOString(),
    revision: input.revision,
    view: 'all',
  })
  if (payload.byteLength > maxNotificationBytes)
    throw new Error('TODO notification payload is too large')
  return payload
}

export function todoNotificationTopic(prefix: string, deviceId: string): string {
  const normalizedPrefix = prefix.replace(/\/+$/u, '')
  const normalizedDevice = encodeURIComponent(deviceId)
  return `${normalizedPrefix}/${normalizedDevice}/todos/changed`
}

export function createTodoNotificationPublisher(options: TodoNotificationPublisherOptions): TodoNotificationPublisher {
  if (!options.brokerUrl.startsWith('mqtts://'))
    throw new Error('TODO notification broker must use mqtts://')
  const client = mqtt.connect(options.brokerUrl, {
    clientId: options.clientId,
    clean: true,
    connectTimeout: 10_000,
    keepalive: 30,
    password: options.password,
    reconnectPeriod: 5_000,
    username: options.username,
  })
  let connected = false
  client.on('connect', () => {
    connected = true
  })
  client.on('close', () => {
    connected = false
  })

  const publish = (topic: string, body: Uint8Array): Promise<void> => new Promise((resolve, reject) => {
    client.publish(topic, Buffer.from(body), { qos: 1, retain: false }, error => error === undefined ? resolve() : reject(error))
  })

  return {
    async publishChanged(input) {
      const recipients = await options.listRecipients(input.accountId)
      if (!connected || recipients.length === 0)
        return
      const payload = todoNotificationPayload(input)
      await Promise.all(recipients.map(deviceId => publish(todoNotificationTopic(options.topicPrefix, deviceId), payload)))
    },
    async close() {
      if (!client.connected && !client.reconnecting)
        return
      await new Promise<void>((resolve, reject) => {
        client.end(false, {}, error => error === undefined ? resolve() : reject(error))
      })
    },
  }
}
