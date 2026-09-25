---
name: Native mobile auth boundary
description: Why BENIUS native mobile authentication must remain separate from web authentication and its browser preview.
---

The native app uses a dedicated bearer-credential contract. The existing browser application remains on cookie sessions, and the Expo browser preview intentionally displays the native sign-in form without enabling sign-in.

Academic-session lists use the authenticated mobile endpoint; selected IDs are sent as `x-view-session-id` only to routes that validate the ID against the bearer principal's school. Support staff cannot list or select academic sessions.

Persist a session choice per school/role/user, but remove it on explicit logout or auth invalidation rather than React effect cleanup. Effect cleanup also runs on provider unmounts and identity changes, so deleting there silently erases a still-valid preference.

**Why:** A browser preview cannot use the native-only secure credential storage. Allowing cross-origin browser access to the native auth endpoints simply to make preview sign-in work would expand the credential surface without making the browser a supported mobile client. Unmount and account-key changes are not equivalent to a deliberate logout.

**How to apply:** For future mobile screens, keep credential storage native-only and avoid broad CORS changes for the Expo web preview. Capture the selected session in query keys and the `x-view-session-id` request context for any session-scoped API. Verify authenticated journeys on Android/iOS and use a separate disposable database for full credential-lifecycle fixtures; do not use a populated development database for destructive fixture tests.