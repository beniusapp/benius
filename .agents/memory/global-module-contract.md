---
name: Global vs Session-Scoped Module Contract
description: Definitive list of which admin modules are global (permanent) vs session-scoped, the server guard pattern, the client query-key rule, and the cache-invalidation approach.
---

## Global (Permanent) Admin Modules
These modules must NEVER filter data by `viewSessionId` or `sessionId`. Their data persists across session rollovers.

| Module | Server route(s) | Tables |
|---|---|---|
| School Setup | `/api/admin/school-config`, `/api/school-metadata/:schoolId`, `/api/admin/grading-tiers`, `/api/admin/leave-policies`, `/api/admin/exam-policy-tiers` | school_metadata, attendance_policies, leave_policies, exam_policy_tiers, grading_tiers, grading_rules |
| School Calendar | `/api/admin/calendar` | calendar_events |
| Teacher Registry | `/api/admin/teachers` | teachers, users |
| Support Staff | `/api/admin/non-teaching-staff` | non_teaching_staff |
| Faculty Mapping | `/api/admin/faculty-mappings`, `/api/faculty/:schoolId` | faculty_mappings, teacher_allocations |
| Student Registry | `/api/schools/:schoolId/students`, `/api/schools/:schoolId/students/paginated` | students |
| Assets & Inventory | `/api/admin/assets` | school_assets |
| Gallery | `/api/gallery/:schoolId`, `/api/admin/gallery/:schoolId` | gallery_items |
| E-Library | `/api/library/*` | library_books, book_borrows |
| Student Profile | `/api/student/profile` | student_profiles |

## Server Guard Pattern
Every global module route must carry this comment block and must NOT read `(req as any).viewSessionId`:

```ts
// ── GLOBAL MODULE — <Name> is permanent school-wide data ─────────────────────
// <Records> are NOT filtered by viewSessionId. <Brief reason why>.
// This route intentionally ignores x-view-session-id and MUST NOT be changed
// to do session filtering.
// Tables: <table_names> (listed in GLOBAL DATA PROTECTION CONTRACT)
```

## Client Query-Key Rule
Global module components must NOT include `selectedViewSession?.id` or `viewSessionId` in their React Query `queryKey`. They also must NOT inject `x-view-session-id` as a custom header in their `queryFn` fetch calls. Using the default `sessionFetch` is acceptable because the server route ignores the header anyway.

**Wrong:**
```ts
queryKey: ["/api/schools", schoolId, "students", "paginated", q, cls, section, page, viewSessionId]
```
**Correct:**
```ts
queryKey: ["/api/schools", schoolId, "students", "paginated", q, cls, section, page]
```

## Session-Scoped Modules Cache Invalidation
Session-scoped modules rely on React Query's cache-bust on session switch. The mechanism:
1. Admin dashboard's `useEffect` on `selectedViewSession` calls `setViewSessionId(id)` then `queryClient.invalidateQueries()`.
2. `setViewSessionId` updates the global `_viewSessionId`; `sessionFetch` injects it as `x-view-session-id` on all subsequent GETs.
3. `queryClient.invalidateQueries()` marks all active queries stale, triggering immediate refetches with the new header.
4. Server routes read `(req as any).viewSessionId` and pass it to storage functions that `WHERE session_id = ?`.

**Why:** `staleTime: Infinity` means React Query never auto-refetches. Without the explicit `invalidateQueries()` call, modules show stale data from the previous session indefinitely.

## Session-Scoped Admin Modules
These modules DO filter by `viewSessionId`:

| Module | Key routes | Storage functions |
|---|---|---|
| Attendance Overview | `/api/admin/attendance/*` | getAttendanceHistory, getStudentsByClassSectionInSession |
| Noticeboard | `/api/notices/:schoolId/all` | getAllSchoolNotices(sessionId) |
| Fees & Payments | `/api/admin/fees` | getFeeRecordsBySchool(sessionId) |
| Complaint Hub | `/api/complaints/school/:schoolId` | getComplaintsBySchool(sessionId) |
| Exam Controller | `/api/admin/exam/aggregated`, `/api/admin/ledger-status` | getExamAggregated, getLedgerStatus, getPromotionDecisions |
| Performance Analytics | `/api/admin/analytics/*` | getAnalyticsData, getExamScoresByStudent, getClassAverages, etc. |
| Timetable Master | `/api/timetable/class-view`, `/api/timetable/class-status` | getTimetableByClassSection |
| Approval Center | `/api/approval-history/:schoolId` | getApprovalHistory(sessionId) |
| Leave Requests | `/api/leave/school/:schoolId`, `/api/student-leaves/school/:schoolId` | getLeaveRequestsBySchool, getStudentLeavesForAdmin |
| Audit Logs | `/api/audit-logs/:schoolId` | getAuditLogsBySchool(sessionId) |
| Visitor Log | `/api/visitor-logs/:schoolId` | getVisitorLogsBySchool(sessionId) |

**Why:** `getStudentsPaginated` has an optional `sessionId` param but Student Registry must NOT use it — see table above.
