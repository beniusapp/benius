# BENIUS Web → Mobile UI Fidelity Map

The responsive BENIUS web application is the source of truth. Translate each
screen's existing layout and interaction into native React Native controls; do
not impose a single generic mobile-card layout on web screens that use different
patterns. This map documents the current foundation and does not claim the
unbuilt module screens already have native equivalents.

## Responsive source review

The screen notes below are source-derived layout reviews at 390 × 844, using
responsive web page markup/styles and the native implementations. They do not
claim a live authenticated web render, native screenshot, or pixel-level
comparison. Authenticated native-device parity remains unverified.

| BENIUS web pattern | Current native foundation | Fidelity rule / remaining gap |
| --- | --- | --- |
| App shell, header, sidebar/drawer, responsive navigation | Expo Router native stack, safe-area wrapper, role dashboards and Admin drawer (`app/_layout.tsx`, `app/index.tsx`) | Preserve source navigation and state. Student Home routes Profile, Attendance, Homework, and Classwork; Teacher Profile is routed; Admin drawer tiles remain display-only. Other module destinations are unbuilt. |
| Button variants and actions (`artifacts/benius-web/src/components/ui/button.tsx`) | `Button` in `artifacts/benius-mobile/components/Foundation.tsx` | Preserve the source action label, variant, hierarchy, and disabled/loading behavior. Native touch sizing may differ where platform accessibility requires it. |
| Labeled inputs (`artifacts/benius-web/src/components/ui/input.tsx`, form patterns) | `Field` in `artifacts/benius-mobile/components/Foundation.tsx` | Preserve labels, validation, input mode, and error text. Password/PIN values remain transient and are never persisted. |
| Selects and dropdowns | No shared native select/dropdown primitive yet | When a source web flow uses one, reproduce its options and behavior with an accessible native picker or modal; do not substitute an unrelated control. |
| Cards (`artifacts/benius-web/src/components/ui/card.tsx` and bespoke responsive cards) | `Card` in `artifacts/benius-mobile/components/Foundation.tsx` | Match the specific source screen: generic web cards and bespoke glass/student cards are different patterns, not one universal card. |
| Tables and responsive data lists | Native lists/cards and session picker | Match each source list's labels, order, and row actions. The reviewed module screens below use cards/calendars rather than a complete native module table system. |
| Tabs (`artifacts/benius-web/src/components/ui/tabs.tsx`) | No reusable native tabs yet | Preserve the source tab labels, selected state, and horizontal overflow behavior when a matching screen is built. |
| Dialogs and confirmations | Native `Alert.alert` is used for sign-out confirmation | Use a native confirmation for equivalent simple actions; richer web dialogs need a native modal with the same content and actions. No reusable rich dialog exists yet. |
| Toasts | No reusable native toast exists | Do not silently replace a web toast with a different workflow. A future native equivalent must preserve message, severity, and dismissal behavior. |
| Alerts and offline/error messages | Inline accessible `State` and offline banner in `components/Foundation.tsx` | Preserve severity, message, retry action, and accessibility announcement. |
| Badges and status labels | Session status currently uses inline text and color | Future badges must retain source wording and meaning; no shared native Badge primitive exists. |
| Loading, empty, and error states | `State` in `components/Foundation.tsx`; session skeleton, empty and retry states in `components/Authenticated.tsx` | Keep the same state meaning and recovery action as the corresponding web screen. |
| Typography, colors, spacing, icons | `artifacts/benius-mobile/constants/colors.ts`, Open Sans font in `artifacts/benius-mobile/app/_layout.tsx`, Feather icons | Reuse web tokens and font roles; Feather icons are the native semantic equivalents of web Lucide icons. Preserve page-specific spacing and palette rather than forcing one style across all web modules. |
| Search and filters | No mobile module search/filter flows yet | Reproduce the corresponding web controls and filter behavior only when that module is authorized; do not invent filters in the foundation. |

