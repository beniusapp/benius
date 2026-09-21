---
name: Student recovery session compare-and-swap
description: Concurrency rule for safely changing server-bound Student password-recovery state in the PostgreSQL session store.
---

Student password-recovery state must be changed only through the dedicated session helpers that stage an expected-state mutation. Ordinary or stale full-session writes preserve the recovery state currently persisted in PostgreSQL.

**Why:** `connect-pg-simple` normally overwrites the complete serialized session. Concurrent requests can otherwise resurrect cleared recovery state or erase a newer OTP_PENDING/PASSWORD_RESET identity. The recovery-aware store uses a PostgreSQL row lock and expected-state comparison to prevent this.

**How to apply:** Never assign or delete `studentPasswordRecovery` directly in routes or new helpers. Use the established start, verification-transition, unconditional local-clear, or persisted identity-matched clear helpers so the store receives the required compare-and-swap metadata.

Forgot-password challenge replacement and recovery-session persistence must converge on the same currently active challenge before an OTP is delivered. A live, verified, unconsumed reset-token challenge is final authority and must not be replaced by a stale or concurrent forgot-password request.

**Why:** Challenge rows and Express sessions are persisted separately. Without rechecking active challenge authority and the persisted session identity, simultaneous requests can deliver an OTP for a consumed challenge or consume a challenge that already granted `password_reset`.

**How to apply:** Keep Student challenge creation serialized by the existing tenant/Student advisory lock, refuse replacement of live verified reset authority, reconcile `otp_pending` through staged session CAS, and use exact identity-matched cleanup after delivery failure.