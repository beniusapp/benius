---
name: Student content boundaries
description: Security rules for historical student cohorts and mobile-created submission files.
---

When reading session-specific Student work, derive the student's class and section from that selected academic session's enrollment, not from their current profile. Treat a missing historical enrollment as unavailable rather than falling back to another cohort.

**Why:** Promotion or transfer changes the current class. Filtering archived work by today's class can hide the student's own records and expose work from a cohort they did not belong to.

**How to apply:** Apply this to future mobile Student modules that filter by cohort, including examination and timetable, and test a promoted student switching between active and archived sessions.

The native Student Dashboard unread-notice count follows the same boundary: require the authenticated Student's exact enrollment in the selected school-owned session and use that enrollment's class and section with the existing notice audience resolver. Missing enrollment is unavailable; never fall back to the current profile placement.

**Why:** The aggregate Dashboard otherwise can count notices for today's cohort while the Student is viewing a historical session.

**How to apply:** Keep this check in the mobile aggregate as well as detail routes, and preserve the null-session notice rules in `notice-session-null-semantics.md`.

Keep new Student-submitted files outside any unauthenticated static upload tree. Download by persisted ownership only, for the submitting Student or an explicitly authorized reviewer. Preserve existing browser URLs rather than changing their access behavior as an incidental part of mobile work.

**Why:** An unguessable URL in a public static folder is still downloadable without authentication; a same-school Teacher alone is not entitled to another Teacher's Student submissions.

**How to apply:** For each new upload flow, enforce role, school, record, and reviewer ownership before reading the file, deny invalid bearer headers even when a cookie exists, and verify replacement/cleanup behavior.

For BENIUS Homework, secure attachment review is deferred until persistent App Storage is available. Keep the existing Student upload path unchanged in the meantime; never add a temporary-file workaround or expose raw/public submission URLs or Teacher download links. Submissions with unreadable attachments must not be reviewable.

**Why:** The Web review work is text-only while durable storage is pending. A new link or temporary disk path would not provide the required access control, and existing public URLs remain a known risk rather than a resolved one.

**How to apply:** Revisit attachment review only with persistent storage and server-side Student ownership or exact-session assigned-Teacher checks before file access. Do not silently change legacy upload behavior as part of unrelated Web work.