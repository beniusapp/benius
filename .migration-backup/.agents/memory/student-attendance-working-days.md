---
name: Student Attendance working days
description: Authoritative applicable-date rule shared by Student, Admin, and Teacher Student-Attendance calculations.
---

A Student Attendance working day exists only when at least one Attendance row exists for the exact school, Academic Session, class, and section on a date inside that Session's inclusive start/end boundaries.

Calendar events, holidays, weekends, closures, leave requests, individual Student rows, Enrollment eligibility, Faculty Mapping, and current Registry placement do not define the working-date set. Once dates are established, missing Student rows remain Missing/null and the separate canonical status-weight contract applies.

**Why:** Duplicated date queries and broader status reads could produce different denominators or credit a status stamped for another class/section.

**How to apply:** Use the canonical server working-date helper for aggregate calculations. Apply the same exact school/Session/class/section predicates to status reads and Teacher submission checks. Preserve historical placement authority separately.