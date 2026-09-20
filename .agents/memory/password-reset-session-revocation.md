---
name: Password-reset session revocation
description: Durable session-store revocation rules needed when a password reset must invalidate every old login.
---

Deleting current session rows is not a complete revocation guarantee. Keep a short-lived per-user revocation marker in the shared session store, timestamp authentication attempts before credential lookup, and reject sessions or login attempts whose authentication timestamp is not newer than the marker.

**Why:** An in-flight authenticated request can save its old session after row deletion, and an old-password login can begin before the reset but finish after it. Either race can recreate or issue an authenticated session unless authorization checks a durable revocation boundary.

**How to apply:** On security-sensitive password reset, atomically write the marker and delete matching session rows. Check the marker on every authenticated request. For login, do the final marker check after all awaited account lookups and immediately before assigning session authentication fields.