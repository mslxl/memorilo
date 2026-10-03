use crate::framebuffer::FRAME_BYTES;
use crate::gallery::GalleryCatalog;
use crate::gallery::{GALLERY_CAPACITY_BYTES, MAX_GALLERY_ASSETS};
use crate::provisioning_protocol::{
    ApplyConfigEnvelope, ApplyStatusEnvelope, DeviceInfoEnvelope, GalleryRequest, MAX_JSON_BYTES,
    PROTOCOL_VERSION, ProtocolErrorCode, PublicConfigEnvelope, TodoRequest, WifiNetwork,
    parse_apply_request, parse_gallery_request, parse_todo_request,
};
use serde::Serialize;
use prost::Message;

pub const SERIAL_PROVISIONING_PREFIX: &str = "MEMORILO_PROVISIONING_V1 ";
// A base64 encoded gallery frame is roughly 40 KiB; keep line framing bounded.
const MAX_SERIAL_MESSAGE_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SerialProvisioningCommand {
    Read { request_id: String },
    ScanWifi { request_id: String },
    Apply(Box<ApplyConfigEnvelope>),
    Gallery(GalleryRequest),
    Todo(TodoRequest),
}

#[derive(Debug, Default)]
pub struct SerialProvisioningDecoder {
    buffered: Vec<u8>,
}

