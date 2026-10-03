//! Read-only TODO snapshot admission shared by LAN pushes and server pulls.
//!
//! Transport code only hands this module bounded bytes. This module owns the
//! semantic contract, validation, source/revision ordering, and model mapping.

use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use prost::Message;

use crate::model::{Status, TodoId, TodoItem, TodoModel};

pub const MAX_SNAPSHOT_BYTES: usize = 32 * 1024;
pub const MAX_ITEMS: usize = 64;
pub const MAX_ID_CHARS: usize = 256;
pub const MAX_TEXT_CHARS: usize = 160;
pub const MAX_METADATA_CHARS: usize = 64;
pub const MIN_POLL_INTERVAL: Duration = Duration::from_secs(60);
pub const MAX_POLL_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TodoView {
    Today,
    All,
}

impl Default for TodoView {
    fn default() -> Self {
        Self::Today
    }
}

#[derive(Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSyncConfig {
    pub enabled: bool,
    pub https_base_url: String,
    device_token: Option<TodoSyncToken>,
    pub poll_interval_seconds: u32,
    pub view: TodoView,
    pub mqtt_broker_url: Option<String>,
    pub mqtt_topic: Option<String>,
    pub mqtt_username: Option<String>,
    mqtt_password: Option<TodoSyncToken>,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
struct TodoSyncToken(String);

impl fmt::Debug for TodoSyncToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<redacted>")
    }
}

