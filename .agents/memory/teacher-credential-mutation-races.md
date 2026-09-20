---
name: Teacher credential mutation races
description: Concurrency contract shared by authenticated Teacher password changes and Forgot Password recovery.
---

Authenticated Teacher password changes must use a tenant-, role-, active-account-, and linked-Teacher-bound transaction. Verify the current password against the canonical hash, then update through a current-hash compare-and-swap so concurrent credential mutations have one winner. Clear forced-change state and consume outstanding recovery challenges in the same transaction. After commit, use strict session invalidation and require login again.

**Why:** A request that verifies an old password before a recovery reset can otherwise resume after the reset and overwrite the newly established credential. Session middleware checked only at request entry cannot prevent that database race.

**How to apply:** Any new Teacher credential mutation must coordinate through the canonical user password row, reject stale hashes, invalidate competing recovery authority atomically, and use the existing revocation marker/session deletion mechanism. Race tests must cover change-vs-change, change-vs-recovery in both directions, and change-vs-login.