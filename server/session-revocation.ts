import type { NextFunction, Request, Response } from "express";
import { pool } from "./db";

export const SESSION_REVOCATION_TTL_MS = 48 * 60 * 60 * 1000;

export function userSessionRevocationSid(userId: number): string {
  return `user-revocation:${userId}`;
}

async function latestRevocation(userId: number): Promise<number | null> {
  const result = await pool.query<{ revoked_at: string | null }>(
    `SELECT sess->>'revokedAt' AS revoked_at
     FROM "session"
     WHERE sid = $1 AND expire > NOW()
     LIMIT 1`,
    [userSessionRevocationSid(userId)],
  );
  if (result.rows.length === 0) return null;
  const revokedAt = Number(result.rows[0].revoked_at);
  if (!Number.isFinite(revokedAt)) {
    throw new Error("Invalid session revocation marker");
  }
  return revokedAt;
}

export async function authenticationAttemptIsRevoked(
  userId: number,
  authenticationStartedAt: number,
): Promise<boolean> {
  const revokedAt = await latestRevocation(userId);
  return revokedAt !== null && authenticationStartedAt <= revokedAt;
}

declare module "express-session" {
  interface SessionData {
    authIssuedAt?: number;
  }
}

export async function enforceSessionRevocation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    next();
    return;
  }
  try {
    const revokedAt = await latestRevocation(userId);
    if (revokedAt === null) {
      next();
      return;
    }
    const authIssuedAt = req.session.authIssuedAt;
    if (
      typeof authIssuedAt !== "number"
      || !Number.isFinite(authIssuedAt)
      || authIssuedAt <= revokedAt
    ) {
      await new Promise<void>(resolve => req.session.destroy(() => resolve()));
      res.status(401).json({ message: "Session expired. Please log in again." });
      return;
    }
    next();
  } catch {
    res.status(503).json({ message: "Unable to verify session security. Please try again." });
  }
}