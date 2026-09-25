---
name: Receipt data snapshots
description: Immutable data-source contract for student fee receipt presentation.
---

The student receipt must treat the fee record as the authority: Invoice Date is the original persisted invoice creation timestamp, Fee Type and Frequency are the invoice fields, and Fee Period is formatted only from the invoice’s persisted start/end dates.

**Why:** Payment, Razorpay, and receipt timestamps describe collection, not invoicing. Live academic-session and fee-structure data can change after an invoice is created, so using them makes historical receipts inaccurate.

**How to apply:** Render the invoice timestamp in IST with the shared persisted-timestamp formatter. Do not infer Frequency from names or period dates. Do not replace a missing invoice period with an academic session; show it as unavailable unless a separately proven immutable invoice representation exists.