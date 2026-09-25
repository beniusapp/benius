# BENIUS Mobile native-replica status

## Inventory basis

Inventory is derived from the current native Expo Router screens/components
and the web route table in `artifacts/benius-web/src/App.tsx`. “Partial” means
the native surface and live API-backed behavior exist, but module parity is
not complete. A visible “Coming to mobile” tile or a role-filtered dashboard
is navigation/presentation, not an implemented module.

## Current native surfaces

| Area | Native route / surface | Status and limits |
| --- | --- | --- |
| Student Home | `/` after verified Student login | Partial working dashboard; API-backed identity/summary/session data and all 14 source tiles. Only Profile, Attendance, Homework, and Classwork lead to native modules. |
| Student Profile | `/student-profile` | Partial working profile read/edit, submission, photo, and password flows; global identity scope. See `student-navigation-step6.md`. |
| Student Attendance | `/student/attendance` | Partial working session-scoped reports and native print flow. |
| Student Homework | `/student/homework` | Partial working session-scoped listing, detail, file submission, and private attachment handling. |
| Student Classwork | `/student/classwork` | Partial working session-scoped listing and resource viewing. |
| Teacher dashboard | `/` after verified Teacher login | Partial working dashboard and API-backed Teacher identity/approval count; only Teacher Profile is navigable as a native module. |
| Teacher Profile | `/teacher/profile` | Partial working read view, photo change, and password change. |
| Admin dashboard | `/` after verified Admin login | Partial working API-backed overview, role-visible dashboard tiles, navigation drawer and read-only Admin profile. The 19 module tiles are not implemented modules. |
| Support Staff dashboard | `/` after verified Support Staff login | Partial working API-backed overview; top-level tiles and metrics are filtered by server-provided allowed module IDs. It has no native module destinations or Admin profile mutation flow. |

## Not complete

- **Student:** 10 of the 14 Student Home destinations remain unbuilt:
  Noticeboard, Fees, Examination, Complaints, Gallery, Faculty Info, School
  Calendar, Leave, Timetable, and E-Library. Their tiles explicitly report
  unavailable; no native module implementation is claimed.
- **Teacher:** 13 of 14 Teacher dashboard tiles remain unbuilt: Attendance,
  Homework, Classwork, Noticeboard, Complaint, Examination, Gallery, Faculty
  Info, School Calendar, Library, Leave, Timetable, and Approval Center.
- **Admin:** all 19 Admin modules remain unbuilt: School Setup, Timetable
  Master, School Calendar, Attendance Overview, Exam Controller, Complaint
  Hub, Noticeboard, Approval Center, Leave Requests, Teacher Registry, Support
  Staff, Faculty Mapping, Student Registry, Fees & Payments, Performance
  Analytics, Audit Logs, Visitor Log, ID Card Gen, and Assets & Inventory.
  Native tiles are display-only. Support Staff sees only granted top-level
  tiles; child grants alone do not create a native module.
- **Account mutations:** complete account-management parity is not available.
  Student profile save/submit/photo/password and Teacher photo/password paths
  exist, but this does not complete all web account flows. Admin profile is
  read-only; Support Staff has no profile surface in the web source. Admin
  account, school, recovery, PIN, password, logo/signature, and audit mutations
  are not implemented as native flows.

The runtime app does not contain fake/placeholder records or fabricated
dashboard metrics. Temporary source-derived visual-preview fixtures used
for inspection were removed from the isolated sandbox.

## Verification

Verified on this workspace:

- Mobile TypeScript and 30 unit tests passed.
- Expo dependency alignment and Expo Doctor passed (21/21 checks).
- Android and iOS JavaScript bundle exports passed from the same Expo codebase;
  Expo public configuration includes both platform targets. This is not an
  installed native binary or App Store/Play Store build.
- Eight top-level API policy/route tests passed through production middleware;
  the API bundle built and its managed workflow started cleanly.
- The BENIUS web production build passed with the required build-time `PORT`
  and `BASE_PATH` variables. Public Student, Teacher, and Admin login routes
  returned HTTP 200; the Student login rendered at a 390 × 844 viewport.
- The Expo browser preview rendered the native-only sign-in boundary on a
  second capture after Metro's cold bundle. It does not permit browser sign-in.

Authenticated Student/Teacher/Admin/Support Staff native-device rendering,
uploads, file opening, printing, and end-to-end interaction remain unverified:
no Android/iOS device or emulator was available. Neither pixel parity nor
complete functional parity is claimed. Existing API TypeScript diagnostics in
legacy modules remain; the API production bundle and targeted tests passed.