The web application has multiple responsive visual patterns. Native surfaces
approximate several working screens but do not establish parity across unbuilt
modules. Native tabs, reusable rich dialogs, toasts, shared badges, selects,
module tables, search, and filters remain incomplete.

## Step 5: Student Home

The responsive `/student-dashboard` is the first authenticated web screen
translated into a native module surface. Its compact header, session control,
profile hero, conditional badges, archive notice, and all 14 emoji module
tiles are mapped to native components in the same order and two-column
mobile hierarchy. Web-only backdrop blur and radial lighting are approximated
with native translucency/gradients/shadows. Unbuilt tile destinations give an
explicit unavailable message instead of claiming those modules exist.

A 390 × 844 source-derived reference of the actual web markup/styles was
reviewed; direct access to the authenticated web route redirected to login.
The browser Expo preview likewise stops at the native-only sign-in boundary.
Native visual parity cannot be confirmed without an authenticated Android/iOS
device or emulator. See `docs/student-dashboard-step5.md` for the dashboard
endpoint, identity/session rules, earlier verification record, and
limitations.

## Source-derived 390 × 844 module reviews

These are layout/pattern notes from responsive source and current native
implementations, not verified screenshots. Web sources are under
`artifacts/benius-web/src/pages`; native implementations are the listed Expo
routes/components.

| Source screen | Responsive web composition | Native screen and approximate differences |
| --- | --- | --- |
| Student Profile (`/student-profile`) | Compact light header; verification/status notice; identity/photo; two-column information grid; menu-driven verification edit and security actions. | `app/student-profile.tsx`: light scrollable profile card, status notice, identity/photo, paired fields, edit/security modes. Same information hierarchy; native spacing, font metrics, picker, and menu/modal behavior differ. |
| Student Attendance (`/student/attendance`) | Light attendance report with summary statistics, monthly calendar, monthly/yearly views, legend/status colors, and print/export action. | `app/student/attendance.tsx`: report hierarchy with native cards, calendar controls, horizontal yearly chart, and OS print dialog. Native chart/print appearance and controls are approximate. |
| Student Homework (`/student/homework`) | Light/pastel subject cards, calendar/date selection, submission state, detail and upload flow. | `app/student/homework.tsx`: pastel cards/calendar, native detail drawer and document picker; downloaded PDF opens/shares through native sharing rather than browser behavior. |
| Student Classwork (`/student/classwork`) | Light/pastel resource list with subject/resource badges and date selection. | `app/student/classwork.tsx`: pastel cards/calendar with image/video presentation; PDFs and unsupported resources open externally or use a fallback, not a fully embedded native PDF viewer. |
| Teacher Dashboard (`/teacher-dashboard`) | Dark workspace header, greeting/assignment indicators, grouped Classroom/School Life/Administration tile grids. | `components/TeacherDashboard.tsx`: dark grouped two-column cards and session/profile controls. Native tiles are taller; only Profile navigates, 13 module destinations are unbuilt. |
| Teacher Profile (Teacher dashboard destination) | Dark profile identity/photo, account fields, options/security controls. | `app/teacher/profile.tsx`: dark identity card, read-only field list, native photo picker and password modal. Platform UI/crop details differ; photo/password actions do not imply full profile-edit parity. |
| Admin Dashboard (`/admin-dashboard`) | Dark school command dashboard, role-visible metrics, grouped module navigation, account/menu actions. | `components/AdminDashboard.tsx`: dark metrics and grouped cards with native drawer. All 19 module cards are informational; Admin profile is read-only. |
| Support Staff Dashboard (`/admin-dashboard`) | Shared dashboard whose visible modules/metrics depend on account permissions. | Same native dashboard component filters to server-granted top-level module IDs and related metrics. No module destinations or profile mutations are implemented. |

Role dashboards use mobile APIs and explicit loading/error/offline states; tile
labels are not evidence that their destinations work. Student Home has 14
tiles, of which Profile, Attendance, Homework, and Classwork have native
screens. Teacher has one native module destination (Profile); Admin's 19 tiles
are informational. See `docs/native-replica-status.md` for remaining modules
and verification limits.