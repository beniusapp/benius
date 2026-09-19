CREATE TABLE IF NOT EXISTS password_reset_challenges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  reset_token_hash TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_ip TEXT
);

CREATE INDEX IF NOT EXISTS password_reset_challenges_user_school_idx
  ON password_reset_challenges (user_id, school_id);

CREATE INDEX IF NOT EXISTS password_reset_challenges_active_idx
  ON password_reset_challenges (user_id, school_id, consumed_at);