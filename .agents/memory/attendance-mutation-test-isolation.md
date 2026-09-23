---
name: Attendance mutation test isolation
description: How to keep guarded Attendance leave-approval regressions authoritative when test fixtures share dates and Sessions.
---

Guarded leave-approval tests must isolate existing Attendance rows and restore the school's active Session state between scenarios. When an older test intentionally creates multiple Sessions, make exactly the intended Session active while testing a guarded mutation; a query for the school's current active Session must not be made ambiguous by the fixture.

**Why:** Reusing one Student and a relative IST date caused later no-write assertions to observe earlier tests' valid marks. A separate legacy fixture activated another Session without deactivating the first, causing a school-active-Session guard to reject before a cross-school check could be reached.

**How to apply:** For new guarded mutation regressions, use one active Session per school and independently scoped marks or cleanup between scenarios. When adapting older historical-data tests, preserve their archived read fixtures but temporarily establish a single active Session for write assertions.