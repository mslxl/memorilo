# ICS feed acceptance matrix and delivery sequence

Type: grilling
Status: resolved
Blocked by: 03, 04, 05

## Question

What evidence is required before implementation is considered complete, and in what order should the work land?

Define pure serializer fixtures, server contract tests, token/revocation tests, cache/304 tests, timezone and date-boundary cases, renderer settings tests, Electron E2E coverage, migration concerns, and the smallest ordered implementation tickets that can be handed to agents after wayfinding.

## Answer

The implementation is accepted as one breaking migration with no dual-read or dual-write compatibility path.

### Ordered implementation phases

1. **Todo Schedule and shared recurrence projection**
   - Replace the ambiguous schedule attributes with explicit `none`, `deadline`, and `span` domain values in the editor schema, storage contracts, CRDT projection, and desktop API.
   - Add one pure occurrence projection that returns the persisted current occurrence plus calculable future occurrences for a requested window.
   - Make the in-app calendar and recurrence picker use that projection. Completion-based rules must not produce speculative future occurrences.
   - Migrate existing stored Notes and remove the old field combinations in the same release.
2. **ICS serializer**
   - Add a public pure serializer at the task integration boundary, exported through the package public API.
   - Serialize `VEVENT` with CRLF line endings, RFC text escaping, line folding, stable occurrence UIDs, timezone-aware timed values, date-only all-day values, completion status, parent context, and no external `RRULE` source of truth.
   - Test the serializer independently of Electron, Hono, and SQLite.
3. **Sync Server credential and GET feed**
   - Add the account/device-bound ICS feed credential type and issue/rotate/revoke operations.
   - Add `GET /calendar/<feed-secret>.ics`, the rolling window defaults and relative overrides, the shared authoritative projection, ETag/304 handling, bounds, rate limiting, and secret redaction.
4. **Desktop secure storage and settings**
   - Add an encrypted main-process feed-secret store and typed IPC/client service for issue, rotate, revoke, and current URL retrieval.
   - Add Todo settings for `undated`, `completed`, `timeZone`, `beforeDays`, and `afterDays`, with the agreed defaults and localized copy/rotate/revoke workflow.
5. **End-to-end integration**
   - Exercise client pairing, feed credential issuance, URL generation, external GET retrieval, Todo mutations, recurrence expansion, ETag refresh, URL option changes, rotation, and revocation through the real server boundary.
6. **Cleanup and release documentation**
   - Remove old schedule readers/writers, update public contracts and locale resources, record migration/recovery behavior, and update the implementation documentation and ADR links.

### Acceptance matrix

- **Domain and migration:** fixtures for `none`, `deadline`, `span`, invalid mixed schedules, all-day spans, timed spans, and one-time migration of existing Notes; no old-field compatibility path remains.
- **Recurrence:** due/custom/holiday/lunar expansion matches the in-app calendar for the same range and holiday snapshot; completion mode exposes only the persisted occurrence until completion creates the next one; occurrence identity is stable and persisted items are not duplicated by previews.
- **Serializer:** golden ICS fixtures cover all-day events, timed events with and without end, timezone boundaries, Unicode and escaped text, line folding, completed items, parent context, stable UIDs, and empty feeds.
- **Server:** credential scope/ownership, issue/rotate/revoke, unauthorized and revoked requests, URL option validation, rolling windows, occurrence and byte bounds, deterministic ordering, ETag/304, rate limits, and redacted logs/audit fields.
- **Desktop:** encrypted secret storage, configuration defaults/migration, IPC error mapping, URL generation, repeated display/copy, option-change notices, rotation/revocation state, and i18n structure across supported locales.
- **Electron E2E:** a paired desktop obtains a feed, an external HTTP client reads it, a Todo mutation changes the feed revision, an unchanged request returns 304, recurrence and timezone behavior match the desktop calendar, and rotation/revocation take effect.
- **Repository gates:** targeted package tests/lint/typecheck first, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, the affected desktop build, and `pnpm test:e2e` with `MEMORILO_E2E_HIDE_WINDOW=1`.
