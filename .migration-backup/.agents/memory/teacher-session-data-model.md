---
name: Teacher Portal Session Data Model
description: Which teacher modules are global vs session-scoped, schema changes, and the write-guard pattern.
---

## Global modules (never session-filtered)
These modules bind to school-global data and are NOT filtered by session_id:
- Teacher Profile — credentials are permanent; subjects/classes come from active-session faculty_mappings via teacher-me
- Gallery — all albums persist globally
- Faculty Info — global staff directory
- School Calendar — global event calendar
- Library / E-Library — all resources persist globally

## Session-scoped modules (filter by viewSessionId)
These modules have session_id columns and filter by the viewed session:
- Attendance (already had session_id)
- Homework (already had session_id)
- Classwork (already had session_id)
- Examination / Exam Scores (already had session_id)
- **Noticeboard** — session_id added to `notices` table
- **Complaints** — session_id added to `complaints` table
- **Timetable** — session_id added to `timetable_entries` table
- **Teacher Leave** — session_id added to `leave_requests` table
- **Student Leave** — session_id added to `student_leave_requests` table
- Approval Center — uses archive-mode UI guard; profile data is global

## DB migration run (2026-07-23)
```sql
ALTER TABLE notices ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES academic_sessions(id) ON DELETE SET NULL;
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES academic_sessions(id) ON DELETE SET NULL;
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES academic_sessions(id) ON DELETE SET NULL;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES academic_sessions(id) ON DELETE SET NULL;
ALTER TABLE student_leave_requests ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES academic_sessions(id) ON DELETE SET NULL;
```

## Write-guard pattern (dual-layer)
- **Frontend**: `useArchiveMode()` hook from ArchiveModeContext; all submit/approve/reject/save buttons get `disabled={isArchiveMode || ...}`; archive amber banner shows at top of each module
- **Backend**: `checkSessionContext` middleware returns 403 `ARCHIVE_READ_ONLY` for any POST/PUT/PATCH/DELETE when `x-view-session-id` header points to a non-active session

## Session tagging on creation
New records are tagged with `storage.getActiveSession(schoolId)?.id` at creation time in routes for: notices, complaints, teacher leave, student leave, timetable entries.

## viewSessionId flow
- Teacher selects archived session → `setViewingSessionId(sessionId)` stored in React state
- `setViewSessionId(sessionId)` syncs to `_viewSessionId` in queryClient.ts which injects `x-view-session-id` header on all API requests
- All session-scoped storage functions accept `sessionId?: number | null` param; if non-null, adds `eq(table.sessionId, sessionId)` to WHERE clause

**Why:** Requirement is that archived sessions show historical data, not the current session's data. The pattern ensures both UI (disabled buttons + banner) and backend (403 guard + query filter) enforce read-only historical access.
