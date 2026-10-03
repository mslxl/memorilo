import protobuf from 'protobufjs'

// The schema is embedded so Electron, Node, Vitest, and the renderer-side
// provisioning code do not depend on a filesystem-relative .proto path.
export const memoriloProtoSource = String.raw`syntax = "proto3";
package memorilo.sync.v1;
message VersionVectorEntry { string device_id = 1; uint64 sequence = 2; }
message VersionVector { repeated VersionVectorEntry entries = 1; }
enum PeerRole { PEER_ROLE_UNSPECIFIED = 0; PEER_ROLE_DEVICE = 1; PEER_ROLE_SERVER = 2; }
enum SyncMode { SYNC_MODE_UNSPECIFIED = 0; SYNC_MODE_DIRECT = 1; SYNC_MODE_RELAY = 2; SYNC_MODE_AUTHORITATIVE = 3; }
enum Namespace { NAMESPACE_UNSPECIFIED = 0; NAMESPACE_NOTES = 1; NAMESPACE_LEARNING = 2; NAMESPACE_ASSETS = 3; }
message Frontiers { VersionVector notes = 1; VersionVector learning = 2; VersionVector assets = 3; }
message Hello { string protocol = 1; PeerRole role = 2; string device_id = 3; string device_name = 4; repeated Namespace namespaces = 5; repeated SyncMode modes = 6; uint64 generation = 7; uint64 membership_epoch = 8; uint64 policy_epoch = 9; string nonce = 10; uint64 issued_at = 11; Frontiers frontiers = 12; string pairing_id = 13; string shared_secret = 14; optional string credential = 15; string signature = 16; }
message NoteUpdate { string note_id = 1; bytes loro_update = 2; }
enum LearningEntityKind { LEARNING_ENTITY_KIND_UNSPECIFIED = 0; LEARNING_ENTITY_KIND_ASSIGNMENT = 1; LEARNING_ENTITY_KIND_CARD = 2; LEARNING_ENTITY_KIND_OPTIMIZER = 3; LEARNING_ENTITY_KIND_REVIEW_EVENT = 4; LEARNING_ENTITY_KIND_TOMBSTONE = 5; }
enum MutationOperation { MUTATION_OPERATION_UNSPECIFIED = 0; MUTATION_OPERATION_UPSERT = 1; MUTATION_OPERATION_DELETE = 2; }
message LearningState { double difficulty = 1; int64 due_at = 2; int64 lapses = 3; optional int64 last_review_at = 4; int64 learning_steps = 5; string optimizer_revision_id = 6; string phase = 7; int64 reps = 8; int64 scheduled_days = 9; double stability = 10; string state_hash = 11; optional string winning_event_id = 12; }
message OptimizerConfiguration { double desired_retention = 1; bool enable_fuzz = 2; repeated double fsrs_parameters = 3; repeated string learning_steps = 4; int64 maximum_interval_days = 5; repeated string relearning_steps = 6; }
message AssignmentMutation { string note_id = 1; string optimizer_id = 2; }
message CardMutation { bool active = 1; string card_id = 2; string direction = 3; repeated string item_block_ids = 4; string kind = 5; string note_id = 6; string source_block_id = 7; int64 source_order = 8; int64 topic_order = 9; string topic_id = 10; }
message OptimizerMutation { OptimizerConfiguration configuration = 1; string id = 2; string name = 3; string revision_id = 4; string status = 5; }
message ReviewEventMutation { optional string base_event_id = 1; string card_id = 2; string event_id = 3; string kind = 4; string note_id = 5; string queue_kind = 6; optional string rating = 7; optional int64 reviewed_at = 8; optional int64 reset_at = 9; optional int64 undone_at = 10; LearningState result_state = 11; string target_id = 12; optional string undoes_event_id = 13; }
message TombstoneMutation { int64 generation = 1; string scope_id = 2; string scope_kind = 3; string tombstone_id = 4; }
message LearningMutation { int64 created_at = 1; string entity_id = 2; LearningEntityKind entity_kind = 3; string mutation_id = 4; MutationOperation operation = 5; oneof payload { AssignmentMutation assignment = 10; CardMutation card = 11; OptimizerMutation optimizer = 12; ReviewEventMutation review_event = 13; TombstoneMutation tombstone = 14; } }
message SyncChange { string id = 1; string device_id = 2; uint64 sequence = 3; oneof payload { NoteUpdate note_update = 4; LearningMutation learning_mutation = 5; } }
message Changes { Namespace namespace = 1; string device_name = 2; uint64 membership_epoch = 3; VersionVector frontier = 4; repeated SyncChange changes = 5; }
message Ack { Namespace namespace = 1; uint64 membership_epoch = 2; VersionVector frontier = 3; repeated string accepted_change_ids = 4; }
message AssetManifest { string id = 1; string device_id = 2; uint64 sequence = 3; string file_name = 4; string original_file_name = 5; string operation = 6; optional bytes content_hash = 7; optional uint64 content_length = 8; optional string content_type = 9; uint64 created_at = 10; }
message AssetManifests { string device_name = 1; uint64 membership_epoch = 2; VersionVector frontier = 3; repeated AssetManifest manifests = 4; }
message AssetAck { uint64 membership_epoch = 1; VersionVector frontier = 2; repeated string accepted_manifest_ids = 3; }
message SyncError { string code = 1; string action = 2; bool retryable = 3; }
message SyncFrame { oneof body { Hello hello = 1; Changes changes = 2; Ack ack = 3; AssetManifests asset_manifests = 4; AssetAck asset_ack = 5; SyncError error = 6; } }
message PairingProbe { string request_id = 1; }
message PairingAvailable { string request_id = 1; string device_id = 2; string device_name = 3; string peer_id = 4; uint64 expires_at = 5; }
message PairingRequest { string request_id = 1; string device_id = 2; string device_name = 3; string peer_id = 4; string signing_public_key = 5; string signature = 6; uint64 created_at = 7; }
message PairingApproval { string request_id = 1; string pairing_id = 2; string device_id = 3; string device_name = 4; string peer_id = 5; string shared_secret = 6; string signing_public_key = 7; string signature = 8; string emoji = 9; uint64 membership_epoch = 10; }
message PairingConfirmation { string request_id = 1; string pairing_id = 2; string emoji = 3; string signature = 4; }
message PairingRejected { string request_id = 1; string reason = 2; }
message PairingFrame { oneof body { PairingProbe probe = 1; PairingAvailable available = 2; PairingRequest request = 3; PairingApproval approval = 4; PairingConfirmation confirmation = 5; PairingRejected rejected = 6; } }
message PairingInvitationCode { uint32 version = 1; string pairing_id = 2; string device_id = 3; string device_name = 4; string peer_id = 5; PeerRole role = 6; string shared_secret = 7; string signing_public_key = 8; string signature = 9; uint64 membership_epoch = 10; uint64 created_at = 11; uint64 expires_at = 12; }
message PairingResponseCode { uint32 version = 1; string pairing_id = 2; string device_id = 3; string device_name = 4; string peer_id = 5; PeerRole role = 6; string shared_secret = 7; string signing_public_key = 8; string signature = 9; uint64 membership_epoch = 10; }
message PairingCode { oneof payload { PairingInvitationCode invitation = 1; PairingResponseCode response = 2; } }
message ObjectPutRequest { string type = 1; string protocol = 2; string device_id = 3; uint64 generation = 4; uint64 membership_epoch = 5; uint64 policy_epoch = 6; string pairing_id = 7; string shared_secret = 8; optional string credential = 9; string nonce = 10; uint64 issued_at = 11; AssetManifest manifest = 12; string signature = 13; }
message ObjectResponse { string type = 1; optional string code = 2; }
message ObjectFrame { oneof body { ObjectPutRequest put = 1; ObjectResponse response = 2; } }
enum TodoStatus { TODO_STATUS_UNSPECIFIED = 0; TODO_STATUS_TODO = 1; TODO_STATUS_IN_PROGRESS = 2; TODO_STATUS_DONE = 3; }
message TodoItem { bool all_day = 1; optional string due_date = 2; optional string due_time = 3; string id = 4; string note_title = 5; optional string parent_id = 6; string revision = 7; TodoStatus status = 8; string text = 9; string topic_title = 10; }
message TodoSnapshot { string generated_at = 1; optional int32 time_zone_offset_minutes = 2; repeated TodoItem items = 3; string revision = 4; }
message TodoSyncRequest { string operation = 1; uint32 protocol_version = 2; string request_id = 3; TodoSnapshot snapshot = 4; }
message TodoSyncResponse { string operation = 1; string request_id = 2; string status = 3; optional string error = 4; }
message TodoRefreshHint { string generated_at = 1; string revision = 2; string view = 3; }
message SyncJournalChange { string id = 1; string device_id = 2; uint64 sequence = 3; oneof payload { NoteUpdate note_update = 4; LearningMutation learning_mutation = 5; } }
message SyncJournal { uint32 version = 1; optional string device_id = 2; uint64 next_sequence = 3; repeated SyncJournalChange changes = 4; VersionVector received_version_vector = 5; repeated VersionVectorEntry pending_received_sequences = 6; }`

