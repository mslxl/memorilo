import type { SyncChange } from './model'

export interface LocalSyncChangeInput {
  readonly id: string
  readonly kind: SyncChange['kind']
  readonly payload: Uint8Array
}
