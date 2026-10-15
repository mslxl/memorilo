# Sync Server Todo ICS Feed

Label: wayfinder:map

## Destination

Produce an execution-ready specification for exposing a user's Todo items as a read-only ICS subscription through the Sync Server, with settings owned by the connected Memorilo client. The route is clear when the feed semantics, token and URL contract, ICS mapping, server behavior, client settings flow, and acceptance matrix are decided.

This map plans the work; it does not implement production code.

## Notes

Domain: Sync Server read-only Todo projection, ICS serialization, and desktop client configuration.

Consult `domain-modeling` for Todo/feed terminology and durable decisions, `grilling` for product and security choices, `codebase-design` for service boundaries, and `research` only when an external calendar compatibility fact is required. Reuse the existing device Todo projection and token/revocation model where the contracts remain appropriate. Follow the repository's Effect-TS and i18n rules when implementation tickets are later executed.

Standing decisions from the conversation:

- The feed is consumed by external calendar clients through a GET-only ICS endpoint.
- Settings are owned and persisted by a Memorilo client connected to the Sync Server.
- An undated Todo may be emitted on the date of the request; the behavior must be configurable.
- Feed options are represented in the generated subscription URL when they are client-local.
- POST/GET/DELETE feed-resource CRUD is out of scope; token issuance/revocation may reuse existing management endpoints.
- The canonical export is a read-only calendar feed. Todo mutation through ICS is out of scope.

## Decisions so far

- [Canonical Todo ICS feed semantics](issues/01-canonical-feed-semantics.md): `completed` and `undated` are independent options; undated items default to the request day in the subscription timezone; journal dates are not implicit due dates; every Todo and Subtask remains an independent event.
- [Feed credential and URL lifecycle](issues/02-feed-credential-and-url-contract.md): use an independent long-lived ICS read credential issued through the connected client's device authorization; put the secret in the path and client-local presentation settings in query parameters.
- [ICS event mapping, timezone, and recurrence](issues/03-ics-event-mapping-and-timezone.md): migrate to explicit `none`/`deadline`/`span` schedules; share one recurrence projection with the in-app calendar; materialize calculable occurrences, while completion-based rules expose only the persisted current occurrence.
- [Sync Server ICS endpoint and cache contract](issues/04-sync-server-feed-endpoint-and-cache.md): add a dedicated GET feed service with a rolling -30/+365-day default window, relative client overrides, bounded projection, and revision-aware ETag/304 caching.
- [Client settings and subscription URL workflow](issues/05-client-settings-and-subscription-ux.md): keep presentation options in Todo settings, protect the feed secret in the main process, and support repeated URL display plus explicit create/rotate/revoke actions.
- [ICS feed acceptance matrix and delivery sequence](issues/06-acceptance-matrix-and-delivery-sequence.md): execute a breaking six-phase migration with shared recurrence projection, independent serializer and server/client integration gates, followed by full repository and Electron verification.

## Not yet specified

- Whether the feed reads the existing bounded device Todo projection or needs a separate unbounded/calendar-specific projection.
- None. The destination is now specified; implementation can proceed through the six ordered phases in the final ticket.

## Out of scope

- Two-way calendar synchronization or importing external calendar changes into Memorilo.
- Creating `VTODO` items as the primary interchange format.
- Desktop-local HTTP hosting as the production cross-device solution.
- Changes to the Note/Loro sync protocol or account tenancy model.
- General calendar subscription management unrelated to Memorilo Todo export.
