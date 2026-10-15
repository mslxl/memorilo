# Client settings and subscription URL workflow

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

How does a connected Memorilo client expose and persist the feed settings?

Decide the owning feature and configuration schema, default values, URL generation, copy/open behavior, token redaction, rotate/revoke actions, language resources, and the user-visible workflow when changing an option requires updating an external calendar subscription.

## Answer

- Put the feature in the Todo settings page as a “Todo calendar subscription” section. Sync Server connection status gates whether the actions are available, but the feed presentation settings belong to the Todo feature because they describe which Todos the calendar receives.
- Persist non-secret options in the normal desktop configuration: `undated`, `completed`, `timeZone`, `beforeDays`, and `afterDays`. Defaults are `undated=today`, `completed=hide`, the current system IANA timezone, `beforeDays=30`, and `afterDays=365`.
- Persist the feed secret in an OS-protected main-process credential store, separate from `configuration.json`. The renderer receives only redacted state until it explicitly requests the current subscription URL for display/copy.
- The client uses the connected Sync Server device credential to create, rotate, and revoke the independent ICS feed credential. Creation is explicit; startup never creates a feed implicitly.
- After creation, the client may display the complete current URL repeatedly and may copy it or open the calendar integration flow. Displaying it again does not issue a new credential.
- Rotation creates a new secret and immediately invalidates the old URL. Revocation clears the local feed secret and leaves the feature unconfigured until the user creates a new subscription.
- Changing any presentation option regenerates the URL query parameters and clearly tells the user that an existing external calendar subscription must be updated to use the new URL. The server-side feed resource itself is not mutated.
- The UI must never put the secret in ordinary logs, telemetry, error text, accessibility labels, or non-secret configuration snapshots. All actions and failures use localized settings strings and structured errors at the IPC boundary.
