---
name: Student content boundaries
description: Security rules for historical student cohorts and mobile-created submission files.
---

When reading session-specific Student work, derive the student's class and section from that selected academic session's enrollment, not from their current profile. Treat a missing historical enrollment as unavailable rather than falling back to another cohort.

**Why:** Promotion or transfer changes the current class. Filtering archived work by today's class can hide the student's own records and expose work from a cohort they did not belong to.

**How to apply:** Apply this to future mobile Student modules that filter by cohort, including examination and timetable, and test a promoted student switching between active and archived sessions.

Keep new Student-submitted files outside any unauthenticated static upload tree. Download by persisted ownership only, for the submitting Student or an explicitly authorized reviewer. Preserve existing browser URLs rather than changing their access behavior as an incidental part of mobile work.

**Why:** An unguessable URL in a public static folder is still downloadable without authentication; a same-school Teacher alone is not entitled to another Teacher's Student submissions.

**How to apply:** For each new upload flow, enforce role, school, record, and reviewer ownership before reading the file, deny invalid bearer headers even when a cookie exists, and verify replacement/cleanup behavior.