impl SerialProvisioningDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Result<SerialProvisioningCommand, String>> {
        self.buffered.extend_from_slice(bytes);
        let mut commands = Vec::new();
        loop {
            let prefix = SERIAL_PROVISIONING_PREFIX.as_bytes();
            if self.buffered.starts_with(prefix) && self.buffered.len() >= prefix.len() + 4 {
                let header = &self.buffered[prefix.len()..prefix.len() + 4];
                let length = u32::from_le_bytes(header.try_into().unwrap()) as usize;
                let binary_header = header[0] != b'{'
                    || header[1] == 0
                    || header[2] == 0
                    || header[3] == 0;
                if binary_header {
                    if length > MAX_SERIAL_MESSAGE_BYTES {
                        self.buffered.clear();
                        commands.push(Err("serial provisioning frame exceeds limit".into()));
                        continue;
                    }
                    let total = prefix.len() + 4 + length;
                    if self.buffered.len() < total {
                        break;
                    }
                    let payload = self.buffered[prefix.len() + 4..total].to_vec();
                    self.buffered.drain(..total);
                    commands.push(parse_todo_request(&payload).map(SerialProvisioningCommand::Todo).map_err(|error| format!("invalid TODO request: {error:?}")));
                    continue;
                }
            }
            let Some(newline) = self.buffered.iter().position(|byte| *byte == b'\n') else { break; };
            let mut line: Vec<_> = self.buffered.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.starts_with(SERIAL_PROVISIONING_PREFIX.as_bytes()) {
                commands.push(parse_command(&line[SERIAL_PROVISIONING_PREFIX.len()..]));
            }
        }
        if self.buffered.len() > MAX_SERIAL_MESSAGE_BYTES {
            self.buffered.clear();
            commands.push(Err("serial provisioning line exceeds limit".into()));
        }
        commands
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandHeader {
    operation: String,
    protocol_version: Option<u16>,
    request_id: Option<String>,
    request: Option<serde_json::Value>,
}

fn parse_command(json: &[u8]) -> Result<SerialProvisioningCommand, String> {
    if json.len() > MAX_SERIAL_MESSAGE_BYTES {
        return Err("serial provisioning request exceeds limit".into());
    }
    let header: CommandHeader =
        serde_json::from_slice(json).map_err(|_| "invalid serial provisioning JSON")?;
    match header.operation.as_str() {
        "read" => {
            if header.protocol_version != Some(PROTOCOL_VERSION) {
                return Err("unsupported serial provisioning protocol".into());
            }
            let request_id = header
                .request_id
                .filter(|value| !value.is_empty() && value.len() <= 64 && value.is_ascii())
                .ok_or("invalid serial provisioning request id")?;
            Ok(SerialProvisioningCommand::Read { request_id })
        }
        "scanWifi" => {
            if header.protocol_version != Some(PROTOCOL_VERSION) {
                return Err("unsupported serial provisioning protocol".into());
            }
            let request_id = header
                .request_id
                .filter(|value| !value.is_empty() && value.len() <= 64 && value.is_ascii())
                .ok_or("invalid serial provisioning request id")?;
            Ok(SerialProvisioningCommand::ScanWifi { request_id })
        }
        "apply" => {
            let request = header.request.ok_or("missing apply request")?;
            let request_json = serde_json::to_vec(&request).map_err(|_| "invalid apply request")?;
            if request_json.len() > MAX_JSON_BYTES {
                return Err("apply request exceeds limit".into());
            }
            parse_apply_request(&request_json)
                .map(Box::new)
                .map(SerialProvisioningCommand::Apply)
                .map_err(|error| format!("invalid apply request: {error:?}"))
        }
        operation if operation.starts_with("gallery.") => parse_gallery_request(json)
            .map(SerialProvisioningCommand::Gallery)
            .map_err(|error| format!("invalid gallery request: {error:?}")),
        "todo.sync" => parse_todo_request(json)
            .map(SerialProvisioningCommand::Todo)
            .map_err(|error| format!("invalid TODO request: {error:?}")),
        _ => Err("unsupported serial provisioning operation".into()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadResponse<'a> {
    operation: &'static str,
    request_id: &'a str,
    device_info: &'a DeviceInfoEnvelope,
    public_config: &'a PublicConfigEnvelope,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyResponse<'a> {
    operation: &'static str,
    request_id: &'a str,
    status: &'a ApplyStatusEnvelope,
}

pub fn encode_read_response(
    request_id: &str,
    device_info: &DeviceInfoEnvelope,
    public_config: &PublicConfigEnvelope,
) -> Result<Vec<u8>, serde_json::Error> {
    encode_response(&ReadResponse {
        operation: "read",
        request_id,
        device_info,
        public_config,
    })
}

pub fn encode_apply_response(
    request_id: &str,
    status: &ApplyStatusEnvelope,
) -> Result<Vec<u8>, serde_json::Error> {
    encode_response(&ApplyResponse {
        operation: "apply",
        request_id,
        status,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WifiScanResponse<'a> {
    operation: &'static str,
    request_id: &'a str,
    networks: &'a [WifiNetwork],
}

pub fn encode_wifi_scan_response(
    request_id: &str,
    networks: &[WifiNetwork],
) -> Result<Vec<u8>, serde_json::Error> {
    encode_response(&WifiScanResponse {
        operation: "scanWifi",
        request_id,
        networks,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryErrorResponse<'a> {
    operation: &'a str,
    request_id: &'a str,
    status: &'static str,
    error: ProtocolErrorCode,
}

/// Encodes a deterministic gallery response envelope. Concrete gallery
/// implementations can populate `gallery` while retaining this operation and
/// request correlation on both serial and BLE transports.
pub fn encode_gallery_error_response(
    operation: &str,
    request_id: &str,
    error: ProtocolErrorCode,
) -> Result<Vec<u8>, serde_json::Error> {
    encode_response(&GalleryErrorResponse {
        operation,
        request_id,
        status: "error",
        error,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryStatusResponse<'a> {
    operation: &'a str,
    request_id: &'a str,
    status: &'static str,
    gallery: GalleryStatus<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GalleryStatus<'a> {
    capacity_bytes: usize,
    catalog: &'a GalleryCatalog,
    full_refresh_seconds: u8,
    image_bytes: usize,
    last_error: Option<&'a str>,
    max_assets: usize,
    mutation_revision: u64,
}

pub fn encode_gallery_status_response(
    operation: &str,
    request_id: &str,
    catalog: &GalleryCatalog,
    mutation_revision: u64,
) -> Result<Vec<u8>, serde_json::Error> {
    encode_response(&GalleryStatusResponse {
        operation,
        request_id,
        status: "ok",
        gallery: GalleryStatus {
            capacity_bytes: GALLERY_CAPACITY_BYTES,
            catalog,
            full_refresh_seconds: 20,
            image_bytes: FRAME_BYTES,
            last_error: None,
            max_assets: MAX_GALLERY_ASSETS,
            mutation_revision,
        },
    })
}

pub fn encode_todo_response(
    request_id: &str,
    error: Option<ProtocolErrorCode>,
) -> Result<Vec<u8>, serde_json::Error> {
    let payload = crate::proto::memorilo::sync::v1::TodoSyncResponse {
        operation: "todo.sync".into(),
        request_id: request_id.into(),
        status: if error.is_some() { "rejected" } else { "accepted" }.into(),
        error: error.map(|value| format!("{value:?}")),
    }.encode_to_vec();
    let mut result = SERIAL_PROVISIONING_PREFIX.as_bytes().to_vec();
    result.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    result.extend_from_slice(&payload);
    Ok(result)
}

pub fn decode_gallery_bytes(value: &str) -> Result<Vec<u8>, &'static str> {
    let bytes = value.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err("invalid-base64");
    }
    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let a = base64_digit(chunk[0]).ok_or("invalid-base64")?;
        let b = base64_digit(chunk[1]).ok_or("invalid-base64")?;
        let c = if chunk[2] == b'=' {
            0
        } else {
            base64_digit(chunk[2]).ok_or("invalid-base64")?
        };
        let d = if chunk[3] == b'=' {
            0
        } else {
            base64_digit(chunk[3]).ok_or("invalid-base64")?
        };
        output.push((a << 2) | (b >> 4));
        if chunk[2] != b'=' {
            output.push((b << 4) | (c >> 2));
        }
        if chunk[3] != b'=' {
            output.push((c << 6) | d);
        }
    }
    Ok(output)
}

fn base64_digit(value: u8) -> Option<u8> {
    Some(match value {
        b'A'..=b'Z' => value - b'A',
        b'a'..=b'z' => value - b'a' + 26,
        b'0'..=b'9' => value - b'0' + 52,
        b'+' => 62,
        b'/' => 63,
        _ => return None,
    })
}

fn encode_response(response: &impl Serialize) -> Result<Vec<u8>, serde_json::Error> {
    let mut line = SERIAL_PROVISIONING_PREFIX.as_bytes().to_vec();
    line.extend(serde_json::to_vec(response)?);
    line.push(b'\n');
    Ok(line)
}

#[cfg(target_os = "espidf")]
mod transport {
    use std::ffi::{c_int, c_void};
    use std::sync::mpsc::{Receiver, TryRecvError, channel};
    use std::thread;

    use anyhow::{Context, Result, ensure};

    use super::{SerialProvisioningCommand, SerialProvisioningDecoder};

    #[repr(C)]
    struct UsbSerialJtagDriverConfig {
        tx_buffer_size: u32,
        rx_buffer_size: u32,
    }

    unsafe extern "C" {
        fn usb_serial_jtag_driver_install(config: *mut UsbSerialJtagDriverConfig) -> c_int;
        fn usb_serial_jtag_read_bytes(
            buffer: *mut c_void,
            length: u32,
            ticks_to_wait: u32,
        ) -> c_int;
        fn usb_serial_jtag_write_bytes(
            source: *const c_void,
            size: usize,
            ticks_to_wait: u32,
        ) -> c_int;
        fn usb_serial_jtag_vfs_use_driver();
    }

    pub struct SerialProvisioningTransport {
        commands: Receiver<SerialProvisioningCommand>,
    }

    impl SerialProvisioningTransport {
        pub fn open() -> Result<Self> {
            let mut config = UsbSerialJtagDriverConfig {
                tx_buffer_size: 8_192,
                rx_buffer_size: 8_192,
            };
            let result = unsafe { usb_serial_jtag_driver_install(&mut config) };
            ensure!(
                result == 0,
                "installing USB Serial/JTAG driver failed: {result}"
            );
            unsafe { usb_serial_jtag_vfs_use_driver() };

            let (command_tx, commands) = channel();
            thread::Builder::new()
                .name("provisioning-serial".into())
                .stack_size(8 * 1024)
                .spawn(move || {
                    let mut decoder = SerialProvisioningDecoder::default();
                    let mut buffer = [0_u8; 512];
                    loop {
                        let count = unsafe {
                            usb_serial_jtag_read_bytes(
                                buffer.as_mut_ptr().cast(),
                                buffer.len() as u32,
                                20,
                            )
                        };
                        if count <= 0 {
                            continue;
                        }
                        for command in decoder.push(&buffer[..count as usize]) {
                            match command {
                                Ok(command) => {
                                    if command_tx.send(command).is_err() {
                                        return;
                                    }
                                }
                                Err(error) => {
                                    log::warn!("ignored serial provisioning input: {error}")
                                }
                            }
                        }
                    }
                })
                .context("spawning USB serial provisioning task failed")?;
            Ok(Self { commands })
        }

        pub fn try_recv(&self) -> Result<Option<SerialProvisioningCommand>> {
            match self.commands.try_recv() {
                Ok(command) => Ok(Some(command)),
                Err(TryRecvError::Empty) => Ok(None),
                Err(TryRecvError::Disconnected) => {
                    anyhow::bail!("serial provisioning command channel disconnected")
                }
            }
        }

        pub fn write(&self, line: &[u8]) -> Result<()> {
            let written =
                unsafe { usb_serial_jtag_write_bytes(line.as_ptr().cast(), line.len(), 100) };
            ensure!(
                written == line.len() as c_int,
                "USB serial provisioning response was truncated: {written}/{}",
                line.len()
            );
            Ok(())
        }
    }
}

#[cfg(target_os = "espidf")]
pub use transport::SerialProvisioningTransport;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_logs_and_decodes_fragmented_commands() {
        let mut decoder = SerialProvisioningDecoder::default();
        assert!(
            decoder
                .push(b"I (12) boot: ready\nMEMORILO_PROV")
                .is_empty()
        );
        assert_eq!(
            decoder.push(b"ISIONING_V1 {\"operation\":\"read\",\"protocolVersion\":1,\"requestId\":\"read-1\"}\n"),
            vec![Ok(SerialProvisioningCommand::Read {
                request_id: "read-1".into(),
            })]
        );
    }

    #[test]
    fn apply_uses_the_shared_envelope_parser() {
        let mut decoder = SerialProvisioningDecoder::default();
        let commands = decoder.push(b"MEMORILO_PROVISIONING_V1 {\"operation\":\"apply\",\"request\":{\"protocolVersion\":1,\"requestId\":\"apply-1\",\"baseRevision\":4,\"requiredCapabilities\":[\"config-v1\"],\"config\":{\"deviceName\":\"Desk\"}}}\n");
        let Ok(SerialProvisioningCommand::Apply(request)) = &commands[0] else {
            panic!("expected apply command");
        };
        assert_eq!(request.request_id, "apply-1");
        assert_eq!(request.base_revision, 4);
    }
}
