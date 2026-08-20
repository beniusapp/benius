---
name: Payment Attempt Authority
description: Rules for treating Razorpay lifecycle events and client callbacks as auditable payment history.
---

The client-side Razorpay success callback is never sufficient on its own to mark
an invoice paid. Before recording payment or issuing a receipt, verify with
Razorpay that the payment is captured and that its payment ID, order ID,
tenant/invoice notes, and frozen total all match the active invoice.

**Why:** A valid callback signature proves a signed payment/order pair, but
does not by itself bind that pair to the fee record the browser submitted.
History must also distinguish actual gateway outcomes: captured, authorized,
pending, failed, checkout-cancelled, and refunded. Refunds retain the original
captured amount and report refund value separately.

**How to apply:** Keep payment attempts immutable and tenant-scoped. Only
captured payments generate a successful receipt and mark the fee Paid; failed
and cancelled attempts remain in history for later retries. Always render the
persisted attempt outcome rather than inferring a status from receipt presence.

When Razorpay emits `payment.failed`, treat that gateway failure as the
authoritative outcome even if the checkout modal subsequently dismisses.

**Why:** The modal close is a UI event, not proof that the student cancelled
before a payment attempt. Recording both would create misleading history.

**How to apply:** Suppress the client-side cancellation write after a failure
callback for the same checkout session; retain only the failed attempt.

Payment-history timestamps must represent the event named by the status:
capture time for Paid, failure time for Failed, authorization time for
Authorized, refund completion/initiation for Refunded, and the local audit time
only for checkout cancellation.

**Why:** The local row creation time can lag the gateway lifecycle event and
would otherwise make payment history appear to report the wrong action time.

**How to apply:** Choose the persisted lifecycle timestamp first and format it
consistently in IST in cards, details, copied data, and PDFs.