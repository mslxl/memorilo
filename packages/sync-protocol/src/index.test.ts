import { readFile } from 'node:fs/promises'
import protobuf from 'protobufjs'
import { expect, it } from 'vitest'
import { memoriloProtoRoot } from './index'

it('embeds the same schema that generates the Rust messages', async () => {
  const canonical = await readFile(new URL('../proto/memorilo.proto', import.meta.url), 'utf8')
  expect(memoriloProtoRoot.toJSON()).toEqual(protobuf.parse(canonical).root.toJSON())
})
