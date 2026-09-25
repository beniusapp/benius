-- =============================================================================
-- Migration 002: Add razorpay_order_id to fee_records
-- Purpose : Store the Razorpay order ID at order-creation time so the webhook
--           handler can recover fee/student/school context when payment notes
--           are missing or malformed.
-- Safety  : Fully idempotent (ADD COLUMN IF NOT EXISTS).  No destructive ops.
-- Index   : scoped (school_id, razorpay_order_id) for O(1) webhook fallback.
-- =============================================================================

ALTER TABLE fee_records
  ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_fee_records_school_order_id
  ON fee_records (school_id, razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;
