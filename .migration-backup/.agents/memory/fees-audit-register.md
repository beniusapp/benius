---
name: Fees audit register contract
description: Durable security and integrity rules for the school-facing Fees & Payments operational audit register.
---

The normal fees audit register is an operational history, not a forensic payment-evidence view. It must show immutable actor, student, record, session, and amount snapshots captured when the event occurs. Never reconstruct a missing historical name from current live records.

**Why:** Live fallbacks can silently rewrite history after a student or staff record changes. Gateway identifiers, network data, payer details, credentials, and payloads are inappropriate for the normal administrator register even when they exist in forensic payment surfaces.

**How to apply:** Project only explicitly approved fields; sanitize both descriptions and record labels; use fixed generic wording for technical payment/refund/dispute events; and keep provider IDs, IP addresses, emails, phones, cards, VPAs, tokens, signatures, payloads, and raw errors out of this surface.

Actor source snapshots must remain explicit: authenticated students use their name and DSID; provider callbacks use Razorpay / Payment Gateway / RAZORPAY; automation uses System / System / SYSTEM. Never turn an incomplete historical actor into a person or provider based only on the action name.

**Why:** Client payment events were once mislabeled as unknown staff activity, while broad legacy normalization could falsely attribute incomplete manual entries to Razorpay.

**How to apply:** Persist student identifiers alongside student names at event creation, show role-specific source captions, and use a neutral historical-source label when a reliable actor snapshot is absent. Student/client payment endpoints must reject teacher and support-staff sessions before mutation.

Financial and destructive state changes must append their audit entry in the same database transaction. Provider retries use tenant-scoped deterministic event keys. Batch invoice deletion must preserve one snapshot row per deleted invoice rather than only a count summary.

**Why:** A summary cannot identify which financial records were removed, and non-atomic audit writes can claim a mutation that rolled back or omit one that committed.

**How to apply:** Snapshot deletion targets before removal, append each deletion inside the transaction, and treat an audit-write failure as a mutation failure. Keep fee records physically deletable when required; audit rows remain append-only.

The only audit deletion exception is the foreign-key cascade during full-school deletion. A transaction-local cleanup flag alone must never permit direct audit-row deletion.

**Why:** School deletion needs complete tenant cleanup, but an application-settable flag by itself would weaken the append-only guarantee.

**How to apply:** Require the cleanup flag, nested cascade trigger context, and absence of the parent school row. Test that direct update/delete fails, including when the flag is enabled.