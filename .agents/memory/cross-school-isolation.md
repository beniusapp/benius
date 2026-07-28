---
name: Cross-School Data Isolation Audit
description: Results of the full backend audit for cross-school data leaks, what was fixed, and the safe pattern to follow for new code.
---

## What was audited
Every route and storage function in server/routes.ts, server/teacher-routes.ts, and server/storage.ts was checked for routes that accept a user-supplied ID without verifying the record belongs to the requester's school.

## Confirmed vulnerabilities fixed (July 2026)

### 1. DELETE /api/calendar/:id (teacher-routes.ts)
- **Was:** Called `deleteCalendarEvent(id)` with no schoolId check — any admin could delete any school's event.
- **Fix:** Switched to `deleteCalendarEventBySchool(id, req.session.schoolId!)` which has `AND schoolId = $2` in the WHERE clause. Returns 404 if not found (was silent success before).

### 2. PATCH /api/classwork/:id (teacher-routes.ts)
- **Was:** Only checked `cw.teacherId !== req.session.teacherId`; `updateClasswork(id, data)` had no schoolId in WHERE.
- **Fix:** Added explicit `cw.schoolId !== req.session.schoolId` route check; `updateClasswork` signature changed to `(id, schoolId, data)` with `AND schoolId = $2` in WHERE.

### 3. DELETE /api/classwork/:id (teacher-routes.ts)
- **Was:** Same teacherId-only check; `deleteClasswork(id)` had no schoolId in WHERE.
- **Fix:** Added schoolId route check; `deleteClasswork(id, schoolId)` with `AND schoolId = $2` in WHERE.

## Safe pattern confirmed elsewhere
All other potentially risky lookups were found to be safe:
- `getStudentById` / `getTeacherById` / `getHomeworkById` — every caller does a manual `entity.schoolId !== req.session.schoolId` check immediately after fetching.
- `deleteNotice` / `updateNotice` — already have `AND schoolId = $2` in WHERE.
- `deleteLeaveRequest(id, teacherId)` / `deleteStudentLeaveRequest(id, studentId)` — check the entity's owner ID (globally unique) before deleting.
- Gallery approve — fetches item first and checks `existing.schoolId !== req.session.schoolId`.
- Library book delete — fetches book and checks `book.schoolId !== req.session.schoolId`.
- Leave status update — fetches leave and checks `leave.schoolId !== req.session.schoolId`.
- Visitor log checkout — fetches all logs for the school and finds by id within them.
- Complaint notes — preceded by `getComplaintByIdForSchool(complaintId, schoolId)`.

## The correct pattern for new mutation storage functions
```ts
// WRONG — id alone; cross-school mutation if ID is guessed
async deleteWidget(id: number): Promise<void> {
  await db.delete(widgets).where(eq(widgets.id, id));
}

// RIGHT — id + schoolId together; mutation is a no-op on wrong school
async deleteWidget(id: number, schoolId: number): Promise<void> {
  await db.delete(widgets).where(and(eq(widgets.id, id), eq(widgets.schoolId, schoolId)));
}
```

**Why:** SERIAL primary keys are guessable. Without a schoolId guard in the WHERE clause, a malicious admin from school A can mutate records belonging to school B by brute-forcing IDs.

## getXxxById read functions
These are intentionally left without schoolId in the SELECT — they're used in multiple contexts (including self-lookup via session, internal lookups from already-owned data, and admin ownership verification). The caller is responsible for checking `entity.schoolId === req.session.schoolId` before acting on the result. All current callers do this.
