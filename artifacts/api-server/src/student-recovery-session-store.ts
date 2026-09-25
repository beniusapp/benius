import type { SessionData, Store } from "express-session";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";
import { pool } from "./db";

const suppressStoreWrite = Symbol("suppressStudentRecoveryStaleStoreWrite");
const recoveryMutation = Symbol("studentRecoveryStoreMutation");

type SuppressibleSession = SessionData & {
  [suppressStoreWrite]?: true;
  [recoveryMutation]?: {
    expected: unknown;
  };
};

type PersistedSessionRow = {
  sess: unknown;
};

export async function getPersistedStudentRecoveryState(
  sessionId: string,
  databasePool: Pool = pool,
): Promise<unknown> {
  const result = await databasePool.query<PersistedSessionRow>(
    `SELECT sess FROM "session" WHERE sid = $1 AND expire > NOW()`,
    [sessionId],
  );
  const stored = result.rows[0]?.sess;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  return (stored as Record<string, unknown>).studentPasswordRecovery;
}

type RecoveryIdentity = {
  challengeId: number;
  studentId: number;
  schoolId: number;
};

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validResetToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hasExactKeys(candidate: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(candidate);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
}

function persistedRecoveryMatches(state: unknown, expected: RecoveryIdentity): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const candidate = state as Record<string, unknown>;
  if (
    candidate.flow !== "student_password_recovery"
    || candidate.challengeId !== expected.challengeId
    || candidate.studentId !== expected.studentId
    || candidate.schoolId !== expected.schoolId
    || !validId(candidate.challengeId)
    || !validId(candidate.studentId)
    || !validId(candidate.schoolId)
    || !validTimestamp(candidate.createdAt)
    || !validTimestamp(candidate.updatedAt)
    || candidate.createdAt > candidate.updatedAt
  ) {
    return false;
  }
  if (candidate.stage === "otp_pending") {
    return hasExactKeys(candidate, [
      "flow", "stage", "challengeId", "studentId", "schoolId", "createdAt", "updatedAt",
    ]);
  }
  if (candidate.stage === "password_reset") {
    return validResetToken(candidate.resetToken) && hasExactKeys(candidate, [
      "flow", "stage", "challengeId", "studentId", "schoolId", "createdAt", "updatedAt", "resetToken",
    ]);
  }
  return false;
}

export async function clearStudentRecoveryIfMatchesPersistedSession(
  sessionId: string,
  challengeId: number,
  studentId: number,
  schoolId: number,
  databasePool: Pool = pool,
): Promise<boolean> {
  if (
    typeof sessionId !== "string"
    || sessionId.length === 0
    || !validId(challengeId)
    || !validId(studentId)
    || !validId(schoolId)
  ) {
    return false;
  }

  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PersistedSessionRow>(
      `SELECT sess
       FROM "session"
       WHERE sid = $1 AND expire > NOW()
       FOR UPDATE`,
      [sessionId],
    );
    if (result.rows.length !== 1) {
      await client.query("COMMIT");
      return false;
    }

    const stored = result.rows[0].sess;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      await client.query("COMMIT");
      return false;
    }
    const persisted = stored as Record<string, unknown>;
    if (!persistedRecoveryMatches(persisted.studentPasswordRecovery, {
      challengeId,
      studentId,
      schoolId,
    })) {
      await client.query("COMMIT");
      return false;
    }

    await client.query(
      `UPDATE "session"
       SET sess = (sess::jsonb - 'studentPasswordRecovery')::json
       WHERE sid = $1`,
      [sessionId],
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

export function suppressStudentRecoveryStaleSessionWrite(sessionData: SessionData): void {
  Object.defineProperty(sessionData, suppressStoreWrite, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
}

function serializableSnapshot(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export function stageStudentRecoverySessionMutation(
  sessionData: SessionData,
  expectedState: unknown,
): void {
  Object.defineProperty(sessionData, recoveryMutation, {
    configurable: true,
    enumerable: false,
    value: { expected: serializableSnapshot(expectedState) },
    writable: true,
  });
}

const PgStore = connectPgSimple(session);

export class StudentRecoverySafePgStore extends PgStore {
  private readonly databasePool: Pool;
  private readonly storeReady: Promise<void>;

  constructor(databasePool: Pool = pool) {
    super({ pool: databasePool, createTableIfMissing: true });
    this.databasePool = databasePool;
    this.storeReady = new Promise<void>((resolve, reject) => {
      super.get("__student_recovery_store_init__", error => error ? reject(error) : resolve());
    });
  }

  override set(
    sid: string,
    sessionData: SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    if ((sessionData as SuppressibleSession)[suppressStoreWrite]) {
      if (callback) process.nextTick(callback);
      return;
    }
    void this.setRecoveryAware(sid, sessionData).then(
      () => callback && process.nextTick(callback),
      error => callback && process.nextTick(callback, error),
    );
  }

  private async setRecoveryAware(sid: string, sessionData: SessionData): Promise<void> {
    await this.storeReady;
    const incoming = serializableSnapshot(sessionData) as Record<string, unknown>;
    const mutation = (sessionData as SuppressibleSession)[recoveryMutation];
    const client = await this.databasePool.connect();
    try {
      await client.query("BEGIN");
      const currentResult = await client.query<PersistedSessionRow>(
        `SELECT sess FROM "session" WHERE sid = $1 FOR UPDATE`,
        [sid],
      );
      const current = currentResult.rows[0]?.sess;
      if (current && typeof current === "object" && !Array.isArray(current)) {
        const persisted = current as Record<string, unknown>;
        const persistedRecovery = serializableSnapshot(persisted.studentPasswordRecovery);
        const mayApplyRecoveryMutation = mutation
          ? isDeepStrictEqual(persistedRecovery, mutation.expected)
          : false;
        if (!mayApplyRecoveryMutation) {
          if (persisted.studentPasswordRecovery === undefined) {
            delete incoming.studentPasswordRecovery;
          } else {
            incoming.studentPasswordRecovery = persisted.studentPasswordRecovery;
          }
        }
      } else if (!mutation || !isDeepStrictEqual(mutation.expected, null)) {
        delete incoming.studentPasswordRecovery;
      }

      const cookie = incoming.cookie as { expires?: string } | undefined;
      const expiresAt = cookie?.expires
        ? new Date(cookie.expires)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO "session" (sid, sess, expire)
         VALUES ($1, $2::json, $3)
         ON CONFLICT (sid) DO UPDATE
         SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [sid, JSON.stringify(incoming), expiresAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export type StudentRecoverySessionStore = Store & StudentRecoverySafePgStore;