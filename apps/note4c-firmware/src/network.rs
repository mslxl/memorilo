use std::time::Duration;

#[cfg(target_os = "espidf")]
use serde::Deserialize;
use serde::Serialize;

use crate::framebuffer::FRAME_BYTES;
use crate::gallery::{GALLERY_CAPACITY_BYTES, GalleryAssetId, GalleryCatalog};
use crate::persistence::DeviceConfig;
use crate::todo_sync::{SnapshotSource, TodoSyncState};

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
pub const MAX_RETRY_DELAY: Duration = Duration::from_secs(5 * 60);
pub const MAX_MANAGEMENT_BODY_BYTES: usize = 1024;
pub const MAX_TODO_BODY_BYTES: usize = crate::todo_sync::MAX_SNAPSHOT_BYTES;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiNetworkInfo {
    pub ssid: String,
    pub rssi: i16,
    pub security: &'static str,
}

/// HTTP status classes used by the TODO transport. Keeping this mapping pure
/// makes the retry and authentication policy independently testable from the
/// ESP-IDF client implementation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TodoHttpStatusClass {
    NotModified,
    Success,
    Authentication(u16),
    RateLimited,
    Client(u16),
    Server(u16),
    Unexpected(u16),
}

pub fn classify_todo_http_status(status: u16) -> TodoHttpStatusClass {
    match status {
        200 => TodoHttpStatusClass::Success,
        304 => TodoHttpStatusClass::NotModified,
        401 | 403 => TodoHttpStatusClass::Authentication(status),
        429 => TodoHttpStatusClass::RateLimited,
        400..=499 => TodoHttpStatusClass::Client(status),
        500..=599 => TodoHttpStatusClass::Server(status),
        other => TodoHttpStatusClass::Unexpected(other),
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct NetworkConfiguration {
    ssid: String,
    password: String,
    timezone: String,
    management_token: Option<String>,
    todo_sync: crate::todo_sync::TodoSyncConfig,
}

impl std::fmt::Debug for NetworkConfiguration {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("NetworkConfiguration")
            .field("ssid", &self.ssid)
            .field("password", &"<redacted>")
            .field(
                "management_token",
                &self.management_token.as_ref().map(|_| "<redacted>"),
            )
            .field("todo_sync", &self.todo_sync)
            .finish()
    }
}

impl NetworkConfiguration {
    pub fn from_device_config(config: &DeviceConfig) -> Option<Self> {
        Some(Self {
            ssid: config.wifi.ssid.clone()?,
            password: config.wifi.password().unwrap_or_default().to_owned(),
            timezone: config.timezone.clone(),
            management_token: config.local_management.token().map(str::to_owned),
            todo_sync: config.todo_sync.clone(),
        })
    }

    pub fn has_local_management(&self) -> bool {
        self.management_token.is_some()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NetworkPhase {
    Disabled,
    Idle,
    Connecting,
    Online,
    Backoff,
    AuthenticationFailed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    pub phase: NetworkPhase,
    pub ipv4: Option<String>,
    pub time_synchronized: bool,
    pub mqtt_connected: bool,
    pub consecutive_failures: u8,
    pub retry_at_ms: Option<u64>,
}

impl Default for NetworkSnapshot {
    fn default() -> Self {
        Self {
            phase: NetworkPhase::Disabled,
            ipv4: None,
            time_synchronized: false,
            mqtt_connected: false,
            consecutive_failures: 0,
            retry_at_ms: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkFailure {
    Authentication,
    Dhcp,
    Transport,
    TimeSynchronization,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkAction {
    Connect { deadline: Duration },
    Disconnect,
    StartLocalManagement,
    StopLocalManagement,
}

pub struct NetworkPolicy {
    configured: bool,
    snapshot: NetworkSnapshot,
    retry_at: Option<Duration>,
}

impl NetworkPolicy {
    pub fn new(configured: bool) -> Self {
        Self {
            configured,
            snapshot: NetworkSnapshot {
                phase: if configured {
                    NetworkPhase::Idle
                } else {
                    NetworkPhase::Disabled
                },
                ..NetworkSnapshot::default()
            },
            retry_at: None,
        }
    }

    pub fn snapshot(&self) -> &NetworkSnapshot {
        &self.snapshot
    }

    pub fn start(&mut self, now: Duration) -> Vec<NetworkAction> {
        if !self.configured || self.snapshot.phase == NetworkPhase::Connecting {
            return Vec::new();
        }
        self.snapshot.phase = NetworkPhase::Connecting;
        self.snapshot.retry_at_ms = None;
        vec![NetworkAction::Connect {
            deadline: now + CONNECT_TIMEOUT,
        }]
    }

    pub fn reconfigure(&mut self, configured: bool, now: Duration) -> Vec<NetworkAction> {
        let was_active = matches!(
            self.snapshot.phase,
            NetworkPhase::Connecting | NetworkPhase::Online | NetworkPhase::Backoff
        );
        self.configured = configured;
        self.retry_at = None;
        self.snapshot = NetworkSnapshot {
            phase: if configured {
                NetworkPhase::Idle
            } else {
                NetworkPhase::Disabled
            },
            ..NetworkSnapshot::default()
        };

        let mut actions = Vec::new();
        if was_active {
            actions.push(NetworkAction::StopLocalManagement);
            actions.push(NetworkAction::Disconnect);
        }
        if configured {
            actions.extend(self.start(now));
        }
        actions
    }

    pub fn connected(&mut self, ipv4: impl Into<String>) -> Vec<NetworkAction> {
        self.retry_at = None;
        self.snapshot.phase = NetworkPhase::Online;
        self.snapshot.ipv4 = Some(ipv4.into());
        self.snapshot.consecutive_failures = 0;
        self.snapshot.retry_at_ms = None;
        vec![NetworkAction::StartLocalManagement]
    }

    pub fn time_synchronized(&mut self) {
        if self.snapshot.phase == NetworkPhase::Online {
            self.snapshot.time_synchronized = true;
        }
    }

    pub fn mqtt_connected(&mut self, connected: bool) {
        self.snapshot.mqtt_connected = connected;
    }

    pub fn failed(&mut self, failure: NetworkFailure, now: Duration) -> Vec<NetworkAction> {
        self.snapshot.ipv4 = None;
        self.snapshot.time_synchronized = false;
        self.snapshot.mqtt_connected = false;
        self.snapshot.consecutive_failures = self.snapshot.consecutive_failures.saturating_add(1);

        if failure == NetworkFailure::Authentication {
            self.retry_at = None;
            self.snapshot.phase = NetworkPhase::AuthenticationFailed;
            self.snapshot.retry_at_ms = None;
            return vec![
                NetworkAction::StopLocalManagement,
                NetworkAction::Disconnect,
            ];
        }

        let retry_delay = retry_delay(self.snapshot.consecutive_failures);
        let retry_at = now + retry_delay;
        self.retry_at = Some(retry_at);
        self.snapshot.phase = NetworkPhase::Backoff;
        self.snapshot.retry_at_ms = Some(duration_millis(retry_at));
        vec![
            NetworkAction::StopLocalManagement,
            NetworkAction::Disconnect,
        ]
    }

    pub fn poll(&mut self, now: Duration) -> Vec<NetworkAction> {
        if self.retry_at.is_none_or(|retry_at| now < retry_at) {
            return Vec::new();
        }
        self.retry_at = None;
        self.start(now)
    }
}

fn retry_delay(failures: u8) -> Duration {
    let exponent = u32::from(failures.saturating_sub(1).min(8));
    Duration::from_secs(5_u64.saturating_mul(1_u64 << exponent)).min(MAX_RETRY_DELAY)
}

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManagementMethod {
    Get,
    Post,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManagementRequest {
    Status,
    GalleryList,
    GalleryUpload,
    GalleryDelete,
    GalleryReorder,
    GallerySlideshow,
    Refresh,
    NextPage,
    Sleep,
    TodoGet,
    TodoPush,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManagementRequestError {
    AuthenticationRequired,
    BodyTooLarge,
    InvalidBody,
    NotFound,
    MethodNotAllowed,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GalleryMutation {
    Upload {
        name: String,
        created_at_unix_seconds: u64,
        bytes: Vec<u8>,
    },
    Delete {
        id: GalleryAssetId,
    },
    Reorder {
        order: Vec<GalleryAssetId>,
    },
    SetSlideshow {
        interval_seconds: Option<u32>,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryManagementSnapshot {
    pub catalog: GalleryCatalog,
    pub mutation_revision: u64,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoManagementSnapshot<'a> {
    pub snapshot: &'a Option<crate::todo_sync::TodoSnapshot>,
    pub revision: Option<&'a str>,
    pub source: Option<SnapshotSourceLabel>,
    pub last_success_unix_seconds: Option<i64>,
    pub last_error: &'a Option<String>,
    pub last_event: Option<crate::todo_sync::TodoSyncEvent>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotSourceLabel {
    ClientLanPush,
    MqttTriggeredHttps,
    PeriodicHttps,
}

impl From<SnapshotSource> for SnapshotSourceLabel {
    fn from(source: SnapshotSource) -> Self {
        match source {
            SnapshotSource::ClientLanPush => Self::ClientLanPush,
            SnapshotSource::MqttTriggeredHttps => Self::MqttTriggeredHttps,
            SnapshotSource::PeriodicHttps => Self::PeriodicHttps,
        }
    }
}

pub fn encode_todo_status(state: &TodoSyncState) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&TodoManagementSnapshot {
        snapshot: &state.snapshot,
        revision: state.revision.as_deref(),
        source: state.source.map(Into::into),
        last_success_unix_seconds: state.last_success_unix_seconds,
        last_error: &state.last_error,
        last_event: state.last_event,
    })
}

#[cfg(target_os = "espidf")]
#[derive(Deserialize)]
struct GalleryDeleteBody {
    id: GalleryAssetId,
}

#[cfg(target_os = "espidf")]
#[derive(Deserialize)]
struct GalleryReorderBody {
    order: Vec<GalleryAssetId>,
}

#[cfg(target_os = "espidf")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GallerySlideshowBody {
    interval_seconds: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryEnvelope<'a> {
    catalog: &'a GalleryCatalog,
    mutation_revision: u64,
    last_error: &'a Option<String>,
    capacity_bytes: usize,
    image_bytes: usize,
    max_assets: usize,
    full_refresh_seconds: u8,
}

pub fn encode_gallery_status(
    snapshot: &GalleryManagementSnapshot,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&GalleryEnvelope {
        catalog: &snapshot.catalog,
        mutation_revision: snapshot.mutation_revision,
        last_error: &snapshot.last_error,
        capacity_bytes: GALLERY_CAPACITY_BYTES,
        image_bytes: FRAME_BYTES,
        max_assets: crate::gallery::MAX_GALLERY_ASSETS,
        full_refresh_seconds: 20,
    })
}

pub fn decode_gallery_name_header(value: &str) -> Option<String> {
    if value.is_empty() || value.len() > 768 {
        return None;
    }
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_digit(*bytes.get(index + 1)?)?;
            let low = hex_digit(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    let decoded = String::from_utf8(decoded).ok()?;
    if decoded.is_empty() || decoded.chars().count() > 64 || decoded.chars().any(char::is_control) {
        return None;
    }
    Some(decoded)
}

const fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ManagementAudit {
    pub request: Option<ManagementRequest>,
    pub accepted: bool,
    pub error: Option<ManagementRequestError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagementStatusEnvelope<'a> {
    firmware_version: &'static str,
    uptime_ms: u64,
    network: &'a NetworkSnapshot,
}

pub fn encode_management_status(
    snapshot: &NetworkSnapshot,
    uptime: Duration,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&ManagementStatusEnvelope {
        firmware_version: env!("CARGO_PKG_VERSION"),
        uptime_ms: duration_millis(uptime),
        network: snapshot,
    })
}

pub fn management_queue_audit(audit: ManagementAudit, queued: bool) -> ManagementAudit {
    ManagementAudit {
        accepted: queued,
        error: (!queued).then_some(ManagementRequestError::Unavailable),
        ..audit
    }
}

pub fn parse_management_request(
    method: ManagementMethod,
    path: &str,
    content_length: usize,
    authorization: Option<&str>,
    expected_token: &str,
) -> Result<(ManagementRequest, ManagementAudit), ManagementAudit> {
    if !authorize_bearer(authorization, expected_token) {
        return Err(ManagementAudit {
            request: None,
            accepted: false,
            error: Some(ManagementRequestError::AuthenticationRequired),
        });
    }
    let expected_method = match path {
        "/v1/status" | "/v1/gallery" => ManagementMethod::Get,
        "/v1/todos" => method,
        _ => ManagementMethod::Post,
    };
    let request = match path {
        "/v1/status" => Some(ManagementRequest::Status),
        "/v1/gallery" => Some(ManagementRequest::GalleryList),
        "/v1/gallery/assets" => Some(ManagementRequest::GalleryUpload),
        "/v1/gallery/delete" => Some(ManagementRequest::GalleryDelete),
        "/v1/gallery/reorder" => Some(ManagementRequest::GalleryReorder),
        "/v1/gallery/slideshow" => Some(ManagementRequest::GallerySlideshow),
        "/v1/commands/refresh" => Some(ManagementRequest::Refresh),
        "/v1/commands/next-page" => Some(ManagementRequest::NextPage),
        "/v1/commands/sleep" => Some(ManagementRequest::Sleep),
        "/v1/todos" if method == ManagementMethod::Get => Some(ManagementRequest::TodoGet),
        "/v1/todos" if method == ManagementMethod::Post => Some(ManagementRequest::TodoPush),
        _ => None,
    };
    let Some(request) = request else {
        return Err(ManagementAudit {
            request: None,
            accepted: false,
            error: Some(ManagementRequestError::NotFound),
        });
    };
    if request == ManagementRequest::GalleryUpload && content_length != FRAME_BYTES {
        return Err(ManagementAudit {
            request: Some(request),
            accepted: false,
            error: Some(ManagementRequestError::InvalidBody),
        });
    }
    if request == ManagementRequest::TodoPush && content_length > MAX_TODO_BODY_BYTES {
        return Err(ManagementAudit {
            request: Some(request),
            accepted: false,
            error: Some(ManagementRequestError::BodyTooLarge),
        });
    }
    if request != ManagementRequest::GalleryUpload
        && request != ManagementRequest::TodoPush
        && content_length > MAX_MANAGEMENT_BODY_BYTES
    {
        return Err(ManagementAudit {
            request: Some(request),
            accepted: false,
            error: Some(ManagementRequestError::BodyTooLarge),
        });
    }
    if method != expected_method {
        return Err(ManagementAudit {
            request: Some(request),
            accepted: false,
            error: Some(ManagementRequestError::MethodNotAllowed),
        });
    }

    Ok((
        request,
        ManagementAudit {
            request: Some(request),
            accepted: true,
            error: None,
        },
    ))
}

pub fn authorize_bearer(authorization: Option<&str>, expected_token: &str) -> bool {
    let Some(provided) = authorization.and_then(|value| value.strip_prefix("Bearer ")) else {
        return false;
    };
    if expected_token.len() < 32 || provided.len() != expected_token.len() {
        return false;
    }
    provided
        .as_bytes()
        .iter()
        .zip(expected_token.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(target_os = "espidf")]
pub mod runtime {
    use std::sync::mpsc::{Receiver, SyncSender, TryRecvError, sync_channel};
    use std::sync::{Arc, RwLock};
    use std::thread;
    use std::time::Duration;

    use anyhow::{Context, Result};
    use esp_idf_svc::eventloop::EspSystemEventLoop;
    use esp_idf_svc::http::Method;
    use esp_idf_svc::http::client::{
        Configuration as HttpClientConfiguration, EspHttpConnection as EspHttpClientConnection,
        FollowRedirectsPolicy,
    };
    use esp_idf_svc::http::server::{
        Configuration as HttpConfiguration, EspHttpConnection, EspHttpServer, Request,
    };
    use esp_idf_svc::io::{Read, Write};
    use esp_idf_svc::mqtt::client::{EspMqttClient, EventPayload, MqttClientConfiguration, QoS};
    use esp_idf_svc::sntp::{EspSntp, SyncStatus};
    use esp_idf_svc::wifi::{AuthMethod, ClientConfiguration, Configuration, EspWifi, WifiEvent};
    use prost::Message;

    use super::{
        FRAME_BYTES, GalleryDeleteBody, GalleryManagementSnapshot, GalleryMutation,
        GalleryReorderBody, GallerySlideshowBody, ManagementAudit, ManagementMethod,
        ManagementRequest, ManagementRequestError, NetworkAction, NetworkConfiguration,
        NetworkFailure, NetworkPhase, NetworkPolicy, NetworkSnapshot, WifiNetworkInfo,
        decode_gallery_name_header, encode_gallery_status, encode_management_status,
        encode_todo_status, management_queue_audit, parse_management_request,
    };
    use crate::todo_sync::{MAX_SNAPSHOT_BYTES, SnapshotSource, TodoSyncState};

    const POLL_INTERVAL: Duration = Duration::from_millis(100);

    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum NetworkRuntimeEvent {
        Snapshot(NetworkSnapshot),
        Management(ManagementRequest),
        Gallery(GalleryMutation),
        TodoSnapshot {
            body: Vec<u8>,
            source: SnapshotSource,
            etag: Option<String>,
        },
        TodoNotModified {
            source: SnapshotSource,
            etag: Option<String>,
        },
        TodoNotification,
        TodoError {
            source: SnapshotSource,
            message: String,
        },
        Audit(ManagementAudit),
        Failed(&'static str),
        Stopped,
    }

    enum NetworkRuntimeCommand {
        Reconfigure(Option<NetworkConfiguration>),
        ScanWifi(SyncSender<Result<Vec<WifiNetworkInfo>>>),
        Shutdown,
    }

    #[derive(Clone, Copy)]
    enum MqttSignal {
        Connected,
        Disconnected,
        Update,
    }

    struct TodoPullRequest {
        generation: u64,
        source: SnapshotSource,
        settings: crate::todo_sync::TodoSyncConfig,
        etag: Option<String>,
        timezone: String,
    }

    struct TodoPullResponse {
        generation: u64,
        source: SnapshotSource,
        result: std::result::Result<TodoPull, TodoPullError>,
    }

    pub struct NetworkRuntime {
        command_tx: SyncSender<NetworkRuntimeCommand>,
        event_rx: Receiver<NetworkRuntimeEvent>,
        gallery: Arc<RwLock<GalleryManagementSnapshot>>,
        todos: Arc<RwLock<TodoSyncState>>,
    }

    impl NetworkRuntime {
        pub fn spawn(
            wifi: EspWifi<'static>,
            system_loop: EspSystemEventLoop,
            initial: Option<NetworkConfiguration>,
            initial_gallery: crate::gallery::GalleryCatalog,
        ) -> Result<Self> {
            let (command_tx, command_rx) = sync_channel(4);
            let (event_tx, event_rx) = sync_channel(16);
            let gallery = Arc::new(RwLock::new(GalleryManagementSnapshot {
                catalog: initial_gallery,
                ..GalleryManagementSnapshot::default()
            }));
            let runtime_gallery = Arc::clone(&gallery);
            let todos = Arc::new(RwLock::new(TodoSyncState::default()));
            let runtime_todos = Arc::clone(&todos);
            thread::Builder::new()
                .name("memorilo-network".into())
                .stack_size(12 * 1024)
                .spawn(move || {
                    if let Err(error) = run_network(
                        wifi,
                        system_loop,
                        initial,
                        command_rx,
                        &event_tx,
                        runtime_gallery,
                        runtime_todos,
                    ) {
                        log::error!("network service stopped unexpectedly: {error:#}");
                        let _ = event_tx.send(NetworkRuntimeEvent::Failed("network-runtime"));
                    }
                    let _ = event_tx.send(NetworkRuntimeEvent::Stopped);
                })
                .context("network service thread creation failed")?;
            Ok(Self {
                command_tx,
                event_rx,
                gallery,
                todos,
            })
        }

        pub fn reconfigure(&self, config: Option<NetworkConfiguration>) -> Result<()> {
            self.command_tx
                .send(NetworkRuntimeCommand::Reconfigure(config))
                .context("network service command channel closed")
        }

        pub fn shutdown(&self) -> Result<()> {
            self.command_tx
                .send(NetworkRuntimeCommand::Shutdown)
                .context("network service command channel closed")
        }

        pub fn scan_wifi(&self) -> Result<Vec<WifiNetworkInfo>> {
            let (result_tx, result_rx) = sync_channel(1);
            self.command_tx
                .send(NetworkRuntimeCommand::ScanWifi(result_tx))
                .context("network service command channel closed")?;
            result_rx
                .recv_timeout(Duration::from_secs(15))
                .context("Wi-Fi scan timed out")?
        }

        pub fn try_recv(&self) -> Result<Option<NetworkRuntimeEvent>> {
            match self.event_rx.try_recv() {
                Ok(event) => Ok(Some(event)),
                Err(TryRecvError::Empty) => Ok(None),
                Err(TryRecvError::Disconnected) => {
                    anyhow::bail!("network service event channel closed")
                }
            }
        }

        pub fn publish_gallery(
            &self,
            catalog: crate::gallery::GalleryCatalog,
            last_error: Option<String>,
        ) -> Result<()> {
            let mut snapshot = self
                .gallery
                .write()
                .map_err(|_| anyhow::anyhow!("gallery status lock poisoned"))?;
            snapshot.catalog = catalog;
            snapshot.mutation_revision = snapshot.mutation_revision.saturating_add(1);
            snapshot.last_error = last_error;
            Ok(())
        }

        pub fn publish_todos(&self, state: TodoSyncState) -> Result<()> {
            *self
                .todos
                .write()
                .map_err(|_| anyhow::anyhow!("todo status lock poisoned"))? = state;
            Ok(())
        }
    }

    fn run_network(
        mut wifi: EspWifi<'static>,
        system_loop: EspSystemEventLoop,
        mut config: Option<NetworkConfiguration>,
        command_rx: Receiver<NetworkRuntimeCommand>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
        shared_gallery: Arc<RwLock<GalleryManagementSnapshot>>,
        shared_todos: Arc<RwLock<TodoSyncState>>,
    ) -> Result<()> {
        let (disconnect_tx, disconnect_rx) = sync_channel(8);
        let _wifi_subscription = system_loop
            .subscribe::<WifiEvent, _>(move |event| {
                if let WifiEvent::StaDisconnected(disconnected) = event {
                    let _ = disconnect_tx.try_send(disconnected.reason());
                }
            })
            .context("Wi-Fi event subscription failed")?;
        let mut policy = NetworkPolicy::new(config.is_some());
        let mut connect_deadline = None;
        let mut sntp: Option<EspSntp<'static>> = None;
        let mut management_server: Option<EspHttpServer<'static>> = None;
        let (mqtt_tx, mqtt_rx) = sync_channel(8);
        let mut mqtt_client: Option<EspMqttClient<'static>> = None;
        let mut next_todo_pull: Option<Duration> = None;
        let mut todo_etag: Option<String> = None;
        let mut todo_pull_generation = 0_u64;
        let mut todo_pull_in_flight = false;
        let mut todo_retry_attempt = 0_u8;
        let (todo_pull_tx, todo_pull_rx) = sync_channel::<TodoPullRequest>(1);
        let (todo_result_tx, todo_result_rx) = sync_channel::<TodoPullResponse>(2);
        thread::Builder::new()
            .name("memorilo-todo-fetch".into())
            .stack_size(12 * 1024)
            .spawn(move || {
                while let Ok(request) = todo_pull_rx.recv() {
                    let result = pull_todo_snapshot(
                        &request.settings,
                        request.etag.as_deref(),
                        &request.timezone,
                    );
                    if todo_result_tx
                        .send(TodoPullResponse {
                            generation: request.generation,
                            source: request.source,
                            result,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            })
            .context("TODO fetch worker creation failed")?;
        let shared_snapshot = Arc::new(RwLock::new(policy.snapshot().clone()));

        publish_snapshot(&policy, &shared_snapshot, event_tx)?;
        execute_actions(
            &mut wifi,
            config.as_ref(),
            policy.start(crate::diagnostics::uptime()),
            &mut connect_deadline,
            &mut sntp,
            &mut management_server,
            &shared_snapshot,
            &shared_gallery,
            &shared_todos,
            event_tx,
        )?;
        publish_snapshot(&policy, &shared_snapshot, event_tx)?;

        loop {
            match command_rx.recv_timeout(POLL_INTERVAL) {
                Ok(NetworkRuntimeCommand::Reconfigure(next)) => {
                    todo_pull_generation = todo_pull_generation.saturating_add(1);
                    next_todo_pull = Some(crate::diagnostics::uptime());
                    todo_etag = None;
                    todo_retry_attempt = 0;
                    config = next;
                    let actions =
                        policy.reconfigure(config.is_some(), crate::diagnostics::uptime());
                    execute_actions(
                        &mut wifi,
                        config.as_ref(),
                        actions,
                        &mut connect_deadline,
                        &mut sntp,
                        &mut management_server,
                        &shared_snapshot,
                        &shared_gallery,
                        &shared_todos,
                        event_tx,
                    )?;
                    publish_snapshot(&policy, &shared_snapshot, event_tx)?;
                }
                Ok(NetworkRuntimeCommand::ScanWifi(result_tx)) => {
                    if !wifi.is_started().unwrap_or(false) {
                        // ESP-IDF requires a station configuration before the radio can start,
                        // even when the caller only wants passive network discovery.
                        if let Err(error) = wifi.set_configuration(&Configuration::Client(
                            ClientConfiguration::default(),
                        )) {
                            log::warn!("wifi scan configuration failed: {error}");
                            let _ = result_tx.send(Err(anyhow::Error::from(error)));
                            continue;
                        }
                        if let Err(error) = wifi.start() {
                            log::warn!("wifi scan radio start failed: {error}");
                            let _ = result_tx.send(Err(anyhow::Error::from(error)));
                            continue;
                        }
                    }
                    log::info!("wifi scan started");
                    let result = wifi
                        .scan()
                        .map_err(anyhow::Error::from)
                        .map(|access_points| {
                            access_points
                                .into_iter()
                                .filter_map(|ap| {
                                    let ssid = ap.ssid.trim_end_matches('\0').to_owned();
                                    if ssid.is_empty() {
                                        return None;
                                    }
                                    Some(WifiNetworkInfo {
                                        ssid,
                                        rssi: i16::from(ap.signal_strength),
                                        security: if ap.auth_method == Some(AuthMethod::None) {
                                            "open"
                                        } else {
                                            "secured"
                                        },
                                    })
                                })
                                .take(12)
                                .collect()
                        });
                    if let Err(error) = &result {
                        log::warn!("wifi scan failed: {error}");
                    }
                    let _ = result_tx.send(result);
                }
                Ok(NetworkRuntimeCommand::Shutdown) => {
                    disconnect(&mut wifi, &mut sntp, &mut management_server);
                    return Ok(());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    disconnect(&mut wifi, &mut sntp, &mut management_server);
                    return Ok(());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            }

            let now = crate::diagnostics::uptime();
            while let Ok(response) = todo_result_rx.try_recv() {
                todo_pull_in_flight = false;
                if response.generation != todo_pull_generation {
                    continue;
                }
                match response.result {
                    Ok(TodoPull::Snapshot { body, etag }) => {
                        todo_retry_attempt = 0;
                        todo_etag = etag.clone();
                        let _ = event_tx.try_send(NetworkRuntimeEvent::TodoSnapshot {
                            body,
                            source: response.source,
                            etag,
                        });
                    }
                    Ok(TodoPull::NotModified { etag }) => {
                        todo_retry_attempt = 0;
                        todo_etag = etag.clone().or(todo_etag);
                        let _ = event_tx.try_send(NetworkRuntimeEvent::TodoNotModified {
                            source: response.source,
                            etag,
                        });
                    }
                    Err(error) => {
                        let message = error.to_string();
                        if matches!(error, TodoPullError::Authentication(_)) {
                            // Credentials need BLE replacement; avoid hammering the server.
                            next_todo_pull = Some(now + crate::todo_sync::MAX_POLL_INTERVAL);
                        } else {
                            let exponent = u32::from(todo_retry_attempt.min(6));
                            let base =
                                Duration::from_secs(5_u64 << exponent).min(super::MAX_RETRY_DELAY);
                            let jitter = Duration::from_millis((now.as_millis() % 1_000) as u64);
                            let delay = (base + jitter).min(super::MAX_RETRY_DELAY);
                            todo_retry_attempt = todo_retry_attempt.saturating_add(1);
                            next_todo_pull = Some(now + delay);
                        }
                        let _ = event_tx.try_send(NetworkRuntimeEvent::TodoError {
                            source: response.source,
                            message,
                        });
                    }
                }
            }
            let mut failure = None;
            while let Ok(reason) = disconnect_rx.try_recv() {
                if matches!(
                    policy.snapshot().phase,
                    NetworkPhase::Connecting | NetworkPhase::Online
                ) {
                    failure = Some(if is_authentication_reason(reason) {
                        NetworkFailure::Authentication
                    } else {
                        NetworkFailure::Transport
                    });
                }
            }
            if failure.is_none()
                && policy.snapshot().phase == NetworkPhase::Connecting
                && wifi.is_up().unwrap_or(false)
            {
                let ipv4 = wifi
                    .sta_netif()
                    .get_ip_info()
                    .map(|info| info.ip.to_string())
                    .unwrap_or_else(|_| "unavailable".into());
                let actions = policy.connected(ipv4);
                execute_actions(
                    &mut wifi,
                    config.as_ref(),
                    actions,
                    &mut connect_deadline,
                    &mut sntp,
                    &mut management_server,
                    &shared_snapshot,
                    &shared_gallery,
                    &shared_todos,
                    event_tx,
                )?;
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            } else if failure.is_none() && connect_deadline.is_some_and(|deadline| now >= deadline)
            {
                failure = Some(NetworkFailure::Transport);
            }
            if let Some(failure) = failure {
                mqtt_client = None;
                next_todo_pull = None;
                todo_pull_generation = todo_pull_generation.saturating_add(1);
                let actions = policy.failed(failure, now);
                execute_actions(
                    &mut wifi,
                    config.as_ref(),
                    actions,
                    &mut connect_deadline,
                    &mut sntp,
                    &mut management_server,
                    &shared_snapshot,
                    &shared_gallery,
                    &shared_todos,
                    event_tx,
                )?;
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            }

            if policy.snapshot().phase == NetworkPhase::Online {
                if mqtt_client.is_none() {
                    if let Some(settings) = config.as_ref().map(|value| &value.todo_sync)
                        && settings.enabled
                        && settings.has_https_source()
                        && let (Some(broker), Some(_)) =
                            (&settings.mqtt_broker_url, &settings.mqtt_topic)
                    {
                        let signals = mqtt_tx.clone();
                        let mqtt_config = MqttClientConfiguration {
                            crt_bundle_attach: Some(esp_idf_sys::esp_crt_bundle_attach),
                            network_timeout: Duration::from_secs(10),
                            reconnect_timeout: Some(Duration::from_secs(5)),
                            username: settings.mqtt_username.as_deref(),
                            password: settings.mqtt_password(),
                            ..MqttClientConfiguration::default()
                        };
                        match EspMqttClient::new_cb(broker, &mqtt_config, move |event| match event
                            .payload()
                        {
                            EventPayload::Connected(_) => {
                                let _ = signals.try_send(MqttSignal::Connected);
                            }
                            EventPayload::Disconnected => {
                                let _ = signals.try_send(MqttSignal::Disconnected);
                            }
                            EventPayload::Received { .. } => {
                                let _ = signals.try_send(MqttSignal::Update);
                            }
                            _ => {}
                        }) {
                            Ok(client) => mqtt_client = Some(client),
                            Err(error) => log::warn!("MQTT setup failed: {error}"),
                        }
                    }
                }
                while let Ok(signal) = mqtt_rx.try_recv() {
                    match signal {
                        MqttSignal::Disconnected => {
                            policy.mqtt_connected(false);
                            publish_snapshot(&policy, &shared_snapshot, event_tx)?;
                        }
                        MqttSignal::Connected => {
                            policy.mqtt_connected(true);
                            publish_snapshot(&policy, &shared_snapshot, event_tx)?;
                            if let (Some(client), Some(topic)) = (
                                mqtt_client.as_mut(),
                                config
                                    .as_ref()
                                    .and_then(|value| value.todo_sync.mqtt_topic.as_deref()),
                            ) {
                                if let Err(error) = client.subscribe(topic, QoS::AtLeastOnce) {
                                    log::warn!("MQTT subscribe failed: {error}");
                                }
                            }
                        }
                        MqttSignal::Update => {
                            next_todo_pull = Some(now);
                            let _ = event_tx.try_send(NetworkRuntimeEvent::TodoNotification);
                        }
                    }
                }
                if let Some(settings) = config.as_ref().map(|value| &value.todo_sync)
                    && settings.enabled
                    && settings.has_https_source()
                    && !todo_pull_in_flight
                    && next_todo_pull.is_none_or(|deadline| now >= deadline)
                {
                    let source = if next_todo_pull == Some(now) {
                        SnapshotSource::MqttTriggeredHttps
                    } else {
                        SnapshotSource::PeriodicHttps
                    };
                    let request = TodoPullRequest {
                        generation: todo_pull_generation,
                        source,
                        settings: settings.clone(),
                        etag: todo_etag.clone(),
                        timezone: config
                            .as_ref()
                            .map(|value| value.timezone.clone())
                            .unwrap_or_else(|| "UTC".into()),
                    };
                    match todo_pull_tx.try_send(request) {
                        Ok(()) => {
                            todo_pull_in_flight = true;
                            next_todo_pull = Some(
                                now + Duration::from_secs(u64::from(
                                    settings.poll_interval_seconds,
                                )),
                            );
                        }
                        Err(std::sync::mpsc::TrySendError::Full(_)) => {
                            log::debug!("TODO fetch worker is busy; keeping the next pull due");
                            next_todo_pull = Some(now);
                        }
                        Err(std::sync::mpsc::TrySendError::Disconnected(_)) => {
                            anyhow::bail!("TODO fetch worker channel closed");
                        }
                    }
                }
            }

            if policy.snapshot().phase == NetworkPhase::Online
                && !policy.snapshot().time_synchronized
                && sntp
                    .as_ref()
                    .is_some_and(|service| service.get_sync_status() == SyncStatus::Completed)
            {
                policy.time_synchronized();
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            }

            let actions = policy.poll(now);
            if !actions.is_empty() {
                execute_actions(
                    &mut wifi,
                    config.as_ref(),
                    actions,
                    &mut connect_deadline,
                    &mut sntp,
                    &mut management_server,
                    &shared_snapshot,
                    &shared_gallery,
                    &shared_todos,
                    event_tx,
                )?;
                publish_snapshot(&policy, &shared_snapshot, event_tx)?;
            }
        }
    }

    fn publish_snapshot(
        policy: &NetworkPolicy,
        shared_snapshot: &Arc<RwLock<NetworkSnapshot>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        let snapshot = policy.snapshot().clone();
        *shared_snapshot
            .write()
            .map_err(|_| anyhow::anyhow!("network status lock poisoned"))? = snapshot.clone();
        event_tx.send(NetworkRuntimeEvent::Snapshot(snapshot))?;
        Ok(())
    }

    enum TodoPull {
        Snapshot { body: Vec<u8>, etag: Option<String> },
        NotModified { etag: Option<String> },
    }

    #[derive(Debug)]
    enum TodoPullError {
        Authentication(u16),
        RateLimited,
        Client(String),
        Server(u16),
        Transport(String),
    }

    impl std::fmt::Display for TodoPullError {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                Self::Authentication(status) => {
                    write!(formatter, "TODO endpoint returned HTTP {status}")
                }
                Self::RateLimited => formatter.write_str("TODO endpoint returned HTTP 429"),
                Self::Client(message) => formatter.write_str(message),
                Self::Server(status) => write!(formatter, "TODO endpoint returned HTTP {status}"),
                Self::Transport(message) => formatter.write_str(message),
            }
        }
    }

    impl std::error::Error for TodoPullError {}

    impl From<anyhow::Error> for TodoPullError {
        fn from(error: anyhow::Error) -> Self {
            Self::Transport(error.to_string())
        }
    }

    fn pull_todo_snapshot(
        settings: &crate::todo_sync::TodoSyncConfig,
        etag: Option<&str>,
        timezone: &str,
    ) -> std::result::Result<TodoPull, TodoPullError> {
        let token = settings
            .device_token()
            .ok_or(TodoPullError::Authentication(401))?;
        let view = match settings.view {
            crate::todo_sync::TodoView::Today => "today",
            crate::todo_sync::TodoView::All => "all",
        };
        let date = local_sync_date(timezone);
        let url = format!(
            "{}/api/device/v1/todos?view={view}&date={date}&limit=64",
            settings.https_base_url.trim_end_matches('/')
        );
        let authorization = format!("Bearer {token}");
        let mut headers = vec![
            ("Authorization", authorization.as_str()),
            ("Accept", "application/x-protobuf"),
        ];
        if let Some(etag) = etag {
            headers.push(("If-None-Match", etag));
        }
        let config = HttpClientConfiguration {
            timeout: Some(Duration::from_secs(15)),
            follow_redirects_policy: FollowRedirectsPolicy::FollowNone,
            crt_bundle_attach: Some(esp_idf_sys::esp_crt_bundle_attach),
            ..HttpClientConfiguration::default()
        };
        let mut connection = EspHttpClientConnection::new(&config)
            .map_err(|error| TodoPullError::Transport(error.to_string()))?;
        connection
            .initiate_request(Method::Get, &url, &headers)
            .map_err(|error| TodoPullError::Transport(error.to_string()))?;
        connection
            .initiate_response()
            .map_err(|error| TodoPullError::Transport(error.to_string()))?;
        let status = connection.status();
        let response_etag = connection.header("etag").map(str::to_owned);
        match super::classify_todo_http_status(status as u16) {
            super::TodoHttpStatusClass::NotModified => {
                return Ok(TodoPull::NotModified {
                    etag: response_etag,
                });
            }
            super::TodoHttpStatusClass::Success => {}
            super::TodoHttpStatusClass::Authentication(status) => {
                return Err(TodoPullError::Authentication(status));
            }
            super::TodoHttpStatusClass::RateLimited => {
                return Err(TodoPullError::RateLimited);
            }
            super::TodoHttpStatusClass::Client(status)
            | super::TodoHttpStatusClass::Unexpected(status) => {
                return Err(TodoPullError::Client(format!(
                    "TODO endpoint returned HTTP {status}"
                )));
            }
            super::TodoHttpStatusClass::Server(status) => {
                return Err(TodoPullError::Server(status));
            }
        }
        let mut body = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = connection
                .read(&mut chunk)
                .map_err(|error| TodoPullError::Transport(error.to_string()))?;
            if read == 0 {
                break;
            }
            if body.len() + read > MAX_SNAPSHOT_BYTES {
                return Err(TodoPullError::Client(
                    "TODO snapshot exceeds size limit".into(),
                ));
            }
            body.extend_from_slice(&chunk[..read]);
        }
        Ok(TodoPull::Snapshot {
            body,
            etag: response_etag,
        })
    }

    fn local_sync_date(timezone: &str) -> String {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        // The server accepts an explicit date. UTC is also the device's
        // fallback before a user-configured timezone has been applied.
        let offset_minutes = match timezone {
            "UTC" | "Etc/UTC" | "Europe/London" => 0,
            "Asia/Shanghai" | "Asia/Singapore" | "Asia/Taipei" => 480,
            "Asia/Tokyo" | "Asia/Seoul" => 540,
            "America/Los_Angeles" => -480,
            "America/New_York" => -300,
            _ => 0,
        };
        let days = seconds
            .saturating_add(i64::from(offset_minutes) * 60)
            .div_euclid(86_400);
        let (year, month, day) = civil_date_from_days(days);
        format!("{year:04}-{month:02}-{day:02}")
    }

    fn civil_date_from_days(days: i64) -> (i32, u8, u8) {
        let days = days + 719_468;
        let era = days.div_euclid(146_097);
        let day_of_era = days - era * 146_097;
        let year_of_era =
            (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
        let mut year = year_of_era + era * 400;
        let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let month_prime = (5 * day_of_year + 2) / 153;
        let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
        let month = month_prime + if month_prime < 10 { 3 } else { -9 };
        year += i64::from(month <= 2);
        (year as i32, month as u8, day as u8)
    }

    fn execute_actions(
        wifi: &mut EspWifi<'static>,
        config: Option<&NetworkConfiguration>,
        actions: Vec<NetworkAction>,
        connect_deadline: &mut Option<Duration>,
        sntp: &mut Option<EspSntp<'static>>,
        management_server: &mut Option<EspHttpServer<'static>>,
        shared_snapshot: &Arc<RwLock<NetworkSnapshot>>,
        shared_gallery: &Arc<RwLock<GalleryManagementSnapshot>>,
        shared_todos: &Arc<RwLock<TodoSyncState>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        for action in actions {
            match action {
                NetworkAction::Connect { deadline } => {
                    let config =
                        config.context("network connect requested without configuration")?;
                    let client = ClientConfiguration {
                        ssid: config
                            .ssid
                            .as_str()
                            .try_into()
                            .context("invalid Wi-Fi SSID")?,
                        password: config
                            .password
                            .as_str()
                            .try_into()
                            .context("invalid Wi-Fi password")?,
                        auth_method: if config.password.is_empty() {
                            AuthMethod::None
                        } else {
                            AuthMethod::WPA2Personal
                        },
                        ..ClientConfiguration::default()
                    };
                    let was_started = wifi.is_started().unwrap_or(false);
                    if was_started {
                        let _ = wifi.disconnect();
                    }
                    wifi.set_configuration(&Configuration::Client(client))?;
                    if !was_started {
                        wifi.start()?;
                    }
                    wifi.connect()?;
                    *connect_deadline = Some(deadline);
                    log::info!("Wi-Fi connection attempt started ssid={}", config.ssid);
                }
                NetworkAction::Disconnect => {
                    disconnect(wifi, sntp, management_server);
                    *connect_deadline = None;
                }
                NetworkAction::StartLocalManagement => {
                    if sntp.is_none() {
                        *sntp = Some(EspSntp::new_default()?);
                        log::info!("SNTP synchronization started");
                    }
                    if management_server.is_none()
                        && let Some(token) =
                            config.and_then(|config| config.management_token.clone())
                    {
                        *management_server = Some(start_management_server(
                            token,
                            Arc::clone(shared_snapshot),
                            Arc::clone(shared_gallery),
                            Arc::clone(shared_todos),
                            event_tx.clone(),
                        )?);
                        log::info!("authenticated local management started");
                    }
                }
                NetworkAction::StopLocalManagement => {
                    *sntp = None;
                    *management_server = None;
                }
            }
        }
        Ok(())
    }

    fn disconnect(
        wifi: &mut EspWifi<'static>,
        sntp: &mut Option<EspSntp<'static>>,
        management_server: &mut Option<EspHttpServer<'static>>,
    ) {
        *sntp = None;
        *management_server = None;
        if wifi.is_connected().unwrap_or(false) {
            let _ = wifi.disconnect();
        }
    }

    fn is_authentication_reason(reason: u16) -> bool {
        matches!(reason, 2 | 15 | 202 | 204)
    }

    fn start_management_server(
        token: String,
        shared_snapshot: Arc<RwLock<NetworkSnapshot>>,
        shared_gallery: Arc<RwLock<GalleryManagementSnapshot>>,
        shared_todos: Arc<RwLock<TodoSyncState>>,
        event_tx: SyncSender<NetworkRuntimeEvent>,
    ) -> Result<EspHttpServer<'static>> {
        let mut server = EspHttpServer::new(&HttpConfiguration {
            stack_size: 8 * 1024,
            ..HttpConfiguration::default()
        })?;
        register_endpoint(
            &mut server,
            "/v1/status",
            Method::Get,
            ManagementMethod::Get,
            ManagementRequest::Status,
            &token,
            Some(&shared_snapshot),
            None,
            None,
            &event_tx,
        )?;
        register_endpoint(
            &mut server,
            "/v1/gallery",
            Method::Get,
            ManagementMethod::Get,
            ManagementRequest::GalleryList,
            &token,
            None,
            Some(&shared_gallery),
            None,
            &event_tx,
        )?;
        register_endpoint(
            &mut server,
            "/v1/todos",
            Method::Get,
            ManagementMethod::Get,
            ManagementRequest::TodoGet,
            &token,
            None,
            None,
            Some(&shared_todos),
            &event_tx,
        )?;
        register_endpoint(
            &mut server,
            "/v1/todos",
            Method::Post,
            ManagementMethod::Post,
            ManagementRequest::TodoPush,
            &token,
            None,
            None,
            None,
            &event_tx,
        )?;
        register_endpoint(
            &mut server,
            "/v1/gallery/assets",
            Method::Post,
            ManagementMethod::Post,
            ManagementRequest::GalleryUpload,
            &token,
            None,
            None,
            None,
            &event_tx,
        )?;
        for (path, request) in [
            ("/v1/gallery/delete", ManagementRequest::GalleryDelete),
            ("/v1/gallery/reorder", ManagementRequest::GalleryReorder),
            ("/v1/gallery/slideshow", ManagementRequest::GallerySlideshow),
        ] {
            register_endpoint(
                &mut server,
                path,
                Method::Post,
                ManagementMethod::Post,
                request,
                &token,
                None,
                None,
                None,
                &event_tx,
            )?;
        }
        for (path, request) in [
            ("/v1/commands/refresh", ManagementRequest::Refresh),
            ("/v1/commands/next-page", ManagementRequest::NextPage),
            ("/v1/commands/sleep", ManagementRequest::Sleep),
        ] {
            register_endpoint(
                &mut server,
                path,
                Method::Post,
                ManagementMethod::Post,
                request,
                &token,
                None,
                None,
                None,
                &event_tx,
            )?;
        }
        Ok(server)
    }

    #[allow(clippy::too_many_arguments)]
    fn register_endpoint(
        server: &mut EspHttpServer<'static>,
        path: &'static str,
        http_method: Method,
        management_method: ManagementMethod,
        expected_request: ManagementRequest,
        token: &str,
        shared_snapshot: Option<&Arc<RwLock<NetworkSnapshot>>>,
        shared_gallery: Option<&Arc<RwLock<GalleryManagementSnapshot>>>,
        shared_todos: Option<&Arc<RwLock<TodoSyncState>>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        let token = token.to_owned();
        let shared_snapshot = shared_snapshot.cloned();
        let shared_gallery = shared_gallery.cloned();
        let shared_todos = shared_todos.cloned();
        let event_tx = event_tx.clone();
        server.fn_handler::<anyhow::Error, _>(
            http_method_path(path),
            http_method,
            move |request| {
                handle_http_request(
                    request,
                    path,
                    management_method,
                    expected_request,
                    &token,
                    shared_snapshot.as_ref(),
                    shared_gallery.as_ref(),
                    shared_todos.as_ref(),
                    &event_tx,
                )
            },
        )?;
        Ok(())
    }

    const fn http_method_path(path: &'static str) -> &'static str {
        path
    }

    fn handle_http_request(
        mut request: Request<&mut EspHttpConnection<'_>>,
        path: &'static str,
        method: ManagementMethod,
        expected_request: ManagementRequest,
        token: &str,
        shared_snapshot: Option<&Arc<RwLock<NetworkSnapshot>>>,
        shared_gallery: Option<&Arc<RwLock<GalleryManagementSnapshot>>>,
        shared_todos: Option<&Arc<RwLock<TodoSyncState>>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
    ) -> Result<()> {
        let content_length = request
            .header("Content-Length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let authorization = request.header("Authorization");
        match parse_management_request(method, path, content_length, authorization, token) {
            Ok((parsed, audit)) if parsed == expected_request => {
                if parsed == ManagementRequest::Status {
                    let Some(shared_snapshot) = shared_snapshot else {
                        anyhow::bail!("status endpoint registered without status state");
                    };
                    let snapshot = shared_snapshot
                        .read()
                        .map_err(|_| anyhow::anyhow!("network status lock poisoned"))?;
                    let body = encode_management_status(&snapshot, crate::diagnostics::uptime())?;
                    let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(audit));
                    request.into_status_response(200)?.write_all(&body)?;
                    return Ok(());
                }
                if parsed == ManagementRequest::GalleryList {
                    let Some(shared_gallery) = shared_gallery else {
                        anyhow::bail!("gallery endpoint registered without gallery state");
                    };
                    let snapshot = shared_gallery
                        .read()
                        .map_err(|_| anyhow::anyhow!("gallery status lock poisoned"))?;
                    let body = encode_gallery_status(&snapshot)?;
                    let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(audit));
                    request.into_status_response(200)?.write_all(&body)?;
                    return Ok(());
                }
                if parsed == ManagementRequest::TodoGet {
                    let Some(shared_todos) = shared_todos else {
                        anyhow::bail!("todo endpoint registered without todo state");
                    };
                    let state = shared_todos
                        .read()
                        .map_err(|_| anyhow::anyhow!("todo status lock poisoned"))?;
                    let body = encode_todo_status(&state)?;
                    let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(audit));
                    request.into_status_response(200)?.write_all(&body)?;
                    return Ok(());
                }
                let event = match parsed {
                    ManagementRequest::GalleryUpload => {
                        let Some(name) = request
                            .header("X-Memorilo-Asset-Name")
                            .and_then(decode_gallery_name_header)
                        else {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        };
                        let created_at_unix_seconds = request
                            .header("X-Memorilo-Created-At")
                            .and_then(|value| value.parse::<u64>().ok())
                            .unwrap_or(0);
                        let mut bytes = vec![0_u8; FRAME_BYTES];
                        if request.read_exact(&mut bytes).is_err() {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        }
                        NetworkRuntimeEvent::Gallery(GalleryMutation::Upload {
                            name,
                            created_at_unix_seconds,
                            bytes,
                        })
                    }
                    ManagementRequest::GalleryDelete
                    | ManagementRequest::GalleryReorder
                    | ManagementRequest::GallerySlideshow => {
                        let mut body = vec![0_u8; content_length];
                        if request.read_exact(&mut body).is_err() {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        }
                        let mutation = match parsed {
                            ManagementRequest::GalleryDelete => {
                                serde_json::from_slice::<GalleryDeleteBody>(&body)
                                    .map(|body| GalleryMutation::Delete { id: body.id })
                            }
                            ManagementRequest::GalleryReorder => {
                                serde_json::from_slice::<GalleryReorderBody>(&body)
                                    .map(|body| GalleryMutation::Reorder { order: body.order })
                            }
                            ManagementRequest::GallerySlideshow => {
                                serde_json::from_slice::<GallerySlideshowBody>(&body).map(|body| {
                                    GalleryMutation::SetSlideshow {
                                        interval_seconds: body.interval_seconds,
                                    }
                                })
                            }
                            _ => unreachable!(),
                        };
                        let Ok(mutation) = mutation else {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        };
                        NetworkRuntimeEvent::Gallery(mutation)
                    }
                    ManagementRequest::TodoPush => {
                        let mut body = vec![0_u8; content_length];
                        if request.read_exact(&mut body).is_err() {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        }
                        if crate::todo_sync::decode_protobuf_snapshot(&body).is_err() {
                            respond_invalid_body(request, event_tx, audit)?;
                            return Ok(());
                        }
                        NetworkRuntimeEvent::TodoSnapshot {
                            body,
                            source: SnapshotSource::ClientLanPush,
                            etag: None,
                        }
                    }
                    _ => NetworkRuntimeEvent::Management(parsed),
                };
                let queued = event_tx.try_send(event).is_ok();
                let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(management_queue_audit(
                    audit, queued,
                )));
                let body = crate::proto::memorilo::sync::v1::TodoSyncResponse {
                    operation: "todo.sync".into(),
                    request_id: String::new(),
                    status: if queued { "accepted" } else { "rejected" }.into(),
                    error: (!queued).then(|| "capacity-exceeded".into()),
                }
                .encode_to_vec();
                request
                    .into_status_response(if queued { 202 } else { 503 })?
                    .write_all(&body)?;
            }
            Ok((_, audit)) => {
                let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(ManagementAudit {
                    accepted: false,
                    error: Some(ManagementRequestError::NotFound),
                    ..audit
                }));
                request
                    .into_status_response(404)?
                    .write_all(br#"{"error":"not-found"}"#)?;
            }
            Err(audit) => {
                let status = match audit.error {
                    Some(ManagementRequestError::AuthenticationRequired) => 401,
                    Some(ManagementRequestError::BodyTooLarge) => 413,
                    Some(ManagementRequestError::InvalidBody) => 400,
                    Some(ManagementRequestError::MethodNotAllowed) => 405,
                    Some(ManagementRequestError::Unavailable) => 503,
                    _ => 404,
                };
                let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(audit));
                request
                    .into_status_response(status)?
                    .write_all(br#"{"accepted":false}"#)?;
            }
        }
        Ok(())
    }

    fn respond_invalid_body(
        request: Request<&mut EspHttpConnection<'_>>,
        event_tx: &SyncSender<NetworkRuntimeEvent>,
        audit: ManagementAudit,
    ) -> Result<()> {
        let _ = event_tx.try_send(NetworkRuntimeEvent::Audit(ManagementAudit {
            accepted: false,
            error: Some(ManagementRequestError::InvalidBody),
            ..audit
        }));
        request
            .into_status_response(400)?
            .write_all(br#"{"accepted":false,"error":"invalid-body"}"#)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn wrong_credentials_wait_for_ble_replacement_instead_of_retrying_forever() {
        let mut policy = NetworkPolicy::new(true);
        assert_eq!(
            policy.start(Duration::ZERO),
            vec![NetworkAction::Connect {
                deadline: CONNECT_TIMEOUT,
            }]
        );
        policy.failed(NetworkFailure::Authentication, Duration::from_secs(3));
        assert_eq!(policy.snapshot().phase, NetworkPhase::AuthenticationFailed);
        assert!(policy.poll(Duration::from_secs(60 * 60)).is_empty());

        let actions = policy.reconfigure(true, Duration::from_secs(60 * 60));
        assert_eq!(
            actions.last(),
            Some(&NetworkAction::Connect {
                deadline: Duration::from_secs(60 * 60) + CONNECT_TIMEOUT,
            })
        );
    }

    #[test]
    fn transient_failures_back_off_with_a_bounded_connection_lease() {
        let mut policy = NetworkPolicy::new(true);
        policy.start(Duration::ZERO);
        policy.failed(NetworkFailure::Transport, Duration::from_secs(1));
        assert_eq!(policy.snapshot().phase, NetworkPhase::Backoff);
        assert!(policy.poll(Duration::from_secs(5)).is_empty());
        assert_eq!(
            policy.poll(Duration::from_secs(6)),
            vec![NetworkAction::Connect {
                deadline: Duration::from_secs(6) + CONNECT_TIMEOUT,
            }]
        );

        for attempt in 0..20 {
            policy.failed(NetworkFailure::Dhcp, Duration::from_secs(1000 + attempt));
        }
        let retry_at = policy.snapshot().retry_at_ms.unwrap();
        assert!(retry_at <= 1_019_000 + duration_millis(MAX_RETRY_DELAY));
    }

    #[test]
    fn classifies_todo_http_outcomes_for_retry_policy() {
        assert_eq!(classify_todo_http_status(200), TodoHttpStatusClass::Success);
        assert_eq!(
            classify_todo_http_status(304),
            TodoHttpStatusClass::NotModified
        );
        assert_eq!(
            classify_todo_http_status(401),
            TodoHttpStatusClass::Authentication(401)
        );
        assert_eq!(
            classify_todo_http_status(403),
            TodoHttpStatusClass::Authentication(403)
        );
        assert_eq!(
            classify_todo_http_status(429),
            TodoHttpStatusClass::RateLimited
        );
        assert_eq!(
            classify_todo_http_status(422),
            TodoHttpStatusClass::Client(422)
        );
        assert_eq!(
            classify_todo_http_status(503),
            TodoHttpStatusClass::Server(503)
        );
        assert_eq!(
            classify_todo_http_status(301),
            TodoHttpStatusClass::Unexpected(301)
        );
    }

    #[test]
    fn local_management_requires_a_long_bearer_and_bounds_requests() {
        assert_eq!(
            parse_management_request(
                ManagementMethod::Get,
                "/v1/status",
                0,
                Some("Bearer wrong"),
                TOKEN,
            )
            .unwrap_err()
            .error,
            Some(ManagementRequestError::AuthenticationRequired)
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/commands/refresh",
                MAX_MANAGEMENT_BODY_BYTES + 1,
                Some(&format!("Bearer {TOKEN}")),
                TOKEN,
            )
            .unwrap_err()
            .error,
            Some(ManagementRequestError::BodyTooLarge)
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/gallery/assets",
                FRAME_BYTES - 1,
                Some(&format!("Bearer {TOKEN}")),
                TOKEN,
            )
            .unwrap_err()
            .error,
            Some(ManagementRequestError::InvalidBody)
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/gallery/assets",
                FRAME_BYTES,
                Some(&format!("Bearer {TOKEN}")),
                TOKEN,
            )
            .unwrap()
            .0,
            ManagementRequest::GalleryUpload
        );
    }

    #[test]
    fn status_json_is_bounded_and_command_queue_saturation_is_audited() {
        let snapshot = NetworkSnapshot {
            phase: NetworkPhase::Online,
            ipv4: Some("192.0.2.42".into()),
            time_synchronized: true,
            mqtt_connected: true,
            consecutive_failures: 0,
            retry_at_ms: None,
        };
        let json = encode_management_status(&snapshot, Duration::from_secs(12)).unwrap();
        assert!(json.len() < MAX_MANAGEMENT_BODY_BYTES);
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap();
        assert_eq!(value["uptimeMs"], 12_000);
        assert_eq!(value["network"]["phase"], "online");
        assert_eq!(value["network"]["ipv4"], "192.0.2.42");

        let audit = management_queue_audit(
            ManagementAudit {
                request: Some(ManagementRequest::Refresh),
                accepted: true,
                error: None,
            },
            false,
        );
        assert!(!audit.accepted);
        assert_eq!(audit.error, Some(ManagementRequestError::Unavailable));
    }

    #[test]
    fn todo_management_supports_bounded_push_and_readback_only() {
        let authorization = format!("Bearer {TOKEN}");
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/todos",
                MAX_MANAGEMENT_BODY_BYTES + 1,
                Some(&authorization),
                TOKEN,
            )
            .unwrap()
            .0,
            ManagementRequest::TodoPush
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Post,
                "/v1/todos",
                MAX_TODO_BODY_BYTES + 1,
                Some(&authorization),
                TOKEN,
            )
            .unwrap_err()
            .error,
            Some(ManagementRequestError::BodyTooLarge)
        );
        assert_eq!(
            parse_management_request(
                ManagementMethod::Get,
                "/v1/todos",
                0,
                Some(&authorization),
                TOKEN,
            )
            .unwrap()
            .0,
            ManagementRequest::TodoGet
        );
    }

    #[test]
    fn todo_status_exposes_snapshot_metadata_without_credentials() {
        let mut state = TodoSyncState::default();
        state.revision = Some("revision-1".into());
        state.source = Some(SnapshotSource::ClientLanPush);
        state.last_success_unix_seconds = Some(123);
        let json = encode_todo_status(&state).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap();
        assert_eq!(value["revision"], "revision-1");
        assert_eq!(value["source"], "client-lan-push");
        assert_eq!(value["lastSuccessUnixSeconds"], 123);
        assert!(!String::from_utf8(json).unwrap().contains(TOKEN));
    }

    #[test]
    fn gallery_status_exposes_storage_and_refresh_cost_without_asset_bytes() {
        let snapshot = GalleryManagementSnapshot {
            catalog: GalleryCatalog::default(),
            mutation_revision: 3,
            last_error: Some("capacity-exceeded".into()),
        };
        let json = encode_gallery_status(&snapshot).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap();
        assert_eq!(value["mutationRevision"], 3);
        assert_eq!(value["imageBytes"], FRAME_BYTES);
        assert_eq!(value["maxAssets"], 100);
        assert_eq!(value["fullRefreshSeconds"], 20);
        assert_eq!(value["lastError"], "capacity-exceeded");
        assert!(json.len() < MAX_MANAGEMENT_BODY_BYTES);
    }

    #[test]
    fn gallery_names_decode_utf8_without_permitting_control_characters() {
        assert_eq!(
            decode_gallery_name_header("%E5%9B%9B%E8%89%B2%20photo"),
            Some("四色 photo".into())
        );
        assert_eq!(decode_gallery_name_header("bad%0Aname"), None);
        assert_eq!(decode_gallery_name_header("bad%XXname"), None);
    }

    #[test]
    fn network_configuration_debug_output_redacts_all_credentials() {
        let mut config = DeviceConfig::default();
        config.wifi.set_ssid(Some("Office".into())).unwrap();
        config.wifi.set_password("password-123").unwrap();
        config.local_management.set_token(TOKEN.to_owned()).unwrap();
        let network = NetworkConfiguration::from_device_config(&config).unwrap();
        let debug = format!("{network:?}");
        assert!(debug.contains("Office"));
        assert!(!debug.contains("password-123"));
        assert!(!debug.contains(TOKEN));
        assert!(network.has_local_management());
    }
}
