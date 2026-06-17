---
name: Attendance Policy Engine
description: Centralized timing rules replacing hardcoded thresholds; evaluation logic, DB table, API routes, and frontend integration points.
---

## The Rule
All attendance timing thresholds (teacher check-in lateness, half-day cutoff, student attendance target %) must come from the `attendance_policies` table — never hardcoded.

**Why:** The old code had `if (h > 9 || (h === 9 && m > 0)) isLate = true` hardcoded in the teacher-summary route and `Target: 85%` hardcoded in the attendance-overview UI. Multi-tenant schools need per-school, per-class, per-role configuration.

## How to Apply
- Engine lives at `server/attendance-policy-engine.ts` — exports `evaluateAttendanceStatus`, `resolvePolicy`, `isLateCheckIn`, `utcToISTHHMM`, `DEFAULT_POLICY`.
- DB table: `attendance_policies` (schoolId, targetRole TEACHER/STUDENT, applicableClasses text[], expectedArrivalTime HH:MM, gracePeriodMinutes, halfDayCutoffTime HH:MM, attendanceTarget %, isActive).
- Resolution priority: exact class match → school-wide (empty classes array) → DEFAULT_POLICY (09:00, 0 min grace, 12:00 cutoff, 85%).
- CRUD API: `GET/POST /api/admin/attendance-policies`, `PUT/DELETE /api/admin/attendance-policies/:id`, `GET /api/admin/attendance-policies/resolve?role=TEACHER&class=6`.
- Teacher portal: `GET /api/teacher/attendance-policy` returns the resolved policy for the teacher's assigned class.
- Check-in status: teacher_self_attendance.status stores "Present" / "Late" / "Half Day" (display strings, not enums).
- Admin UI: School Setup → Attendance Policy section (`attendance-policy.tsx`, purple #8b5cf6 theme).
- Attendance Overview: student target % comes from `/api/admin/attendance-policies/resolve?role=STUDENT`.
