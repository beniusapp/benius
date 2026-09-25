---
name: Native mobile auth boundary
description: Why BENIUS native mobile authentication must remain separate from web authentication and its browser preview.
---

The native app uses a dedicated bearer-credential contract. The existing browser application remains on cookie sessions, and the Expo browser preview intentionally displays the native sign-in form without enabling sign-in.

Academic-session lists use the authenticated mobile endpoint; selected IDs are sent as `x-view-session-id` only to routes that validate the ID against the bearer principal's school. Support staff cannot list or select academic sessions.

Persist a session choice per school/role/user, but remove it on explicit logout or auth invalidation rather than React effect cleanup. Effect cleanup also runs on provider unmounts and identity changes, so deleting there silently erases a still-valid preference.

Refresh coordination must be generation-aware and principal-bound. A delayed 401 for a credential already rotated should reuse the newer credential for the same principal; refresh or cleanup must not cross into another signed-in identity.

New bearer-protected mobile API routes must pass the production bearer gate through an exact, narrow allowance, require HTTPS before processing credentials, and keep private response bodies out of request logs. A direct route-only test is not sufficient.

**Why:** A browser preview cannot use native-only secure credential storage. Allowing cross-origin browser access to native auth endpoints would expand the credential surface without making the browser a supported mobile client. A pending-only refresh promise misses late 401s after rotation, while stale responses must not clear another login. A dashboard route passed its direct unit test but the earlier production bearer gate would reject every request, and the legacy JSON logger would record private Student data.

**How to apply:** For future mobile screens, keep credential storage native-only and avoid broad CORS changes for the Expo web preview. Capture the selected session in query keys and `x-view-session-id` request context for session-scoped APIs. Coordinate refresh by access-token generation and principal; cover concurrent and delayed 401s with deferred-promise tests. Test new protected routes with the production middleware order, including HTTPS, exact-path admission and response-body logging. Verify authenticated journeys on Android/iOS and use a separate disposable database for full credential-lifecycle fixtures; do not use a populated development database for destructive fixture tests.