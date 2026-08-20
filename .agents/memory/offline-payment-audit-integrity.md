---
name: Offline Payment Audit Integrity
description: Durable rules for recording and correcting sensitive offline-payment accounting metadata.
---

Method-specific offline accounting values belong in a tenant-scoped one-to-one detail record, while the common payment record remains authoritative for amount, receipt, method, invoice, student, session, recorder, and timestamps. Permitted metadata corrections must preserve immutable before/after snapshots and show those changes to administrators.

**Why:** Financial identity fields must not be silently rewritten after recording a payment, but operational instrument details can legitimately be corrected. A visible revision history makes those corrections reviewable.

**How to apply:** Scope every detail/revision read and write by both school and payment record. Do not expose bank, instrument, or accounting details in student receipts. Do not add payment-proof uploads while uploads are publicly served; introduce a private, tenant-authorized file-access path first.