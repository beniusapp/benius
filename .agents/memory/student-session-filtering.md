---
name: Student Dashboard Session Filtering
description: How all 8 student portal modules are wired to the academic session switcher — the three-layer pattern and the critical client-side fix.
---

## The three-layer pattern

Every student module requires changes at three levels:

1. **Client** — `student-dashboard.tsx` calls `setViewSessionId(selectedSession.id)` in a `useEffect` watching `selectedSession?.id`. This populates the module-level singleton so every `sessionFetch` / `getQueryFn` call injects `x-view-session-id` on all subsequent requests.

2. **Route** — each GET handler reads `const viewSessionId: number | null = (req as any).viewSessionId ?? null;` (set by the global `checkSessionContext` middleware) and passes it through to storage.

3. **Storage** — each storage function accepts `sessionId?: number | null` as a trailing optional param; when truthy, appends `eq(<table>.sessionId, sessionId)` to the WHERE conditions array.

## Modules covered

Homework, Homework Pending Dates, Classwork, Noticeboard (+ unread-count + mark-read), Complaints Inbox, Complaints Filed, Exam (classes/types/scores/journey/all-scores), Leave (GET), Fees, Timetable.

## Dashboard homepage stat

`attendanceStats` query key now includes `selectedSession?.id` and uses `startDate`/`endDate` params (from the selected session) instead of the clock-based `getCurrentAcademicYear()` fallback. The fallback is kept when `selectedSession` is null.

## Notices SELECT projection gotcha

`getAllSchoolNotices` and `getStudentNotices` both do explicit SELECT projections that must include `sessionId: notices.sessionId` — the `Notice` type has `sessionId` as a required field. Forgetting it causes a TS2322 type error at the `return rows` line.

**Why:** The `Notice` drizzle schema type includes `sessionId: number | null` as a non-optional column. Any custom SELECT that returns a `Notice`-shaped object must project it.

**How to apply:** Any future function that does a partial SELECT from the `notices` table and returns `Notice[]` or `Notice & {...}` must explicitly include `sessionId: notices.sessionId` in the projection.

## Archive-mode leave POST guard

Leave POST already had its own archive guard before this work (checks `x-view-session-id` header and rejects if that session is not active). The GET for leave is now session-scoped by `sessionId` param, consistent with all other modules.
