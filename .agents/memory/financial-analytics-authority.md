---
name: Financial analytics authority
description: Durable rules for accurate, session-scoped financial reporting and exports.
---

Financial analytics must have one canonical, server-side dataset consumed by the interactive API, every PDF export, and scheduled reports. Scope invoice populations by both tenant and the selected academic session.

**Why:** Separate report queries and client-side aggregation drifted from the ledger, which made totals, refund dates, and exports disagree. Payment-attempt lifecycle events communicate portal state but do not represent booked money.

**How to apply:** Derive revenue only from persisted payment records; reduce it exactly once for processed refunds, using Asia/Kolkata calendar boundaries. Keep attempts/statuses as non-revenue operational counts. Return a prior-period comparison only when both ranges lie wholly within the selected session. Keep PDFs server-rendered from the same data and measure variable-length table rows before pagination so long labels cannot overlap rows or footers.