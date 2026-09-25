# Step 6 — Student Profile and navigation audit

## Scope and source

This closes the Student Profile audit following Step 5. The responsive web
reference is `artifacts/benius-web/src/pages/student-dashboard.tsx` and
`student-profile.tsx`. The first Student Home tile is **Profile** and routes to
`/student-profile`; the native `StudentDashboard` tile uses the same label and
route. Native Expo Router registers `app/student-profile.tsx` as
`student-profile`.

This step documents the current native screen and its contract; it does not
change web, API, or sandbox code. The web is the visual and behavioral source
of truth. At 390 × 844, the responsive source composition is a compact header,
status notice, identity card, two-column detail fields, and profile actions.
The native screen uses a light, scrollable profile card, identity/photo area,
status notice, paired information fields, and separate edit/security modes.
Spacing, font metrics, native image picker UI, and safe-area insets are
approximations, not pixel parity.

## Identity, API, and scope

The profile is **global to the authenticated Student**, not scoped to an
academic session. `app/student-profile.tsx` uses identity-only `apiGet` /
`apiPost` requests (Bearer authorization, no `x-view-session-id`) and a query
key containing school ID, Student ID, and role:

- `GET /api/mobile/student/profile` loads the Student, profile, approved
  snapshot, and monthly verification-attempt allowance.
- `POST /api/mobile/student/profile` saves profile details.
- `POST /api/mobile/student/profile/submit` submits saved details for teacher
  verification.
- `POST /api/mobile/student/profile/photo` uploads a profile photo.
- `POST /api/mobile/student/profile/change-password` changes the password.

The API derives the Student and tenant from the authenticated Bearer principal;
the native response is checked against the signed-in Student ID and, when
present, the school ID. Mutations target that same authenticated identity, not
a client-supplied Student ID. The verification-attempt limit is a profile rule,
not an academic session selector.

Profile read data is refetched on screen mount (`staleTime: 0`). A successful
detail save updates the cached profile and submits it; if submission fails, the
screen reports that the details were saved but submission failed and
invalidates the query for recovery. Successful submissions and photo uploads
update then invalidate the identity-scoped cache. Passwords are transient form
state only; after a successful password change the old mobile credentials are
cleared and the screen requires sign-in again.

## Navigation, actions, and states

- The first Student Home tile opens `/student-profile`. The profile header
  returns Home; while editing or in Security it offers Cancel. Hardware back
  closes the menu or leaves an edit/security mode before navigating. The
  profile route disables stack swipe gestures so an in-progress form is not
  accidentally discarded.
- Read mode shows verification status, current profile fields and, when
  available, last-verified data. Edit mode's **Submit for Approval** action
  saves the details and then submits them for verification. Photo upload requests media-library permission,
  validates a JPEG/PNG/WebP photo up to 1 MiB, and shows teacher-review state.
  Security mode validates the current/new/confirmation values and changes the
  password.
- Loading has a profile skeleton. Missing/offline data, request errors,
  unavailable profile data, and mutation failures have explicit messages;
  load failures can be retried. Offline state blocks network reads/mutations
  and is surfaced in the screen. Previously cached profile data may remain
  visible while offline; it is not presented as a successful refresh.
- School calendar dates use the shared date-only formatting rules; profile
  instants are displayed in Asia/Kolkata (IST), independent of device timezone.

## Differences and verification status

The web crop/editor and native `ImagePicker` crop flow are platform-dependent;
native requests square editing, but exact crop controls/output are not
guaranteed to match web. Attendance PDF/print and homework/classwork PDF
handling elsewhere in the native app also differ from browser behavior:
attendance invokes the OS print dialog with generated HTML, homework opens or
shares a downloaded PDF through native sharing, and classwork PDF resources
open externally rather than in an embedded native PDF viewer.

Relevant existing tests are `artifacts/benius-mobile/test/student-profile-pure.test.mjs`
and the API policy/route tests in `artifacts/api-server/src/mobile-auth-policy.test.ts`
and `mobile-auth-routes.test.ts`; they cover profile helpers, Bearer route
allowlisting and server-side profile behavior. The final mobile suite passed
30 tests and the two API test files passed 8 top-level tests. These are
automated checks, not authenticated native-device interaction.

There is no authenticated Android/iOS device or emulator verification recorded
for this audit. Browser Expo preview is not native-device validation. Native
photo crop behavior, actual device navigation/keyboard interactions, and
pixel-level 390 × 844 parity therefore remain unverified.

The Step 6 “stop” is superseded by the newer request to continue the mobile
replica. This document closes the Profile audit only; it is not a project stop
or a claim that the remaining mobile modules are complete. See
`docs/native-replica-status.md` for the current inventory.