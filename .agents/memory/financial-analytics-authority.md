---
name: Financial analytics authority
description: Durable rules for accurate, session-scoped financial reporting and exports.
---

Financial analytics must have one canonical, server-side dataset consumed by the interactive API, every PDF export, and scheduled reports. Scope invoice populations by both tenant and the selected academic session.

**Why:** Separate report queries and client-side aggregation drifted from the ledger, which made totals, refund dates, and exports disagree. Payment-attempt lifecycle events communicate portal state but do not represent booked money.

**How to apply:** Derive revenue only from persisted payment records; reduce it exactly once for processed refunds, using Asia/Kolkata calendar boundaries. Keep attempts/statuses as non-revenue operational counts. Return a prior-period comparison only when both ranges lie wholly within the selected session. Keep PDFs server-rendered from the same data and measure variable-length table rows before pagination so long labels cannot overlap rows or footers.

For successful-payment calendar ranges, `payment_records.received_date` is authoritative. An invoice-level Ledger row matches a paid-date range when any tenant-bound payment for that invoice falls inside it; display the latest authoritative payment date, using the invoice paid-date projection only for legacy invoices with no payment record.

**Why:** Split payments can span dates, and historical gateway paths allowed the invoice projection to drift by one calendar day from the persisted payment record. Using the projection for Ledger filtering made Analytics and Ledger disagree even though the booked payment data was correct.

**How to apply:** Keep gateway capture writes on one Asia/Kolkata date for both records, but treat the payment record as the reporting source. Preserve lifecycle attempts in transaction reports only as explicitly labeled non-revenue rows, and date-scope each displayed attempt or fallback payment independently.