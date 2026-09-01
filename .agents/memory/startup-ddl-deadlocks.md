---
name: Startup DDL deadlocks
description: Why Replit Preview can report a network problem when concurrent application startups deadlock database schema-repair statements.
---

Concurrent workflow or deployment launches can deadlock while the server runs its large startup-time DDL sequence. PostgreSQL may terminate one launch with `40P01`, while another process still answers locally; Replit can then mark the workflow failed and show a generic Preview network-reachability warning.

**Why:** This was observed when startup `ALTER TABLE` statements competed for locks. The Preview symptom looked like DNS/network failure, but workflow logs identified the database deadlock and the workflow status became inconsistent with a surviving server process.

**How to apply:** For a Preview failure after rapid restarts or overlapping launches, check workflow logs for `40P01`, inspect for competing processes/locks, let the deadlock clear, then perform one controlled workflow restart. Avoid repeated restart loops; long-term remediation should move schema changes out of application startup or serialize them.