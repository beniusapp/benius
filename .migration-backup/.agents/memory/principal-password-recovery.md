---
name: Principal password recovery security
description: Security and product contract for Principal Login password recovery.
---

Principal recovery must always return the same forgot-password response regardless of whether the school or recovery email exists. OTPs and reset tokens must never appear in API responses, UI disclosure, application logs, or plaintext persistence.

Use a dedicated tenant-bound challenge with HMAC-hashed secrets, cryptographic randomness, expiry, a five-attempt OTP limit, replacement invalidation, and atomic single consumption. Successful reset must invalidate other active account challenges and existing authenticated sessions.

Preserve the principal's existing mandatory PIN verification when a PIN is configured. Recovery must never create an authenticated session; it ends at a success screen and Back to Login.

**Why:** The prior user-row implementation used predictable plaintext OTPs/tokens and disclosed OTPs through the API and UI, making account enumeration, replay, and cross-tenant mistakes possible.

**How to apply:** Any future recovery-route, login UI, email-provider, or session change must retain generic identity responses, school/user/challenge binding, bcrypt password hashing, UTC timestamp semantics, and one-time atomic challenge use.