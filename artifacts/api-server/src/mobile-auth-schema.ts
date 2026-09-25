import type { Pool } from "pg";

/**
 * The API already runs additive SQL before its schema-drift guard. Keep the
 * mobile tables on that same startup path so a fresh deployment can start
 * without a destructive Drizzle push. 017/018 retain the reviewed SQL history.
 */
export async function ensureMobileAuthSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS mobile_auth_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL DEFAULT gen_random_uuid(),
        principal_id INTEGER NOT NULL,
        principal_entity_id INTEGER,
        role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'support_staff')),
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        principal_password_version VARCHAR(64) NOT NULL,
        access_token_hash VARCHAR(64) NOT NULL UNIQUE,
        access_expires_at TIMESTAMPTZ NOT NULL,
        auth_issued_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS mobile_auth_sessions_principal_idx
        ON mobile_auth_sessions(role, principal_id, school_id);
      CREATE UNIQUE INDEX IF NOT EXISTS mobile_auth_sessions_device_id_uidx
        ON mobile_auth_sessions(device_id);

      CREATE TABLE IF NOT EXISTS mobile_auth_refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES mobile_auth_sessions(id) ON DELETE CASCADE,
        family_id UUID NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS mobile_auth_refresh_session_idx
        ON mobile_auth_refresh_tokens(session_id, expires_at);
      CREATE INDEX IF NOT EXISTS mobile_auth_refresh_family_idx
        ON mobile_auth_refresh_tokens(family_id);

      CREATE TABLE IF NOT EXISTS mobile_auth_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        challenge_hash VARCHAR(64) NOT NULL UNIQUE,
        principal_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('admin_pin', 'admin_initialize')),
        auth_issued_at TIMESTAMPTZ NOT NULL,
        principal_password_version VARCHAR(64) NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS mobile_auth_challenges_active_idx
        ON mobile_auth_challenges(principal_id, purpose, consumed_at);
      CREATE INDEX IF NOT EXISTS security_audit_mobile_auth_throttle_idx
        ON security_audit(ip_address, created_at)
        WHERE action = 'mobile_auth_attempt';
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}