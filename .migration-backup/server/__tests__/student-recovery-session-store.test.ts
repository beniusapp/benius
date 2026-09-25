import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { pool } from "../db";
import {
  clearStudentPasswordRecoverySessionIfMatches,
  markStudentPasswordRecoveryVerified,
  startStudentPasswordRecoverySession,
} from "../student-password-recovery-session";
import {
  clearStudentRecoveryIfMatchesPersistedSession,
  StudentRecoverySafePgStore,
} from "../student-recovery-session-store";

const identityA = { challengeId: 801001, studentId: 802001, schoolId: 803001 };
const identityB = { challengeId: 801002, studentId: 802001, schoolId: 803001 };
const resetToken = "b".repeat(64);
const sessionIds: string[] = [];
let server: Server;
let baseUrl = "";
let delayedRequestLoaded: (() => void) | undefined;
let releaseDelayedRequest: (() => void) | undefined;

async function post(path: string, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}

async function persistedSession(sessionId: string): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query<{ sess: Record<string, unknown> }>(
    `SELECT sess FROM "session" WHERE sid = $1`,
    [sessionId],
  );
  return result.rows[0]?.sess;
}

beforeAll(async () => {
  const app = express();
  app.use(session({
    store: new StudentRecoverySafePgStore(pool),
    secret: "student-recovery-session-store-test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
  }));
  app.post("/start-a", (req, res) => {
    req.session.studentId = 999001;
    (req.session as any).unrelated = "preserved";
    startStudentPasswordRecoverySession(req, identityA);
    sessionIds.push(req.sessionID);
    res.json({ ok: true, sessionId: req.sessionID });
  });
  app.post("/start-b", (req, res) => {
    startStudentPasswordRecoverySession(req, identityB);
    res.json({ ok: true });
  });
  app.post("/verify-b", (req, res) => {
    startStudentPasswordRecoverySession(req, identityB);
    markStudentPasswordRecoveryVerified(req, resetToken);
    res.json({ ok: true });
  });
  app.post("/clear-a", async (req, res) => {
    const cleared = await clearStudentPasswordRecoverySessionIfMatches(
      req,
      identityA.challengeId,
      identityA.studentId,
      identityA.schoolId,
    );
    res.json({ cleared });
  });
  app.post("/clear-a-and-save-unrelated-change", async (req, res) => {
    const cleared = await clearStudentPasswordRecoverySessionIfMatches(
      req,
      identityA.challengeId,
      identityA.studentId,
      identityA.schoolId,
    );
    (req.session as any).newerUnrelatedValue = "saved";
    res.json({ cleared });
  });
  app.post("/delayed-clear-a", async (req, res) => {
    delayedRequestLoaded?.();
    await new Promise<void>(resolve => {
      releaseDelayedRequest = resolve;
    });
    const cleared = await clearStudentPasswordRecoverySessionIfMatches(
      req,
      identityA.challengeId,
      identityA.studentId,
      identityA.schoolId,
    );
    (req.session as any).staleRequestUnrelatedValue = "saved";
    res.json({ cleared });
  });
  app.post("/save-unrelated", (req, res) => {
    delayedRequestLoaded?.();
    (req.session as any).queuedStaleValue = "saved";
    res.json({ ok: true });
  });
  app.post("/clear-b-and-mutate-stale-request", async (req, res) => {
    const cleared = await clearStudentPasswordRecoverySessionIfMatches(
      req,
      identityB.challengeId,
      identityB.studentId,
      identityB.schoolId,
    );
    (req.session as any).mustNotBePersisted = "stale-write";
    res.json({ cleared });
  });
  server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())
  );
  if (sessionIds.length) {
    await pool.query(`DELETE FROM "session" WHERE sid = ANY($1::text[])`, [sessionIds]);
  }
});

