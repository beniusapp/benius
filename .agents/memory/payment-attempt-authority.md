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

For successful Razorpay payments, derive the IST business date from the best
provider occurrence in this order: payment `captured_at`, signed
`payment.captured` event time, then payment `created_at`; use application
receipt time only when the provider supplied no usable occurrence.

**Why:** Delayed webhook delivery or client verification can arrive on a later
IST calendar day than the real capture. Assigning `received_date` or invoice
`paid_date` from processing time moves revenue, ledger filters, and reports
onto the wrong school business day.

**How to apply:** Keep provider-created, provider-lifecycle, and
webhook/application-received instants separate. Use the provider-derived IST
date for the successful payment and invoice projections; use the same provider
occurrence for immutable lifecycle events. For processed refunds, prefer the
signed webhook occurrence over the refund entity creation time.

Payment-attempt history has two layers: the mutable `payment_attempts`
projection answers “what is the latest known state?”, while immutable lifecycle
events answer “what happened, in what order?”. Webhook deliveries are retained
separately so exact retries can be counted without making distinct provider
events disappear.

**Why:** A later capture, refund, or enrichment update must never overwrite the
evidence of an earlier checkout cancellation or failure. Provider delivery
retries are operational evidence, not new attempts.

**How to apply:** Allocate a stable per-invoice attempt number for each online
order/payment identity; append lifecycle facts with a tenant-scoped idempotency
key; sanitize gateway payloads before persistence; restrict forensic payloads
to admin transaction details. Ordinary application paths must not rewrite or
remove recorded lifecycle facts.