export const memoriloProtoRoot = protobuf.parse(memoriloProtoSource).root

export function memoriloProtoType(name: string): protobuf.Type {
  const type = memoriloProtoRoot.lookupType(`memorilo.sync.v1.${name}`)
  if (!(type instanceof protobuf.Type))
    throw new Error(`Memorilo protobuf type is not a message: ${name}`)
  return type
}

export function encodeMemoriloProto(name: string, value: unknown): Uint8Array {
  return memoriloProtoType(name).encode(memoriloProtoType(name).create(value as Record<string, unknown>)).finish()
}

export function decodeMemoriloProto(name: string, bytes: Uint8Array): Record<string, unknown> {
  const decoded = memoriloProtoType(name).toObject(memoriloProtoType(name).decode(bytes), {
    longs: Number,
    enums: Number,
    bytes: Uint8Array,
    defaults: false,
    oneofs: true,
  }) as Record<string, unknown>
  // protobufjs exposes synthetic oneof markers for proto3 optional fields
  // (for example `_contentHash`). They are decoder metadata, not schema
  // fields, so remove them before values cross the protocol boundary.
  const stripSyntheticMarkers = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value.map(stripSyntheticMarkers)
    if (value instanceof Uint8Array)
      return value
    if (typeof value !== 'object' || value === null)
      return value
    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(record)) {
      if (key.startsWith('_'))
        continue
      result[key] = stripSyntheticMarkers(child)
    }
    return result
  }
  return stripSyntheticMarkers(decoded) as Record<string, unknown>
}
