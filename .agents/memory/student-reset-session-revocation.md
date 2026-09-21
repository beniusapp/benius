---
name: Student reset session revocation
description: Security ordering rules for Student password reset, login, and durable authenticated-session revocation.
---

Student login and final password reset must serialize on the same tenant-and-Student PostgreSQL advisory lock. Authentication issuance and reset revocation timestamps must both come from PostgreSQL after that lock is acquired; never compare a Node process timestamp with a database timestamp for security ordering.

**Why:** Deleting session rows alone cannot stop stale in-flight saves, and clocks on the application and database hosts may differ. A durable revocation marker blocks recreated sessions, while one lock and one clock ensure a login verified with the old password cannot be considered newer than the reset.

**How to apply:** Any Student credential mutation must atomically write the Student revocation marker and delete only that Student's authenticated sessions. Student login must verify the authoritative password under the same lock, check the marker, issue the database timestamp into the session, and perform a final marker check before returning success.