---
name: Support Staff parent-only modules
description: Parent-only permission semantics and boundaries for six Support Staff modules.
---

For Support Staff, Timetable Master (`timetable`), School Calendar (`school-calendar`), Attendance Overview (`attendance`), Exam Controller (`exam-controller`), Complaint Hub (`complaint-hub`), and Noticeboard (`noticeboard`) are parent-only grants. A parent grant unlocks the module's normal features; child-only legacy grants never authorize access or imply the parent. When permissions are next saved, preserve a parent root and remove its legacy children. Keep Admin behavior, other module permission trees, Mobile feature development, and the database schema unchanged.

**Why:** The user requested full parent-grant access for these six modules while keeping other permission structures and data models unchanged; Web must be finalized before Mobile feature work resumes.

**How to apply:** Keep the permission editor, dashboard visibility, and API authorization aligned. Preserve school and academic-session checks; do not translate orphan child grants into parent access or implement Mobile parity before the user asks.
