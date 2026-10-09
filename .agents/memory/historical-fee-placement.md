---
name: Historical fee placement
description: Owner-approved placement source and failure behavior for fee documents and transaction details.
---

For Principal and Student Web fee documents and transaction details, plus the approved Principal fee list, ledger, and payment exports, resolve class and section from the enrollment matching the authenticated school, fee-record Student, and fee record's own Academic Session. Do not substitute the selected UI session or current Student Registry placement.

If the fee session is NULL, the enrollment is missing, ambiguous, or incomplete, keep the financial record and values unchanged and display “Historical placement unavailable.” Never backfill enrollment or guess placement.

For a valid linked payment, placement follows the linked fee record's session. If payment and fee session IDs differ, or the payment has no valid fee link, visibly flag the issue; do not rewrite either record. Existing document authorization and session gates remain unchanged.

Bulk fee-list and export queries must use a one-row exact-tuple enrollment aggregate that fails closed for duplicate or incomplete matches. Keep nullable placement values for named Class/Section filters; use the unavailable label only for display.

**Why:** Current Registry placement can misrepresent historical invoices, and raw one-to-many joins can multiply financial rows and corrupt counts or aggregates. Student Profile intentionally continues to show current Registry placement.

**How to apply:** Keep this rule limited to approved fee-document, detail, list, and export surfaces. Preserve each route's existing school/session gates, financial selection, amounts, and sorting. Keep unresolved financial records visible when unfiltered and out of named placement filters.
