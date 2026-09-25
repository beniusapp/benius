---
name: Native mobile auth boundary
description: Why BENIUS native mobile authentication must remain separate from web authentication and its browser preview.
---

The native app uses a dedicated bearer-credential contract. The existing browser application remains on cookie sessions, and the Expo browser preview intentionally displays the native sign-in form without enabling sign-in.

Academic-session lists use the authenticated mobile endpoint; selected IDs are sent as `x-view-session-id` only to routes that validate the ID against the bearer principal's school. Support staff cannot list or select academic sessions.

Persist a session choice per school/role/user, but remove it on explicit logout or auth invalidation rather than React effect cleanup. Effect cleanup also runs on provider unmounts and identity changes, so deleting there silently erases a still-valid preference.

Refresh coordination must be generation-aware and principal-bound. A delayed 401 for a credential already rotated should reuse the newer credential for the same principal; refresh or cleanup must not cross into another signed-in identity.

**Why:** A browser preview cannot use the native-only secure credential storage. Allowing cross-origin browser access to the native auth endpoints simply to make preview sign-in work would expand the credential surface without making the browser a supported mobile client. A pending-only refresh promise also misses late 401s after rotation, while stale responses must not clear another login.

**How to apply:** For future mobile screens, keep credential storage native-only and avoid broad CORS changes for the Expo web preview. Capture the selected session in query keys and the `x-view-session-id` request context for any session-scoped API. Coordinate refresh by both access-token generation and principal; cover concurrent and delayed 401s with deferred-promise tests. Verify authenticated journeys on Android/iOS and use a separate disposable database for full credential-lifecycle fixtures; do not use a populated development database for destructive fixture tests.