-- =============================================================================
-- Migration 003: Add Razorpay payment metadata columns to payment_records
-- Purpose : Store gateway-level details (mode, bank, card, VPA, payer info,
--           signature) captured at verify time for the transaction detail view.
-- Safety  : Fully idempotent (ADD COLUMN IF NOT EXISTS). No destructive ops.
-- =============================================================================

ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_order_id   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS razorpay_signature  TEXT,
  ADD COLUMN IF NOT EXISTS payment_mode        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bank_name           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS card_last4          VARCHAR(4),
  ADD COLUMN IF NOT EXISTS vpa                 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payer_name          VARCHAR(200),
  ADD COLUMN IF NOT EXISTS payer_email         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS payer_contact       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gateway_status      VARCHAR(30);
