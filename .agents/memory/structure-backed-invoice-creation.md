---
name: Structure-backed invoice creation
description: Rules that keep individual and bulk fee invoices consistent and race-safe.
---

All new invoices based on a fee structure must go through the shared structure-backed creation flow. Treat the selected structure and the active academic session as authoritative: clients may choose a student, structure, and valid period, but may not supply fee type, amount, due date, academic year, status, snapshot, or invoice number.

**Why:** Allowing the Add Invoice form to persist its own values made single-student invoices diverge from bulk generation. A read-check-insert duplicate guard also admitted duplicates when requests arrived concurrently.

**How to apply:** Keep single and bulk callers on the same context/creation service. Monthly and quarterly periods must be complete calendar periods inside the active session; annual and one-time invoices always use the full active session. Preserve the advisory-lock-backed creation boundary and legacy period-less duplicate handling when changing invoice identity or persistence.

Invoice frequency is also an immutable invoice snapshot: the shared creator must persist the structure or manual frequency onto the fee record, and all portal/PDF views must use that stored value rather than infer it from a fee name or current structure.

**Why:** Older structure-backed invoices predated this persistence and rendered a missing frequency even when a current structure had one. A structure can change after invoicing, so it is not a general-purpose historical fallback.

**How to apply:** Treat a null legacy frequency as missing data. Repair it only after audit evidence establishes that the matching structure configuration did not change after the invoice was created; otherwise leave the invoice untouched for manual review.