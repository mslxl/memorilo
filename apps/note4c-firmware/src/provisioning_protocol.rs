use std::collections::BTreeMap;

use prost::Message;
use serde::{Deserialize, Serialize};

use crate::persistence::{AlmanacConfig, SelectionPolicy, WeatherConfig};
use crate::todo_sync::TodoView;
use crate::todo_sync::{MAX_SNAPSHOT_BYTES, TodoSnapshot, validate_snapshot};
use crate::proto::memorilo::sync::v1::{TodoItem as ProtoTodoItem, TodoStatus as ProtoTodoStatus, TodoSyncRequest};

pub const PROTOCOL_VERSION: u16 = 1;
pub const CONFIG_SCHEMA_VERSION: u16 = 2;
pub const MAX_JSON_BYTES: usize = 64 * 1024;
pub const MAX_CHUNKS: usize = 256;
pub const MAX_CHUNK_PAYLOAD_BYTES: usize = 384;
pub const FRAME_HEADER_BYTES: usize = 18;
pub const MAX_GALLERY_JSON_BYTES: usize = 64 * 1024;

// Bumped to invalidate stale macOS GATT service caches after adding the continuation characteristic.
pub const SERVICE_UUID: &str = "7b7a1010-6c6f-4d65-8a8b-6d656d6f7269";
pub const DEVICE_INFO_UUID: &str = "7b7a1001-6c6f-4d65-8a8b-6d656d6f7269";
pub const PUBLIC_CONFIG_UUID: &str = "7b7a1002-6c6f-4d65-8a8b-6d656d6f7269";
pub const CONFIG_APPLY_UUID: &str = "7b7a1003-6c6f-4d65-8a8b-6d656d6f7269";
pub const STATUS_UUID: &str = "7b7a1004-6c6f-4d65-8a8b-6d656d6f7269";
pub const WIFI_SCAN_UUID: &str = "7b7a1006-6c6f-4d65-8a8b-6d656d6f7269";
pub const GALLERY_UUID: &str = "7b7a1007-6c6f-4d65-8a8b-6d656d6f7269";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoRequest {
    pub operation: String,
    pub protocol_version: u16,
    pub request_id: String,
    pub snapshot: TodoSnapshot,
}

pub fn parse_todo_request(bytes: &[u8]) -> Result<TodoRequest, ProtocolErrorCode> {
    if bytes.len() > MAX_JSON_BYTES || bytes.len() > MAX_SNAPSHOT_BYTES + 512 {
        return Err(ProtocolErrorCode::RequestTooLarge);
    }
    let request = TodoSyncRequest::decode(bytes).map_err(|_| ProtocolErrorCode::InvalidRequest)?;
    let Some(snapshot) = request.snapshot else {
        return Err(ProtocolErrorCode::InvalidRequest);
    };
    if request.operation != "todo.sync"
        || request.protocol_version != u32::from(PROTOCOL_VERSION)
        || request.request_id.is_empty()
        || request.request_id.len() > 64
        || !request.request_id.is_ascii()
        || snapshot.time_zone_offset_minutes.is_some_and(|offset| !(-840..=840).contains(&offset))
    {
        return Err(ProtocolErrorCode::InvalidRequest);
    }
    let items = snapshot.items.into_iter().map(todo_item_from_proto).collect::<Result<Vec<_>, _>>()?;
    let snapshot = TodoSnapshot {
        generated_at: snapshot.generated_at,
        time_zone_offset_minutes: snapshot.time_zone_offset_minutes.map(|offset| offset as i16),
        items,
        revision: snapshot.revision,
    };
    if validate_snapshot(&snapshot).is_err() {
        return Err(ProtocolErrorCode::InvalidRequest);
    }
    Ok(TodoRequest { operation: request.operation, protocol_version: PROTOCOL_VERSION, request_id: request.request_id, snapshot })
}

