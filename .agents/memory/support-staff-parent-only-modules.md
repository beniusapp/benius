---
name: Support Staff parent-only modules
description: Permission semantics for Support Staff Timetable Master and School Calendar access.
---

For Support Staff, Timetable Master (`timetable`) and School Calendar (`school-calendar`) are parent-only grants. A parent grant unlocks the module's normal features; child-only legacy grants never authorize access or imply the parent. When permissions are next saved, preserve a parent root and remove its legacy children. Keep Admin behavior, other module permission trees, Mobile, and the database schema unchanged.

**Why:** The user requested exactly two module-level grants with full module functionality, while keeping all other permission structures and data models unchanged.

**How to apply:** Keep the permission editor, dashboard visibility, and API authorization aligned. Preserve school and academic-session checks; do not translate orphan child grants into parent access.
