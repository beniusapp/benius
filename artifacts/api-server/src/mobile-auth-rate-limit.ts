import type { Request } from "express";
import { pool } from "./db";

const MOBILE_AUTH_RATE_LIMIT = 20;
const MOBILE_AUTH_WINDOW_MINUTES = 15;

function clientIpAddress(req: Request): string {
  // Only a local reverse proxy may supply a client address. A direct caller
  // must not be able to rotate X-Forwarded-For to evade the shared limiter.
  const peer = req.socket.remoteAddress ?? "";
  const localProxy = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  if (!localProxy) return peer || "unknown";
  const forwarded = req.get("x-forwarded-for");
  const forwardedAddresses = forwarded?.split(",").map((address) => address.trim()).filter(Boolean);
  return forwardedAddresses?.at(-1) || peer;
}

/**
 * Reserve attempts transactionally in shared PostgreSQL state so every API
 * instance observes one per-IP limit. Failed DB checks are intentionally not
 * treated as permission to try authentication.
 */
export async function reserveMobileAuthAttempt(req: Request): Promise<boolean> {
  const ipAddress = clientIpAddress(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`mobile-auth-rate:${ipAddress}`],
    );
    const result = await client.query<{ attempt_count: number }>(
      `SELECT COUNT(*)::integer AS attempt_count
       FROM security_audit
       WHERE action = 'mobile_auth_attempt'
         AND ip_address = $1
         AND created_at > NOW() - ($2::integer * INTERVAL '1 minute')`,
      [ipAddress, MOBILE_AUTH_WINDOW_MINUTES],
    );
    const attemptCount = Number(result.rows[0]?.attempt_count ?? 0);
    if (attemptCount >= MOBILE_AUTH_RATE_LIMIT) {
      await client.query("COMMIT");
      return false;
    }
    await client.query(
      `INSERT INTO security_audit (user_id, school_id, action, success, ip_address, user_agent)
       VALUES (NULL, NULL, 'mobile_auth_attempt', FALSE, $1, $2)`,
      [ipAddress, req.get("user-agent") || null],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const MOBILE_AUTH_RATE_LIMIT_COUNT = MOBILE_AUTH_RATE_LIMIT;
export const MOBILE_AUTH_RATE_LIMIT_WINDOW_MINUTES = MOBILE_AUTH_WINDOW_MINUTES;