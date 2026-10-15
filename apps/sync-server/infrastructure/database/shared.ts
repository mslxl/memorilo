import type { SyncAccountState, SyncDeviceTodoToken, SyncLearningEntityRecord, SyncNoteSnapshotRecord, SyncObjectMetadata, SyncResetJob, VersionVector } from '@memorilo/sync'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mergeVersionVectors } from '@memorilo/sync'

export function payloadHash(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex')
}

// SQL text columns store the protobuf bytes losslessly; decoding belongs to
// this adapter so repository callers always exchange byte arrays.
export function storedSyncPayload(payload: Uint8Array): string {
  return Buffer.from(payload).toString('base64')
}

export function restoredSyncPayload(payload: string): Uint8Array {
  return new Uint8Array(Buffer.from(payload, 'base64'))
}

export function noteSnapshotRevision(snapshot: Pick<SyncNoteSnapshotRecord, 'snapshot'> | null): string | null {
  return snapshot === null ? null : createHash('sha256').update(snapshot.snapshot).digest('hex')
}

export function deviceTodoTokenFromRow<Row extends SyncDeviceTodoToken>(row: Row): SyncDeviceTodoToken {
  return { ...row, scopes: [...row.scopes] }
}

export function frontierFromRows(rows: readonly { readonly deviceId: string, readonly sequence: number }[]): VersionVector {
  const contiguous: Record<string, number> = {}
  for (const row of rows) {
    const expected = (contiguous[row.deviceId] ?? 0) + 1
    if (row.sequence === expected)
      contiguous[row.deviceId] = row.sequence
  }
  return mergeVersionVectors(contiguous)
}

export function accountStateFromRow(row: { accountId: string, enabledModes: readonly ('relay' | 'authoritative')[], generation: number, membershipEpoch: number, policyEpoch: number }): SyncAccountState {
  return {
    accountId: row.accountId,
    enabledModes: row.enabledModes,
    generation: row.generation,
    membershipEpoch: row.membershipEpoch,
    policyEpoch: row.policyEpoch,
  }
}

export function resetJobFromRow<Row extends SyncResetJob>(row: Row): SyncResetJob {
  return { ...row }
}

export function objectMetadataFromRow<Row extends SyncObjectMetadata>(row: Row): SyncObjectMetadata {
  return { ...row }
}

export function compareLearningEntityOrder(
  left: Pick<SyncLearningEntityRecord, 'createdAt' | 'sourceDeviceId' | 'sourceSequence' | 'mutationId'>,
  right: Pick<SyncLearningEntityRecord, 'createdAt' | 'sourceDeviceId' | 'sourceSequence' | 'mutationId'>,
): number {
  return left.createdAt - right.createdAt
    || left.sourceDeviceId.localeCompare(right.sourceDeviceId)
    || left.sourceSequence - right.sourceSequence
    || left.mutationId.localeCompare(right.mutationId)
}
