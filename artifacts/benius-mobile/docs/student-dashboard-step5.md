# Step 5 — Native Student Home/Dashboard

## Scope and source

The source of truth is the responsive BENIUS web Student Home at
`artifacts/benius-web/src/pages/student-dashboard.tsx` (`/student-dashboard`,
entered through `/student-login`). This step adds only its native Student Home
equivalent. Step 4/4B remains closed with its documented native-device
limitation; this work does not replace its authentication or session handling.

At 390 × 844, the authenticated web URL redirected to Student Login because
there was no web Student session. For visual inspection, the actual web page
markup and styles were copied into a **temporary, isolated** preview with
in-memory visual data. That rendered reference showed the compact BENIUS
header, centered glass profile card, status pills, and two-column module grid.
The temporary preview was removed after inspection. This is a source-derived
visual reference, not a claim that the authenticated web dashboard or native
dashboard was rendered with a real account.

## API and data

Existing mobile endpoints reused by the authentication/session foundation:

- `GET /api/mobile/auth/me`, `POST /api/mobile/auth/refresh`, and
  `POST /api/mobile/auth/logout`
- `GET /api/mobile/academic-sessions` and
  `GET /api/mobile/academic-sessions/selection`

New read-only endpoint: `GET /api/mobile/student/dashboard` with a mobile
Student Bearer credential and `x-view-session-id`. It returns the verified
Student's ID, school ID, name, DSID, class, section, photo URL, school
name/code, selected session ID, attendance percent, unread notice count, and
whether positive non-Paid fees are outstanding. It uses existing storage
calculations rather than fetching whole-school lists. Archived attendance
uses the resolved historical class/section for that session. The homework
count and fee-portal settings are not fetched: the source web Home displays
neither, and its Homework tile cannot pulse.

The production bearer allowlist accepts only the exact GET dashboard path;
the route requires HTTPS, verified Student Bearer authentication, and a
school-validated Academic Session. The server derives Student and school
from the authenticated principal, never from a query parameter or route ID.
The Student/school record is checked again before returning data. The legacy
API response logger excludes the dashboard JSON body, which contains private
Student details.

## Authentication, isolation, and session switching

`AccountGate` renders this Home only after a verified `student` role; other
roles keep their existing Home. Requests use `apiGetForSession` and the
existing generation-aware refresh coordinator, with no cookie auth or
secondary refresh mechanism. Existing sign-out confirms the action, revokes
the mobile session, and only then clears local credentials; failures remain
visible. The browser preview intentionally cannot securely sign in.

The dashboard query key is
`['mobile/student/dashboard', schoolId, studentId, role, selectedSessionId]`.
It is disabled until the verified Student, valid selected school session,
and network are available. The existing session selector invalidates
session-sensitive queries on change; responses are validated against the
current Student, school, and session before display, so an old response
cannot show another Student's or school year's dashboard. The selected
archive shows the existing read-only archive banner. No archive mutations
or module destinations are implemented here.

## UI mapping

| Web Student Home | Native Student Home |
| --- | --- |
| Compact BENIUS/Student Portal header, session pill, sign-out control | Safe-area native header, existing `/sessions` selector, revocation-based native confirmation |
| Centered glass hero, avatar/photo, school, greeting, DSID/class pills | Native translucent/shadowed card, gradient avatar with photo/initials fallback, matching labels and pills |
| Attendance and unread-notice badges; archive warning when appropriate | Same conditional information and status colors; historical-session read-only banner |
| Two-column grid of 14 colored emoji cards | Same tile order, labels, emoji, accents, two-column layout, and notice/fee pulses |
| Student footer | School footer with the year calculated in Asia/Kolkata |

The 14 tiles are Profile, Attendance, Homework, Classwork, Noticeboard,
Fees, Examination, Complaints, Gallery, Faculty Info, School Calendar,
Leave, Timetable, and E-Library. Tapping an unbuilt tile explicitly says
it is unavailable in BENIUS Mobile; it does **not** pretend the module works.
The native screen has a loading skeleton, session loading/empty/error and
retry states, dashboard error and retry, offline messaging, and a photo
fallback. No permanent fake Student data or fallback metrics were added.

Native differences: CSS backdrop blur/radial lighting is approximated with
translucency, gradients, and shadows; emoji and font metrics can differ by
OS; safe-area spacing follows each device. Actual visual parity on Android
or iOS is **not verified** without a device/emulator and authenticated
Student session.

## IST and performance

Greeting changes at 12:00, 17:00, and midnight in Asia/Kolkata; the footer
year also follows IST, not the device timezone. The clock checks periodically
and on foreground return, but does not re-render the grid unless its
displayed greeting/year changes. The existing query fetches only visible
Home data, uses one authenticated/session-scoped request, and polls at most
once per 60 seconds while online and foregrounded so the notice and fee
badges can update. No unrelated Student, Teacher, or Admin dataset is loaded.

## Verification performed

- Mobile TypeScript: `pnpm --filter @workspace/benius-mobile run typecheck`
  **PASS**.
- Mobile tests: `pnpm --filter @workspace/benius-mobile run test`
  **PASS, 6/6** (refresh coordination, IST boundaries/year, safe photo URLs).
- Expo dependency check and doctor: `expo install --check` **PASS**;
  `expo-doctor` **PASS, 21/21**.
- Android bundle: `CI=1 pnpm exec expo export --platform android --output-dir
  /tmp/benius-step5-android` **PASS** (Metro bundled 1,860 modules).
  This validates bundling, not native execution.
- API policy and in-memory route tests (from `artifacts/api-server`):
  `pnpm dlx tsx --test src/mobile-auth-policy.test.ts
  src/mobile-auth-routes.test.ts` **PASS, 8/8**. These exercise the production
  bearer-gate middleware before route registration, exact-path allowlist,
  HTTPS rejection, private response-log classification, role authorization,
  school/Student/session isolation, malformed query/session identifiers,
  invalid and expired access tokens, refresh-token behavior, and logout.
- Web production build: `PORT=26203 BASE_PATH=/ pnpm --filter
  @workspace/benius-web run build` **PASS** with existing sourcemap,
  PostCSS, and chunk-size warnings. The Student login URL returned HTTP 200;
  existing web routes and cookie auth were not changed.
- API workflow build/start and schema validation: **PASS**; unauthenticated
  proxied dashboard request returned HTTP 401, not Student data. Expo workflow
  started and bundled the browser preview, which displayed the expected
  native-sign-in limitation screen.
- API-wide TypeScript check: **NOT PASSING** (375 errors across 10 existing
  server files, largely legacy route return-type and declaration problems).
  It is not reported as a successful Step 5 test; the focused API tests and
  running build are the checks for this change.
- `git diff --check`: **PASS**.

Not possible here: authenticated native Student dashboard rendering,
Android/iOS runtime interaction, native photo rendering, on-device network
switching, or a pixel-level screenshot comparison with the source. No
Android/iOS device or emulator is available. The Expo browser preview is
not a substitute for a native sign-in client. These items remain unverified,
not failed or fabricated.

No Student Examination, Attendance, Fees, Timetable, Notices, Profile, other
Student module, Teacher module, or Admin module was started in Step 5.