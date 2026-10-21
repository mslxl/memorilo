use std::time::Duration;

use crate::persistence::{PersistentState, validate};
use crate::provisioning_protocol::{
    ApplyConfigEnvelope, ApplyStatus, ApplyStatusEnvelope, ChunkFrame, FrameError, GalleryRequest,
    PROTOCOL_VERSION, ProtocolErrorCode, TodoRequest, WifiScanRequest, decode_frame,
    parse_apply_request, parse_gallery_request, parse_todo_request, parse_wifi_scan_request,
    reassemble_frames, validate_base_revision,
};

pub const SESSION_LIFETIME: Duration = Duration::from_secs(5 * 60);
pub const COMPLETION_GRACE: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum ProvisioningPhase {
    #[default]
    Idle,
    WaitingForDisplay,
    Advertising,
    Connected,
    Authenticated,
    Applying,
    Applied,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ProvisioningSnapshot {
    pub phase: ProvisioningPhase,
    pub passkey: Option<u32>,
    pub config_revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProvisioningEvent {
    Connected,
    Authenticated,
    AuthenticationFailed,
    Disconnected,
    Frame(Vec<u8>),
    WifiScan(Vec<u8>),
    GalleryFrame(Vec<u8>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionOutput {
    None,
    StartAdvertising { remaining: Duration },
    Apply(Box<ApplyConfigEnvelope>),
    ScanWifi(WifiScanRequest),
    Gallery(GalleryRequest),
    Todo(TodoRequest),
    Stop,
    Reject(ProtocolErrorCode),
}

pub struct ProvisioningSession {
    snapshot: ProvisioningSnapshot,
    display_revision: Option<u64>,
    deadline: Option<Duration>,
    shutdown_at: Option<Duration>,
    frames: Vec<ChunkFrame>,
    gallery_frames: Vec<ChunkFrame>,
}

impl ProvisioningSession {
    pub fn new(config_revision: u64) -> Self {
        Self {
            snapshot: ProvisioningSnapshot {
                config_revision,
                ..ProvisioningSnapshot::default()
            },
            display_revision: None,
            deadline: None,
            shutdown_at: None,
            frames: Vec::new(),
            gallery_frames: Vec::new(),
        }
    }

    pub fn snapshot(&self) -> ProvisioningSnapshot {
        self.snapshot
    }

    pub fn begin(&mut self, passkey: u32, display_revision: u64, now: Duration) {
        assert!((100_000..=999_999).contains(&passkey));
        self.snapshot.phase = ProvisioningPhase::WaitingForDisplay;
        self.snapshot.passkey = Some(passkey);
        self.display_revision = Some(display_revision);
        self.deadline = Some(now.saturating_add(SESSION_LIFETIME));
        self.shutdown_at = None;
        self.frames.clear();
        self.gallery_frames.clear();
    }

    pub fn on_display_completed(&mut self, revision: u64, now: Duration) -> SessionOutput {
        if self.snapshot.phase != ProvisioningPhase::WaitingForDisplay
            || self.display_revision != Some(revision)
        {
            return SessionOutput::None;
        }
        let Some(deadline) = self.deadline else {
            return self.fail(ProtocolErrorCode::Timeout);
        };
        if now >= deadline {
            return self.fail(ProtocolErrorCode::Timeout);
        }
        self.snapshot.phase = ProvisioningPhase::Advertising;
        SessionOutput::StartAdvertising {
            remaining: deadline.saturating_sub(now),
        }
    }

    pub fn on_event(&mut self, event: ProvisioningEvent) -> SessionOutput {
        match event {
            ProvisioningEvent::Connected
                if self.snapshot.phase == ProvisioningPhase::Advertising =>
            {
                self.snapshot.phase = ProvisioningPhase::Connected;
                SessionOutput::None
            }
            ProvisioningEvent::Authenticated
                if matches!(
                    self.snapshot.phase,
                    ProvisioningPhase::Advertising | ProvisioningPhase::Connected
                ) =>
            {
                self.snapshot.phase = ProvisioningPhase::Authenticated;
                SessionOutput::None
            }
            ProvisioningEvent::AuthenticationFailed => {
                self.fail(ProtocolErrorCode::AuthenticationRequired)
            }
            ProvisioningEvent::Disconnected
                if matches!(
                    self.snapshot.phase,
                    ProvisioningPhase::Connected
                        | ProvisioningPhase::Authenticated
                        | ProvisioningPhase::Applying
                ) =>
            {
                self.snapshot.phase = ProvisioningPhase::Advertising;
                self.frames.clear();
                SessionOutput::StartAdvertising {
                    remaining: SESSION_LIFETIME,
                }
            }
            ProvisioningEvent::Frame(bytes) => self.accept_frame(&bytes),
            ProvisioningEvent::WifiScan(bytes) => match parse_wifi_scan_request(&bytes) {
                Ok(request)
                    if matches!(
                        self.snapshot.phase,
                        ProvisioningPhase::Connected | ProvisioningPhase::Authenticated
                    ) =>
                {
                    SessionOutput::ScanWifi(request)
                }
                Err(error) => SessionOutput::Reject(error),
                _ => SessionOutput::Reject(ProtocolErrorCode::AuthenticationRequired),
            },
            ProvisioningEvent::GalleryFrame(bytes) => match self.accept_gallery_frame(&bytes) {
                Ok(Some(request))
                    if matches!(
                        self.snapshot.phase,
                        ProvisioningPhase::Connected | ProvisioningPhase::Authenticated
                    ) =>
                {
                    request
                }
                Ok(Some(_)) => SessionOutput::Reject(ProtocolErrorCode::AuthenticationRequired),
                Ok(None) => SessionOutput::None,
                Err(error) => SessionOutput::Reject(error),
            },
            _ => SessionOutput::None,
        }
    }

    pub fn mark_applying(&mut self) {
        self.snapshot.phase = ProvisioningPhase::Applying;
    }

    pub fn mark_applied(&mut self, revision: u64, now: Duration) {
        self.snapshot.phase = ProvisioningPhase::Applied;
        self.snapshot.config_revision = revision;
        self.shutdown_at = Some(now.saturating_add(COMPLETION_GRACE));
        self.frames.clear();
    }

    pub fn mark_rejected(&mut self) {
        self.snapshot.phase = ProvisioningPhase::Authenticated;
        self.frames.clear();
    }

    pub fn mark_failed_after_status(&mut self, now: Duration) {
        self.snapshot.phase = ProvisioningPhase::Failed;
        self.shutdown_at = Some(now.saturating_add(COMPLETION_GRACE));
        self.frames.clear();
    }

    pub fn cancel(&mut self) -> SessionOutput {
        self.snapshot.phase = ProvisioningPhase::Idle;
        self.snapshot.passkey = None;
        self.deadline = None;
        self.shutdown_at = None;
        self.frames.clear();
        SessionOutput::Stop
    }

    pub fn fail(&mut self, _error: ProtocolErrorCode) -> SessionOutput {
        self.snapshot.phase = ProvisioningPhase::Failed;
        self.shutdown_at = Some(Duration::ZERO);
        self.frames.clear();
        SessionOutput::Stop
    }

    pub fn poll(&mut self, now: Duration) -> SessionOutput {
        if self
            .shutdown_at
            .is_some_and(|shutdown_at| now >= shutdown_at)
        {
            self.snapshot.phase = ProvisioningPhase::Idle;
            self.snapshot.passkey = None;
            self.shutdown_at = None;
            return SessionOutput::Stop;
        }
        if self.deadline.is_some_and(|deadline| now >= deadline)
            && !matches!(
                self.snapshot.phase,
                ProvisioningPhase::Idle | ProvisioningPhase::Applied
            )
        {
            return self.fail(ProtocolErrorCode::Timeout);
        }
        SessionOutput::None
    }

    pub fn status(
        &self,
        request_id: String,
        status: ApplyStatus,
        error: Option<ProtocolErrorCode>,
    ) -> ApplyStatusEnvelope {
        ApplyStatusEnvelope {
            protocol_version: PROTOCOL_VERSION,
            request_id,
            status,
            revision: self.snapshot.config_revision,
            error,
        }
    }

    fn accept_frame(&mut self, bytes: &[u8]) -> SessionOutput {
        if self.snapshot.phase != ProvisioningPhase::Authenticated {
            return SessionOutput::Reject(ProtocolErrorCode::AuthenticationRequired);
        }
        let frame = match decode_frame(bytes) {
            Ok(frame) => frame,
            Err(error) => return SessionOutput::Reject(protocol_error(error)),
        };
        if self.frames.is_empty() && frame.index != 0 {
            return SessionOutput::Reject(ProtocolErrorCode::InvalidRequest);
        }
        self.frames.push(frame);
        let expected = usize::from(self.frames[0].count);
        if self.frames.len() < expected {
            return SessionOutput::None;
        }
        let json = match reassemble_frames(&self.frames) {
            Ok(json) => json,
            Err(error) => {
                self.frames.clear();
                return SessionOutput::Reject(protocol_error(error));
            }
        };
        self.frames.clear();
        match parse_apply_request(&json) {
            Ok(request) => SessionOutput::Apply(Box::new(request)),
            Err(error) => SessionOutput::Reject(error),
        }
    }

    fn accept_gallery_frame(
        &mut self,
        bytes: &[u8],
    ) -> Result<Option<SessionOutput>, ProtocolErrorCode> {
        if self.snapshot.phase != ProvisioningPhase::Authenticated {
            return Err(ProtocolErrorCode::AuthenticationRequired);
        }
        let frame = decode_frame(bytes).map_err(protocol_error)?;
        if self.gallery_frames.is_empty() && frame.index != 0 {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        self.gallery_frames.push(frame);
        let expected = usize::from(self.gallery_frames[0].count);
        if self.gallery_frames.len() < expected {
            return Ok(None);
        }
        let json = reassemble_frames(&self.gallery_frames).map_err(protocol_error)?;
        self.gallery_frames.clear();
        if json.first() != Some(&b'{') {
            return parse_todo_request(&json).map(|request| Some(SessionOutput::Todo(request)));
        }
        parse_gallery_request(&json).map(|request| Some(SessionOutput::Gallery(request)))
    }
}

pub fn apply_config(
    current: &PersistentState,
    current_revision: u64,
    request: &ApplyConfigEnvelope,
) -> Result<PersistentState, ProtocolErrorCode> {
    validate_base_revision(request, current_revision)?;
    let mut candidate = current.clone();
    let patch = &request.config;

    if let Some(device_name) = &patch.device_name {
        candidate.config.device_name = device_name.clone();
    }
    if let Some(timezone) = &patch.timezone {
        candidate.config.timezone = timezone.clone();
    }
    if let Some(idle_sleep_seconds) = patch.idle_sleep_seconds {
        candidate.config.idle_sleep_seconds = idle_sleep_seconds;
    }
    if let Some(selection_policy) = &patch.selection_policy {
        candidate.config.selection_policy = selection_policy.clone();
    }
    if let Some(weather) = &patch.weather {
        if candidate.config.weather.latitude_e6 != weather.latitude_e6
            || candidate.config.weather.longitude_e6 != weather.longitude_e6
        {
            candidate.weather_cache = None;
        }
        candidate.config.weather = weather.clone();
    }
    if let Some(almanac) = &patch.almanac {
        candidate.config.almanac = almanac.clone();
    }
    if let Some(todo_sync) = &patch.todo_sync {
        if todo_sync.clear_device_token && todo_sync.device_token.is_some() {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        if let Some(enabled) = todo_sync.enabled {
            candidate.config.todo_sync.enabled = enabled;
        }
        if let Some(url) = &todo_sync.https_base_url {
            candidate.config.todo_sync.https_base_url = url.trim().to_owned();
        }
        if todo_sync.clear_device_token {
            candidate.config.todo_sync.clear_device_token();
        }
        if let Some(token) = &todo_sync.device_token {
            candidate.config.todo_sync.set_device_token(token.clone());
        }
        if let Some(interval) = todo_sync.poll_interval_seconds {
            candidate.config.todo_sync.poll_interval_seconds = interval;
        }
        if let Some(view) = todo_sync.view {
            candidate.config.todo_sync.view = view;
        }
        if let Some(url) = &todo_sync.mqtt_broker_url {
            candidate.config.todo_sync.mqtt_broker_url =
                (!url.trim().is_empty()).then(|| url.trim().to_owned());
        }
        if let Some(topic) = &todo_sync.mqtt_topic {
            candidate.config.todo_sync.mqtt_topic =
                (!topic.trim().is_empty()).then(|| topic.trim().to_owned());
        }
        if todo_sync.clear_mqtt_password && todo_sync.mqtt_password.is_some() {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        if todo_sync.clear_mqtt_password {
            candidate.config.todo_sync.clear_mqtt_password();
        }
        if let Some(username) = &todo_sync.mqtt_username {
            candidate.config.todo_sync.mqtt_username =
                (!username.trim().is_empty()).then(|| username.trim().to_owned());
        }
        if let Some(password) = &todo_sync.mqtt_password {
            candidate
                .config
                .todo_sync
                .set_mqtt_password(password.clone());
        }
    }
    if let Some(wifi) = &patch.wifi {
        if wifi.clear_password && wifi.password.is_some() {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        if let Some(ssid) = &wifi.ssid {
            candidate
                .config
                .wifi
                .set_ssid(Some(ssid.clone()))
                .map_err(|_| ProtocolErrorCode::InvalidRequest)?;
        }
        if wifi.clear_password {
            candidate.config.wifi.clear_password();
        }
        if let Some(password) = &wifi.password {
            candidate
                .config
                .wifi
                .set_password(password.clone())
                .map_err(|_| ProtocolErrorCode::InvalidRequest)?;
        }
    }
    if let Some(local_management) = &patch.local_management {
        if local_management.clear_token && local_management.token.is_some() {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        if local_management.clear_token {
            candidate.config.local_management.clear_token();
        }
        if let Some(token) = &local_management.token {
            candidate
                .config
                .local_management
                .set_token(token.clone())
                .map_err(|_| ProtocolErrorCode::InvalidRequest)?;
        }
    }

    validate(&candidate).map_err(|_| ProtocolErrorCode::InvalidRequest)?;
    Ok(candidate)
}

fn protocol_error(error: FrameError) -> ProtocolErrorCode {
    match error {
        FrameError::ChecksumMismatch => ProtocolErrorCode::ChecksumMismatch,
        FrameError::RequestTooLarge => ProtocolErrorCode::RequestTooLarge,
        _ => ProtocolErrorCode::InvalidRequest,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glance::{WeatherCondition, WeatherReading};
    use crate::persistence::{AlmanacConfig, WeatherConfig};
    use crate::provisioning_protocol::{DeviceConfigPatch, WifiPatch, encode_frames};

    fn request(base_revision: u64) -> ApplyConfigEnvelope {
        ApplyConfigEnvelope {
            protocol_version: PROTOCOL_VERSION,
            request_id: "req-1".into(),
            base_revision,
            required_capabilities: vec!["config-v1".into()],
            config: DeviceConfigPatch {
                device_name: Some("Desk display".into()),
                wifi: Some(WifiPatch {
                    ssid: Some("Office".into()),
                    password: Some("password-123".into()),
                    clear_password: false,
                }),
                weather: Some(WeatherConfig {
                    enabled: true,
                    location_name: "Shanghai".into(),
                    latitude_e6: 31_230_400,
                    longitude_e6: 121_473_700,
                }),
                almanac: Some(AlmanacConfig {
                    note: "User note".into(),
                    source: "Personal calendar".into(),
                }),
                ..DeviceConfigPatch::default()
            },
        }
    }

    #[test]
    fn advertising_waits_for_the_exact_physical_passkey_frame() {
        let mut session = ProvisioningSession::new(4);
        session.begin(123_456, 9, Duration::ZERO);
        assert_eq!(
            session.on_display_completed(8, Duration::from_secs(20)),
            SessionOutput::None
        );
        assert_eq!(
            session.snapshot().phase,
            ProvisioningPhase::WaitingForDisplay
        );
        assert_eq!(
            session.on_display_completed(9, Duration::from_secs(20)),
            SessionOutput::StartAdvertising {
                remaining: Duration::from_secs(280),
            }
        );
    }

    #[test]
    fn unauthenticated_frames_are_rejected_and_authenticated_chunks_reassemble() {
        let mut session = ProvisioningSession::new(0);
        session.begin(123_456, 1, Duration::ZERO);
        session.on_display_completed(1, Duration::from_secs(1));
        let json = serde_json::to_vec(&request(0)).unwrap();
        let frames = encode_frames(7, &json, 24).unwrap();
        assert_eq!(
            session.on_event(ProvisioningEvent::Frame(frames[0].clone())),
            SessionOutput::Reject(ProtocolErrorCode::AuthenticationRequired)
        );
        session.on_event(ProvisioningEvent::Connected);
        session.on_event(ProvisioningEvent::Authenticated);
        for frame in &frames[..frames.len() - 1] {
            assert_eq!(
                session.on_event(ProvisioningEvent::Frame(frame.clone())),
                SessionOutput::None
            );
        }
        assert_eq!(
            session.on_event(ProvisioningEvent::Frame(frames.last().unwrap().clone())),
            SessionOutput::Apply(Box::new(request(0)))
        );
    }

    #[test]
    fn disconnect_during_an_active_session_restarts_advertising() {
        let mut session = ProvisioningSession::new(4);
        session.begin(123_456, 9, Duration::ZERO);
        session.on_display_completed(9, Duration::from_secs(20));
        session.on_event(ProvisioningEvent::Connected);
        session.on_event(ProvisioningEvent::Authenticated);

        assert_eq!(
            session.on_event(ProvisioningEvent::Disconnected),
            SessionOutput::StartAdvertising {
                remaining: SESSION_LIFETIME,
            }
        );
        assert_eq!(session.snapshot().phase, ProvisioningPhase::Advertising);
        assert_eq!(session.snapshot().passkey, Some(123_456));
    }

    #[test]
    fn applying_a_patch_preserves_secrets_and_rejects_stale_revisions() {
        let mut current = PersistentState {
            weather_cache: Some(WeatherReading {
                is_demo: false,
                observed_at_unix_seconds: 1,
                fetched_at_unix_seconds: 2,
                temperature_tenths_celsius: 200,
                apparent_temperature_tenths_celsius: 200,
                relative_humidity_percent: 50,
                precipitation_probability_percent: 10,
                condition: WeatherCondition::Clear,
            }),
            ..PersistentState::default()
        };
        let candidate = apply_config(&current, 3, &request(3)).unwrap();
        assert_eq!(candidate.config.device_name, "Desk display");
        assert_eq!(candidate.config.wifi.ssid.as_deref(), Some("Office"));
        assert!(candidate.config.wifi.has_password());
        assert_eq!(candidate.config.weather.location_name, "Shanghai");
        assert_eq!(candidate.config.almanac.source, "Personal calendar");
        assert!(candidate.weather_cache.is_none());
        assert_eq!(
            apply_config(&current, 4, &request(3)),
            Err(ProtocolErrorCode::StaleRevision)
        );

        current.config.weather.latitude_e6 = 31_230_400;
        current.config.weather.longitude_e6 = 121_473_700;
        assert!(
            apply_config(&current, 3, &request(3))
                .unwrap()
                .weather_cache
                .is_some()
        );
    }

    #[test]
    fn timeout_and_completion_always_stop_the_session() {
        let mut session = ProvisioningSession::new(2);
        session.begin(654_321, 1, Duration::ZERO);
        assert_eq!(session.poll(SESSION_LIFETIME), SessionOutput::Stop);

        let mut session = ProvisioningSession::new(2);
        session.begin(654_321, 1, Duration::ZERO);
        session.mark_applied(3, Duration::from_secs(10));
        assert_eq!(session.poll(Duration::from_secs(10)), SessionOutput::None);
        assert_eq!(session.poll(Duration::from_secs(11)), SessionOutput::Stop);
        assert_eq!(session.snapshot().phase, ProvisioningPhase::Idle);
    }
}
