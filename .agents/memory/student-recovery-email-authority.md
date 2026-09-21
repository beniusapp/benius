---
name: Student recovery email authority
description: Trust and invalidation rules for the Student password-recovery destination.
---

The Student Registry email is the only Student password-recovery destination. There is no separate verified recovery-contact subsystem. Challenges bind directly to the tenant and Student, while delivery uses the exact normalized email revalidated under the Student lock.

**Why:** A separate contact-verification workflow duplicated Registry email and blocked normal recovery. Comparing the route-observed email with the locked authoritative row also prevents an A-to-B email race from sending usable authority to the old address.

**How to apply:** Every path that changes `students.email` must use the Student-keyed lock and atomically consume pending reset challenges when the normalized value changes. Provider selection remains explicit and school-scoped with no global or default fallback.