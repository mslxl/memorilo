use std::collections::HashSet;
use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::glance::WeatherReading;
use crate::model::{Status, TodoId, TodoItem, TodoModel};
use crate::todo_sync::{TodoSyncConfig, TodoSyncState};

const MAGIC: [u8; 4] = *b"MRLO";
const CURRENT_VERSION: u16 = 6;
const HEADER_BYTES: usize = 22;
// TODO snapshots are retained alongside the rendered model and metadata.
// Keep enough NVS room for the bounded 32 KiB transport payload without
// silently dropping persistence when a valid snapshot is received.
const MAX_BLOB_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum SelectionPolicy {
    Remember,
    FirstOpen,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherConfig {
    pub enabled: bool,
    pub location_name: String,
    pub latitude_e6: i32,
    pub longitude_e6: i32,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlmanacConfig {
    pub note: String,
    pub source: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
struct SecretString(String);

impl fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<redacted>")
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct WifiConfig {
    pub ssid: Option<String>,
    password: Option<SecretString>,
}

impl WifiConfig {
    pub fn has_password(&self) -> bool {
        self.password.is_some()
    }

    pub(crate) fn password(&self) -> Option<&str> {
        self.password.as_ref().map(|password| password.0.as_str())
    }

    pub fn set_password(&mut self, password: impl Into<String>) -> Result<(), ValidationError> {
        let password = password.into();
        if password.is_empty() {
            self.password = None;
            return Ok(());
        }
        if !(8..=63).contains(&password.len()) {
            return Err(ValidationError::InvalidWifiPasswordLength);
        }
        self.password = Some(SecretString(password));
        Ok(())
    }

    pub fn set_ssid(&mut self, ssid: Option<String>) -> Result<(), ValidationError> {
        if ssid
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 32)
        {
            return Err(ValidationError::InvalidWifiSsid);
        }
        self.ssid = ssid;
        Ok(())
    }

    pub fn clear_password(&mut self) {
        self.password = None;
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct LocalManagementConfig {
    token: Option<SecretString>,
}

impl LocalManagementConfig {
    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    pub(crate) fn token(&self) -> Option<&str> {
        self.token.as_ref().map(|token| token.0.as_str())
    }

    pub fn set_token(&mut self, token: impl Into<String>) -> Result<(), ValidationError> {
        let token = token.into();
        if token.is_empty() {
            self.token = None;
            return Ok(());
        }
        if !(32..=128).contains(&token.len()) || !token.is_ascii() {
            return Err(ValidationError::InvalidLocalManagementToken);
        }
        self.token = Some(SecretString(token));
        Ok(())
    }

    pub fn clear_token(&mut self) {
        self.token = None;
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeviceConfig {
    pub device_name: String,
    pub wifi: WifiConfig,
    pub local_management: LocalManagementConfig,
    pub timezone: String,
    pub idle_sleep_seconds: u32,
    pub selection_policy: SelectionPolicy,
    pub weather: WeatherConfig,
    pub almanac: AlmanacConfig,
    pub todo_sync: TodoSyncConfig,
}

impl Default for DeviceConfig {
    fn default() -> Self {
        Self {
            device_name: "Memorilo".into(),
            wifi: WifiConfig::default(),
            local_management: LocalManagementConfig::default(),
            timezone: "Asia/Shanghai".into(),
            idle_sleep_seconds: 10 * 60,
            selection_policy: SelectionPolicy::Remember,
            weather: WeatherConfig::default(),
            almanac: AlmanacConfig::default(),
            todo_sync: TodoSyncConfig::normalized_default(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicDeviceConfig {
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
    pub todo_sync_view: crate::todo_sync::TodoView,
    pub todo_sync_mqtt_configured: bool,
    pub todo_sync_mqtt_password_is_set: bool,
}

impl DeviceConfig {
    pub fn public(&self) -> PublicDeviceConfig {
        PublicDeviceConfig {
            device_name: self.device_name.clone(),
            wifi_ssid: self.wifi.ssid.clone(),
            wifi_password_is_set: self.wifi.has_password(),
            local_management_token_is_set: self.local_management.has_token(),
            timezone: self.timezone.clone(),
            idle_sleep_seconds: self.idle_sleep_seconds,
            selection_policy: self.selection_policy.clone(),
            weather: self.weather.clone(),
            almanac: self.almanac.clone(),
            todo_sync_enabled: self.todo_sync.enabled,
            todo_sync_view: self.todo_sync.view,
            todo_sync_mqtt_configured: self.todo_sync.mqtt_broker_url.is_some(),
            todo_sync_mqtt_password_is_set: self.todo_sync.has_mqtt_password(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PersistentState {
    pub config: DeviceConfig,
    pub todos: TodoModel,
    pub weather_cache: Option<WeatherReading>,
    #[serde(default)]
    pub todo_sync: TodoSyncState,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidationError {
    InvalidDeviceName,
    InvalidWifiSsid,
    InvalidWifiPasswordLength,
    InvalidLocalManagementToken,
    InvalidTimezone,
    InvalidSleepTimeout,
    InvalidWeatherLocation,
    InvalidWeatherCoordinates,
    InvalidAlmanac,
    InvalidWeatherCache,
    TooManyTodos,
    InvalidTodoTitle { index: usize },
    InvalidTodoDue { index: usize },
    InvalidTodoIndent { index: usize },
    DuplicateTodoId(TodoId),
    InvalidTodoSyncConfig,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for ValidationError {}

pub fn validate(state: &PersistentState) -> Result<(), ValidationError> {
    let config = &state.config;
    if config.device_name.is_empty() || config.device_name.chars().count() > 32 {
        return Err(ValidationError::InvalidDeviceName);
    }
    if config
        .wifi
        .ssid
        .as_ref()
        .is_some_and(|ssid| ssid.is_empty() || ssid.len() > 32)
    {
        return Err(ValidationError::InvalidWifiSsid);
    }
    if config
        .wifi
        .password
        .as_ref()
        .is_some_and(|password| !(8..=63).contains(&password.0.len()))
    {
        return Err(ValidationError::InvalidWifiPasswordLength);
    }
    if config
        .local_management
        .token
        .as_ref()
        .is_some_and(|token| !(32..=128).contains(&token.0.len()) || !token.0.is_ascii())
    {
        return Err(ValidationError::InvalidLocalManagementToken);
    }
    if config.timezone.is_empty() || config.timezone.len() > 64 || !config.timezone.contains('/') {
        return Err(ValidationError::InvalidTimezone);
    }
    if !(60..=24 * 60 * 60).contains(&config.idle_sleep_seconds) {
        return Err(ValidationError::InvalidSleepTimeout);
    }
    if config.weather.location_name.chars().count() > 32 {
        return Err(ValidationError::InvalidWeatherLocation);
    }
    if !(-90_000_000..=90_000_000).contains(&config.weather.latitude_e6)
        || !(-180_000_000..=180_000_000).contains(&config.weather.longitude_e6)
        || (config.weather.enabled && config.weather.location_name.trim().is_empty())
    {
        return Err(ValidationError::InvalidWeatherCoordinates);
    }
    if config.almanac.note.chars().count() > 160 || config.almanac.source.chars().count() > 80 {
        return Err(ValidationError::InvalidAlmanac);
    }
    config
        .todo_sync
        .validate()
        .map_err(|_| ValidationError::InvalidTodoSyncConfig)?;
    if state.weather_cache.as_ref().is_some_and(|reading| {
        !(-1_000..=700).contains(&reading.temperature_tenths_celsius)
            || !(-1_000..=700).contains(&reading.apparent_temperature_tenths_celsius)
            || reading.relative_humidity_percent > 100
            || reading.precipitation_probability_percent > 100
            || reading.observed_at_unix_seconds > reading.fetched_at_unix_seconds + 24 * 60 * 60
    }) {
        return Err(ValidationError::InvalidWeatherCache);
    }

    if state.todos.items.len() > 64 {
        return Err(ValidationError::TooManyTodos);
    }
    let mut ids = HashSet::new();
    for (index, item) in state.todos.items.iter().enumerate() {
        if item.title.is_empty() || item.title.chars().count() > 160 {
            return Err(ValidationError::InvalidTodoTitle { index });
        }
        if item.due.chars().count() > 32 {
            return Err(ValidationError::InvalidTodoDue { index });
        }
        if item.indent > 4 {
            return Err(ValidationError::InvalidTodoIndent { index });
        }
        if !ids.insert(item.id.clone()) {
            return Err(ValidationError::DuplicateTodoId(item.id.clone()));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlobSlot {
    A,
    B,
}

impl BlobSlot {
    fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

pub trait BlobStore {
    fn read(&mut self, slot: BlobSlot) -> Result<Option<Vec<u8>>, PersistenceError>;
    fn write(&mut self, slot: BlobSlot, bytes: &[u8]) -> Result<(), PersistenceError>;
}

#[derive(Debug)]
pub enum PersistenceError {
    Storage(String),
    Encode,
    BlobTooLarge { actual: usize },
    Validation(ValidationError),
}

impl fmt::Display for PersistenceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Storage(message) => write!(formatter, "storage error: {message}"),
            Self::Encode => formatter.write_str("state encoding failed"),
            Self::BlobTooLarge { actual } => {
                write!(formatter, "state blob is too large: {actual} bytes")
            }
            Self::Validation(error) => write!(formatter, "state validation failed: {error}"),
        }
    }
}

impl std::error::Error for PersistenceError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RecoveryReason {
    Truncated,
    InvalidMagic,
    InvalidChecksum,
    UnsupportedVersion(u16),
    InvalidPayload,
    InvalidState(ValidationError),
    Oversized,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoadSource {
    Defaults,
    Stored {
        slot: BlobSlot,
        generation: u64,
        migrated: bool,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoadOutcome {
    pub state: PersistentState,
    pub source: LoadSource,
    pub recovery: Option<RecoveryReason>,
}

#[derive(Debug)]
struct DecodedState {
    state: PersistentState,
    generation: u64,
    migrated: bool,
}

pub struct PersistenceManager<S> {
    store: S,
    debounce: Duration,
    pending: Option<(PersistentState, Duration)>,
    generation: u64,
    next_slot: BlobSlot,
}

impl<S: BlobStore> PersistenceManager<S> {
    pub fn new(store: S, debounce: Duration) -> Self {
        Self {
            store,
            debounce,
            pending: None,
            generation: 0,
            next_slot: BlobSlot::A,
        }
    }

    pub fn load(&mut self) -> Result<LoadOutcome, PersistenceError> {
        let slots = [
            (BlobSlot::A, self.store.read(BlobSlot::A)?),
            (BlobSlot::B, self.store.read(BlobSlot::B)?),
        ];
        let mut best: Option<(BlobSlot, DecodedState)> = None;
        let mut recovery = None;
        let mut had_data = false;

        for (slot, bytes) in slots {
            let Some(bytes) = bytes else { continue };
            had_data = true;
            match decode(&bytes) {
                Ok(decoded)
                    if best
                        .as_ref()
                        .is_none_or(|(_, current)| decoded.generation > current.generation) =>
                {
                    best = Some((slot, decoded));
                }
                Ok(_) => {}
                Err(reason) => recovery = Some(reason),
            }
        }

        if let Some((slot, decoded)) = best {
            self.generation = decoded.generation;
            self.next_slot = slot.other();
            Ok(LoadOutcome {
                state: decoded.state,
                source: LoadSource::Stored {
                    slot,
                    generation: decoded.generation,
                    migrated: decoded.migrated,
                },
                recovery,
            })
        } else {
            Ok(LoadOutcome {
                state: PersistentState::default(),
                source: LoadSource::Defaults,
                recovery: had_data.then_some(recovery.unwrap_or(RecoveryReason::InvalidPayload)),
            })
        }
    }

    pub fn schedule(&mut self, state: PersistentState, now: Duration) {
        self.pending = Some((state, now + self.debounce));
    }

    pub fn has_pending_write(&self) -> bool {
        self.pending.is_some()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn poll(&mut self, now: Duration) -> Result<bool, PersistenceError> {
        if self
            .pending
            .as_ref()
            .is_none_or(|(_, ready_at)| now < *ready_at)
        {
            return Ok(false);
        }
        self.flush().map(|()| true)
    }

    pub fn flush(&mut self) -> Result<(), PersistenceError> {
        let Some((state, _)) = self.pending.as_ref() else {
            return Ok(());
        };
        validate(state).map_err(PersistenceError::Validation)?;
        let generation = self.generation.saturating_add(1);
        let bytes = encode(state, generation)?;
        self.store.write(self.next_slot, &bytes)?;
        self.generation = generation;
        self.next_slot = self.next_slot.other();
        self.pending = None;
        Ok(())
    }
}

fn encode(state: &PersistentState, generation: u64) -> Result<Vec<u8>, PersistenceError> {
    validate(state).map_err(PersistenceError::Validation)?;
    let payload = postcard::to_stdvec(state).map_err(|_| PersistenceError::Encode)?;
    encode_payload(CURRENT_VERSION, generation, &payload)
}

fn encode_payload(
    version: u16,
    generation: u64,
    payload: &[u8],
) -> Result<Vec<u8>, PersistenceError> {
    let total = HEADER_BYTES + payload.len();
    if total > MAX_BLOB_BYTES {
        return Err(PersistenceError::BlobTooLarge { actual: total });
    }
    let mut bytes = Vec::with_capacity(total);
    bytes.extend_from_slice(&MAGIC);
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend_from_slice(&generation.to_le_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&checksum(payload).to_le_bytes());
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

fn decode(bytes: &[u8]) -> Result<DecodedState, RecoveryReason> {
    if bytes.len() < HEADER_BYTES {
        return Err(RecoveryReason::Truncated);
    }
    if bytes[..4] != MAGIC {
        return Err(RecoveryReason::InvalidMagic);
    }
    let version = u16::from_le_bytes(bytes[4..6].try_into().unwrap());
    let generation = u64::from_le_bytes(bytes[6..14].try_into().unwrap());
    let payload_len = u32::from_le_bytes(bytes[14..18].try_into().unwrap()) as usize;
    let expected_checksum = u32::from_le_bytes(bytes[18..22].try_into().unwrap());
    if bytes.len() > MAX_BLOB_BYTES {
        return Err(RecoveryReason::Oversized);
    }
    if bytes.len() != HEADER_BYTES + payload_len {
        return Err(RecoveryReason::Truncated);
    }
    let payload = &bytes[HEADER_BYTES..];
    if checksum(payload) != expected_checksum {
        return Err(RecoveryReason::InvalidChecksum);
    }

    let (state, migrated) = match version {
        CURRENT_VERSION => (
            postcard::from_bytes(payload).map_err(|_| RecoveryReason::InvalidPayload)?,
            false,
        ),
        5 => (
            migrate_v5(postcard::from_bytes(payload).map_err(|_| RecoveryReason::InvalidPayload)?),
            true,
        ),
        4 => (
            migrate_v4(postcard::from_bytes(payload).map_err(|_| RecoveryReason::InvalidPayload)?),
            true,
        ),
        3 => (
            migrate_v3(postcard::from_bytes(payload).map_err(|_| RecoveryReason::InvalidPayload)?),
            true,
        ),
        2 => (
            migrate_v2(postcard::from_bytes(payload).map_err(|_| RecoveryReason::InvalidPayload)?),
            true,
        ),
        1 => (
            migrate_v1(postcard::from_bytes(payload).map_err(|_| RecoveryReason::InvalidPayload)?),
            true,
        ),
        other => return Err(RecoveryReason::UnsupportedVersion(other)),
    };
    validate(&state).map_err(RecoveryReason::InvalidState)?;
    Ok(DecodedState {
        state,
        generation,
        migrated,
    })
}

fn checksum(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0x811c9dc5, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(0x01000193)
    })
}

#[derive(Deserialize, Serialize)]
struct StateV1 {
    device_name: String,
    timezone: String,
    idle_sleep_seconds: u32,
    selected: usize,
    todos: Vec<TodoV1>,
}

#[derive(Deserialize, Serialize)]
struct StateV2 {
    config: DeviceConfigV2,
    todos: LegacyTodoModel,
}

#[derive(Deserialize, Serialize)]
struct StateV3 {
    config: DeviceConfigV3,
    todos: LegacyTodoModel,
}

#[derive(Deserialize, Serialize)]
struct StateV4 {
    config: DeviceConfigV4,
    todos: LegacyTodoModel,
    weather_cache: Option<WeatherReading>,
}

#[derive(Deserialize, Serialize)]
struct StateV5 {
    config: DeviceConfigV5,
    todos: LegacyTodoModel,
    weather_cache: Option<WeatherReading>,
}

#[derive(Deserialize, Serialize)]
struct DeviceConfigV5 {
    device_name: String,
    wifi: WifiConfig,
    local_management: LocalManagementConfig,
    timezone: String,
    idle_sleep_seconds: u32,
    selection_policy: SelectionPolicy,
    weather: WeatherConfig,
    almanac: AlmanacConfig,
}

#[derive(Deserialize, Serialize)]
struct LegacyTodoModel {
    items: Vec<LegacyTodoItem>,
    #[serde(default)]
    selected: usize,
}

#[derive(Deserialize, Serialize)]
struct LegacyTodoItem {
    id: u64,
    title: String,
    due: String,
    status: Status,
    indent: u8,
}

#[derive(Deserialize, Serialize)]
struct DeviceConfigV4 {
    device_name: String,
    wifi: WifiConfig,
    local_management: LocalManagementConfig,
    timezone: String,
    idle_sleep_seconds: u32,
    selection_policy: SelectionPolicy,
    weather: WeatherConfig,
    almanac: AlmanacConfig,
    life_progress: LegacyLifeProgressConfig,
}

#[derive(Deserialize, Serialize)]
struct LegacyLifeProgressConfig {
    birth_date: Option<LegacyProfileDate>,
    expected_years: u8,
}

#[derive(Deserialize, Serialize)]
struct LegacyProfileDate {
    year: u16,
    month: u8,
    day: u8,
}

#[derive(Deserialize, Serialize)]
struct DeviceConfigV3 {
    device_name: String,
    wifi: WifiConfig,
    local_management: LocalManagementConfig,
    timezone: String,
    idle_sleep_seconds: u32,
    selection_policy: SelectionPolicy,
}

#[derive(Deserialize, Serialize)]
struct DeviceConfigV2 {
    device_name: String,
    wifi: WifiConfig,
    timezone: String,
    idle_sleep_seconds: u32,
    selection_policy: SelectionPolicy,
}

#[derive(Deserialize, Serialize)]
struct TodoV1 {
    title: String,
    due: String,
    completed: bool,
}

fn migrate_v1(state: StateV1) -> PersistentState {
    PersistentState {
        config: DeviceConfig {
            device_name: state.device_name,
            timezone: state.timezone,
            idle_sleep_seconds: state.idle_sleep_seconds,
            ..DeviceConfig::default()
        },
        todos: TodoModel {
            items: state
                .todos
                .into_iter()
                .enumerate()
                .map(|(index, item)| TodoItem {
                    id: TodoId(format!("legacy-{index}")),
                    title: item.title,
                    due: item.due,
                    status: if item.completed {
                        Status::Done
                    } else {
                        Status::Open
                    },
                    indent: 0,
                })
                .collect(),
        },
        weather_cache: None,
        todo_sync: TodoSyncState::default(),
    }
}

fn migrate_v2(state: StateV2) -> PersistentState {
    PersistentState {
        config: DeviceConfig {
            device_name: state.config.device_name,
            wifi: state.config.wifi,
            timezone: state.config.timezone,
            idle_sleep_seconds: state.config.idle_sleep_seconds,
            selection_policy: state.config.selection_policy,
            ..DeviceConfig::default()
        },
        todos: migrate_legacy_todos(state.todos),
        weather_cache: None,
        todo_sync: TodoSyncState::default(),
    }
}

fn migrate_v3(state: StateV3) -> PersistentState {
    PersistentState {
        config: DeviceConfig {
            device_name: state.config.device_name,
            wifi: state.config.wifi,
            local_management: state.config.local_management,
            timezone: state.config.timezone,
            idle_sleep_seconds: state.config.idle_sleep_seconds,
            selection_policy: state.config.selection_policy,
            ..DeviceConfig::default()
        },
        todos: migrate_legacy_todos(state.todos),
        weather_cache: None,
        todo_sync: TodoSyncState::default(),
    }
}

fn migrate_v4(state: StateV4) -> PersistentState {
    PersistentState {
        config: DeviceConfig {
            device_name: state.config.device_name,
            wifi: state.config.wifi,
            local_management: state.config.local_management,
            timezone: state.config.timezone,
            idle_sleep_seconds: state.config.idle_sleep_seconds,
            selection_policy: state.config.selection_policy,
            weather: state.config.weather,
            almanac: state.config.almanac,
            todo_sync: TodoSyncConfig::normalized_default(),
        },
        todos: migrate_legacy_todos(state.todos),
        weather_cache: state.weather_cache,
        todo_sync: TodoSyncState::default(),
    }
}

fn migrate_v5(state: StateV5) -> PersistentState {
    PersistentState {
        config: DeviceConfig {
            device_name: state.config.device_name,
            wifi: state.config.wifi,
            local_management: state.config.local_management,
            timezone: state.config.timezone,
            idle_sleep_seconds: state.config.idle_sleep_seconds,
            selection_policy: state.config.selection_policy,
            weather: state.config.weather,
            almanac: state.config.almanac,
            todo_sync: TodoSyncConfig::normalized_default(),
        },
        todos: migrate_legacy_todos(state.todos),
        weather_cache: state.weather_cache,
        todo_sync: TodoSyncState::default(),
    }
}

fn migrate_legacy_todos(state: LegacyTodoModel) -> TodoModel {
    TodoModel {
        items: state
            .items
            .into_iter()
            .enumerate()
            .map(|(index, item)| TodoItem {
                id: TodoId(format!("legacy-{}-{}", item.id, index)),
                title: item.title,
                due: item.due,
                status: item.status,
                indent: item.indent,
            })
            .collect(),
    }
}

#[cfg(target_os = "espidf")]
pub struct EspNvsBlobStore {
    nvs: esp_idf_svc::nvs::EspDefaultNvs,
}

#[cfg(target_os = "espidf")]
impl EspNvsBlobStore {
    pub fn new(
        partition: esp_idf_svc::nvs::EspDefaultNvsPartition,
    ) -> Result<Self, PersistenceError> {
        let nvs = esp_idf_svc::nvs::EspNvs::new(partition, "memorilo", true)
            .map_err(|error| PersistenceError::Storage(error.to_string()))?;
        Ok(Self { nvs })
    }

    fn key(slot: BlobSlot) -> &'static str {
        match slot {
            BlobSlot::A => "state_a",
            BlobSlot::B => "state_b",
        }
    }
}

#[cfg(target_os = "espidf")]
impl BlobStore for EspNvsBlobStore {
    fn read(&mut self, slot: BlobSlot) -> Result<Option<Vec<u8>>, PersistenceError> {
        let key = Self::key(slot);
        let Some(length) = self
            .nvs
            .blob_len(key)
            .map_err(|error| PersistenceError::Storage(error.to_string()))?
        else {
            return Ok(None);
        };
        if length > MAX_BLOB_BYTES {
            return Err(PersistenceError::BlobTooLarge { actual: length });
        }
        let mut bytes = vec![0; length];
        let read = self
            .nvs
            .get_blob(key, &mut bytes)
            .map_err(|error| PersistenceError::Storage(error.to_string()))?;
        Ok(read.map(|value| value.to_vec()))
    }

    fn write(&mut self, slot: BlobSlot, bytes: &[u8]) -> Result<(), PersistenceError> {
        self.nvs
            .set_blob(Self::key(slot), bytes)
            .map_err(|error| PersistenceError::Storage(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MemoryStore {
        slots: [Option<Vec<u8>>; 2],
        writes: usize,
    }

    impl BlobStore for MemoryStore {
        fn read(&mut self, slot: BlobSlot) -> Result<Option<Vec<u8>>, PersistenceError> {
            Ok(self.slots[slot as usize].clone())
        }

        fn write(&mut self, slot: BlobSlot, bytes: &[u8]) -> Result<(), PersistenceError> {
            self.slots[slot as usize] = Some(bytes.to_vec());
            self.writes += 1;
            Ok(())
        }
    }

    #[test]
    fn round_trip_preserves_configuration_and_todos() {
        let mut state = PersistentState::default();
        state.config.device_name = "Desk display".into();
        state.config.wifi.ssid = Some("Office".into());
        state.config.wifi.set_password("correct horse").unwrap();
        state.config.timezone = "Europe/Paris".into();
        state.config.idle_sleep_seconds = 900;
        state
            .config
            .todo_sync
            .set_device_token("server-secret".into());
        state.todo_sync.revision = Some("revision-1".into());
        state.todo_sync.etag = Some("etag-1".into());

        let bytes = encode(&state, 8).unwrap();
        let decoded = decode(&bytes).unwrap();

        assert_eq!(decoded.state, state);
        assert_eq!(decoded.generation, 8);
        assert!(!decoded.migrated);
        assert!(decoded.state.config.todo_sync.has_device_token());
        assert!(!format!("{:?}", decoded.state.config).contains("server-secret"));
    }

    #[test]
    fn migrates_v1_and_assigns_stable_ids() {
        let v1 = StateV1 {
            device_name: "Old device".into(),
            timezone: "Asia/Shanghai".into(),
            idle_sleep_seconds: 600,
            selected: 0,
            todos: vec![TodoV1 {
                title: "Legacy task".into(),
                due: String::new(),
                completed: true,
            }],
        };
        let payload = postcard::to_stdvec(&v1).unwrap();
        let decoded = decode(&encode_payload(1, 3, &payload).unwrap()).unwrap();

        assert!(decoded.migrated);
        assert_eq!(decoded.state.todos.items[0].id, TodoId("legacy-0".into()));
        assert_eq!(decoded.state.todos.items[0].status, Status::Done);
    }

    #[test]
    fn migrates_v2_without_inventing_a_local_management_credential() {
        let mut wifi = WifiConfig::default();
        wifi.set_ssid(Some("Study".into())).unwrap();
        wifi.set_password("correct horse").unwrap();
        let v2 = StateV2 {
            config: DeviceConfigV2 {
                device_name: "Legacy display".into(),
                wifi,
                timezone: "Asia/Shanghai".into(),
                idle_sleep_seconds: 900,
                selection_policy: SelectionPolicy::FirstOpen,
            },
            todos: LegacyTodoModel {
                items: TodoModel::default()
                    .items
                    .into_iter()
                    .map(|item| LegacyTodoItem {
                        id: item.id.0.parse::<u64>().unwrap_or(0),
                        title: item.title,
                        due: item.due,
                        status: item.status,
                        indent: item.indent,
                    })
                    .collect(),
                selected: 0,
            },
        };
        let payload = postcard::to_stdvec(&v2).unwrap();
        let decoded = decode(&encode_payload(2, 4, &payload).unwrap()).unwrap();

        assert!(decoded.migrated);
        assert_eq!(decoded.generation, 4);
        assert_eq!(decoded.state.config.device_name, "Legacy display");
        assert_eq!(decoded.state.config.wifi.ssid.as_deref(), Some("Study"));
        assert!(decoded.state.config.wifi.has_password());
        assert!(!decoded.state.config.local_management.has_token());
        assert_eq!(
            decoded.state.config.selection_policy,
            SelectionPolicy::FirstOpen
        );
    }

    #[test]
    fn truncated_and_corrupt_blobs_produce_explicit_recovery() {
        assert_eq!(decode(&[1, 2, 3]).unwrap_err(), RecoveryReason::Truncated);
        let mut bytes = encode(&PersistentState::default(), 1).unwrap();
        bytes.pop();
        assert_eq!(decode(&bytes).unwrap_err(), RecoveryReason::Truncated);
        let mut bytes = encode(&PersistentState::default(), 1).unwrap();
        *bytes.last_mut().unwrap() ^= 0xff;
        assert_eq!(decode(&bytes).unwrap_err(), RecoveryReason::InvalidChecksum);
    }

    #[test]
    fn interrupted_latest_slot_falls_back_to_previous_valid_generation() {
        let previous = PersistentState::default();
        let mut latest = previous.clone();
        latest.config.device_name = "New name".into();
        let store = MemoryStore {
            slots: [Some(encode(&previous, 1).unwrap()), Some(vec![0, 1, 2])],
            writes: 0,
        };
        let mut manager = PersistenceManager::new(store, Duration::from_millis(500));

        let loaded = manager.load().unwrap();

        assert_eq!(loaded.state, previous);
        assert_eq!(loaded.recovery, Some(RecoveryReason::Truncated));
        assert_eq!(
            loaded.source,
            LoadSource::Stored {
                slot: BlobSlot::A,
                generation: 1,
                migrated: false,
            }
        );
    }

    #[test]
    fn semantic_writes_are_debounced_and_rotate_slots() {
        let store = MemoryStore::default();
        let mut manager = PersistenceManager::new(store, Duration::from_millis(500));
        manager.schedule(PersistentState::default(), Duration::ZERO);
        manager.schedule(PersistentState::default(), Duration::from_millis(300));

        assert!(!manager.poll(Duration::from_millis(799)).unwrap());
        assert!(manager.poll(Duration::from_millis(800)).unwrap());
        assert!(!manager.poll(Duration::from_millis(900)).unwrap());
    }

    #[test]
    fn invalid_fields_and_oversized_snapshots_are_rejected() {
        let mut invalid = PersistentState::default();
        invalid.config.timezone = "not-a-timezone".into();
        assert_eq!(validate(&invalid), Err(ValidationError::InvalidTimezone));

        let mut oversized = PersistentState::default();
        oversized.todos.items = (0..64)
            .map(|index| TodoItem {
                id: TodoId(format!("oversized-{index}")),
                title: "a".repeat(160),
                due: "b".repeat(32),
                status: Status::Open,
                indent: 0,
            })
            .collect();
        oversized.todo_sync.snapshot = Some(crate::todo_sync::TodoSnapshot {
            generated_at: "2026-01-01T00:00:00Z".into(),
            time_zone_offset_minutes: Some(480),
            items: (0..2048)
                .map(|index| crate::todo_sync::TodoSnapshotItem {
                    id: format!("snapshot-{index}"),
                    note_title: "note".into(),
                    parent_id: None,
                    revision: "revision".into(),
                    schedule: crate::todo_sync::TodoSchedule::None,
                    status: crate::todo_sync::SnapshotStatus::Todo,
                    text: "a".repeat(160),
                    topic_title: "topic".into(),
                })
                .collect(),
            revision: "revision".into(),
        });
        assert!(matches!(
            encode(&oversized, 1),
            Err(PersistenceError::BlobTooLarge { .. })
        ));
    }

    #[test]
    fn wifi_password_is_write_only_and_redacted() {
        let mut config = DeviceConfig::default();
        config.wifi.ssid = Some("Office".into());
        config.wifi.set_password("super secret").unwrap();

        let debug = format!("{config:?}");
        let public = config.public();
        assert!(!debug.contains("super secret"));
        assert!(debug.contains("<redacted>"));
        assert!(public.wifi_password_is_set);
        assert_eq!(public.wifi_ssid.as_deref(), Some("Office"));
    }
}
