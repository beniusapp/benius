---
name: Support Staff Admin Profile boundary
description: Product access boundary for Principal/Admin profile and account settings in the shared portal.
---

Support Staff may use the Principal/Admin portal for granted modules, but Principal/Admin profile, account, and security controls belong only to Admins. Support Staff should retain their own header identity and logout, and should not receive a separate profile page unless explicitly requested.

**Why:** The user specified this distinction as a product rule for the shared portal.

**How to apply:** Keep the Admin profile trigger and drawer Admin-only, avoid requesting Admin profile/security data from Support Staff UI, and preserve backend Admin authorization.
