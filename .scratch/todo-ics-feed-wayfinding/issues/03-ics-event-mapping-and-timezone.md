# ICS event mapping, timezone, and recurrence

Type: grilling
Status: resolved
Blocked by: 01

## Question

How are Memorilo Todo fields represented as interoperable ICS events?

Decide `VEVENT` versus `VTODO`, stable UID construction, all-day and timed DTSTART/DTEND rules, timezone representation, escaping and line folding, completed status, descriptions/URLs, and how Memorilo's completion-based, holiday, lunar, and custom repeat rules map to a feed without inventing incorrect RFC 5545 recurrence data.

## Comments

- The schedule model will be migrated directly without a compatibility layer. The new domain shape must distinguish an explicit `deadline` from an explicit `span`; existing ambiguous fields do not remain as an alternate input contract.
- The current decision direction is one `VEVENT` representation: `deadline` without a time is all-day, `deadline` with a time is a point event, `span` uses start/end, and `none` becomes an all-day event on the request day when the feed's `undated=today` policy includes it.

## Answer

- Migrate the Todo schedule model directly to an explicit discriminated shape: `none`, `deadline`, or `span`. Do not preserve the old ambiguous field combination as a compatibility input.
- Keep one recurrence projection as the source of truth for both the in-app Todo calendar and the ICS feed. The shared operation should return the persisted current occurrence plus any preview occurrences in a requested date range; the renderer and Sync Server must not each implement their own recurrence loop.
- Reuse the existing pure recurrence engine and subscribed holiday-calendar inputs from `@memorilo/editor/task`. Refactor `previewTaskRecurrenceDates`/`nextTaskOccurrenceDate` behind the new projection rather than copying the logic into the server.
- For `due`, `custom`, `holiday`, and `lunar` rules, expand every occurrence that the shared recurrence engine can calculate within the feed's bounded horizon. This keeps the external calendar preview aligned with the application's calendar preview, including holiday and lunar rules.
- For `completion` rules, emit the currently persisted occurrence only. The next occurrence date cannot be known until the current Todo is completed; after completion creates the next persisted occurrence, the next feed refresh emits it. Do not invent future completion-based events.
- Do not use ICS `RRULE`, `RECURRENCE-ID`, or a separate external recurrence series as the source of truth. Materialize projected occurrences as individual `VEVENT`s with stable identities derived from the Todo identity and occurrence key/date.
- The persisted current occurrence is never duplicated by the preview list. `none` is represented as an all-day occurrence on the request day when `undated=today` is selected; `undated=hide` omits it.
- The feed endpoint ticket still decides the finite expansion horizon, maximum occurrence count, ordering, ETag inputs, and how holiday calendar snapshots are made available to the server projection.
