---
name: Financial analytics authority
description: Durable rules for accurate, session-scoped financial reporting and exports.
---

Financial analytics must have one canonical, server-side dataset consumed by the interactive API, every PDF export, and scheduled reports. Scope invoice populations by both tenant and the selected academic session.

**Why:** Separate report queries and client-side aggregation drifted from the ledger, which made totals and exports disagree. Payment-attempt lifecycle events communicate portal state but do not represent booked money.

**How to apply:** Derive revenue only from persisted payment records. Keep attempts/statuses as non-revenue operational counts. Return a prior-period comparison only when both ranges lie wholly within the selected session. Keep PDFs server-rendered from the same data and measure variable-length table rows before pagination so long labels cannot overlap rows or footers.

For successful-payment calendar ranges, `payment_records.received_date` is authoritative. An invoice-level Ledger row matches a paid-date range when any tenant-bound payment for that invoice falls inside it; display the latest authoritative payment date, using the invoice paid-date projection only for legacy invoices with no payment record.

**Why:** Split payments can span dates, and historical gateway paths allowed the invoice projection to drift by one calendar day from the persisted payment record. Using the projection for Ledger filtering made Analytics and Ledger disagree even though the booked payment data was correct.

**How to apply:** Keep gateway capture writes on one Asia/Kolkata date for both records, but treat the payment record as the reporting source. Preserve lifecycle attempts in transaction reports only as explicitly labeled non-revenue rows, and date-scope each displayed attempt or fallback payment independently.

Due-period demand and collections intentionally use different date authorities. Name invoice demand “Due This Period” (fee record due date) rather than a generic “Billed”; name collections from successful payment record received dates. Collection efficiency is Net Collected ÷ Due This Period and is not applicable (`null` in the canonical dataset, `N/A` in presentation) when no invoices are due in the selected range.

**Why:** A payment can be received before or after its invoice due date. Showing paid receipts beside zero due-period demand is valid, but displaying a numeric 0% efficiency falsely suggests failed collection rather than an absent denominator.

**How to apply:** Return the accounting basis with analytics API data and keep dashboard labels, PDF labels, trend/class/category headings, and report-copy aligned with it. Do not relabel receipts as due-period demand or backfill historical dates to make the two date populations appear to match.

Financial Analytics reports only fee and payment operations that are currently supported and recorded. It has no refund metric, query, adjustment, comparison, or presentation; Net Collected equals Gross Collected throughout the canonical dataset.

**Why:** The product does not currently have a real refund workflow, so refund analytics would imply financial operations that the system cannot reliably record or reconcile.

**How to apply:** Keep refund tables and any future refund workflow outside the analytics contract until a complete, auditable refund process is deliberately introduced. When that happens, define its accounting authority first and update the canonical service, dashboard, PDFs, scheduled reports, and reconciliation tests together.

When reconciling PDF report headings with `pdftotext -layout`, use spacing-tolerant assertions for tracked, uppercase display headings while keeping numeric and table-row assertions exact.

**Why:** The PDF renderer can emit a visually correct title as individually spaced glyphs, and extraction may apply inconsistent spacing within a single heading.

**How to apply:** Assert the heading with whitespace permitted between letters; validate the collection totals, transaction counts, channel labels, amounts, and shares in their normal extracted table text.