#[cfg(target_os = "espidf")]
mod firmware {
    #[cfg(not(feature = "color-test"))]
    use std::sync::mpsc::{Receiver, SyncSender, TryRecvError, channel, sync_channel};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[cfg(not(feature = "color-test"))]
    use anyhow::bail;
    use anyhow::{Context, Result, ensure};
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::application::{
        Application, ApplicationCommand, PageId, PowerRequest, RenderIntent, ServiceId,
        ServiceRequest,
    };
    use memorilo_device_firmware::board::Board;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::device_status::DeviceStatusService;
    use memorilo_device_firmware::rtc::{
        datetime_from_iso8601, datetime_from_unix_seconds, timezone_offset_minutes,
    };
    use memorilo_device_firmware::diagnostics::{self, RefreshMeasurement};
    use memorilo_device_firmware::display::Display;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::display_coordinator::{
        CoordinatorOutput, DisplayCoordinator, DisplayEvent, DisplayPolicy, RefreshRequest,
    };
    use memorilo_device_firmware::framebuffer::FRAME_BYTES;
    #[cfg(feature = "color-test")]
    use memorilo_device_firmware::framebuffer::render_color_test;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::gallery::{EspPartitionGalleryStorage, GalleryRepository};
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::gallery_idle::{
        GalleryIdleFullscreen, gallery_slideshow_interval,
    };
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::input::{ButtonId, Gesture, GestureRecognizer, route_gesture};
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::network::runtime::{NetworkRuntime, NetworkRuntimeEvent};
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::network::{
        CONNECT_TIMEOUT, GalleryMutation, ManagementRequest, NetworkConfiguration, NetworkPhase,
    };
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::persistence::{EspNvsBlobStore, LoadSource, PersistenceManager};
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::power::{PowerCoordinator, SleepBlocker, SleepDecision};
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::provisioning::{
        ProvisioningPhase, ProvisioningSession, ProvisioningSnapshot, SessionOutput, apply_config,
    };
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::provisioning_ble::BleProvisioningTransport;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::provisioning_protocol::{
        ApplyConfigEnvelope, ApplyStatus, ApplyStatusEnvelope, CONFIG_SCHEMA_VERSION,
        DeviceInfoEnvelope, PROTOCOL_VERSION, ProtocolErrorCode, PublicConfigEnvelope, TodoRequest,
        WifiNetwork, encode_frames,
    };
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::provisioning_serial::{
        SerialProvisioningCommand, SerialProvisioningTransport, decode_gallery_bytes,
        encode_apply_response, encode_gallery_error_response, encode_gallery_status_response,
        encode_read_response, encode_todo_response, encode_wifi_scan_response,
    };
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::todo_sync::{
        Admission, SnapshotSource, TodoSnapshot, TodoSyncEvent, decode_protobuf_snapshot,
    };
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::ui;
    #[cfg(not(feature = "color-test"))]
    use memorilo_device_firmware::weather::{
        DemoWeatherProvider, WeatherScheduler, WeatherSchedulerEvent,
    };

