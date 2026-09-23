---
name: Deleted Student Attendance identity
description: Identity and release safety for Attendance that outlives a physical Student deletion
---

Historical Attendance belongs to a particular incarnation of a Student, not merely to a numeric Registry ID or reusable display code. Preserve a non-reusable identity and display snapshot on each mark; use the live foreign key only for active Student reads and marking. Historical rosters, corrections, population, and uniqueness must not group or match solely on an original numeric ID.

**Why:** A deleted Student can lose its live foreign key, and a replacement may reuse the same numeric ID and display code. Matching on either would silently attribute old marks to the replacement.

**How to apply:** When editing Attendance readers or writers, keep historical grouping separate from live-Student membership. An ordered backfill must precede any nullable-FK delete action on databases with existing rows. A schema-only publish is not equivalent to that data migration; verify the production rollout path separately.

Reserve every issued Attendance identity permanently, including Students who never had an Attendance row. A uniqueness check over only live Students releases the key on physical deletion, and retained Attendance rows cannot recover keys for deleted Students with no marks.

**Why:** Explicit UUID reuse after deletion would otherwise attach a replacement Student to historical identity, and a Student without marks leaves no snapshot from which to reconstruct a prior key.

**How to apply:** Treat the reservation set as append-only across Student and school deletion. An upgrade can reserve only keys still visible in Registry or historical Attendance; previously deleted Students without retained marks cannot be reconstructed retroactively.