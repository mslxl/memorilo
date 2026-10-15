# NOTE4 device TODO API

The sync server exposes a small device-facing Interface for native ESP-IDF firmware. It is intentionally separate from the desktop libp2p/Loro protocol.

## Provisioning

An authenticated browser session creates a device credential:

```http
POST /api/devices/todo-token
X-CSRF-Token: <browser-csrf-token>
Content-Type: application/json

{"deviceName":"NOTE4","expiresAt":<unix-ms>,"scopes":["todos:read"]}
```

`expiresAt` must be in the future and no more than one year from issuance. The response contains the bearer credential exactly once. Store it in NOTE4's protected storage. Credentials can be listed with `GET /api/devices/todo-tokens` and revoked with `POST /api/devices/todo-tokens/:deviceId/revoke`.

## Read-only synchronization

```http
GET /api/device/v1/todos?view=today&date=2026-09-01&limit=20
Authorization: Bearer memorilo-todo-v1....
```

`view=today` returns active tasks whose due date (or journal date) is the requested date. `view=all` returns all active tasks. Each item contains a stable opaque `id`, display text, status, date/time, and the nearest Todo parent. The response has a revision in the top-level `revision`, suitable for cache validation.

The server returns an `ETag` for the top-level revision and answers `304 Not Modified` when `If-None-Match` matches. NOTE4 should keep its last successful snapshot and avoid an EPD refresh for a 304 response.

Malformed requests return `400`; expired or invalid credentials return `401`; missing scopes return `403`; an account without authoritative Note state returns `503`; and unexpected server failures return `500`. Device Todo reads are rate limited independently of the general API limit.

## Completion and reopening

The current device API is read-only. The server does not expose a
`/api/device/v1/todo-actions` route yet, so NOTE4 cannot complete or reopen
TODOs through this API. The firmware integration must continue to treat the
snapshot returned by `GET /api/device/v1/todos` as authoritative.

Use TLS, a device-specific credential, and the narrowest scope required. Do not embed a Memorilo account password in firmware.

## Todo calendar subscription

Calendar clients subscribe to the read-only ICS resource directly. It is not a JSON API route:

```http
GET /calendar/<calendar-feed-secret>.ics?undated=today&completed=hide&tz=Asia%2FShanghai
```

The feed secret is issued once by the authenticated management endpoint:

```http
POST /api/devices/todo-calendar-token
X-CSRF-Token: <browser-csrf-token>
Content-Type: application/json

{"deviceId":"desktop-1","deviceName":"Desktop"}
```

Rotate by issuing again for the same device, or revoke with
`POST /api/devices/todo-calendar-tokens/:deviceId/revoke`. Rotation immediately
invalidates the previous subscription URL.

A paired desktop client uses its existing Sync Server device credential to manage
the feed without browser cookies or CSRF:

```http
POST /api/device/v1/todo-calendar-token
Authorization: Bearer <sync-device-credential>
Content-Type: application/json

{"deviceName":"Desktop"}
```

The client can revoke its own feed with
`POST /api/device/v1/todo-calendar-token/revoke`. The desktop application keeps
the returned calendar secret in the operating system credential store and only
exposes the complete `/calendar/<secret>.ics` URL when the user requests it.
