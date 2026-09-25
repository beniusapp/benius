# BENIUS Mobile — foundation

This is a separate Expo Router / React Native / TypeScript artifact, not a WebView of the BENIUS web app. The approved multi-artifact workspace uses `artifacts/benius-mobile/` instead of the originally requested root `mobile/` directory. The existing web app remains at `/`, so the mobile preview is registered at `/benius-mobile/`.

## Run

From the workspace root, use the managed `artifacts/benius-mobile: expo` workflow, or `pnpm --filter @workspace/benius-mobile run typecheck` for static checks. Open the Replit mobile preview and use its Expo Go phone option for Android/iOS development. A development build is only necessary when a future native dependency requires it. The Expo workflow supplies `EXPO_PUBLIC_DOMAIN` at bundle time; on a different host configure it to the reachable backend domain **without** a scheme. Do not put credentials or secrets in `EXPO_PUBLIC_*`.

## Structure and boundaries

- `app/` is native navigation. Authenticated role-specific homes, account, settings and Session selection are foundation screens; module rows explicitly say “Future phase.”
- `components/` contains small native primitives and the role gate. `contexts/` owns auth, connectivity and Session selection. `lib/api.ts` is the one future API transport boundary. `lib/date.ts` applies the school's IST policy.
- The backend currently uses `express-session` browser cookies, with separate admin/student/teacher flows and admin PIN initialization. **There is no approved native authentication transport.** The login screen deliberately has no credential form: collecting a password when sign-in cannot work would mislead users. `AuthTransport` returns no restored user and rejects login. Before enabling sign-in, agree on a server-verified native session/token exchange and refresh/revocation contract, then implement `restore`, `login`, `logout`, `token` and `currentUser` together; restoration must confirm role and school with the server before navigation. Only approved session material belongs in `expo-secure-store`. Never store passwords or PINs, rely on a web cookie jar, or assign a role based on the selected UI.
- `apiGet` requires a verified auth token before requests; it uses a bounded timeout, abort signal, normalized errors, one retry for safe GETs, and a centralized 401 callback. Writes are intentionally absent, especially while offline. Native connection changes display a banner.
- Only after verified authentication, Session queries use existing school-scoped `/api/student/academic-sessions`, `/api/teacher/academic-sessions`, or `/api/admin/academic-sessions`. The provider accepts only IDs returned for the user's school, persists the selection keyed by verified identity and clears it on identity switch/logout. Session IDs are sent in a header only when a future endpoint explicitly needs them; they are **not** authorization or an arbitrary school selector. Before using an endpoint, verify its actual Session header contract.
- Server collections should use TanStack Query and paginated `FlatList`/`useInfiniteQuery` when the API has a cursor/page contract. There is no role collection loaded in this foundation. Session picker uses FlatList and pull-to-refresh.
- PostgreSQL DATE values are formatted as calendar values, never converted through a device timezone. Bare persisted timestamps follow BENIUS' UTC-wall-clock convention and are displayed in `Asia/Kolkata`.

## Later phases

Approve and implement native authentication plus per-role current-user verification; then add authorized role modules and API contracts incrementally. Do not ship the current blocked-login foundation as a working school app. Audit pre-existing backend authorization and session-cookie settings before any live mobile release: the current Express session configuration sets `secure: false` and has a fallback session secret, neither of which is appropriate for production native authentication.