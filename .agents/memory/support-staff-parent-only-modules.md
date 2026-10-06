---
name: Support Staff parent-only modules
description: Parent-only module grants, registry action grants, and Support Staff actor-attribution boundaries.
---

For Support Staff, Timetable Master (`timetable`), School Calendar (`school-calendar`), Attendance Overview (`attendance`), Exam Controller (`exam-controller`), Complaint Hub (`complaint-hub`), Noticeboard (`noticeboard`), Performance Analytics (`analytics`), Audit Logs (`audit-logs`), Visitor Log (`visitor-log`), ID Card Gen (`id-card-gen`), Assets & Inventory (`assets`), and Faculty Mapping (`faculty-mapping`) remain parent-only grants.

Teacher Registry (`teacher-registry`) and Student Registry (`student-registry`) use parent-plus-action grants: the parent unlocks base/read access, while each mutation requires both that parent and its exact `:add`, `:edit`, or `:delete` child. The permission editor must not auto-grant those actions when a parent is checked. A child without its parent is ineffective and is removed when permissions are saved. Legacy registry `:deactivate` maps to `:delete`; stale `:view`, `:export`, and unknown action children do not authorize registry access or mutations. A legacy parent-only grant remains read-only until a Principal explicitly grants actions. Keep Admin behavior and other module permission trees unchanged.

Visitor Log and Assets & Inventory can safely identify Support Staff through the existing role-aware `audit_logs` pattern: positive Staff ID, `support_staff` role, action, entity, and authenticated school. For assets, keep `asset_logs.user_id` exclusively for Admin actors because it references Admin users; never write a Staff ID there or attribute Staff changes to a Principal. Record Support Staff asset create/edit/delete actions in `audit_logs` and preserve school-scoped asset operations.

**Why:** The user requires registry mutation permissions to be explicit and independently enforced, without upgrading existing parent-only grants; other parent-only behavior, audit integrity, actor IDs, and database schema must remain unchanged. The existing `audit_logs` table already supports role-aware attribution without an Admin-user foreign key.

**How to apply:** Keep the permission editor, dashboard visibility, UI controls, and API authorization aligned. Preserve school and academic-session checks; canonicalize legacy grants without converting registry parent grants into mutation grants. The shared paginated Student roster may be read by either the exact `student-registry` or `id-card-gen` parent grant; child grants alone do not authorize it. Keep the `asset_logs` foreign-key path unchanged for Admins and Web as the source of truth before Mobile feature work resumes.
