---
name: Structure-backed invoice creation
description: Rules that keep individual and bulk fee invoices consistent and race-safe.
---

All new invoices based on a fee structure must go through the shared structure-backed creation flow. Treat the selected structure and the active academic session as authoritative: clients may choose a student, structure, and valid period, but may not supply fee type, amount, due date, academic year, status, snapshot, or invoice number.

**Why:** Allowing the Add Invoice form to persist its own values made single-student invoices diverge from bulk generation. A read-check-insert duplicate guard also admitted duplicates when requests arrived concurrently.

**How to apply:** Keep single and bulk callers on the same context/creation service. Monthly and quarterly periods must be complete calendar periods inside the active session; annual and one-time invoices always use the full active session. Preserve the advisory-lock-backed creation boundary and legacy period-less duplicate handling when changing invoice identity or persistence.