# Device provisioning protocol v1

Memorilo configures a device over either a five-minute, physically initiated BLE session or a physical USB Serial/JTAG connection. Both transports expose the same device-information, redacted-configuration, configuration-patch, and apply-status envelopes. BLE uses LE Secure Connections with MITM protection, a displayed six-digit passkey, bonding, and authenticated access on every characteristic. Normal mode does not advertise the BLE service. USB serial relies on physical possession of the connected device and remains available while the firmware is running.

## GATT service

| Purpose | UUID | Access |
| --- | --- | --- |
| Service | `7b7a1010-6c6f-4d65-8a8b-6d656d6f7269` | — |
| Device information | `7b7a1001-6c6f-4d65-8a8b-6d656d6f7269` | authenticated read |
| Redacted configuration | `7b7a1002-6c6f-4d65-8a8b-6d656d6f7269` | authenticated read |
| Redacted configuration continuation | `7b7a1005-6c6f-4d65-8a8b-6d656d6f7269` | authenticated read |
| Configuration apply | `7b7a1003-6c6f-4d65-8a8b-6d656d6f7269` | authenticated write |
| Status | `7b7a1004-6c6f-4d65-8a8b-6d656d6f7269` | authenticated read/notify |
| Wi-Fi scan | `7b7a1006-6c6f-4d65-8a8b-6d656d6f7269` | authenticated write/notify |
| Gallery and TODO sync | `7b7a1007-6c6f-4d65-8a8b-6d656d6f7269` | authenticated write/notify |

Device information reports protocol/config schema versions, firmware version, device ID, current configuration revision, and capabilities. Redacted configuration reports `wifiPasswordIsSet` and `localManagementTokenIsSet`, but never password or token material.

## Apply transaction

An apply request contains `protocolVersion`, an ASCII `requestId` of at most 64 bytes, `baseRevision`, required capabilities, and a configuration patch. Missing optional fields mean “leave unchanged.” A Wi-Fi password is write-only; `clearPassword` explicitly removes it. A local management token is also write-only, must contain 32–128 ASCII characters, and is removed only by `clearToken`. Unknown configuration fields are retained only as forward-compatible input and ignored by firmware v1. Unknown required capabilities fail.

The firmware rejects a request when `baseRevision` differs from the durable configuration revision. It validates a complete candidate configuration, writes it atomically, then sends one definitive status carrying the new revision before it disconnects or reconfigures radios. Replaying an accepted old revision therefore returns `stale-revision`.

Stable error codes are `authentication-required`, `configuration-mode-required`, `unsupported-protocol`, `unsupported-capability`, `invalid-request`, `stale-revision`, `checksum-mismatch`, `request-too-large`, `timeout`, and `storage-failure`.

## USB serial transport

The desktop opens the selected Web Serial port at 115200 baud. Configuration,
Wi-Fi, and gallery requests and responses are newline-delimited UTF-8 JSON
prefixed with `MEMORILO_PROVISIONING_V1 `. TODO synchronization uses a binary
frame with the same prefix, a little-endian `u32` payload length, and a
Protobuf payload. Firmware logs share the same USB Serial/JTAG stream, so
clients must ignore every line without that exact prefix. Every serial message
is limited to 64 KiB.

A read request contains `operation: "read"`, `protocolVersion`, and `requestId`. Its response contains the same request ID plus `deviceInfo` and `publicConfig`. An apply request contains `operation: "apply"` and the same `ApplyConfigEnvelope` sent through the BLE apply characteristic. Its response contains the same `ApplyStatusEnvelope` emitted through the BLE status characteristic. The firmware routes both transports through one persistence, validation, application dispatch, and network reconfiguration transaction.

The `scanWifi` request contains `protocolVersion` and `requestId`. Over USB
serial it is a newline-delimited request; over BLE it is written to the Wi-Fi
scan characteristic. The response contains the request ID and a bounded list of
`{ ssid, rssi, security }` entries and is delivered on the same transport. Empty
SSIDs are omitted because they represent hidden networks; users can still enter
those names manually in the Device Settings SSID field.

### TODO synchronization

Both transports also accept a bounded `todo.sync` request on the gallery
characteristic/serial envelope. The request and response use the shared
`TodoSyncRequest` and `TodoSyncResponse` Protobuf messages. BLE carries the
Protobuf bytes in the normal chunk frames. Serial carries them in the binary
frame described above.

The response is `accepted` or `rejected`. `items: []` is a valid authoritative
snapshot and clears the device's retained TODO model; it is never treated as a
missing update. Device Settings sends the current Desktop snapshot immediately
after a BLE or USB Serial connection is established, so a newly provisioned
device starts empty until Desktop supplies TODO data.

### Glance-page configuration

The redacted configuration and configuration patch may contain these optional, non-secret objects. A missing object in a patch means "leave unchanged."

| Object | Fields | Validation |
| --- | --- | --- |
| `weather` | `enabled`, `locationName`, `latitudeE6`, `longitudeE6` | Location is at most 32 characters and is required when enabled. Coordinates are signed integer microdegrees in the latitude range -90,000,000 to 90,000,000 and longitude range -180,000,000 to 180,000,000. |

