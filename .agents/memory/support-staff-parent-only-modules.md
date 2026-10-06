---
name: Support Staff parent-only modules
description: Parent-only permission semantics and actor-attribution boundaries for eleven Support Staff modules.
---

For Support Staff, Timetable Master (`timetable`), School Calendar (`school-calendar`), Attendance Overview (`attendance`), Exam Controller (`exam-controller`), Complaint Hub (`complaint-hub`), Noticeboard (`noticeboard`), Performance Analytics (`analytics`), Audit Logs (`audit-logs`), Visitor Log (`visitor-log`), ID Card Gen (`id-card-gen`), and Assets & Inventory (`assets`) are parent-only grants. A parent grant unlocks normal module features; child-only legacy grants never authorize access or imply the parent. When permissions are next saved, preserve a parent root and remove its legacy children. Keep Admin behavior and other module permission trees unchanged.

Visitor Log audit records can safely identify Support Staff with their positive staff ID and `support_staff` role. Asset creation has no actor field, while asset edit/delete history uses `asset_logs.user_id`, a foreign key to Admin users. Do not write negative Staff IDs there or attribute Staff changes to a Principal; keep Staff edit/delete blocked until a role-aware attribution model is approved.

**Why:** The user requested parent-grant access for these eleven modules without unrelated permission changes or a schema migration, and explicitly prohibited false actor attribution.

**How to apply:** Keep the permission editor, dashboard visibility, and API authorization aligned. Preserve school and academic-session checks; canonicalize legacy child grants without converting them to parents. Web remains the source of truth before Mobile feature work resumes.
