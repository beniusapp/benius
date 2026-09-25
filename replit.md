# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

- BENIUS Mobile is a genuine native Expo app using the same backend and school-scoped business rules as BENIUS Web. Mobile bearer authentication remains separate from web cookie sessions.
- Authentication identifies a principal and school; the selected Academic Session is separate, changeable context. Every future mobile session-sensitive endpoint must validate both the bearer principal's school and the selected Academic Session on the server. The `x-view-session-id` header alone is not proof of ownership.
- Do not run a destructive Drizzle schema push against the populated BENIUS database. Review additive SQL and preserve existing records.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

- The existing BENIUS web application's **actual responsive/mobile interface and interactions are the primary source of truth** for every future native screen. Match its structure, navigation, text, controls, colors, hierarchy, states, and workflows with native React Native components; do not independently redesign or use a WebView as a shortcut. Document unavoidable native deviations.
- Keep application/business/display time in `Asia/Kolkata`. Calendar dates are not device-local instants.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
