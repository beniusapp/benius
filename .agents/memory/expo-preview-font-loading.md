---
name: Expo preview font loading
description: Keep slow custom-font asset loading from hiding the Expo app in Replit's browser preview.
---

Do not block the Expo Router tree or keep the root splash visible until an optional custom font loads. Render the app immediately with the platform font fallback, then let the custom font replace it when available.

**Why:** On 2026-09-25, the Replit Expo web preview stayed blank while the font-loading gate waited on an asset request; rendering without that gate made the sign-in screen visible.

**How to apply:** When a custom font is used, treat it as a progressive enhancement. Check the first preview render and avoid diagnosing a delayed font asset as an authentication or API failure.