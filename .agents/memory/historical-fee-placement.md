---
name: Historical fee placement
description: Owner-approved placement source and failure behavior for fee documents and transaction details.
---

For Principal and Student Web fee documents and transaction details, resolve class, section, and roll number from the enrollment matching the authenticated school, fee-record Student, and fee record's own Academic Session. Do not substitute the selected UI session or current Student Registry placement.

If the fee session is NULL, the enrollment is missing, ambiguous, or incomplete, keep the financial record and values unchanged and display “Historical placement unavailable.” Never backfill enrollment or guess placement.

For a valid linked payment, placement follows the linked fee record's session. If payment and fee session IDs differ, or the payment has no valid fee link, visibly flag the issue; do not rewrite either record. Existing document authorization and session gates remain unchanged.

**Why:** The owner approved exact-session historical placement while separately deferring Principal fee-list/filter and unresolved-report changes. Student Profile continues to show current Registry placement.

**How to apply:** Keep this rule limited to explicitly approved document/detail surfaces. If the Principal fee list is later changed, align its displayed placement and class/section filters together under separate approval. Keep unresolved financial rows visible and preserve their amounts.