impl fmt::Debug for TodoSyncConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TodoSyncConfig")
            .field("enabled", &self.enabled)
            .field("https_base_url", &self.https_base_url)
            .field(
                "device_token",
                &self.device_token.as_ref().map(|_| "<redacted>"),
            )
            .field("poll_interval_seconds", &self.poll_interval_seconds)
            .field("view", &self.view)
            .field("mqtt_broker_url", &self.mqtt_broker_url)
            .field("mqtt_topic", &self.mqtt_topic)
            .field("mqtt_username", &self.mqtt_username)
            .field(
                "mqtt_password",
                &self.mqtt_password.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

impl TodoSyncConfig {
    pub fn has_device_token(&self) -> bool {
        self.device_token.is_some()
    }

    pub(crate) fn device_token(&self) -> Option<&str> {
        self.device_token.as_ref().map(|token| token.0.as_str())
    }

    pub fn set_device_token(&mut self, token: String) {
        self.device_token = Some(TodoSyncToken(token));
    }

    pub fn clear_device_token(&mut self) {
        self.device_token = None;
    }

    pub(crate) fn mqtt_password(&self) -> Option<&str> {
        self.mqtt_password.as_ref().map(|token| token.0.as_str())
    }

    pub fn set_mqtt_password(&mut self, password: String) {
        self.mqtt_password = Some(TodoSyncToken(password));
    }

    pub fn clear_mqtt_password(&mut self) {
        self.mqtt_password = None;
    }

    pub fn has_mqtt_password(&self) -> bool {
        self.mqtt_password.is_some()
    }

    pub fn has_https_source(&self) -> bool {
        !self.https_base_url.is_empty() && self.has_device_token()
    }

    /// HTTPS polling (including MQTT-triggered HTTPS) and local management
    /// pushes are alternative sources. Keeping LAN/BLE/Serial disabled while
    /// HTTPS is configured prevents two differently projected snapshots from
    /// replacing one another on the device.
    pub fn allows_snapshot_source(&self, source: SnapshotSource) -> bool {
        !matches!(source, SnapshotSource::ClientLanPush)
            || !(self.enabled && self.has_https_source())
    }

    pub fn normalized_default() -> Self {
        Self {
            poll_interval_seconds: 15 * 60,
            ..Self::default()
        }
    }

    pub fn validate(&self) -> Result<(), TodoSyncConfigError> {
        if self.https_base_url.len() > 256
            || (!self.https_base_url.is_empty() && !(self.https_base_url.starts_with("https://")))
        {
            return Err(TodoSyncConfigError::InvalidHttpsUrl);
        }
        if let Some(token) = self.device_token() {
            if token.is_empty() || token.len() > 256 || !token.is_ascii() {
                return Err(TodoSyncConfigError::InvalidToken);
            }
        }
        let interval = Duration::from_secs(u64::from(self.poll_interval_seconds));
        if self.enabled && !(MIN_POLL_INTERVAL..=MAX_POLL_INTERVAL).contains(&interval) {
            return Err(TodoSyncConfigError::InvalidPollInterval);
        }
        if self
            .mqtt_broker_url
            .as_ref()
            .is_some_and(|url| url.len() > 256 || !url.starts_with("mqtts://"))
            || self
                .mqtt_topic
                .as_ref()
                .is_some_and(|topic| topic.is_empty() || topic.len() > 256 || !topic.is_ascii())
        {
            return Err(TodoSyncConfigError::InvalidMqttSettings);
        }
        if self.mqtt_broker_url.is_some() != self.mqtt_topic.is_some() {
            return Err(TodoSyncConfigError::InvalidMqttSettings);
        }
        if self.mqtt_username.as_ref().is_some_and(|username| {
            username.is_empty() || username.len() > 128 || !username.is_ascii()
        }) || self.mqtt_password().is_some_and(|password| {
            password.is_empty() || password.len() > 256 || !password.is_ascii()
        }) {
            return Err(TodoSyncConfigError::InvalidMqttSettings);
        }
        if self.mqtt_username.is_some() != self.mqtt_password.is_some() {
            return Err(TodoSyncConfigError::InvalidMqttSettings);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TodoSyncConfigError {
    InvalidHttpsUrl,
    InvalidToken,
    InvalidPollInterval,
    InvalidMqttSettings,
}

impl fmt::Display for TodoSyncConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for TodoSyncConfigError {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSnapshot {
    pub generated_at: String,
    #[serde(default)]
    pub time_zone_offset_minutes: Option<i16>,
    pub items: Vec<TodoSnapshotItem>,
    pub revision: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSnapshotItem {
    pub all_day: bool,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub id: String,
    pub note_title: String,
    pub parent_id: Option<String>,
    pub revision: String,
    pub status: SnapshotStatus,
    pub text: String,
    pub topic_title: String,
}

pub fn decode_protobuf_snapshot(bytes: &[u8]) -> Result<TodoSnapshot, TodoSnapshotError> {
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(TodoSnapshotError::TooLarge);
    }
    let value = crate::proto::memorilo::sync::v1::TodoSnapshot::decode(bytes)
        .map_err(|_| TodoSnapshotError::InvalidJson)?;
    let items = value.items.into_iter().map(|item| Ok(TodoSnapshotItem {
        all_day: item.all_day,
        due_date: item.due_date,
        due_time: item.due_time,
        id: item.id,
        note_title: item.note_title,
        parent_id: item.parent_id,
        revision: item.revision,
        status: match item.status {
            1 => SnapshotStatus::Todo,
            2 => SnapshotStatus::InProgress,
            3 => SnapshotStatus::Done,
            _ => return Err(TodoSnapshotError::InvalidJson),
        },
        text: item.text,
        topic_title: item.topic_title,
    })).collect::<Result<Vec<_>, TodoSnapshotError>>()?;
    let snapshot = TodoSnapshot {
        generated_at: value.generated_at,
        time_zone_offset_minutes: value.time_zone_offset_minutes.map(|v| v as i16),
        items,
        revision: value.revision,
    };
    validate_snapshot(&snapshot).map_err(|_| TodoSnapshotError::InvalidJson)?;
    Ok(snapshot)
}

pub fn encode_protobuf_snapshot(snapshot: &TodoSnapshot) -> Vec<u8> {
    crate::proto::memorilo::sync::v1::TodoSnapshot {
        generated_at: snapshot.generated_at.clone(),
        time_zone_offset_minutes: snapshot.time_zone_offset_minutes.map(i32::from),
        items: snapshot.items.iter().map(|item| crate::proto::memorilo::sync::v1::TodoItem {
            all_day: item.all_day,
            due_date: item.due_date.clone(),
            due_time: item.due_time.clone(),
            id: item.id.clone(),
            note_title: item.note_title.clone(),
            parent_id: item.parent_id.clone(),
            revision: item.revision.clone(),
            status: match item.status { SnapshotStatus::Todo => 1, SnapshotStatus::InProgress => 2, SnapshotStatus::Done => 3 },
            text: item.text.clone(),
            topic_title: item.topic_title.clone(),
        }).collect(),
        revision: snapshot.revision.clone(),
    }.encode_to_vec()
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotStatus {
    Todo,
    InProgress,
    Done,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotSource {
    ClientLanPush,
    MqttTriggeredHttps,
    PeriodicHttps,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Admission {
    Unchanged,
    Rejected(TodoSnapshotError),
    Accepted {
        model: TodoModel,
        revision: String,
        source: SnapshotSource,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TodoSnapshotError {
    TooLarge,
    InvalidJson,
    InvalidRevision,
    InvalidItemCount,
    InvalidField { field: &'static str, index: usize },
    DuplicateId,
    UnknownParent,
    ParentCycle,
    StaleSnapshot,
    RevisionCollision,
}

impl fmt::Display for TodoSnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for TodoSnapshotError {}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSyncState {
    pub model: TodoModel,
    pub snapshot: Option<TodoSnapshot>,
    pub revision: Option<String>,
    pub source: Option<SnapshotSource>,
    pub etag: Option<String>,
    pub last_success_unix_seconds: Option<i64>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_event: Option<TodoSyncEvent>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TodoSyncEvent {
    Updated,
    Empty,
    Notification,
    NotModified,
    AuthenticationFailure,
    Retrying,
    OfflineCache,
}

impl TodoSyncState {
    pub fn admit_protobuf(
        &mut self,
        body: &[u8],
        source: SnapshotSource,
        now_unix_seconds: Option<i64>,
    ) -> Admission {
        let snapshot = match decode_protobuf_snapshot(body) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                self.last_error = Some("snapshot-invalid-protobuf".into());
                return Admission::Rejected(if body.len() > MAX_SNAPSHOT_BYTES {
                    TodoSnapshotError::TooLarge
                } else {
                    TodoSnapshotError::InvalidJson
                });
            }
        };
        self.admit(snapshot, source, now_unix_seconds)
    }

    pub fn admit(
        &mut self,
        snapshot: TodoSnapshot,
        source: SnapshotSource,
        now_unix_seconds: Option<i64>,
    ) -> Admission {
        if let Err(error) = validate_snapshot(&snapshot) {
            self.last_error = Some(error.to_string());
            return Admission::Rejected(error);
        }
        let model = map_model(&snapshot);
        if self.revision.as_deref() == Some(snapshot.revision.as_str()) {
            if self.model != model {
                self.last_error = Some("snapshot-revision-collision".into());
                return Admission::Rejected(TodoSnapshotError::RevisionCollision);
            }
            self.last_error = None;
            self.last_event = Some(if snapshot.items.is_empty() {
                TodoSyncEvent::Empty
            } else {
                TodoSyncEvent::Updated
            });
            return Admission::Unchanged;
        }
        if self
            .snapshot
            .as_ref()
            .is_some_and(|current| current.generated_at > snapshot.generated_at)
        {
            self.last_error = Some("snapshot-stale".into());
            return Admission::Rejected(TodoSnapshotError::StaleSnapshot);
        }
        if self.model == model {
            let event = if snapshot.items.is_empty() {
                TodoSyncEvent::Empty
            } else {
                TodoSyncEvent::Updated
            };
            self.revision = Some(snapshot.revision.clone());
            self.snapshot = Some(snapshot);
            self.source = Some(source);
            self.last_success_unix_seconds = now_unix_seconds;
            self.last_error = None;
            self.last_event = Some(event);
            return Admission::Unchanged;
        }
        self.model = model.clone();
        self.revision = Some(snapshot.revision.clone());
        self.snapshot = Some(snapshot.clone());
        self.source = Some(source);
        self.last_success_unix_seconds = now_unix_seconds;
        self.last_error = None;
        self.last_event = Some(if snapshot.items.is_empty() {
            TodoSyncEvent::Empty
        } else {
            TodoSyncEvent::Updated
        });
        Admission::Accepted {
            model,
            revision: snapshot.revision,
            source,
        }
    }
}

pub fn validate_snapshot(snapshot: &TodoSnapshot) -> Result<(), TodoSnapshotError> {
    if snapshot.generated_at.is_empty()
        || snapshot.generated_at.len() > 64
        || !snapshot.generated_at.is_ascii()
        || !snapshot.generated_at.contains('T')
    {
        return Err(TodoSnapshotError::InvalidField {
            field: "generatedAt",
            index: 0,
        });
    }
    if snapshot.revision.is_empty()
        || snapshot.revision.len() > 128
        || !snapshot.revision.is_ascii()
    {
        return Err(TodoSnapshotError::InvalidRevision);
    }
    if snapshot.items.len() > MAX_ITEMS {
        return Err(TodoSnapshotError::InvalidItemCount);
    }
    let mut ids = std::collections::HashSet::with_capacity(snapshot.items.len());
    for (index, item) in snapshot.items.iter().enumerate() {
        if item.id.is_empty() || item.id.chars().count() > MAX_ID_CHARS || !item.id.is_ascii() {
            return Err(TodoSnapshotError::InvalidField { field: "id", index });
        }
        if item.text.is_empty() || item.text.chars().count() > MAX_TEXT_CHARS {
            return Err(TodoSnapshotError::InvalidField {
                field: "text",
                index,
            });
        }
        if item.note_title.chars().count() > MAX_METADATA_CHARS {
            return Err(TodoSnapshotError::InvalidField {
                field: "noteTitle",
                index,
            });
        }
        if item.topic_title.chars().count() > MAX_METADATA_CHARS {
            return Err(TodoSnapshotError::InvalidField {
                field: "topicTitle",
                index,
            });
        }
        if item.revision.is_empty() || item.revision.len() > 128 || !item.revision.is_ascii() {
            return Err(TodoSnapshotError::InvalidField {
                field: "revision",
                index,
            });
        }
        if item.due_date.as_ref().is_some_and(|date| !valid_date(date)) {
            return Err(TodoSnapshotError::InvalidField {
                field: "dueDate",
                index,
            });
        }
        if item.due_time.as_ref().is_some_and(|time| !valid_time(time)) {
            return Err(TodoSnapshotError::InvalidField {
                field: "dueTime",
                index,
            });
        }
        if !ids.insert(item.id.as_str()) {
            return Err(TodoSnapshotError::DuplicateId);
        }
    }
    for (index, item) in snapshot.items.iter().enumerate() {
        let Some(parent) = &item.parent_id else {
            continue;
        };
        if !ids.contains(parent.as_str()) {
            return Err(TodoSnapshotError::UnknownParent);
        }
        let mut current = parent.as_str();
        let mut seen = std::collections::HashSet::new();
        while let Some(parent_item) = snapshot
            .items
            .iter()
            .find(|candidate| candidate.id == current)
        {
            if !seen.insert(current) {
                return Err(TodoSnapshotError::ParentCycle);
            }
            let Some(next) = &parent_item.parent_id else {
                break;
            };
            current = next;
        }
        let _ = index;
    }
    Ok(())
}

fn map_model(snapshot: &TodoSnapshot) -> TodoModel {
    TodoModel {
        items: snapshot
            .items
            .iter()
            .map(|item| TodoItem {
                id: TodoId(item.id.clone()),
                title: item.text.clone(),
                due: item
                    .due_time
                    .clone()
                    .or_else(|| item.due_date.clone())
                    .unwrap_or_default(),
                status: match item.status {
                    SnapshotStatus::Todo => Status::Open,
                    SnapshotStatus::InProgress => Status::Doing,
                    SnapshotStatus::Done => Status::Done,
                },
                indent: indent_for(item, snapshot),
            })
            .collect(),
    }
}

fn indent_for(item: &TodoSnapshotItem, snapshot: &TodoSnapshot) -> u8 {
    let mut depth = 0_u8;
    let mut parent = item.parent_id.as_deref();
    while let Some(id) = parent {
        depth = depth.saturating_add(1).min(4);
        parent = snapshot
            .items
            .iter()
            .find(|candidate| candidate.id == id)
            .and_then(|candidate| candidate.parent_id.as_deref());
    }
    depth
}

fn valid_date(value: &str) -> bool {
    if value.len() != 10
        || value.as_bytes().get(4) != Some(&b'-')
        || value.as_bytes().get(7) != Some(&b'-')
    {
        return false;
    }
    let Ok(year) = value[0..4].parse::<i32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u32>() else {
        return false;
    };
    if !(1..=12).contains(&month) || day == 0 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    day <= days
}

fn valid_time(value: &str) -> bool {
    if value.len() != 5 || value.as_bytes().get(2) != Some(&b':') {
        return false;
    }
    let Ok(hour) = value[0..2].parse::<u32>() else {
        return false;
    };
    let Ok(minute) = value[3..5].parse::<u32>() else {
        return false;
    };
    hour < 24 && minute < 60
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(revision: &str, text: &str) -> TodoSnapshot {
        TodoSnapshot {
            generated_at: "2026-09-05T00:00:00Z".into(),
            time_zone_offset_minutes: Some(480),
            revision: revision.into(),
            items: vec![TodoSnapshotItem {
                all_day: true,
                due_date: Some("2026-09-05".into()),
                due_time: None,
                id: "opaque-1".into(),
                note_title: "Note".into(),
                parent_id: None,
                revision: revision.into(),
                status: SnapshotStatus::Todo,
                text: text.into(),
                topic_title: "Topic".into(),
            }],
        }
    }

    #[test]
    fn enabled_todo_accepts_lan_only_delivery_without_https_credentials() {
        let mut config = TodoSyncConfig::normalized_default();
        config.enabled = true;
        assert!(!config.has_https_source());
        assert_eq!(config.validate(), Ok(()));

        config.https_base_url = "https://example.test".into();
        assert!(!config.has_https_source());
        assert_eq!(config.validate(), Ok(()));
        config.set_device_token("secret".into());
        assert!(config.has_https_source());
        assert_eq!(config.validate(), Ok(()));
    }

    #[test]
    fn configured_https_source_disables_local_snapshot_pushes() {
        let mut config = TodoSyncConfig::normalized_default();
        assert!(config.allows_snapshot_source(SnapshotSource::ClientLanPush));

        config.https_base_url = "https://example.test".into();
        config.set_device_token("secret".into());
        assert!(config.allows_snapshot_source(SnapshotSource::ClientLanPush));

        config.enabled = true;
        assert!(!config.allows_snapshot_source(SnapshotSource::ClientLanPush));
        assert!(config.allows_snapshot_source(SnapshotSource::PeriodicHttps));
        assert!(config.allows_snapshot_source(SnapshotSource::MqttTriggeredHttps));
    }

    #[test]
    fn semantic_equality_skips_refresh_even_when_revision_changes() {
        let mut state = TodoSyncState::default();
        assert!(matches!(
            state.admit(
                snapshot("a", "same"),
                SnapshotSource::PeriodicHttps,
                Some(1)
            ),
            Admission::Accepted { .. }
        ));
        assert!(matches!(
            state.admit(
                snapshot("b", "same"),
                SnapshotSource::ClientLanPush,
                Some(2)
            ),
            Admission::Unchanged
        ));
        assert_eq!(state.revision.as_deref(), Some("b"));
    }

    #[test]
    fn an_empty_client_snapshot_clears_existing_todos() {
        let mut state = TodoSyncState::default();
        assert!(matches!(
            state.admit(
                snapshot("revision-with-items", "remove me"),
                SnapshotSource::ClientLanPush,
                Some(1)
            ),
            Admission::Accepted { .. }
        ));

        let mut empty = snapshot("revision-empty", "unused");
        empty.generated_at = "2026-09-05T00:01:00Z".into();
        empty.items.clear();
        assert!(matches!(
            state.admit(empty, SnapshotSource::ClientLanPush, Some(2)),
            Admission::Accepted { .. }
        ));
        assert!(state.model.items.is_empty());
        assert_eq!(state.last_event, Some(TodoSyncEvent::Empty));
    }

    #[test]
    fn rejects_invalid_dates_duplicate_ids_and_cycles() {
        let mut invalid = snapshot("a", "text");
        invalid.items[0].due_date = Some("2026-02-30".into());
        assert_eq!(
            validate_snapshot(&invalid),
            Err(TodoSnapshotError::InvalidField {
                field: "dueDate",
                index: 0
            })
        );

        let mut cycle = snapshot("a", "text");
        cycle.items.push(TodoSnapshotItem {
            parent_id: Some("opaque-1".into()),
            id: "opaque-2".into(),
            ..snapshot("a", "child").items.remove(0)
        });
        cycle.items[0].parent_id = Some("opaque-2".into());
        assert_eq!(
            validate_snapshot(&cycle),
            Err(TodoSnapshotError::ParentCycle)
        );
    }

    #[test]
    fn maps_status_dates_and_parent_depth_without_row_selection() {
        let mut parent = snapshot("a", "parent");
        parent.items.push(TodoSnapshotItem {
            parent_id: Some("opaque-1".into()),
            id: "opaque-2".into(),
            status: SnapshotStatus::InProgress,
            ..snapshot("a", "child").items.remove(0)
        });
        let mut state = TodoSyncState::default();
        let result = state.admit(parent, SnapshotSource::ClientLanPush, None);
        let Admission::Accepted { model, .. } = result else {
            panic!("expected accepted")
        };
        assert_eq!(model.items[0].id.0, "opaque-1");
        assert_eq!(model.items[1].indent, 1);
        assert_eq!(model.items[1].status, Status::Doing);
    }

    #[test]
    fn rejects_out_of_order_snapshots_and_revision_collisions() {
        let mut state = TodoSyncState::default();
        let mut current = snapshot("revision-a", "current");
        current.generated_at = "2026-09-05T10:00:00Z".into();
        assert!(matches!(
            state.admit(current, SnapshotSource::ClientLanPush, Some(1)),
            Admission::Accepted { .. }
        ));

        let mut stale = snapshot("revision-b", "stale");
        stale.generated_at = "2026-09-05T09:00:00Z".into();
        assert_eq!(
            state.admit(stale, SnapshotSource::PeriodicHttps, Some(2)),
            Admission::Rejected(TodoSnapshotError::StaleSnapshot)
        );

        let mut collision = snapshot("revision-a", "different");
        collision.generated_at = "2026-09-05T11:00:00Z".into();
        assert_eq!(
            state.admit(collision, SnapshotSource::PeriodicHttps, Some(3)),
            Admission::Rejected(TodoSnapshotError::RevisionCollision)
        );
        assert_eq!(state.model.items[0].title, "current");
    }
}