describe("atomic Student recovery session-store cleanup", () => {
  it("clears only an exact persisted identity and preserves authentication and unrelated fields", async () => {
    const started = await post("/start-a");
    const sessionId = started.body.sessionId as string;
    expect(await clearStudentRecoveryIfMatchesPersistedSession(
      sessionId,
      identityA.challengeId,
      identityA.studentId,
      identityA.schoolId,
    )).toBe(true);
    const stored = await persistedSession(sessionId);
    expect(stored?.studentPasswordRecovery).toBeUndefined();
    expect(stored?.studentId).toBe(999001);
    expect(stored?.unrelated).toBe("preserved");
  });

  it("returns false without changing missing, malformed, or mismatched persisted sessions", async () => {
    expect(await clearStudentRecoveryIfMatchesPersistedSession(
      "missing-student-recovery-session",
      identityA.challengeId,
      identityA.studentId,
      identityA.schoolId,
    )).toBe(false);

    const started = await post("/start-a");
    const sessionId = started.body.sessionId as string;
    const before = await persistedSession(sessionId);
    for (const mismatch of [
      { ...identityA, challengeId: identityB.challengeId },
      { ...identityA, studentId: identityA.studentId + 1 },
      { ...identityA, schoolId: identityA.schoolId + 1 },
    ]) {
      expect(await clearStudentRecoveryIfMatchesPersistedSession(
        sessionId,
        mismatch.challengeId,
        mismatch.studentId,
        mismatch.schoolId,
      )).toBe(false);
      expect(await persistedSession(sessionId)).toEqual(before);
    }

    await pool.query(
      `UPDATE "session" SET sess = json_build_object(
        'cookie', sess->'cookie',
        'studentId', sess->'studentId',
        'studentPasswordRecovery', json_build_object('malformed', true)
      ) WHERE sid = $1`,
      [sessionId],
    );
    const malformed = await persistedSession(sessionId);
    expect(await clearStudentRecoveryIfMatchesPersistedSession(
      sessionId,
      identityA.challengeId,
      identityA.studentId,
      identityA.schoolId,
    )).toBe(false);
    expect(await persistedSession(sessionId)).toEqual(malformed);
  });

  it("allows exactly one winner for simultaneous exact clears", async () => {
    const started = await post("/start-a");
    const sessionId = started.body.sessionId as string;
    const results = await Promise.all([
      clearStudentRecoveryIfMatchesPersistedSession(
        sessionId, identityA.challengeId, identityA.studentId, identityA.schoolId,
      ),
      clearStudentRecoveryIfMatchesPersistedSession(
        sessionId, identityA.challengeId, identityA.studentId, identityA.schoolId,
      ),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });

  it("prevents delayed A cleanup from erasing newer OTP_PENDING B", async () => {
    const started = await post("/start-a");
    const cookie = started.cookie!;
    const sessionId = started.body.sessionId as string;
    await post("/start-b", cookie);
    const cleanup = await post("/clear-a", cookie);
    expect(cleanup.body).toEqual({ cleared: false });
    expect((await persistedSession(sessionId))?.studentPasswordRecovery).toMatchObject(identityB);
  });

  it("preserves newer B when a false cleanup request saves an unrelated field", async () => {
    const started = await post("/start-a");
    const cookie = started.cookie!;
    const sessionId = started.body.sessionId as string;
    await post("/start-b", cookie);
    const cleanup = await post("/clear-a-and-save-unrelated-change", cookie);
    expect(cleanup.body).toEqual({ cleared: false });
    const stored = await persistedSession(sessionId);
    expect(stored?.studentPasswordRecovery).toMatchObject(identityB);
    expect(stored?.newerUnrelatedValue).toBe("saved");
  });

  it("preserves B when a request that loaded A completes after B was persisted", async () => {
    const started = await post("/start-a");
    const cookie = started.cookie!;
    const sessionId = started.body.sessionId as string;
    const loaded = new Promise<void>(resolve => {
      delayedRequestLoaded = resolve;
    });
    const delayedCleanup = post("/delayed-clear-a", cookie);
    await loaded;
    await post("/start-b", cookie);
    releaseDelayedRequest?.();
    const cleanup = await delayedCleanup;
    delayedRequestLoaded = undefined;
    releaseDelayedRequest = undefined;
    expect(cleanup.body).toEqual({ cleared: false });
    const stored = await persistedSession(sessionId);
    expect(stored?.studentPasswordRecovery).toMatchObject(identityB);
    expect(stored?.staleRequestUnrelatedValue).toBe("saved");
  });

  it("merges a queued stale full-session write without erasing a newer recovery state", async () => {
    const started = await post("/start-a");
    const cookie = started.cookie!;
    const sessionId = started.body.sessionId as string;
    const lockClient = await pool.connect();
    try {
      await lockClient.query("BEGIN");
      const locked = await lockClient.query<{ sess: Record<string, unknown> }>(
        `SELECT sess FROM "session" WHERE sid = $1 FOR UPDATE`,
        [sessionId],
      );
      const newer = {
        ...locked.rows[0].sess,
        studentPasswordRecovery: {
          flow: "student_password_recovery",
          stage: "otp_pending",
          ...identityB,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
      const loaded = new Promise<void>(resolve => {
        delayedRequestLoaded = resolve;
      });
      const queuedStaleSave = post("/save-unrelated", cookie);
      await loaded;
      await lockClient.query(
        `UPDATE "session" SET sess = $2::json WHERE sid = $1`,
        [sessionId, JSON.stringify(newer)],
      );
      await lockClient.query("COMMIT");
      await queuedStaleSave;
    } catch (error) {
      await lockClient.query("ROLLBACK");
      throw error;
    } finally {
      delayedRequestLoaded = undefined;
      lockClient.release();
    }
    const stored = await persistedSession(sessionId);
    expect(stored?.studentPasswordRecovery).toMatchObject(identityB);
    expect(stored?.queuedStaleValue).toBe("saved");
  });

  it("prevents delayed A cleanup from erasing newer PASSWORD_RESET B", async () => {
    const started = await post("/start-a");
    const cookie = started.cookie!;
    const sessionId = started.body.sessionId as string;
    await post("/start-b", cookie);
    await post("/verify-b", cookie);
    const cleanup = await post("/clear-a", cookie);
    expect(cleanup.body).toEqual({ cleared: false });
    expect((await persistedSession(sessionId))?.studentPasswordRecovery).toMatchObject({
      ...identityB,
      stage: "password_reset",
      resetToken,
    });
  });

  it("clears newer B exactly and suppresses a later stale full-session save", async () => {
    const started = await post("/start-a");
    const cookie = started.cookie!;
    const sessionId = started.body.sessionId as string;
    await post("/start-b", cookie);
    const cleanup = await post("/clear-b-and-mutate-stale-request", cookie);
    expect(cleanup.body).toEqual({ cleared: true });
    const stored = await persistedSession(sessionId);
    expect(stored?.studentPasswordRecovery).toBeUndefined();
    expect(stored?.studentId).toBe(999001);
    expect(stored?.unrelated).toBe("preserved");
    expect(stored?.mustNotBePersisted).toBeUndefined();
  });
});