---
name: Student recovery session compare-and-swap
description: Concurrency rule for safely changing server-bound Student password-recovery state in the PostgreSQL session store.
---

Student password-recovery state must be changed only through the dedicated session helpers that stage an expected-state mutation. Ordinary or stale full-session writes preserve the recovery state currently persisted in PostgreSQL.

**Why:** `connect-pg-simple` normally overwrites the complete serialized session. Concurrent requests can otherwise resurrect cleared recovery state or erase a newer OTP_PENDING/PASSWORD_RESET identity. The recovery-aware store uses a PostgreSQL row lock and expected-state comparison to prevent this.

**How to apply:** Never assign or delete `studentPasswordRecovery` directly in routes or new helpers. Use the established start, verification-transition, unconditional local-clear, or persisted identity-matched clear helpers so the store receives the required compare-and-swap metadata.