Weather is fetched only when it is enabled, Wi-Fi is online, trusted time has synchronized, and the bounded scheduler says the cache is due. The current firmware provider returns visibly labeled demo data; this protocol does not imply an external weather service or transmit weather credentials.

## Framing and limits

JSON payloads are UTF-8 and limited to 64 KiB. TODO Protobuf payloads use the
same binary GATT frames with an 18-byte little-endian header followed by at
most 384 payload bytes. The CRC covers the complete payload bytes:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0 | 2 | ASCII `MP` |
| 2 | 1 | frame version (`1`) |
| 3 | 1 | bit 0 start, bit 1 end |
| 4 | 4 | request token |
| 8 | 2 | zero-based chunk index |
| 10 | 2 | chunk count, maximum 256 |
| 12 | 2 | payload length |
| 14 | 4 | IEEE CRC-32 of the complete JSON |

Chunks may arrive in order or be reconstructed by index, but mixed request tokens, duplicate/missing indexes, inconsistent metadata, oversize messages, and checksum failures are rejected. An incomplete assembly expires after 15 seconds. A completed request must receive a final status within 30 seconds.

The canonical cross-language vector is [`provisioning-v1.json`](../packages/device-provisioning/test-vectors/provisioning-v1.json). Rust and TypeScript tests both verify its exact bytes and CRC.

## Trusted local management

When Wi-Fi and a local management token are configured, the device exposes an authenticated HTTP surface on its assigned LAN address. Every request requires `Authorization: Bearer <token>`. The token is generated by the desktop main process, sent once to the device over a provisioning apply transaction, and saved by Memorilo with Electron `safeStorage`, isolated by device ID. Neither the device nor the desktop renderer can read the token back from provisioning state.

Ordinary JSON and command requests are limited to 1024 body bytes. Gallery uploads are the only exception and must be exactly 30,000 bytes: one packed 400×300 2bpp BWRY frame. The allowlist is:

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/v1/status` | bounded device and network status |
| `GET` | `/v1/gallery` | bounded gallery metadata, storage limits, last mutation result, and full-refresh cost |
| `GET` | `/v1/todos` | bounded TODO status (JSON status projection) |
| `POST` | `/v1/todos` | enqueue a `TodoSnapshot` Protobuf payload |
| `POST` | `/v1/gallery/assets` | enqueue one exact packed frame; percent-encoded name and Unix timestamp are supplied in bounded headers |
| `POST` | `/v1/gallery/delete` | enqueue `{ "id": number }` |
| `POST` | `/v1/gallery/reorder` | enqueue `{ "order": number[] }` containing every current asset ID once |
| `POST` | `/v1/gallery/slideshow` | enqueue `{ "intervalSeconds": number | null }`; enabled intervals are at least five minutes |
| `POST` | `/v1/commands/refresh` | enqueue a display refresh |
| `POST` | `/v1/commands/next-page` | enqueue page navigation |
| `POST` | `/v1/commands/sleep` | request sleep |

Mutating commands return `202` only after entering the bounded application queue. A TODO push uses `application/x-protobuf` with the shared `TodoSnapshot` message and returns a `TodoSyncResponse` Protobuf body. The application main loop owns all gallery index and partition writes; HTTP workers never call the display or retained C panel driver. Clients observe completion by polling `/v1/gallery` until `mutationRevision` advances, then check `lastError`. Missing or incorrect authentication returns `401`, malformed or incorrectly sized gallery bodies return `400`, oversized ordinary requests return `413`, disallowed methods return `405`, and a saturated command queue returns `503`. Audit logs record only the command kind and outcome, never credentials.

Memorilo's renderer passes only the device ID, a user-entered private IPv4 address or generated `memorilo-*.local` discovery name, and operation data through the preload bridge. The Electron main process loads the encrypted token, restricts literal addresses to RFC1918 or link-local IPv4 targets, adds the Bearer header, rejects redirects, and bounds response parsing. The token is never returned to renderer code. Address and device ID are not cryptographically bound yet, so verify the configured target before enabling LAN management; challenge/response is a future hardening step.
## Wi-Fi network selection

Desktop can request a `scanWifi` operation after connecting over USB serial or
BLE. The device performs the scan and returns bounded `{ ssid, rssi, security }`
entries using the same provisioning session exposed by the Device Settings UI.
The SSID text field remains editable so hidden networks can be configured without
a scan result.

## Gallery over every transport

The Device Gallery uses one transport-neutral command contract. When a provisioning
session is connected, the same UI dispatches `gallery.list`, `gallery.upload`,
`gallery.delete`, `gallery.reorder`, and `gallery.slideshow` over authenticated BLE
GATT (characteristic `7b7a1007-6c6f-4d65-8a8b-6d656d6f7269`) or USB serial. BLE uses
the binary framing above; serial uses the line envelope and base64 for image bytes.
When no provisioning session is active, the existing authenticated LAN HTTP client
remains the fallback. Thus Wi-Fi is no longer required for gallery operations.
