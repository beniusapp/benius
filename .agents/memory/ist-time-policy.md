---
name: IST Time Policy
description: Canonical time and calendar-date handling for school-facing behaviour.
---

School-facing presentation and business-date decisions use `Asia/Kolkata` through the shared IST helpers. A PostgreSQL `DATE` is a calendar value, not an instant: preserve and manipulate its `YYYY-MM-DD` components without parsing it as a local browser date.

**Why:** The runtime and PostgreSQL session intentionally remain UTC, while historical timestamp-without-time-zone values were written under that UTC convention. Reinterpreting or migrating them would risk moving historical financial and audit events.

**How to apply:** Use the shared helpers for current school dates, calendar arithmetic, exports, and presentation. Treat persisted timestamp strings as UTC instants for IST display. Preserve Razorpay epoch conversion and keep provider timestamps distinct from application timestamps.

Raw Drizzle queries can serialize PostgreSQL `TIMESTAMPTZ` values with shortened offsets such as `+00` or `-05`. Expand those to `+00:00` or `-05:00` before parsing an ISO timestamp in JavaScript.

**Why:** Replacing the database string's space with `T` while retaining a shortened offset produces an invalid JavaScript date even though the persisted timestamp is valid.

**How to apply:** Normalize shortened offsets centrally before constructing a `Date`; preserve full offsets, `Z`, `Date` instances, and the existing UTC convention for timezone-free persisted timestamps.