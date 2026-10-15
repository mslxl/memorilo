# Canonical Todo ICS feed semantics

Type: grilling
Status: resolved
Blocked by: None

## Question

What exactly does one ICS feed contain and how should filtering behave?

Decide the meaning of `undated=today|hide`, the meaning of the product's `hide` wording, completed-item inclusion, whether journal dates can act as fallback dates, ordering and item limits, behavior for parent/child Todos, and the date/time basis for “request day”. The answer must define observable examples for empty, undated, completed, timed, and all-day tasks.

## Answer

- `completed` and `undated` are independent feed options. `completed=hide|show` controls completed Todos; `undated=today|hide` controls Todos without an explicit schedule.
- The default presentation is active work: completed items are hidden unless `completed=show` is present. Undated items are included by default as `undated=today`; the client can opt into `undated=hide`.
- “Request day” is calculated in the subscription's configured timezone. A Todo with `schedule.kind = none` is placed on that local date when `undated=today` is selected.
- `journalDate` is not an implicit due date and is never used as a fallback for this feed.
- Every Todo is exported as its own calendar event. A `Subtask` remains an independent event; its nearest Todo ancestor is retained as descriptive parent context rather than being used to suppress or merge the child.
- The feed is read-only. This ticket defines eligibility and identity semantics; transport limits, deterministic sort order, cache validators, and rate limits belong to the Sync Server endpoint ticket.

Examples:

- An undated active Todo with `undated=today` becomes an all-day event on the request date.
- The same Todo is absent with `undated=hide`.
- A completed Todo is absent by default and appears with `completed=show`.
- A Todo with `schedule.kind = deadline` and no time is an all-day event on its deadline date.
- A Todo with `schedule.kind = deadline` and a time, or `schedule.kind = span`, is a timed event according to the mapping decided by the ICS event ticket.
