---
name: Student recovery transaction locking
description: Lock-order rule for Student recovery-contact, password-reset, and email-mutation transactions.
---

All transactions that can read or mutate a Student's recovery contact, recovery challenges, reset challenges, or current email must first acquire the same transaction-scoped PostgreSQL advisory lock keyed by school and Student, before taking row locks.

**Why:** Reset verification naturally locks the challenge before revalidating the Student/contact, while challenge replacement and email mutation naturally lock the Student before invalidating challenges. Without a common first lock, concurrent replacement and verification can deadlock.

**How to apply:** Preserve the advisory-lock-first order in every future Student recovery transaction. Keep the school in the key so independent tenants and Students remain concurrent.