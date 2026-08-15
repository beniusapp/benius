---
name: Fees & Payments Fintech Hub
description: DB tables, route registration, idempotency flow, high-value re-auth, and 5-tab UI for the fees module
---

# Fees & Payments Fintech Hub

4 DB tables: `fee_records`, `fee_audit_log`, `payment_attempts`, `dunning_log`

Routes registered in `server/routes.ts` via the standard flat registration pattern (no sub-router).

Idempotency key flow: `fee_records.razorpay_order_id` guards against duplicate order creation.

High-value payment re-auth: amounts ≥ ₹10 000 require a second PIN confirmation before Razorpay order creation.

5-tab UI in `fees-manager.tsx`:  Overview · Fee Records · Payments · Dunning · Settings.

**School address in receipts:** `schools` table now has structured address fields (`address_line1`, `address_line2`, `city`, `state`, `pin_code`, `country`, `phone`, `email`) — these should flow into fee receipts/invoices rather than hardcoding a blank address. See `GET /api/admin/profile` for the data shape.
