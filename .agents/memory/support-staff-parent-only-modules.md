---
name: Support Staff parent-only modules
description: Parent-only permission semantics and actor-attribution boundaries for eleven Support Staff modules.
---

For Support Staff, Timetable Master (`timetable`), School Calendar (`school-calendar`), Attendance Overview (`attendance`), Exam Controller (`exam-controller`), Complaint Hub (`complaint-hub`), Noticeboard (`noticeboard`), Performance Analytics (`analytics`), Audit Logs (`audit-logs`), Visitor Log (`visitor-log`), ID Card Gen (`id-card-gen`), and Assets & Inventory (`assets`) are parent-only grants. A parent grant unlocks normal module features; child-only legacy grants never authorize access or imply the parent. When permissions are next saved, preserve a parent root and remove its legacy children. Keep Admin behavior and other module permission trees unchanged.

Visitor Log and Assets & Inventory can safely identify Support Staff through the existing role-aware `audit_logs` pattern: positive Staff ID, `support_staff` role, action, entity, and authenticated school. For assets, keep `asset_logs.user_id` exclusively for Admin actors because it references Admin users; never write a Staff ID there or attribute Staff changes to a Principal. Record Support Staff asset create/edit/delete actions in `audit_logs` and preserve school-scoped asset operations.

**Why:** The user requires full Assets functionality under the parent grant while prohibiting fake Admin attribution, negative compatibility IDs, weakened audit integrity, and unnecessary schema changes. The existing `audit_logs` table already supports role-aware attribution without an Admin-user foreign key.

**How to apply:** Keep the permission editor, dashboard visibility, and API authorization aligned. Preserve school and academic-session checks; canonicalize legacy child grants without converting them to parents. Keep the `asset_logs` foreign-key path unchanged for Admins and Web as the source of truth before Mobile feature work resumes.
