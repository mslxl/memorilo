# Feed credential and URL lifecycle

Type: grilling
Status: resolved
Blocked by: 01

## Question

How does a connected Memorilo client obtain, store, rotate, revoke, and embed the read-only ICS credential?

Decide whether the existing `todos:read` device token can safely serve calendar subscriptions or whether an explicit ICS scope/token type is required; define path versus query placement, expiry and revocation behavior, URL option encoding, and the consequences of client-local settings changing an already-subscribed URL.

## Answer

- Use an independent, read-only ICS feed credential rather than reusing the NOTE4C/device `todos:read` bearer token. Its authorization scope is dedicated to reading a Todo Calendar Feed and it has its own audit, rotation, and revocation lifecycle.
- The connected Memorilo client requests issuance through a Sync Server endpoint authenticated with the client's existing device credential. The server binds the feed credential to the account and requesting device, returns the secret once, and never lets the client mint or inspect another account's credentials.
- The feed credential is long-lived and remains valid until explicit rotation or revocation. The issue and revoke operations are user-initiated; startup must not silently create credentials.
- The credential is placed in the URL path because calendar clients need a normal subscribable URL and usually cannot send a custom `Authorization` header. Presentation settings remain ordinary query parameters:

  `https://server.example.com/calendar/<feed-secret>.ics?undated=today&completed=hide&tz=Asia%2FShanghai`

- Changing a client-local setting changes the generated subscription URL. Existing calendar subscriptions keep their previous behavior until the user updates their subscription URL; changing settings does not silently mutate a server-side feed resource.
- The server must treat the path secret as sensitive, redact it from application logs and audit details, and make rotation invalidate the previous secret immediately.
