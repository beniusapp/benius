# Academic Session Route Compatibility

The web role routes are separate handlers, not aliases for the mobile endpoint.
They share the same school-scoped, newest-first session list, but differ in how
they authenticate and derive the school.

| Route | Authorization and tenant source | Response |
| --- | --- | --- |
| `GET /api/admin/academic-sessions` | Existing web session; requires admin role and a session school ID. | Raw session array. |
| `GET /api/teacher/academic-sessions` | Existing web session; requires a teacher ID, resolves that teacher, and derives school from the teacher record. | Raw session array. |
| `GET /api/student/academic-sessions` | Existing web session; requires a student ID, resolves that student, and derives school from the student record. | Raw session array. |
| `GET /api/mobile/academic-sessions` | HTTPS mobile bearer session; derives school from the verified mobile principal and rejects support staff. | `{ sessions, activeSessionId }`. |

All four list handlers use the same school-scoped session collection. None of
the web list routes consumes `x-view-session-id` or returns a selected/default
session. Mobile returns the school's active session ID separately; the mobile
selection endpoint is a distinct bearer-authenticated route that validates the
requested session against the principal's school.

Source references:

- `artifacts/api-server/src/routes/routes.ts`
- `artifacts/api-server/src/teacher-routes.ts`
- `artifacts/api-server/src/mobile-auth-routes.ts`
- `artifacts/api-server/src/storage.ts`