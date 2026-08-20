-- =============================================================================
-- Migration 004: Immutable Razorpay refund financial audit
-- Safety: additive and restart-safe. Existing payments, receipts and lifecycle
--          tables remain untouched. Historical refund data is not fabricated.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_refund BOOLEAN NOT NULL DEFAULT FALSE;

-- The school creator / earliest administrator is granted the explicit initial
-- permission. Other administrators remain unable to initiate refunds until
-- deliberately granted this financial capability.
UPDATE users u
SET can_refund = TRUE
WHERE u.id IN (
  SELECT DISTINCT ON (school_id) id
  FROM users
  WHERE role = 'admin' AND is_active = TRUE
  ORDER BY school_id, id ASC
);

CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id INTEGER,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  fee_record_id INTEGER REFERENCES fee_records(id) ON DELETE SET NULL,
  payment_record_id INTEGER REFERENCES payment_records(id) ON DELETE RESTRICT,
  payment_attempt_id INTEGER,
  razorpay_payment_id VARCHAR(100) NOT NULL,
  razorpay_order_id VARCHAR(100),
  razorpay_refund_id VARCHAR(100),
  requested_amount_paise INTEGER NOT NULL CHECK (requested_amount_paise > 0),
  processed_amount_paise INTEGER CHECK (processed_amount_paise IS NULL OR processed_amount_paise > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  reason_code VARCHAR(60),
  reason_text TEXT,
  internal_note TEXT,
  origin VARCHAR(20) NOT NULL DEFAULT 'admin',
  local_status VARCHAR(40) NOT NULL DEFAULT 'requested',
  provider_status VARCHAR(40),
  idempotency_key VARCHAR(120) NOT NULL,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requester_ip TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_created_at TIMESTAMPTZ,
  provider_processed_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  failure_code VARCHAR(100),
  failure_message TEXT,
  provider_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_school_provider_refund_uniq
  ON refunds(school_id, razorpay_refund_id)
  WHERE razorpay_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refunds_school_payment_idx
  ON refunds(school_id, payment_record_id);
CREATE INDEX IF NOT EXISTS refunds_school_fee_idx
  ON refunds(school_id, fee_record_id);

CREATE TABLE IF NOT EXISTS refund_events (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  refund_id INTEGER NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  fee_record_id INTEGER,
  payment_record_id INTEGER,
  payment_attempt_id INTEGER,
  event_type VARCHAR(80) NOT NULL,
  local_status VARCHAR(40),
  provider_status VARCHAR(40),
  razorpay_payment_id VARCHAR(100),
  razorpay_order_id VARCHAR(100),
  razorpay_refund_id VARCHAR(100),
  amount_paise INTEGER,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  source VARCHAR(20) NOT NULL,
  webhook_delivery_id INTEGER,
  correlation_key VARCHAR(200) NOT NULL,
  payload JSONB,
  provider_occurred_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, correlation_key)
);

CREATE OR REPLACE FUNCTION reject_refund_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'refund_events are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS refund_events_append_only ON refund_events;
CREATE TRIGGER refund_events_append_only
  BEFORE UPDATE OR DELETE ON refund_events
  FOR EACH ROW EXECUTE FUNCTION reject_refund_event_mutation();