# Sync Server ICS endpoint and cache contract

Type: grilling
Status: resolved
Blocked by: 02, 03

## Question

What should the Sync Server's GET endpoint do at the HTTP and service boundaries?

Decide the public route, authentication and authorization flow, projection ownership, bounds, deterministic ordering, ETag/Last-Modified calculation, 304 behavior, cache-control, rate limiting, error responses, request-date/timezone handling, audit/log redaction, and whether the endpoint may reuse or must extend the existing device Todo module.

## Answer

- Add a dedicated `GET /calendar/<feed-secret>.ics` route handled by a `TodoCalendarFeed` service. It shares token authorization, normalized Todo projection, and recurrence expansion with the existing device Todo path, but does not reuse the device API's bounded JSON pagination contract.
- The feed renders a rolling window relative to the request day in the URL's configured timezone. Defaults are 30 days before the request day through 365 days after it. Client-local settings may override this with bounded relative parameters such as `beforeDays` and `afterDays`; absolute dates are not the default because they would make a copied subscription silently stale.
- The service queries the authoritative account projection, normalizes each Todo's `none`/`deadline`/`span` schedule, and uses the shared recurrence projection to materialize events within the window. It applies the previously decided `completed` and `undated` filters before expansion.
- Responses use `Content-Type: text/calendar; charset=utf-8`, a private cache policy, and validators. `ETag` includes the account Todo revision, all URL presentation options, timezone, effective request day, rolling window, and relevant subscribed-calendar snapshot versions. An unchanged conditional request returns `304 Not Modified` with no calendar body.
- The route applies authentication and authorization before projection, accepts only safe GET semantics, and rate-limits polling by feed credential. Secrets are redacted from access logs, application logs, audit records, error messages, and metrics labels.
- Bounds are mandatory: validate query options and timezone, cap the expanded occurrence count and serialized bytes, and return typed errors for invalid options or an output that cannot fit the feed contract (`400` for malformed options, `401/403` for credential failures, `413` for output-size overflow, and `422` for semantically invalid but well-formed feed options). The exact numeric limits are implementation acceptance criteria, not domain semantics.
- Deterministic ordering is by effective start date, timed start when present, completion rank, title, and stable event identity. The endpoint must not include a task twice when the persisted occurrence is also present in the recurrence preview.
