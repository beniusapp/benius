---
name: Native mobile auth boundary
description: Why BENIUS native mobile authentication must remain separate from web authentication and its browser preview.
---

The native app uses a dedicated bearer-credential contract. The existing browser application remains on cookie sessions, and the Expo browser preview intentionally displays the native sign-in form without enabling sign-in.

**Why:** A browser preview cannot use the native-only secure credential storage. Allowing cross-origin browser access to the native auth endpoints simply to make preview sign-in work would expand the credential surface without making the browser a supported mobile client.

**How to apply:** For future mobile screens, keep credential storage native-only and avoid broad CORS changes for the Expo web preview. Verify authenticated journeys on Android/iOS and use a separate disposable database for full credential-lifecycle fixtures; do not use the populated development database for destructive fixture tests.