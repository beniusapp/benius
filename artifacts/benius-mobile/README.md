# BENIUS Mobile — foundation

This is a separate Expo Router / React Native / TypeScript artifact, not a WebView of the BENIUS web app. The approved multi-artifact workspace uses `artifacts/benius-mobile/` instead of the originally requested root `mobile/` directory. The existing web app remains at `/`, so the mobile preview is registered at `/benius-mobile/`.

## Run

From the workspace root, use the managed `artifacts/benius-mobile: expo` workflow, or `pnpm --filter @workspace/benius-mobile run typecheck` for static checks. Open the Replit mobile preview and use its Expo Go phone option for Android/iOS development. A development build is only necessary when a future native dependency requires it. The Expo workflow supplies `EXPO_PUBLIC_DOMAIN` at bundle time; on a different host configure it to the reachable backend domain **without** a scheme. Do not put credentials or secrets in `EXPO_PUBLIC_*`.

## Structure and boundaries

- `app/` is native navigation. Authenticated role-specific homes, account, settings and Session selection are foundation screens; module rows explicitly say “Future phase.”
- `components/` contains small native primitives and the role gate. `contexts/` owns auth, connectivity and Session selection. `lib/api.ts` is the mobile bearer transport boundary. `lib/date.ts` applies the school's IST policy.
- Native authentication is separate from the existing web cookie session. `/api/mobile/auth` provides role-specific credential exchange, challenge flows, short-lived access credentials, refresh rotation, `/me`, and revocation. Only opaque access/refresh material belongs in native `expo-secure-store`; never store passwords or PINs, rely on a web cookie jar, or assign a role based on the selected UI. The browser preview intentionally cannot sign in.
- `apiGet` requires a verified bearer session; it uses a bounded timeout, abort signal, normalized errors, a single-flight refresh path for 401s, and one retry of the eligible request. Writes are intentionally absent, especially while offline. Native connection changes display a banner.
- The mobile Session provider loads `/api/mobile/academic-sessions` with the verified bearer identity. It accepts sessions only from the user's school, validates a restored ID against that server response, persists by school/role/user, and removes the preference on logout. Explicit session-scoped requests use the backend's `x-view-session-id` contract; the server validates positive IDs against the authenticated school. Session IDs are not authorization or an arbitrary school selector.
- Server collections should use TanStack Query and paginated `FlatList`/`useInfiniteQuery` when the API has a cursor/page contract. There is no role collection loaded in this foundation. Session picker uses FlatList and pull-to-refresh.
- PostgreSQL DATE values are formatted as calendar values, never converted through a device timezone. Bare persisted timestamps follow BENIUS' UTC-wall-clock convention and are displayed in `Asia/Kolkata`.

## Later phases

Add authorized role modules and API contracts incrementally; do not present the current foundation as a full school app. Keep web authentication unchanged. Before any live release, review both native bearer lifecycle and the existing web cookie/session configuration for the deployment environment.