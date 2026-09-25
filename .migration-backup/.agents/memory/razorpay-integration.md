---
name: Razorpay Integration
description: What's fully built vs what was added; credential resolver pattern; verify endpoint; failure handling.
---

## What was already complete (do not rebuild)
- `POST /api/payments/create-order` — multi-tenant, validates fee ownership, returns orderId + keyId
- `POST /api/webhooks/razorpay` — HMAC validation, handles `payment.captured`, marks Paid, assigns ON receipt, writes audit log, SSE broadcast
- Admin External Portal settings screen — Key ID / Key Secret / Webhook Secret / enable toggle per school
- Student fees "Pay Now" button with Razorpay checkout modal
- HTML receipt print routes (admin + student)
- `storage.nextReceiptNumber(schoolId, "ON")` for online receipt prefix

## What was added
1. `resolveRazorpayCredentials(schoolId)` — local helper in `fees-routes.ts`; reads DB settings first, falls back to `process.env.RAZORPAY_KEY_ID / KEY_SECRET / WEBHOOK_SECRET`. Returns `null` when neither source has keys.
2. `POST /api/payments/verify` — client-side HMAC verify (`order_id|payment_id` SHA-256 with keySecret); idempotent Paid-status update identical to webhook path; used by student UI immediately after checkout handler fires.
3. `payment.failed` webhook branch — writes `payment_failed` audit log entry (error_code + error_description); does NOT change fee status.
4. Student UI (`student-fees.tsx`) — handler now calls `/api/payments/verify` immediately; `rzp.on("payment.failed", ...)` wired to surface failure reason via `payError` state.
5. `portal-info` endpoint — now uses `resolveRazorpayCredentials` so `razorpayEnabled` is true when only env vars are set (no DB config).

## Key rules
- `resolveRazorpayCredentials` must be used everywhere credentials are needed — never read `storage.getExternalPaymentSettings` directly for Razorpay keys.
- Amounts in `fee_records.amount` are **full rupees**; multiply by 100 for Razorpay paise. Conversion already in create-order.
- Idempotency key for payment_records: `rzp_${razorpay_payment_id}` — prevents double-insert if both webhook and verify run.