fn todo_item_from_proto(item: ProtoTodoItem) -> Result<crate::todo_sync::TodoSnapshotItem, ProtocolErrorCode> {
    let status = match ProtoTodoStatus::try_from(item.status).map_err(|_| ProtocolErrorCode::InvalidRequest)? {
        ProtoTodoStatus::Todo => crate::todo_sync::SnapshotStatus::Todo,
        ProtoTodoStatus::InProgress => crate::todo_sync::SnapshotStatus::InProgress,
        ProtoTodoStatus::Done => crate::todo_sync::SnapshotStatus::Done,
        ProtoTodoStatus::Unspecified => return Err(ProtocolErrorCode::InvalidRequest),
    };
    Ok(crate::todo_sync::TodoSnapshotItem {
        all_day: item.all_day,
        due_date: item.due_date,
        due_time: item.due_time,
        id: item.id,
        note_title: item.note_title,
        parent_id: item.parent_id,
        revision: item.revision,
        status,
        text: item.text,
        topic_title: item.topic_title,
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiScanRequest {
    pub protocol_version: u16,
    pub request_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiNetwork {
    pub ssid: String,
    pub rssi: i16,
    pub security: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiScanResponse {
    pub protocol_version: u16,
    pub request_id: String,
    pub networks: Vec<WifiNetwork>,
}

/// Gallery operations use the same JSON envelope over BLE and USB serial.
/// `bytesBase64` keeps binary frame data safe for line-delimited serial links;
/// BLE transports may carry the same payload in framed chunks.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryRequest {
    pub operation: String,
    pub protocol_version: u16,
    pub request_id: String,
    pub name: Option<String>,
    pub created_at_unix_seconds: Option<u64>,
    pub bytes_base64: Option<String>,
    pub id: Option<u64>,
    pub order: Option<Vec<u64>>,
    pub interval_seconds: Option<Option<u32>>,
}

pub fn parse_gallery_request(json: &[u8]) -> Result<GalleryRequest, ProtocolErrorCode> {
    if json.len() > MAX_GALLERY_JSON_BYTES {
        return Err(ProtocolErrorCode::RequestTooLarge);
    }
    let request: GalleryRequest =
        serde_json::from_slice(json).map_err(|_| ProtocolErrorCode::InvalidRequest)?;
    if request.protocol_version != PROTOCOL_VERSION
        || !request.operation.starts_with("gallery.")
        || request.request_id.is_empty()
        || request.request_id.len() > 64
        || !request.request_id.is_ascii()
    {
        return Err(ProtocolErrorCode::InvalidRequest);
    }
    match request.operation.as_str() {
        "gallery.list" | "gallery.refresh" | "gallery.nextPage" | "gallery.sleep" => {}
        "gallery.upload" => {
            let valid = request
                .name
                .as_ref()
                .is_some_and(|value| !value.is_empty() && value.len() <= 64)
                && request.created_at_unix_seconds.is_some()
                && request
                    .bytes_base64
                    .as_ref()
                    .is_some_and(|value| value.len() <= 100_000);
            if !valid {
                return Err(ProtocolErrorCode::InvalidRequest);
            }
        }
        "gallery.delete" => {
            if request.id.is_none() {
                return Err(ProtocolErrorCode::InvalidRequest);
            }
        }
        "gallery.reorder" => {
            if request.order.as_ref().is_none_or(|order| order.len() > 100) {
                return Err(ProtocolErrorCode::InvalidRequest);
            }
        }
        "gallery.slideshow" => {}
        _ => return Err(ProtocolErrorCode::InvalidRequest),
    }
    Ok(request)
}

pub fn parse_wifi_scan_request(json: &[u8]) -> Result<WifiScanRequest, ProtocolErrorCode> {
    if json.len() > MAX_JSON_BYTES {
        return Err(ProtocolErrorCode::RequestTooLarge);
    }
    let request: WifiScanRequest =
        serde_json::from_slice(json).map_err(|_| ProtocolErrorCode::InvalidRequest)?;
    if request.protocol_version != PROTOCOL_VERSION {
        return Err(ProtocolErrorCode::UnsupportedProtocol);
    }
    if request.request_id.is_empty()
        || request.request_id.len() > 64
        || !request.request_id.is_ascii()
    {
        return Err(ProtocolErrorCode::InvalidRequest);
    }
    Ok(request)
}

const FRAME_MAGIC: [u8; 2] = *b"MP";
const FRAME_VERSION: u8 = 1;
const FLAG_START: u8 = 1;
const FLAG_END: u8 = 2;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfoEnvelope {
    pub protocol_version: u16,
    pub config_schema_version: u16,
    pub firmware_version: String,
    pub device_id: String,
    pub config_revision: u64,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfigEnvelope {
    pub protocol_version: u16,
    pub config_schema_version: u16,
    pub revision: u64,
    pub device_name: String,
    pub wifi_ssid: Option<String>,
    pub wifi_password_is_set: bool,
    pub local_management_token_is_set: bool,
    pub timezone: String,
    pub idle_sleep_seconds: u32,
    pub selection_policy: SelectionPolicy,
    pub weather: WeatherConfig,
    pub almanac: AlmanacConfig,
    pub todo_sync_enabled: bool,
    pub todo_sync_url: String,
    pub todo_sync_token_is_set: bool,
    pub todo_sync_poll_interval_seconds: u32,
    pub todo_sync_view: TodoView,
    pub todo_sync_mqtt_broker_url: Option<String>,
    pub todo_sync_mqtt_topic: Option<String>,
    pub todo_sync_mqtt_username: Option<String>,
    pub todo_sync_mqtt_password_is_set: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiPatch {
    pub ssid: Option<String>,
    pub password: Option<String>,
    #[serde(default)]
    pub clear_password: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalManagementPatch {
    pub token: Option<String>,
    #[serde(default)]
    pub clear_token: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSyncPatch {
    pub enabled: Option<bool>,
    pub https_base_url: Option<String>,
    pub device_token: Option<String>,
    #[serde(default)]
    pub clear_device_token: bool,
    pub poll_interval_seconds: Option<u32>,
    pub view: Option<TodoView>,
    pub mqtt_broker_url: Option<String>,
    pub mqtt_topic: Option<String>,
    pub mqtt_username: Option<String>,
    pub mqtt_password: Option<String>,
    #[serde(default)]
    pub clear_mqtt_password: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfigPatch {
    pub device_name: Option<String>,
    pub wifi: Option<WifiPatch>,
    pub local_management: Option<LocalManagementPatch>,
    pub timezone: Option<String>,
    pub idle_sleep_seconds: Option<u32>,
    pub selection_policy: Option<SelectionPolicy>,
    pub weather: Option<WeatherConfig>,
    pub almanac: Option<AlmanacConfig>,
    pub todo_sync: Option<TodoSyncPatch>,
    #[serde(flatten)]
    pub optional_extensions: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyConfigEnvelope {
    pub protocol_version: u16,
    pub request_id: String,
    pub base_revision: u64,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    pub config: DeviceConfigPatch,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApplyStatus {
    Accepted,
    Rejected,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProtocolErrorCode {
    AuthenticationRequired,
    ConfigurationModeRequired,
    UnsupportedProtocol,
    UnsupportedCapability,
    InvalidRequest,
    StaleRevision,
    ChecksumMismatch,
    RequestTooLarge,
    Timeout,
    AssetNotFound,
    CapacityExceeded,
    InvalidAssetLength,
    InvalidAssetName,
    InvalidOrder,
    InvalidSlideshowInterval,
    StorageFailure,
}

impl ProtocolErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AuthenticationRequired => "authentication-required",
            Self::ConfigurationModeRequired => "configuration-mode-required",
            Self::UnsupportedProtocol => "unsupported-protocol",
            Self::UnsupportedCapability => "unsupported-capability",
            Self::InvalidRequest => "invalid-request",
            Self::StaleRevision => "stale-revision",
            Self::ChecksumMismatch => "checksum-mismatch",
            Self::RequestTooLarge => "request-too-large",
            Self::Timeout => "timeout",
            Self::AssetNotFound => "asset-not-found",
            Self::CapacityExceeded => "capacity-exceeded",
            Self::InvalidAssetLength => "invalid-asset-length",
            Self::InvalidAssetName => "invalid-asset-name",
            Self::InvalidOrder => "invalid-order",
            Self::InvalidSlideshowInterval => "invalid-slideshow-interval",
            Self::StorageFailure => "storage-failure",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyStatusEnvelope {
    pub protocol_version: u16,
    pub request_id: String,
    pub status: ApplyStatus,
    pub revision: u64,
    pub error: Option<ProtocolErrorCode>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChunkFrame {
    pub request_token: u32,
    pub index: u16,
    pub count: u16,
    pub checksum: u32,
    pub payload: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FrameError {
    InvalidHeader,
    UnsupportedVersion,
    InvalidBounds,
    InconsistentRequest,
    DuplicateChunk,
    MissingChunk,
    ChecksumMismatch,
    RequestTooLarge,
}

pub fn parse_apply_request(json: &[u8]) -> Result<ApplyConfigEnvelope, ProtocolErrorCode> {
    if json.len() > MAX_JSON_BYTES {
        return Err(ProtocolErrorCode::RequestTooLarge);
    }
    let request: ApplyConfigEnvelope =
        serde_json::from_slice(json).map_err(|_| ProtocolErrorCode::InvalidRequest)?;
    if request.protocol_version != PROTOCOL_VERSION {
        return Err(ProtocolErrorCode::UnsupportedProtocol);
    }
    if request.request_id.is_empty()
        || request.request_id.len() > 64
        || !request.request_id.is_ascii()
    {
        return Err(ProtocolErrorCode::InvalidRequest);
    }
    if request
        .required_capabilities
        .iter()
        .any(|capability| capability != "config-v1")
    {
        return Err(ProtocolErrorCode::UnsupportedCapability);
    }
    Ok(request)
}

pub fn validate_base_revision(
    request: &ApplyConfigEnvelope,
    current_revision: u64,
) -> Result<(), ProtocolErrorCode> {
    if request.base_revision != current_revision {
        return Err(ProtocolErrorCode::StaleRevision);
    }
    Ok(())
}

pub fn encode_frames(
    request_token: u32,
    json: &[u8],
    maximum_payload: usize,
) -> Result<Vec<Vec<u8>>, FrameError> {
    if json.len() > MAX_JSON_BYTES {
        return Err(FrameError::RequestTooLarge);
    }
    if maximum_payload == 0 || maximum_payload > MAX_CHUNK_PAYLOAD_BYTES {
        return Err(FrameError::InvalidBounds);
    }
    let count = json.len().div_ceil(maximum_payload).max(1);
    if count > MAX_CHUNKS || count > usize::from(u16::MAX) {
        return Err(FrameError::InvalidBounds);
    }
    let checksum = crc32(json);
    Ok((0..count)
        .map(|index| {
            let start = index * maximum_payload;
            let end = (start + maximum_payload).min(json.len());
            let payload = &json[start..end];
            let mut flags = 0;
            if index == 0 {
                flags |= FLAG_START;
            }
            if index + 1 == count {
                flags |= FLAG_END;
            }
            let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + payload.len());
            frame.extend_from_slice(&FRAME_MAGIC);
            frame.push(FRAME_VERSION);
            frame.push(flags);
            frame.extend_from_slice(&request_token.to_le_bytes());
            frame.extend_from_slice(&(index as u16).to_le_bytes());
            frame.extend_from_slice(&(count as u16).to_le_bytes());
            frame.extend_from_slice(&(payload.len() as u16).to_le_bytes());
            frame.extend_from_slice(&checksum.to_le_bytes());
            frame.extend_from_slice(payload);
            frame
        })
        .collect())
}

pub fn decode_frame(bytes: &[u8]) -> Result<ChunkFrame, FrameError> {
    if bytes.len() < FRAME_HEADER_BYTES || bytes[..2] != FRAME_MAGIC {
        return Err(FrameError::InvalidHeader);
    }
    if bytes[2] != FRAME_VERSION {
        return Err(FrameError::UnsupportedVersion);
    }
    let index = u16::from_le_bytes([bytes[8], bytes[9]]);
    let count = u16::from_le_bytes([bytes[10], bytes[11]]);
    let payload_length = usize::from(u16::from_le_bytes([bytes[12], bytes[13]]));
    if count == 0
        || usize::from(count) > MAX_CHUNKS
        || index >= count
        || payload_length > MAX_CHUNK_PAYLOAD_BYTES
        || bytes.len() != FRAME_HEADER_BYTES + payload_length
    {
        return Err(FrameError::InvalidBounds);
    }
    let flags = bytes[3];
    if (index == 0) != (flags & FLAG_START != 0) || (index + 1 == count) != (flags & FLAG_END != 0)
    {
        return Err(FrameError::InvalidHeader);
    }
    Ok(ChunkFrame {
        request_token: u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
        index,
        count,
        checksum: u32::from_le_bytes(bytes[14..18].try_into().unwrap()),
        payload: bytes[FRAME_HEADER_BYTES..].to_vec(),
    })
}

pub fn reassemble_frames(frames: &[ChunkFrame]) -> Result<Vec<u8>, FrameError> {
    let Some(first) = frames.first() else {
        return Err(FrameError::MissingChunk);
    };
    if frames.len() != usize::from(first.count) {
        return Err(FrameError::MissingChunk);
    }
    let mut ordered = vec![None; usize::from(first.count)];
    for frame in frames {
        if frame.request_token != first.request_token
            || frame.count != first.count
            || frame.checksum != first.checksum
        {
            return Err(FrameError::InconsistentRequest);
        }
        let slot = &mut ordered[usize::from(frame.index)];
        if slot.replace(frame.payload.as_slice()).is_some() {
            return Err(FrameError::DuplicateChunk);
        }
    }
    let mut json = Vec::new();
    for payload in ordered {
        let Some(payload) = payload else {
            return Err(FrameError::MissingChunk);
        };
        json.extend_from_slice(payload);
        if json.len() > MAX_JSON_BYTES {
            return Err(FrameError::RequestTooLarge);
        }
    }
    if crc32(&json) != first.checksum {
        return Err(FrameError::ChecksumMismatch);
    }
    Ok(json)
}

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0_u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SharedVector {
        request_token: u32,
        chunk_payload_bytes: usize,
        json_utf8: String,
        expected_crc32: u32,
        expected_frames_hex: Vec<String>,
    }

    fn from_hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }

    #[test]
    fn shared_typescript_and_rust_vector_is_stable() {
        let vector: SharedVector = serde_json::from_str(include_str!(
            "../../../packages/device-provisioning/test-vectors/provisioning-v1.json"
        ))
        .unwrap();
        let json = vector.json_utf8.as_bytes();
        assert_eq!(crc32(json), vector.expected_crc32);
        let encoded =
            encode_frames(vector.request_token, json, vector.chunk_payload_bytes).unwrap();
        let expected: Vec<Vec<u8>> = vector
            .expected_frames_hex
            .iter()
            .map(|frame| from_hex(frame))
            .collect();
        assert_eq!(encoded, expected);
        let decoded: Vec<_> = expected
            .iter()
            .map(|frame| decode_frame(frame).unwrap())
            .collect();
        assert_eq!(reassemble_frames(&decoded).unwrap(), json);
        assert!(parse_apply_request(json).is_ok());
    }

    #[test]
    fn forward_compatible_optional_fields_and_required_capabilities_are_distinct() {
        let json = br#"{"protocolVersion":1,"requestId":"req-1","baseRevision":0,"requiredCapabilities":["config-v1"],"config":{"futureOptional":{"enabled":true}}}"#;
        let request = parse_apply_request(json).unwrap();
        assert!(
            request
                .config
                .optional_extensions
                .contains_key("futureOptional")
        );

        let unsupported = br#"{"protocolVersion":1,"requestId":"req-2","baseRevision":0,"requiredCapabilities":["future-required"],"config":{}}"#;
        assert_eq!(
            parse_apply_request(unsupported),
            Err(ProtocolErrorCode::UnsupportedCapability)
        );
    }

    #[test]
    fn todo_sync_accepts_a_wall_clock_offset_and_rejects_impossible_offsets() {
        let valid = TodoSyncRequest {
            operation: "todo.sync".into(), protocol_version: 1, request_id: "todo-time".into(),
            snapshot: Some(crate::proto::memorilo::sync::v1::TodoSnapshot { generated_at: "2026-09-30T00:00:00.000Z".into(), time_zone_offset_minutes: Some(480), items: vec![], revision: "empty".into() }),
        }.encode_to_vec();
        assert_eq!(parse_todo_request(&valid).unwrap().snapshot.time_zone_offset_minutes, Some(480));
        let invalid = TodoSyncRequest {
            operation: "todo.sync".into(), protocol_version: 1, request_id: "todo-time".into(),
            snapshot: Some(crate::proto::memorilo::sync::v1::TodoSnapshot { generated_at: "2026-09-30T00:00:00.000Z".into(), time_zone_offset_minutes: Some(1000), items: vec![], revision: "empty".into() }),
        }.encode_to_vec();
        assert_eq!(parse_todo_request(&invalid), Err(ProtocolErrorCode::InvalidRequest));
    }

    #[test]
    fn todo_sync_rejects_unspecified_item_status() {
        let invalid = TodoSyncRequest {
            operation: "todo.sync".into(), protocol_version: 1, request_id: "todo-status".into(),
            snapshot: Some(crate::proto::memorilo::sync::v1::TodoSnapshot {
                generated_at: "2026-09-30T00:00:00.000Z".into(), time_zone_offset_minutes: None,
                items: vec![ProtoTodoItem {
                    all_day: true, due_date: None, due_time: None, id: "item-1".into(),
                    note_title: "Note".into(), parent_id: None, revision: "item-r1".into(),
                    status: 0, text: "Task".into(), topic_title: "Topic".into(),
                }], revision: "snapshot-r1".into(),
            }),
        }.encode_to_vec();
        assert_eq!(parse_todo_request(&invalid), Err(ProtocolErrorCode::InvalidRequest));
    }

    #[test]
    fn framing_rejects_corruption_and_inconsistent_requests() {
        let json = br#"{"protocolVersion":1}"#;
        let mut frames: Vec<_> = encode_frames(7, json, 10)
            .unwrap()
            .iter()
            .map(|frame| decode_frame(frame).unwrap())
            .collect();
        frames[0].payload[0] ^= 1;
        assert_eq!(
            reassemble_frames(&frames),
            Err(FrameError::ChecksumMismatch)
        );
    }

    #[test]
    fn unsupported_protocol_and_stale_revision_are_rejected() {
        let unsupported = br#"{"protocolVersion":2,"requestId":"req-version","baseRevision":4,"requiredCapabilities":["config-v1"],"config":{}}"#;
        assert_eq!(
            parse_apply_request(unsupported),
            Err(ProtocolErrorCode::UnsupportedProtocol)
        );

        let current = br#"{"protocolVersion":1,"requestId":"req-revision","baseRevision":4,"requiredCapabilities":["config-v1"],"config":{}}"#;
        let request = parse_apply_request(current).unwrap();
        assert_eq!(
            validate_base_revision(&request, 5),
            Err(ProtocolErrorCode::StaleRevision)
        );
        assert_eq!(validate_base_revision(&request, 4), Ok(()));
    }

    #[test]
    fn public_configuration_serialization_never_contains_a_password() {
        let public = PublicConfigEnvelope {
            protocol_version: PROTOCOL_VERSION,
            config_schema_version: CONFIG_SCHEMA_VERSION,
            revision: 3,
            device_name: "Desk".into(),
            wifi_ssid: Some("Office".into()),
            wifi_password_is_set: true,
            local_management_token_is_set: true,
            timezone: "Asia/Shanghai".into(),
            idle_sleep_seconds: 600,
            selection_policy: SelectionPolicy::Remember,
            weather: WeatherConfig::default(),
            almanac: AlmanacConfig::default(),
            todo_sync_enabled: false,
            todo_sync_url: String::new(),
            todo_sync_token_is_set: false,
            todo_sync_poll_interval_seconds: 900,
            todo_sync_view: TodoView::Today,
            todo_sync_mqtt_broker_url: None,
            todo_sync_mqtt_topic: None,
            todo_sync_mqtt_username: None,
            todo_sync_mqtt_password_is_set: false,
        };
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("password"));
        assert!(!json.contains("0123456789abcdef0123456789abcdef"));
        assert!(json.contains("wifiPasswordIsSet"));
        assert!(json.contains("localManagementTokenIsSet"));
    }
}