    pub fn run() -> Result<()> {
        esp_idf_sys::link_patches();
        esp_idf_svc::log::EspLogger::initialize_default();
        diagnostics::log_snapshot("boot_start", "main");

        #[cfg(feature = "color-test")]
        let _board = Board::new().context("board initialization failed")?;
        #[cfg(not(feature = "color-test"))]
        let board = Board::new().context("board initialization failed")?;
        #[cfg(feature = "color-test")]
        {
            let mut display = Display::new().context("display initialization failed")?;
            diagnostics::log_snapshot("hardware_ready", "main");
            let mut framebuffer = vec![0_u8; FRAME_BYTES];
            render_color_test(&mut framebuffer);
            let refresh = RefreshMeasurement::start(1);
            let result = display.refresh(&framebuffer);
            refresh.finish(result.is_ok());
            result?;
            log::warn!("first-hardware-test color bars displayed; TODO input is disabled");
            loop {
                thread::sleep(Duration::from_secs(1));
            }
        }

        #[cfg(not(feature = "color-test"))]
        {
            let nvs_partition = esp_idf_svc::nvs::EspDefaultNvsPartition::take()
                .context("default NVS partition initialization failed")?;
            let network_nvs_partition = nvs_partition.clone();
            let persistence_store = EspNvsBlobStore::new(nvs_partition)
                .context("persistence namespace initialization failed")?;
            let mut persistence =
                PersistenceManager::new(persistence_store, Duration::from_millis(500));
            let loaded = persistence.load().context("persistent state load failed")?;
            if let Some(recovery) = &loaded.recovery {
                log::warn!("persistent state recovered: {recovery:?}");
            }
            log::info!("persistent state source={:?}", loaded.source);
            let gallery_storage = EspPartitionGalleryStorage::new()
                .context("gallery partition initialization failed")?;
            let (mut gallery, gallery_report) = GalleryRepository::load(gallery_storage)
                .context("gallery catalog initialization failed")?;
            if !gallery_report.recovery.is_empty() {
                log::warn!("gallery recovered entries={:?}", gallery_report.recovery);
            }

            let should_rewrite_migration =
                matches!(loaded.source, LoadSource::Stored { migrated: true, .. });
            let mut status_service = DeviceStatusService::new();
            let mut power = PowerCoordinator::new(
                Duration::from_secs(u64::from(loaded.state.config.idle_sleep_seconds)),
                diagnostics::uptime(),
            );
            let system_loop = esp_idf_svc::eventloop::EspSystemEventLoop::take()
                .context("system event loop initialization failed")?;
            let peripherals = esp_idf_svc::hal::peripherals::Peripherals::take()
                .context("ESP32 peripherals are already taken")?;
            let wifi = esp_idf_svc::wifi::EspWifi::new(
                peripherals.modem,
                system_loop.clone(),
                Some(network_nvs_partition),
            )
            .context("Wi-Fi driver initialization failed")?;
            let network_config = NetworkConfiguration::from_device_config(&loaded.state.config);
            let mut weather = WeatherScheduler::new(
                DemoWeatherProvider,
                loaded.state.config.weather.latitude_e6,
                loaded.state.config.weather.longitude_e6,
                loaded.state.weather_cache.clone(),
            );
            let network =
                NetworkRuntime::spawn(wifi, system_loop, network_config, gallery.catalog().clone())
                    .context("network service initialization failed")?;
            let mut application = Application::with_state(
                [
                    ServiceId::Display,
                    ServiceId::Persistence,
                    ServiceId::Status,
                    ServiceId::Provisioning,
                    ServiceId::Network,
                ],
                loaded.state,
            );
            let mut todo_sync = application.snapshot().todo_sync.clone();
            todo_sync.model = application.snapshot().todos.clone();
            network.publish_todos(todo_sync.clone())?;
            application.dispatch(ApplicationCommand::StatusUpdated(
                status_service.sample(diagnostics::uptime()),
            ));
            application.dispatch(ApplicationCommand::GalleryUpdated(
                gallery.catalog().clone(),
            ));
            let startup = application.start();
            ensure!(
                startup.service_requests
                    == vec![
                        ServiceRequest::Start(ServiceId::Display),
                        ServiceRequest::Start(ServiceId::Persistence),
                        ServiceRequest::Start(ServiceId::Status),
                        ServiceRequest::Start(ServiceId::Provisioning),
                        ServiceRequest::Start(ServiceId::Network),
                    ],
                "application did not request required service startup"
            );
            let persistence_ready =
                application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Persistence));
            let status_ready =
                application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Status));
            let provisioning_ready =
                application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Provisioning));
            let network_ready =
                application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Network));
            let display = Display::new().context("display initialization failed")?;
            let display_ready =
                application.dispatch(ApplicationCommand::ServiceStarted(ServiceId::Display));
            diagnostics::log_snapshot("hardware_ready", "main");

            let (refresh_tx, refresh_rx) = sync_channel(1);
            let (result_tx, result_rx) = channel();
            spawn_display_task(refresh_rx, result_tx, display)?;
            let mut coordinator = DisplayCoordinator::new(DisplayPolicy::default());
            let mut gallery_idle = GalleryIdleFullscreen::default();
            let mut gallery_mutation_revision = 0_u64;
            let mut slideshow_due: Option<Duration> = None;
            let mut gesture_recognizer = GestureRecognizer::default();
            let mut provisioning = ProvisioningSession::new(persistence.generation());
            let mut provisioning_transport: Option<BleProvisioningTransport> = None;
            let serial_provisioning_transport = match SerialProvisioningTransport::open() {
                Ok(transport) => Some(transport),
                Err(error) => {
                    log::error!("USB serial provisioning unavailable: {error:#}");
                    None
                }
            };
            queue_render(
                &mut application,
                &mut coordinator,
                &refresh_tx,
                display_ready
                    .render
                    .or(provisioning_ready.render)
                    .or(network_ready.render)
                    .or(status_ready.render)
                    .or(persistence_ready.render)
                    .or(startup.render),
            )?;
            if should_rewrite_migration {
                persistence.schedule(application.persistent_state(), diagnostics::uptime());
            }
            diagnostics::log_snapshot("ui_loop_ready", "main");

            #[cfg(feature = "coordinator-test")]
            let mut coordinator_test_step = 0_u8;

            log::info!(
                "application UI ready ({} TODO items); input remains active during refresh",
                application.snapshot().todos.items.len()
            );

            loop {
                drain_display_results(&mut application, &mut coordinator, &refresh_tx, &result_rx)?;
                let now = diagnostics::uptime();
                while let Some(event) = network.try_recv()? {
                    match event {
                        NetworkRuntimeEvent::Snapshot(snapshot) => {
                            let network_time_became_valid = snapshot.time_synchronized
                                && !application.snapshot().network.time_synchronized;
                            if snapshot.phase == NetworkPhase::Connecting {
                                power.acquire_lease(
                                    SleepBlocker::Network,
                                    now,
                                    CONNECT_TIMEOUT + Duration::from_secs(2),
                                );
                            } else {
                                power.release_lease(SleepBlocker::Network);
                            }
                            application.dispatch(ApplicationCommand::NetworkUpdated(snapshot));
                            if network_time_became_valid
                                && let Some(unix_seconds) = unix_seconds()
                            {
                                let offset = timezone_offset_minutes(
                                    &application.snapshot().config.timezone,
                                );
                                if let Some(local_time) =
                                    datetime_from_unix_seconds(unix_seconds, offset)
                                {
                                    if let Err(error) = status_service
                                        .synchronize_time(unix_seconds, local_time)
                                    {
                                        log::warn!(
                                            "SNTP time synchronization could not update RTC: {error:#}"
                                        );
                                    }
                                }
                            }
                        }
                        NetworkRuntimeEvent::Management(request) => {
                            power.note_activity(now);
                            let command = match request {
                                ManagementRequest::Status => None,
                                ManagementRequest::GalleryList
                                | ManagementRequest::GalleryUpload
                                | ManagementRequest::GalleryDelete
                                | ManagementRequest::GalleryReorder
                                | ManagementRequest::GallerySlideshow
                                | ManagementRequest::TodoGet
                                | ManagementRequest::TodoPush => None,
                                ManagementRequest::Refresh => Some(ApplicationCommand::Refresh),
                                ManagementRequest::NextPage => Some(ApplicationCommand::NextPage),
                                ManagementRequest::Sleep => Some(ApplicationCommand::RequestSleep),
                            };
                            if let Some(command) = command {
                                let before = application.persistent_state();
                                let persists_state = !matches!(
                                    &command,
                                    ApplicationCommand::SelectPrevious
                                        | ApplicationCommand::SelectNext
                                );
                                let transition = application.dispatch(command);
                                if transition.power_request == Some(PowerRequest::Sleep) {
                                    power.request_manual_sleep();
                                }
                                let after = application.persistent_state();
                                if persists_state && after != before {
                                    persistence.schedule(after, now);
                                }
                                sync_gallery_frame(&mut application, &mut gallery);
                                slideshow_due = None;
                                queue_render(
                                    &mut application,
                                    &mut coordinator,
                                    &refresh_tx,
                                    transition.render,
                                )?;
                            }
                        }
                        NetworkRuntimeEvent::Gallery(mutation) => {
                            power.note_activity(now);
                            power.acquire_lease(
                                SleepBlocker::Storage,
                                now,
                                Duration::from_secs(30),
                            );
                            let result = apply_gallery_mutation(&mut gallery, mutation);
                            let transition = match result {
                                Ok(()) => {
                                    let catalog = gallery.catalog().clone();
                                    network.publish_gallery(catalog.clone(), None)?;
                                    application
                                        .dispatch(ApplicationCommand::GalleryUpdated(catalog))
                                }
                                Err(error) => {
                                    let message = error.to_string();
                                    log::error!("gallery mutation failed: {message}");
                                    network.publish_gallery(
                                        gallery.catalog().clone(),
                                        Some(message.clone()),
                                    )?;
                                    application.dispatch(ApplicationCommand::GalleryFailed(message))
                                }
                            };
                            power.release_lease(SleepBlocker::Storage);
                            sync_gallery_frame(&mut application, &mut gallery);
                            queue_render(
                                &mut application,
                                &mut coordinator,
                                &refresh_tx,
                                transition.render,
                            )?;
                        }
                        NetworkRuntimeEvent::TodoSnapshot { body, source, etag } => {
                            if !application
                                .snapshot()
                                .config
                                .todo_sync
                                .allows_snapshot_source(source)
                            {
                                log::warn!(
                                    "ignored local TODO snapshot while HTTPS source is configured"
                                );
                                continue;
                            }
                            if let Ok(snapshot) = decode_protobuf_snapshot(&body) {
                                synchronize_snapshot_time(
                                    &snapshot,
                                    &application.snapshot().config.timezone,
                                    &mut status_service,
                                );
                            }
                            match todo_sync.admit_protobuf(&body, source, unix_timestamp()) {
                                Admission::Accepted { model, .. } => {
                                    todo_sync.etag = etag;
                                    let transition = application
                                        .dispatch(ApplicationCommand::TodosSynced(model));
                                    application.dispatch(ApplicationCommand::TodoSyncStatus(
                                        todo_sync.clone(),
                                    ));
                                    persistence.schedule(application.persistent_state(), now);
                                    network.publish_todos(todo_sync.clone())?;
                                    queue_render(
                                        &mut application,
                                        &mut coordinator,
                                        &refresh_tx,
                                        transition.render,
                                    )?;
                                }
                                Admission::Unchanged => {
                                    todo_sync.etag = etag;
                                    application.dispatch(ApplicationCommand::TodoSyncStatus(
                                        todo_sync.clone(),
                                    ));
                                    network.publish_todos(todo_sync.clone())?;
                                }
                                Admission::Rejected(error) => {
                                    log::warn!("rejected TODO snapshot from {source:?}: {error}");
                                    application.dispatch(ApplicationCommand::TodoSyncStatus(
                                        todo_sync.clone(),
                                    ));
                                    persistence.schedule(application.persistent_state(), now);
                                    network.publish_todos(todo_sync.clone())?;
                                }
                            }
                        }
                        NetworkRuntimeEvent::TodoNotModified { source, etag } => {
                            todo_sync.source = Some(source);
                            todo_sync.etag = etag.or(todo_sync.etag);
                            todo_sync.last_success_unix_seconds = unix_timestamp();
                            todo_sync.last_error = None;
                            todo_sync.last_event = Some(TodoSyncEvent::NotModified);
                            application
                                .dispatch(ApplicationCommand::TodoSyncStatus(todo_sync.clone()));
                            persistence.schedule(application.persistent_state(), now);
                            network.publish_todos(todo_sync.clone())?;
                        }
                        NetworkRuntimeEvent::TodoError { source, message } => {
                            todo_sync.source = Some(source);
                            todo_sync.last_error = Some(message);
                            todo_sync.last_event = Some(
                                if todo_sync.last_error.as_deref().is_some_and(|value| {
                                    value.contains("HTTP 401") || value.contains("HTTP 403")
                                }) {
                                    TodoSyncEvent::AuthenticationFailure
                                } else if todo_sync.snapshot.is_some() {
                                    TodoSyncEvent::OfflineCache
                                } else {
                                    TodoSyncEvent::Retrying
                                },
                            );
                            application
                                .dispatch(ApplicationCommand::TodoSyncStatus(todo_sync.clone()));
                            persistence.schedule(application.persistent_state(), now);
                            network.publish_todos(todo_sync.clone())?;
                        }
                        NetworkRuntimeEvent::TodoNotification => {
                            todo_sync.last_event = Some(TodoSyncEvent::Notification);
                            application
                                .dispatch(ApplicationCommand::TodoSyncStatus(todo_sync.clone()));
                            network.publish_todos(todo_sync.clone())?;
                        }
                        NetworkRuntimeEvent::Audit(audit) => log::info!(
                            "local management request={:?} accepted={} error={:?}",
                            audit.request,
                            audit.accepted,
                            audit.error
                        ),
                        NetworkRuntimeEvent::Failed(error) => {
                            log::error!("network service failure code={error}");
                            power.release_lease(SleepBlocker::Network);
                            let transition = application
                                .dispatch(ApplicationCommand::ServiceFailed(ServiceId::Network));
                            queue_render(
                                &mut application,
                                &mut coordinator,
                                &refresh_tx,
                                transition.render,
                            )?;
                        }
                        NetworkRuntimeEvent::Stopped => {
                            power.release_lease(SleepBlocker::Network);
                            application
                                .dispatch(ApplicationCommand::ServiceStopped(ServiceId::Network));
                        }
                    }
                }
                if let Some(revision) = application.snapshot().display.displayed_revision {
                    let output = provisioning.on_display_completed(revision, now);
                    handle_provisioning_output(
                        output,
                        now,
                        &mut provisioning,
                        &mut provisioning_transport,
                        &network,
                        &mut application,
                        &mut status_service,
                        &mut persistence,
                        &mut gallery,
                        &mut gallery_mutation_revision,
                        &mut coordinator,
                        &refresh_tx,
                        &mut power,
                    )?;
                }
                let mut provisioning_events = Vec::new();
                if let Some(transport) = &provisioning_transport {
                    while let Some(event) = transport.try_recv()? {
                        provisioning_events.push(event);
                    }
                }
                for event in provisioning_events {
                    let output = provisioning.on_event(event);
                    handle_provisioning_output(
                        output,
                        now,
                        &mut provisioning,
                        &mut provisioning_transport,
                        &network,
                        &mut application,
                        &mut status_service,
                        &mut persistence,
                        &mut gallery,
                        &mut gallery_mutation_revision,
                        &mut coordinator,
                        &refresh_tx,
                        &mut power,
                    )?;
                }
                if let Some(serial) = &serial_provisioning_transport {
                    while let Some(command) = serial.try_recv()? {
                        match command {
                            SerialProvisioningCommand::Read { request_id } => {
                                let info = device_info(&persistence)?;
                                let public = public_config(&application, persistence.generation());
                                serial.write(&encode_read_response(
                                    &request_id,
                                    &info,
                                    &public,
                                )?)?;
                            }
                            SerialProvisioningCommand::ScanWifi { request_id } => {
                                let networks = network
                                    .scan_wifi()?
                                    .into_iter()
                                    .map(|network| WifiNetwork {
                                        ssid: network.ssid,
                                        rssi: network.rssi,
                                        security: network.security.to_string(),
                                    })
                                    .collect::<Vec<_>>();
                                serial
                                    .write(&encode_wifi_scan_response(&request_id, &networks)?)?;
                            }
                            SerialProvisioningCommand::Apply(request) => {
                                let status = commit_provisioning_request(
                                    &request,
                                    now,
                                    &network,
                                    &mut application,
                                    &mut persistence,
                                )?;
                                serial
                                    .write(&encode_apply_response(&request.request_id, &status)?)?;
                            }
                            SerialProvisioningCommand::Gallery(request) => {
                                let operation = request.operation.clone();
                                let request_id = request.request_id.clone();
                                let result = handle_gallery_request(request, &mut gallery);
                                if result.is_ok() && operation != "gallery.list" {
                                    gallery_mutation_revision =
                                        gallery_mutation_revision.saturating_add(1);
                                    let catalog = gallery.catalog().clone();
                                    network.publish_gallery(catalog.clone(), None)?;
                                    let transition = application
                                        .dispatch(ApplicationCommand::GalleryUpdated(catalog));
                                    sync_gallery_frame(&mut application, &mut gallery);
                                    queue_render(
                                        &mut application,
                                        &mut coordinator,
                                        &refresh_tx,
                                        transition.render,
                                    )?;
                                }
                                let response = match result {
                                    Ok(()) => encode_gallery_status_response(
                                        &operation,
                                        &request_id,
                                        gallery.catalog(),
                                        gallery_mutation_revision,
                                    )?,
                                    Err(error) => encode_gallery_error_response(
                                        &operation,
                                        &request_id,
                                        error,
                                    )?,
                                };
                                serial.write(&response)?;
                            }
                            SerialProvisioningCommand::Todo(request) => {
                                let error = commit_todo_snapshot(
                                    &request,
                                    now,
                                    &network,
                                    &mut application,
                                    &mut status_service,
                                    &mut persistence,
                                    &mut coordinator,
                                    &refresh_tx,
                                )?;
                                serial.write(&encode_todo_response(&request.request_id, error)?)?;
                            }
                        }
                    }
                }
                let output = provisioning.poll(now);
                handle_provisioning_output(
                    output,
                    now,
                    &mut provisioning,
                    &mut provisioning_transport,
                    &network,
                    &mut application,
                    &mut status_service,
                    &mut persistence,
                    &mut gallery,
                    &mut gallery_mutation_revision,
                    &mut coordinator,
                    &refresh_tx,
                    &mut power,
                )?;
                sync_provisioning_ui(
                    &mut application,
                    &mut coordinator,
                    &refresh_tx,
                    provisioning.snapshot(),
                )?;

                let due = coordinator.poll(now);
                apply_coordinator_output(&mut application, &refresh_tx, due)?;
                if persistence.poll(now)? {
                    log::info!("persistent state committed");
                }

                let weather_config = application.snapshot().config.weather.clone();
                weather.set_location(weather_config.latitude_e6, weather_config.longitude_e6);
                if let Some(unix_seconds) = unix_seconds()
                    && let Some(event) = weather.poll(
                        weather_config.enabled,
                        application.snapshot().network.phase == NetworkPhase::Online
                            && application.snapshot().network.time_synchronized,
                        unix_seconds,
                    )
                {
                    let transition = match event {
                        WeatherSchedulerEvent::Fetched(reading) => {
                            application.dispatch(ApplicationCommand::WeatherFetched(reading))
                        }
                        WeatherSchedulerEvent::Failed(error) => {
                            application.dispatch(ApplicationCommand::WeatherFailed {
                                at_unix_seconds: unix_seconds,
                                error,
                            })
                        }
                    };
                    persistence.schedule(application.persistent_state(), now);
                    queue_render(
                        &mut application,
                        &mut coordinator,
                        &refresh_tx,
                        transition.render,
                    )?;
                }

                let slideshow_interval = (application.snapshot().page
                    == memorilo_device_firmware::application::PageId::Gallery)
                    .then(|| {
                        gallery_slideshow_interval(
                            application.snapshot().gallery.fullscreen,
                            application.snapshot().gallery.catalog.assets.len(),
                            application
                                .snapshot()
                                .gallery
                                .catalog
                                .slideshow_interval_seconds,
                        )
                    })
                    .flatten();
                match (slideshow_interval, slideshow_due) {
                    (Some(interval), Some(due_at)) if now >= due_at => {
                        let transition = application.dispatch(ApplicationCommand::SelectNext);
                        sync_gallery_frame(&mut application, &mut gallery);
                        queue_render(
                            &mut application,
                            &mut coordinator,
                            &refresh_tx,
                            transition.render,
                        )?;
                        slideshow_due = Some(now.saturating_add(interval));
                    }
                    (Some(interval), None) => {
                        slideshow_due = Some(now.saturating_add(interval));
                    }
                    (None, _) => slideshow_due = None,
                    _ => {}
                }

                #[cfg(feature = "coordinator-test")]
                if coordinator_test_step < 2
                    && diagnostics::uptime()
                        >= Duration::from_secs(2 + u64::from(coordinator_test_step))
                {
                    let transition = application.dispatch(ApplicationCommand::SelectNext);
                    queue_render(
                        &mut application,
                        &mut coordinator,
                        &refresh_tx,
                        transition.render,
                    )?;
                    coordinator_test_step += 1;
                    log::warn!(
                        "coordinator-test injected input step={} during initial refresh",
                        coordinator_test_step
                    );
                }

                let button_state = board.button_state();
                for gesture in gesture_recognizer.update(diagnostics::uptime(), button_state) {
                    log::info!("input gesture={gesture:?}");
                    let input_at = diagnostics::uptime();
                    power.note_activity(input_at);
                    gallery_idle.update(
                        input_at,
                        gallery_auto_fullscreen_eligible(&application),
                        true,
                    );
                    let Some(command) = route_gesture(application.snapshot().page, gesture) else {
                        continue;
                    };
                    application.dispatch(ApplicationCommand::DiagnosticsUpdated(
                        diagnostics::RuntimeDiagnostics::sample(
                            [button_state.up, button_state.ok, button_state.down],
                            gesture_label(gesture),
                        ),
                    ));
                    if command == ApplicationCommand::EnterProvisioning
                        && provisioning.snapshot().phase != ProvisioningPhase::Idle
                    {
                        let output = provisioning.cancel();
                        handle_provisioning_output(
                            output,
                            diagnostics::uptime(),
                            &mut provisioning,
                            &mut provisioning_transport,
                            &network,
                            &mut application,
                            &mut status_service,
                            &mut persistence,
                            &mut gallery,
                            &mut gallery_mutation_revision,
                            &mut coordinator,
                            &refresh_tx,
                            &mut power,
                        )?;
                        sync_provisioning_ui(
                            &mut application,
                            &mut coordinator,
                            &refresh_tx,
                            provisioning.snapshot(),
                        )?;
                        continue;
                    }
                    application.dispatch(ApplicationCommand::StatusUpdated(
                        status_service.sample(diagnostics::uptime()),
                    ));
                    let before = application.persistent_state();
                    let persists_state = !matches!(
                        &command,
                        ApplicationCommand::SelectPrevious | ApplicationCommand::SelectNext
                    );
                    let transition = application.dispatch(command);
                    if transition.power_request == Some(PowerRequest::Sleep) {
                        power.request_manual_sleep();
                    }
                    let after = application.persistent_state();
                    if persists_state && after != before {
                        persistence.schedule(after, diagnostics::uptime());
                    }
                    sync_gallery_frame(&mut application, &mut gallery);
                    slideshow_due = None;
                    let render = if application.snapshot().settings.provisioning_requested
                        && provisioning.snapshot().phase == ProvisioningPhase::Idle
                    {
                        provisioning = ProvisioningSession::new(persistence.generation());
                        let passkey = 100_000 + unsafe { esp_idf_sys::esp_random() } % 900_000;
                        let prepared = ProvisioningSnapshot {
                            phase: ProvisioningPhase::WaitingForDisplay,
                            passkey: Some(passkey),
                            config_revision: persistence.generation(),
                        };
                        let prepared_transition =
                            application.dispatch(ApplicationCommand::ProvisioningUpdated(prepared));
                        let intent = prepared_transition
                            .render
                            .expect("preparing provisioning must render the passkey");
                        provisioning.begin(passkey, intent.revision, diagnostics::uptime());
                        power.acquire_lease(
                            SleepBlocker::Provisioning,
                            diagnostics::uptime(),
                            memorilo_device_firmware::provisioning::SESSION_LIFETIME,
                        );
                        Some(intent)
                    } else {
                        transition.render
                    };
                    queue_render(&mut application, &mut coordinator, &refresh_tx, render)?;
                    log::info!(
                        "command accepted; page={:?} revision={}",
                        application.snapshot().page,
                        application.snapshot().render_revision
                    );
                }

                if gallery_idle.update(
                    diagnostics::uptime(),
                    gallery_auto_fullscreen_eligible(&application),
                    false,
                ) {
                    log::info!("gallery idle timeout elapsed; entering fullscreen");
                    let transition =
                        application.dispatch(ApplicationCommand::EnterGalleryFullscreen);
                    sync_gallery_frame(&mut application, &mut gallery);
                    queue_render(
                        &mut application,
                        &mut coordinator,
                        &refresh_tx,
                        transition.render,
                    )?;
                    slideshow_due = None;
                }

                power.set_display_work(coordinator.has_pending_work());
                power.set_persistence_write(persistence.has_pending_write());
                power.set_external_power(
                    status_service.external_power_present(diagnostics::uptime()),
                );
                if let SleepDecision::Ready(trigger) = power.poll(diagnostics::uptime()) {
                    log::info!("entering deep sleep trigger={trigger:?}; GPIO0 wakes device");
                    board.prepare_deep_sleep()?;
                    board.enter_deep_sleep();
                }
                thread::sleep(Duration::from_millis(20));
            }
        }
    }

    #[cfg(not(feature = "color-test"))]
    const fn gesture_label(gesture: Gesture) -> &'static str {
        match gesture {
            Gesture::Press(ButtonId::Up) => "up-press",
            Gesture::Press(ButtonId::Ok) => "ok-press",
            Gesture::Press(ButtonId::Down) => "down-press",
            Gesture::Release(ButtonId::Up) => "up-release",
            Gesture::Release(ButtonId::Ok) => "ok-release",
            Gesture::Release(ButtonId::Down) => "down-release",
            Gesture::Tap(ButtonId::Up) => "up-tap",
            Gesture::Tap(ButtonId::Ok) => "ok-tap",
            Gesture::Tap(ButtonId::Down) => "down-tap",
            Gesture::LongPress(ButtonId::Up) => "up-long",
            Gesture::LongPress(ButtonId::Ok) => "ok-long",
            Gesture::LongPress(ButtonId::Down) => "down-long",
            Gesture::Repeat(ButtonId::Up) => "up-repeat",
            Gesture::Repeat(ButtonId::Ok) => "ok-repeat",
            Gesture::Repeat(ButtonId::Down) => "down-repeat",
            Gesture::UpDownChordLongPress => "up+down-long",
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn gallery_auto_fullscreen_eligible(application: &Application) -> bool {
        application.snapshot().page == PageId::Gallery
            && !application.snapshot().gallery.fullscreen
            && !application.snapshot().gallery.catalog.assets.is_empty()
    }

    #[cfg(not(feature = "color-test"))]
    fn unix_seconds() -> Option<i64> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| i64::try_from(duration.as_secs()).ok())
    }

    #[cfg(not(feature = "color-test"))]
    fn synchronize_snapshot_time(
        snapshot: &TodoSnapshot,
        timezone: &str,
        status_service: &mut DeviceStatusService,
    ) {
        let offset_minutes = snapshot
            .time_zone_offset_minutes
            .unwrap_or_else(|| timezone_offset_minutes(timezone));
        let Some((unix_seconds, local_time)) =
            datetime_from_iso8601(&snapshot.generated_at, offset_minutes)
        else {
            log::warn!(
                "TODO snapshot time was not a supported ISO-8601 timestamp: {}",
                snapshot.generated_at
            );
            return;
        };
        if let Err(error) = status_service.synchronize_time(unix_seconds, local_time) {
            log::warn!("TODO snapshot time synchronization failed: {error:#}");
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn handle_provisioning_output(
        output: SessionOutput,
        now: Duration,
        provisioning: &mut ProvisioningSession,
        transport: &mut Option<BleProvisioningTransport>,
        network: &NetworkRuntime,
        application: &mut Application,
        status_service: &mut DeviceStatusService,
        persistence: &mut PersistenceManager<EspNvsBlobStore>,
        gallery: &mut GalleryRepository<EspPartitionGalleryStorage>,
        gallery_mutation_revision: &mut u64,
        coordinator: &mut DisplayCoordinator,
        refresh_tx: &SyncSender<RefreshRequest>,
        power: &mut PowerCoordinator,
    ) -> Result<()> {
        match output {
            SessionOutput::None => {}
            SessionOutput::StartAdvertising { remaining } => {
                if transport.is_some() {
                    return Ok(());
                }
                let info = device_info(persistence)?;
                let public = public_config(application, persistence.generation());
                match BleProvisioningTransport::open(
                    provisioning
                        .snapshot()
                        .passkey
                        .expect("advertising requires a displayed passkey"),
                    &info,
                    &public,
                )
                .and_then(|opened| {
                    opened.start_advertising(remaining)?;
                    Ok(opened)
                }) {
                    Ok(opened) => {
                        log::info!("authenticated provisioning advertisement started");
                        *transport = Some(opened);
                    }
                    Err(error) => {
                        log::error!("provisioning BLE startup failed: {error:#}");
                        provisioning.mark_failed_after_status(now);
                        power.release_lease(SleepBlocker::Provisioning);
                    }
                }
            }
            SessionOutput::Apply(request) => {
                provisioning.mark_applying();
                let status =
                    commit_provisioning_request(&request, now, network, application, persistence)?;
                if status.status == ApplyStatus::Accepted {
                    provisioning.mark_applied(status.revision, now);
                } else if status.error == Some(ProtocolErrorCode::StorageFailure) {
                    provisioning.mark_failed_after_status(now);
                } else {
                    provisioning.mark_rejected();
                }
                if let Some(transport) = transport.as_ref() {
                    transport.notify_status(&status)?;
                }
            }
            SessionOutput::ScanWifi(request) => {
                let networks = network
                    .scan_wifi()?
                    .into_iter()
                    .map(|network| WifiNetwork {
                        ssid: network.ssid,
                        rssi: network.rssi,
                        security: network.security.to_owned(),
                    })
                    .collect::<Vec<_>>();
                if let Some(transport) = transport.as_ref() {
                    transport.notify_wifi_scan(&request.request_id, &networks)?;
                }
            }
            SessionOutput::Gallery(request) => {
                let operation = request.operation.clone();
                let request_id = request.request_id.clone();
                let result = handle_gallery_request(request, gallery);
                if result.is_ok() && operation != "gallery.list" {
                    *gallery_mutation_revision = (*gallery_mutation_revision).saturating_add(1);
                    let catalog = gallery.catalog().clone();
                    network.publish_gallery(catalog.clone(), None)?;
                    let transition =
                        application.dispatch(ApplicationCommand::GalleryUpdated(catalog));
                    sync_gallery_frame(application, gallery);
                    queue_render(application, coordinator, refresh_tx, transition.render)?;
                }
                let payload = match result {
                    Ok(()) => encode_gallery_status_response(
                        &operation,
                        &request_id,
                        gallery.catalog(),
                        *gallery_mutation_revision,
                    )?,
                    Err(error) => encode_gallery_error_response(&operation, &request_id, error)?,
                };
                // Serial response encoder includes its line prefix; BLE carries only JSON frames.
                let json = payload
                    .strip_prefix(
                        memorilo_device_firmware::provisioning_serial::SERIAL_PROVISIONING_PREFIX
                            .as_bytes(),
                    )
                    .and_then(|value| value.strip_suffix(b"\n"))
                    .unwrap_or(payload.as_slice());
                let frames = encode_frames(0x4752_4C59, json, 180).map_err(|error| {
                    anyhow::anyhow!("gallery response framing failed: {error:?}")
                })?;
                if let Some(transport) = transport.as_ref() {
                    for frame in frames {
                        transport.notify_gallery(&frame)?;
                    }
                }
            }
            SessionOutput::Todo(request) => {
                let request_id = request.request_id.clone();
                let error = commit_todo_snapshot(
                    &request,
                    now,
                    network,
                    application,
                    status_service,
                    persistence,
                    coordinator,
                    refresh_tx,
                )?;
                let payload = encode_todo_response(&request_id, error)?;
                let body = payload
                    .strip_prefix(
                        memorilo_device_firmware::provisioning_serial::SERIAL_PROVISIONING_PREFIX
                            .as_bytes(),
                    )
                    .and_then(|value| {
                        if value.len() < 4 {
                            return None;
                        }
                        let length = u32::from_le_bytes(value[..4].try_into().ok()?) as usize;
                        (value.len() == 4 + length).then_some(&value[4..])
                    })
                    .unwrap_or(payload.as_slice());
                let frames = encode_frames(0x544F_444F, body, 180)
                    .map_err(|error| anyhow::anyhow!("TODO response framing failed: {error:?}"))?;
                if let Some(transport) = transport.as_ref() {
                    for frame in frames {
                        transport.notify_gallery(&frame)?;
                    }
                }
            }
            SessionOutput::Reject(error) => {
                if let Some(transport) = transport.as_ref() {
                    transport.notify_status(&provisioning.status(
                        String::new(),
                        ApplyStatus::Rejected,
                        Some(error),
                    ))?;
                }
            }
            SessionOutput::Stop => {
                if let Some(mut opened) = transport.take()
                    && let Err(error) = opened.stop()
                {
                    log::error!("provisioning BLE shutdown failed: {error:#}");
                }
                power.release_lease(SleepBlocker::Provisioning);
            }
        }
        Ok(())
    }

    #[cfg(not(feature = "color-test"))]
    fn handle_gallery_request(
        request: memorilo_device_firmware::provisioning_protocol::GalleryRequest,
        gallery: &mut GalleryRepository<EspPartitionGalleryStorage>,
    ) -> Result<(), ProtocolErrorCode> {
        match request.operation.as_str() {
            "gallery.list" => Ok(()),
            "gallery.upload" => {
                let bytes = request
                    .bytes_base64
                    .as_deref()
                    .ok_or(ProtocolErrorCode::InvalidRequest)
                    .and_then(|value| {
                        decode_gallery_bytes(value).map_err(|_| ProtocolErrorCode::InvalidRequest)
                    })?;
                if bytes.len() != FRAME_BYTES {
                    return Err(ProtocolErrorCode::InvalidAssetLength);
                }
                apply_gallery_mutation(
                    gallery,
                    GalleryMutation::Upload {
                        name: request.name.unwrap_or_default(),
                        created_at_unix_seconds: request
                            .created_at_unix_seconds
                            .unwrap_or_default(),
                        bytes,
                    },
                )
                .map_err(gallery_error_code)
            }
            "gallery.delete" => apply_gallery_mutation(
                gallery,
                GalleryMutation::Delete {
                    id: memorilo_device_firmware::gallery::GalleryAssetId(
                        request.id.unwrap_or_default(),
                    ),
                },
            )
            .map_err(gallery_error_code),
            "gallery.reorder" => apply_gallery_mutation(
                gallery,
                GalleryMutation::Reorder {
                    order: request
                        .order
                        .unwrap_or_default()
                        .into_iter()
                        .map(memorilo_device_firmware::gallery::GalleryAssetId)
                        .collect(),
                },
            )
            .map_err(gallery_error_code),
            "gallery.slideshow" => apply_gallery_mutation(
                gallery,
                GalleryMutation::SetSlideshow {
                    interval_seconds: request.interval_seconds.flatten(),
                },
            )
            .map_err(gallery_error_code),
            _ => Err(ProtocolErrorCode::InvalidRequest),
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn gallery_error_code(
        error: memorilo_device_firmware::gallery::GalleryError,
    ) -> ProtocolErrorCode {
        use memorilo_device_firmware::gallery::GalleryError;
        match error {
            GalleryError::AssetNotFound => ProtocolErrorCode::AssetNotFound,
            GalleryError::CapacityExceeded => ProtocolErrorCode::CapacityExceeded,
            GalleryError::InvalidAssetLength { .. } => ProtocolErrorCode::InvalidAssetLength,
            GalleryError::InvalidAssetName => ProtocolErrorCode::InvalidAssetName,
            GalleryError::InvalidOrder => ProtocolErrorCode::InvalidOrder,
            GalleryError::InvalidSlideshowInterval => ProtocolErrorCode::InvalidSlideshowInterval,
            GalleryError::Storage(_) => ProtocolErrorCode::StorageFailure,
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn commit_todo_snapshot(
        request: &TodoRequest,
        now: Duration,
        network: &NetworkRuntime,
        application: &mut Application,
        status_service: &mut DeviceStatusService,
        persistence: &mut PersistenceManager<EspNvsBlobStore>,
        coordinator: &mut DisplayCoordinator,
        refresh_tx: &SyncSender<RefreshRequest>,
    ) -> Result<Option<ProtocolErrorCode>> {
        let mut candidate = application.persistent_state();
        synchronize_snapshot_time(
            &request.snapshot,
            &candidate.config.timezone,
            status_service,
        );
        let mut todo_sync = candidate.todo_sync.clone();
        match todo_sync.admit(
            request.snapshot.clone(),
            SnapshotSource::ClientLanPush,
            unix_seconds(),
        ) {
            Admission::Accepted { .. } | Admission::Unchanged => {
                candidate.todos = todo_sync.model.clone();
                candidate.todo_sync = todo_sync.clone();
            }
            Admission::Rejected(error) => {
                log::warn!("rejected TODO snapshot from provisioning: {error}");
                return Ok(Some(ProtocolErrorCode::InvalidRequest));
            }
        }
        persistence.schedule(candidate.clone(), now);
        if let Err(error) = persistence.flush() {
            log::error!("TODO provisioning commit failed: {error}");
            return Ok(Some(ProtocolErrorCode::StorageFailure));
        }
        let transition = application.dispatch(ApplicationCommand::TodosSynced(candidate.todos));
        application.dispatch(ApplicationCommand::TodoSyncStatus(todo_sync.clone()));
        network.publish_todos(todo_sync)?;
        queue_render(application, coordinator, refresh_tx, transition.render)?;
        Ok(None)
    }

    #[cfg(not(feature = "color-test"))]
    fn commit_provisioning_request(
        request: &ApplyConfigEnvelope,
        now: Duration,
        network: &NetworkRuntime,
        application: &mut Application,
        persistence: &mut PersistenceManager<EspNvsBlobStore>,
    ) -> Result<ApplyStatusEnvelope> {
        let rejected = |revision, error| ApplyStatusEnvelope {
            protocol_version: PROTOCOL_VERSION,
            request_id: request.request_id.clone(),
            status: ApplyStatus::Rejected,
            revision,
            error: Some(error),
        };
        let candidate = match apply_config(
            &application.persistent_state(),
            persistence.generation(),
            request,
        ) {
            Ok(candidate) => candidate,
            Err(error) => return Ok(rejected(persistence.generation(), error)),
        };

        persistence.schedule(candidate.clone(), now);
        if let Err(error) = persistence.flush() {
            log::error!("provisioning configuration commit failed: {error}");
            return Ok(rejected(
                persistence.generation(),
                ProtocolErrorCode::StorageFailure,
            ));
        }

        let applied = application.dispatch(ApplicationCommand::ConfigApplied(candidate.config));
        if applied
            .service_requests
            .contains(&ServiceRequest::Reconfigure(ServiceId::Network))
        {
            network.reconfigure(NetworkConfiguration::from_device_config(
                &application.snapshot().config,
            ))?;
        }
        log::info!(
            "provisioning configuration committed revision={}",
            persistence.generation()
        );
        Ok(ApplyStatusEnvelope {
            protocol_version: PROTOCOL_VERSION,
            request_id: request.request_id.clone(),
            status: ApplyStatus::Accepted,
            revision: persistence.generation(),
            error: None,
        })
    }

    #[cfg(not(feature = "color-test"))]
    fn device_info(
        persistence: &PersistenceManager<EspNvsBlobStore>,
    ) -> Result<DeviceInfoEnvelope> {
        Ok(DeviceInfoEnvelope {
            protocol_version: PROTOCOL_VERSION,
            config_schema_version: CONFIG_SCHEMA_VERSION,
            firmware_version: env!("CARGO_PKG_VERSION").into(),
            device_id: device_id()?,
            config_revision: persistence.generation(),
            capabilities: vec!["config-v1".into()],
        })
    }

    #[cfg(not(feature = "color-test"))]
    fn sync_provisioning_ui(
        application: &mut Application,
        coordinator: &mut DisplayCoordinator,
        refresh_tx: &SyncSender<RefreshRequest>,
        snapshot: ProvisioningSnapshot,
    ) -> Result<()> {
        let transition = application.dispatch(ApplicationCommand::ProvisioningUpdated(snapshot));
        queue_render(application, coordinator, refresh_tx, transition.render)
    }

    #[cfg(not(feature = "color-test"))]
    fn public_config(application: &Application, revision: u64) -> PublicConfigEnvelope {
        let config = application.snapshot().config.public();
        PublicConfigEnvelope {
            protocol_version: PROTOCOL_VERSION,
            config_schema_version: CONFIG_SCHEMA_VERSION,
            revision,
            device_name: config.device_name,
            wifi_ssid: config.wifi_ssid,
            wifi_password_is_set: config.wifi_password_is_set,
            local_management_token_is_set: config.local_management_token_is_set,
            timezone: config.timezone,
            idle_sleep_seconds: config.idle_sleep_seconds,
            selection_policy: config.selection_policy,
            weather: config.weather,
            almanac: config.almanac,
            todo_sync_enabled: config.todo_sync_enabled,
            todo_sync_url: application
                .snapshot()
                .config
                .todo_sync
                .https_base_url
                .clone(),
            todo_sync_token_is_set: application.snapshot().config.todo_sync.has_device_token(),
            todo_sync_poll_interval_seconds: application
                .snapshot()
                .config
                .todo_sync
                .poll_interval_seconds,
            todo_sync_view: config.todo_sync_view,
            todo_sync_mqtt_broker_url: application
                .snapshot()
                .config
                .todo_sync
                .mqtt_broker_url
                .clone(),
            todo_sync_mqtt_topic: application.snapshot().config.todo_sync.mqtt_topic.clone(),
            todo_sync_mqtt_username: application
                .snapshot()
                .config
                .todo_sync
                .mqtt_username
                .clone(),
            todo_sync_mqtt_password_is_set: application
                .snapshot()
                .config
                .todo_sync
                .has_mqtt_password(),
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn device_id() -> Result<String> {
        let mut mac = [0_u8; 6];
        esp_idf_sys::esp!(unsafe { esp_idf_sys::esp_efuse_mac_get_default(mac.as_mut_ptr()) })?;
        Ok(mac.iter().map(|byte| format!("{byte:02x}")).collect())
    }

    fn unix_timestamp() -> Option<i64> {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|duration| i64::try_from(duration.as_secs()).ok())
    }

    #[cfg(not(feature = "color-test"))]
    fn apply_gallery_mutation(
        gallery: &mut GalleryRepository<EspPartitionGalleryStorage>,
        mutation: GalleryMutation,
    ) -> Result<(), memorilo_device_firmware::gallery::GalleryError> {
        match mutation {
            GalleryMutation::Upload {
                name,
                created_at_unix_seconds,
                bytes,
            } => {
                gallery.insert(name, created_at_unix_seconds, &bytes)?;
            }
            GalleryMutation::Delete { id } => {
                gallery.delete(id)?;
            }
            GalleryMutation::Reorder { order } => gallery.reorder(&order)?,
            GalleryMutation::SetSlideshow { interval_seconds } => gallery.set_slideshow_interval(
                interval_seconds.map(|seconds| Duration::from_secs(u64::from(seconds))),
            )?,
        }
        Ok(())
    }

    #[cfg(not(feature = "color-test"))]
    fn sync_gallery_frame(
        application: &mut Application,
        gallery: &mut GalleryRepository<EspPartitionGalleryStorage>,
    ) {
        if application.snapshot().page != memorilo_device_firmware::application::PageId::Gallery {
            application.dispatch(ApplicationCommand::GalleryFrameLoaded(None));
            return;
        }
        let Some(asset) = application
            .snapshot()
            .gallery
            .catalog
            .assets
            .get(application.snapshot().gallery.selected)
        else {
            application.dispatch(ApplicationCommand::GalleryFrameLoaded(None));
            return;
        };
        match gallery.read_asset(asset.id) {
            Ok(bytes) => {
                application.dispatch(ApplicationCommand::GalleryFrameLoaded(Some(bytes)));
            }
            Err(error) => {
                application.dispatch(ApplicationCommand::GalleryFailed(error.to_string()));
            }
        }
    }

    #[cfg(not(feature = "color-test"))]
    struct DisplayResult {
        revision: u64,
        succeeded: bool,
    }

    #[cfg(not(feature = "color-test"))]
    fn queue_render(
        application: &mut Application,
        coordinator: &mut DisplayCoordinator,
        refresh_tx: &SyncSender<RefreshRequest>,
        intent: Option<RenderIntent>,
    ) -> Result<()> {
        let Some(intent) = intent else {
            return Ok(());
        };
        let mut framebuffer = application
            .snapshot()
            .gallery
            .selected_frame
            .clone()
            .filter(|_| {
                application.snapshot().page
                    == memorilo_device_firmware::application::PageId::Gallery
                    && application.snapshot().gallery.fullscreen
            })
            .unwrap_or_else(|| vec![0_u8; FRAME_BYTES]);
        if !application.snapshot().gallery.fullscreen
            || application.snapshot().page != memorilo_device_firmware::application::PageId::Gallery
        {
            ui::render(application.snapshot(), &mut framebuffer);
        }
        let output = coordinator
            .request(intent.revision, framebuffer, diagnostics::uptime())
            .context("display coordinator rejected a frame")?;
        apply_coordinator_output(application, refresh_tx, output)?;
        Ok(())
    }

    #[cfg(not(feature = "color-test"))]
    fn drain_display_results(
        application: &mut Application,
        coordinator: &mut DisplayCoordinator,
        refresh_tx: &SyncSender<RefreshRequest>,
        result_rx: &Receiver<DisplayResult>,
    ) -> Result<()> {
        loop {
            let result = match result_rx.try_recv() {
                Ok(result) => result,
                Err(TryRecvError::Empty) => return Ok(()),
                Err(TryRecvError::Disconnected) => bail!("display task stopped"),
            };
            let output = coordinator
                .complete(result.revision, result.succeeded, diagnostics::uptime())
                .context("display coordinator rejected a completion")?;
            apply_coordinator_output(application, refresh_tx, output)?;
        }
    }

    #[cfg(not(feature = "color-test"))]
    fn apply_coordinator_output(
        application: &mut Application,
        refresh_tx: &SyncSender<RefreshRequest>,
        output: CoordinatorOutput,
    ) -> Result<()> {
        for event in output.events {
            match event {
                DisplayEvent::Busy {
                    revision, delta, ..
                } => log::info!(
                    "display busy revision={} changed_pixels={} ratio_permyriad={} dirty_rect={:?}",
                    revision,
                    delta.changed_pixels,
                    delta.change_ratio_permyriad,
                    delta.dirty_rect
                ),
                DisplayEvent::Completed { revision } => {
                    log::info!("display completed revision={revision}")
                }
                DisplayEvent::Skipped { revision } => {
                    log::info!("display skipped identical revision={revision}")
                }
                DisplayEvent::Delayed {
                    revision,
                    ready_at,
                    delta,
                } => log::info!(
                    "display delayed revision={} ready_at_ms={} changed_pixels={}",
                    revision,
                    ready_at.as_millis(),
                    delta.changed_pixels
                ),
                DisplayEvent::Failed { revision } => {
                    log::error!("display failed revision={revision}")
                }
            }
            application.dispatch(ApplicationCommand::Display(event));
        }
        if let Some(refresh) = output.refresh {
            refresh_tx
                .send(refresh)
                .map_err(|_| anyhow::anyhow!("display task stopped"))?;
        }
        Ok(())
    }

    #[cfg(not(feature = "color-test"))]
    fn spawn_display_task(
        refresh_rx: Receiver<RefreshRequest>,
        result_tx: std::sync::mpsc::Sender<DisplayResult>,
        mut display: Display,
    ) -> Result<()> {
        thread::Builder::new()
            .name("display".into())
            .stack_size(64 * 1024)
            .spawn(move || {
                let mut refresh_sequence = 0_u32;
                while let Ok(request) = refresh_rx.recv() {
                    refresh_sequence = refresh_sequence.saturating_add(1);
                    let refresh = RefreshMeasurement::start(refresh_sequence);
                    let result = display.refresh(request.framebuffer());
                    let succeeded = result.is_ok();
                    refresh.finish(result.is_ok());
                    match &result {
                        Ok(()) => {
                            log::info!("displayed application revision={}", request.revision)
                        }
                        Err(error) => log::error!("display refresh failed: {error:#}"),
                    }
                    if result_tx
                        .send(DisplayResult {
                            revision: request.revision,
                            succeeded,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            })
            .context("display task creation failed")?;
        Ok(())
    }
}

#[cfg(target_os = "espidf")]
fn main() -> anyhow::Result<()> {
    // UI state and BLE initialization together exceed the ESP-IDF main task's stack.
    std::thread::Builder::new()
        .name("application".into())
        .stack_size(32 * 1024)
        .spawn(firmware::run)?
        .join()
        .map_err(|_| anyhow::anyhow!("application task panicked"))?
}

#[cfg(not(target_os = "espidf"))]
fn main() {
    println!("build this firmware for xtensa-esp32s3-espidf");
}
