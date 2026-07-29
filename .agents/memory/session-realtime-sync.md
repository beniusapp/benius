---
name: Session Real-time Sync (SSE)
description: How admin session activate/delete pushes instantly to teacher and student portals via SSE, and the two bugs that were fixed.
---

## Architecture
- `server/sse.ts` — maintains a `Map<schoolId, Set<Response>>` of connected SSE clients.
- `server/routes.ts GET /api/events/session-change` — SSE endpoint; teachers, admins, and students connect here on load.
- On admin **activate**: `broadcastSessionActivated()` → all clients receive `{ type: "session-activated" }`.
- On admin **delete**: `broadcastSessionDeleted()` → all clients receive `{ type: "session-deleted" }`.
- `client/src/contexts/student-session-provider.tsx` — handles both events; invalidates `["/api/student/academic-sessions"]` and resets selected session to null (auto-picks active).
- `client/src/pages/teacher-dashboard.tsx` — handles both events; invalidates `["/api/teacher/academic-sessions"]` and resets `viewingSessionId` to null.

## Bugs fixed (July 2026)

### Bug 1: Delete never broadcast
- The `DELETE /api/admin/academic-sessions/:id` route called `storage.deleteAcademicSession()` and returned — no SSE broadcast.
- Fix: added `broadcastSessionDeleted(schoolId, { sessionId: id })` after the successful delete response.
- Added `broadcastSessionDeleted()` to `server/sse.ts` alongside the existing `broadcastSessionActivated()`.

### Bug 2: Students rejected from SSE (401)
- Student login only sets `req.session.studentId`; it does NOT set `req.session.userId` or `req.session.schoolId`.
- The SSE endpoint guard was `if (!req.session.userId || !schoolId)` — this rejected all students with 401.
- Fix: endpoint now derives `schoolId` from `storage.getStudentById(req.session.studentId)` when `req.session.schoolId` is absent, and accepts any of `userId / teacherId / studentId` as proof of authentication.

## How to extend
To push any other real-time event to all portals of a school, use the private `broadcastToSchool(schoolId, payload)` helper inside `server/sse.ts` (or export a new named function that calls it).
