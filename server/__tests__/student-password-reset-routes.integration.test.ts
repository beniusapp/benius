import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import {
  notificationConfig,
  schools,
  studentPasswordResetChallenges,
  students,
} from "@shared/schema";
import {
  PasswordRecoveryRateLimiter,
  passwordRecoverySecretsEqual,
  hashPasswordRecoverySecret,
} from "../password-recovery";
import { registerStudentPasswordRecoveryRoutes } from "../student-password-recovery-routes";
import { StudentRecoverySafePgStore } from "../student-recovery-session-store";
import {
  enforceSessionRevocation,
  studentSessionRevocationSid,
} from "../session-revocation";

let serial = 0;
const schoolIds: number[] = [];
const studentIds: number[] = [];
const sessionIds: string[] = [];
let baseUrl = "";

const generic = "Invalid or expired OTP. Please request a new OTP.";

type Fixture = {
  school: { id: number; code: string };
  student: {
    id: number;
    schoolId: number;
    digitalStudentId: string;
    email: string | null;
    passwordHash: string;
    isActive: boolean;
    isActivated: boolean;
  };
  oldPassword: string;
};

type Harness = {
  server: Server;
  send: ReturnType<typeof vi.fn>;
  stop: () => Promise<void>;
};

async function fixture(): Promise<Fixture> {
  const suffix = `${Date.now()}${serial++}`;
  const oldPassword = `old-password-${suffix}`;
  const passwordHash = await bcrypt.hash(oldPassword, 10);
  const [school] = await db.insert(schools).values({
    name: `Step 5 ${suffix}`,
    code: `S5${suffix}`.slice(0, 20),
  }).returning({ id: schools.id, code: schools.code });
  schoolIds.push(school.id);
  const [student] = await db.insert(students).values({
    schoolId: school.id,
    digitalStudentId: `S5-${suffix}`,
    name: "Step 5 Student",
    class: "10",
    section: "A",
    phone: `91${String(9000000000 + serial++).slice(-8)}`,
    dob: "2010-01-01",
    passwordHash,
    email: `step5-${suffix}@example.test`,
    isActive: true,
    isActivated: true,
  }).returning();
  studentIds.push(student.id);
  await db.insert(notificationConfig).values({
    schoolId: school.id,
    emailEnabled: true,
    emailProvider: "sendgrid",
    sendgridApiKey: "step5-test-key",
    sendgridFromEmail: "step5@example.test",
    sendgridFromName: "Step 5 Test",
  });
  return { school, student, oldPassword };
}

async function makeHarness(rateLimiter = new PasswordRecoveryRateLimiter(1000)): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(session({
    store: new StudentRecoverySafePgStore(pool),
    secret: "student-step5-integration-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
  }));
  app.use(enforceSessionRevocation);

  const send = vi.fn(async () => undefined);
  registerStudentPasswordRecoveryRoutes(app, {
    getSchoolByCode: code => storage.getSchoolByCode(code),
    getStudentByDsidAndSchool: (dsid, schoolId) =>
      storage.getStudentByDsidAndSchool(dsid, schoolId),
    createChallenge: (studentId, schoolId, expectedEmail, otpHash, expires, ip) =>
      storage.createStudentPasswordResetChallenge(
        studentId, schoolId, expectedEmail, otpHash, expires, ip,
      ),
    invalidateChallenge: (challengeId, studentId, schoolId) =>
      storage.invalidateStudentPasswordResetChallenge(challengeId, studentId, schoolId),
    getNotificationConfig: schoolId => storage.getNotificationConfig(schoolId),
    sendRecoveryEmail: send,
    verifyOtp: (challengeId, studentId, schoolId, otp) =>
      storage.verifyStudentPasswordResetOtp(challengeId, studentId, schoolId, otp),
     rateLimiter,
    getPersistedRecoveryState: async sessionId => {
      const result = await pool.query<{ sess: Record<string, unknown> }>(
        `SELECT sess FROM "session" WHERE sid = $1`,
        [sessionId],
      );
      return result.rows[0]?.sess?.studentPasswordRecovery;
    },
    isChallengeActive: async (challengeId, studentId, schoolId) => {
      const challenge = await storage.getStudentPasswordResetChallenge(
        challengeId, studentId, schoolId,
      );
      return !!challenge && !challenge.consumedAt && !challenge.verifiedAt;
    },
    resetPassword: (challengeId, studentId, schoolId, resetToken, passwordHash) =>
      storage.resetStudentPasswordAtomically(
        challengeId, studentId, schoolId, resetToken, passwordHash,
      ),
  } as any);
  app.get("/test/student-protected", (req, res) => {
    if (!req.session.studentId) return res.status(401).json({ message: "Not authenticated" });
    res.json({ ok: true });
  });
  app.post("/test/student-login-session", (req, res) => {
    req.session.studentId = Number(req.body.studentId);
    req.session.studentAuthIssuedAt = Date.now();
    req.session.authIssuedAt = req.session.studentAuthIssuedAt;
    res.json({ ok: true });
  });

  const server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Step 5 server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    server,
    send,
    stop: () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())
    ),
  };
}

async function post(
  path: string,
  body: Record<string, unknown>,
  cookie?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const cookieHeader = response.headers.get("set-cookie")?.split(";")[0];
  if (cookieHeader) sessionIds.push(cookieHeader.slice("connect.sid=".length));
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
    cookie: cookieHeader ?? cookie,
  };
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function beginReset(
  app: Harness,
  item: Fixture,
): Promise<{ cookie: string; otp: string }> {
  const forgot = await post("/api/student/forgot-password", {
    schoolCode: item.school.code,
    dsid: item.student.digitalStudentId,
  });
  expect(forgot.status).toBe(200);
  expect(forgot.cookie).toBeTruthy();
  const otp = app.send.mock.calls.at(-1)?.[2] as string;
  expect(otp).toMatch(/^\d{6}$/);
  const verified = await post("/api/student/verify-recovery-otp", { otp }, forgot.cookie);
  expect(verified.status).toBe(200);
  return { cookie: verified.cookie!, otp };
}

async function challengeFor(studentId: number) {
  const [challenge] = await db.select().from(studentPasswordResetChallenges)
    .where(eq(studentPasswordResetChallenges.studentId, studentId))
    .orderBy(studentPasswordResetChallenges.id);
  return challenge;
}

async function persistedSessionFor(studentId: number) {
  const result = await pool.query<{ sid: string; sess: Record<string, any> }>(
    `SELECT sid, sess FROM "session"
     WHERE sess->'studentPasswordRecovery'->>'studentId' = $1
     ORDER BY expire DESC LIMIT 1`,
    [String(studentId)],
  );
  return result.rows[0];
}

async function replaceRecoveryState(studentId: number, state: unknown) {
  const row = await persistedSessionFor(studentId);
  expect(row).toBeTruthy();
  const sess = { ...row.sess, studentPasswordRecovery: state };
  await pool.query(`UPDATE "session" SET sess = $2::json WHERE sid = $1`, [
    row.sid,
    JSON.stringify(sess),
  ]);
}

beforeAll(() => {
  process.env.SESSION_SECRET = "student-step5-integration-session-secret";
});

afterAll(async () => {
  if (sessionIds.length) {
    await pool.query(`DELETE FROM "session" WHERE sid = ANY($1::text[])`, [sessionIds]);
  }
  if (studentIds.length) {
    await pool.query(
      `DELETE FROM "session" WHERE sid = ANY($1::text[])`,
      [studentIds.map(studentSessionRevocationSid)],
    );
  }
  if (schoolIds.length) {
    await db.delete(schools).where(inArray(schools.id, schoolIds));
  }
});

describe("Student Step 5 PostgreSQL reset integration", () => {
  it("completes Step 4 through reset, changes only the password, and consumes authority", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const before = await db.select().from(students).where(eq(students.id, item.student.id));
    const reset = await beginReset(app, item);
    const response = await post("/api/student/reset-password", {
      newPassword: "new-secure-password",
    }, reset.cookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, message: "Password reset successful." });
    expect(JSON.stringify(response.body)).not.toMatch(/token|student|school|challenge/i);

    const [after] = await db.select().from(students).where(eq(students.id, item.student.id));
    expect(await bcrypt.compare("new-secure-password", after.passwordHash)).toBe(true);
    expect(await bcrypt.compare(item.oldPassword, before[0].passwordHash)).toBe(true);
    expect(after.schoolId).toBe(before[0].schoolId);
    expect(after.isActive).toBe(before[0].isActive);
    expect(after.isActivated).toBe(before[0].isActivated);
    const challenge = await challengeFor(item.student.id);
    expect(challenge?.consumedAt).not.toBeNull();
    const persisted = await pool.query(
      `SELECT sess FROM "session" WHERE sid = $1`,
      [reset.cookie!.split("=")[1]],
    );
    expect(persisted.rows[0]?.sess?.studentPasswordRecovery).toBeUndefined();
    await app.stop();
  });

  it("rejects injected browser identity fields and preserves the valid authority", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    const before = await db.select({ passwordHash: students.passwordHash })
      .from(students).where(eq(students.id, item.student.id));
    const rejected = await post("/api/student/reset-password", {
      newPassword: "new-secure-password",
      studentId: item.student.id,
      schoolId: item.school.id,
      challengeId: 999999,
      resetToken: "a".repeat(64),
      dsid: item.student.digitalStudentId,
    }, reset.cookie);
    expect(rejected.status).toBe(400);
    const [after] = await db.select().from(students).where(eq(students.id, item.student.id));
    expect(after.passwordHash).toBe(before[0].passwordHash);
    expect((await challengeFor(item.student.id))?.consumedAt).toBeNull();
    await app.stop();
  });

  it("preserves authority on policy failure and allows a valid retry", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    const rejected = await post("/api/student/reset-password", { newPassword: "short" }, reset.cookie);
    expect(rejected.status).toBe(400);
    expect((await challengeFor(item.student.id))?.consumedAt).toBeNull();
    const retry = await post("/api/student/reset-password", {
      newPassword: "valid-password",
    }, reset.cookie);
    expect(retry.status).toBe(200);
    await app.stop();
  });

  it("prevents replay and leaves a consumed challenge unusable", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    expect((await post("/api/student/reset-password", {
      newPassword: "first-password",
    }, reset.cookie)).status).toBe(200);
    const replay = await post("/api/student/reset-password", {
      newPassword: "second-password",
    }, reset.cookie);
    expect(replay.status).toBe(400);
    await app.stop();
  });

  it("has exactly one winner for concurrent resets", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    const results = await Promise.all([
      post("/api/student/reset-password", { newPassword: "winner-password-a" }, reset.cookie),
      post("/api/student/reset-password", { newPassword: "winner-password-b" }, reset.cookie),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
    const [after] = await db.select().from(students).where(eq(students.id, item.student.id));
    const a = await bcrypt.compare("winner-password-a", after.passwordHash);
    const b = await bcrypt.compare("winner-password-b", after.passwordHash);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    await app.stop();
  });

  it("writes a Student revocation marker, deletes target auth sessions, and preserves others", async () => {
    const item = await fixture();
    const other = await fixture();
    const app = await makeHarness();
    const auth = await post("/test/student-login-session", { studentId: item.student.id });
    const authSid = auth.cookie!.split("=")[1];
    const otherSid = `step5-other-${Date.now()}-${serial++}`;
    const adminSid = `step5-admin-${Date.now()}-${serial++}`;
    const teacherSid = `step5-teacher-${Date.now()}-${serial++}`;
    await pool.query(
      `INSERT INTO "session" (sid, sess, expire) VALUES
       ($1, $2::json, NOW() + INTERVAL '1 hour'),
       ($3, $4::json, NOW() + INTERVAL '1 hour'),
       ($5, $6::json, NOW() + INTERVAL '1 hour')
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [
        otherSid, JSON.stringify({ studentId: other.student.id, studentAuthIssuedAt: Date.now() }),
        adminSid, JSON.stringify({ userId: 777001, userRole: "admin" }),
        teacherSid, JSON.stringify({ userId: 778001, teacherId: 779001 }),
      ],
    );
    sessionIds.push(authSid, otherSid, adminSid, teacherSid);
    const reset = await beginReset(app, item);
    expect((await post("/api/student/reset-password", {
      newPassword: "revoked-password",
    }, reset.cookie)).status).toBe(200);
    const sessions = await pool.query<{ sid: string }>(
      `SELECT sid FROM "session" WHERE sid = ANY($1::text[]) ORDER BY sid`,
      [[authSid, otherSid, adminSid, teacherSid]],
    );
    expect(sessions.rows.map(row => row.sid)).toEqual(
      [otherSid, adminSid, teacherSid].sort(),
    );
    const marker = await pool.query<{ revoked_at: string }>(
      `SELECT sess->>'revokedAt' AS revoked_at FROM "session" WHERE sid = $1`,
      [studentSessionRevocationSid(item.student.id)],
    );
    expect(Number(marker.rows[0]?.revoked_at)).toBeGreaterThan(0);
    expect((await get("/test/student-protected", auth.cookie)).status).toBe(401);
    const staleAuth = await post("/test/student-login-session", { studentId: item.student.id });
    const staleCookie = staleAuth.cookie!;
    const staleSession = await pool.query<{ sid: string; sess: Record<string, unknown> }>(
      `SELECT sid, sess FROM "session"
       WHERE sess->>'studentId' = $1 ORDER BY expire DESC LIMIT 1`,
      [String(item.student.id)],
    );
    const staleState = {
      ...staleSession.rows[0].sess,
      studentAuthIssuedAt: Number(marker.rows[0]?.revoked_at) - 1,
    };
    await pool.query(`UPDATE "session" SET sess = $2::json WHERE sid = $1`, [
      staleSession.rows[0].sid,
      JSON.stringify(staleState),
    ]);
    expect((await get("/test/student-protected", staleCookie)).status).toBe(401);
    const staleRow = await pool.query(`SELECT 1 FROM "session" WHERE sid = $1`, [staleSession.rows[0].sid]);
    expect(staleRow.rows).toHaveLength(0);
    await app.stop();
  });

  it("rejects missing recovery authority without changing the password", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const response = await post("/api/student/reset-password", { newPassword: "valid-password" });
    expect(response.status).toBe(400);
    const [after] = await db.select().from(students).where(eq(students.id, item.student.id));
    expect(after.passwordHash).toBe(item.student.passwordHash);
    await app.stop();
  });

  it("rejects an expired reset token and leaves the password authority unconsumed", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    const challenge = await challengeFor(item.student.id);
    await db.update(studentPasswordResetChallenges).set({
      resetTokenExpiresAt: new Date(Date.now() - 1_000),
    }).where(eq(studentPasswordResetChallenges.id, challenge!.id));
    const response = await post("/api/student/reset-password", {
      newPassword: "expired-password",
    }, reset.cookie);
    expect(response.status).toBe(400);
    const [after] = await db.select().from(students).where(eq(students.id, item.student.id));
    expect(after.passwordHash).toBe(item.student.passwordHash);
    expect((await challengeFor(item.student.id))?.consumedAt).toBeNull();
    await app.stop();
  });

  it("rejects a session whose challenge identity does not match the persisted authority", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    const stored = await pool.query<{ sid: string; sess: Record<string, unknown> }>(
      `SELECT sid, sess FROM "session"
       WHERE sess->'studentPasswordRecovery'->>'studentId' = $1
       ORDER BY expire DESC LIMIT 1`,
      [String(item.student.id)],
    );
    expect(stored.rows[0]).toBeTruthy();
    const session = stored.rows[0].sess;
    session.studentPasswordRecovery = {
      ...(session.studentPasswordRecovery as Record<string, unknown>),
      challengeId: 999999999,
    };
    await pool.query(`UPDATE "session" SET sess = $2::json WHERE sid = $1`, [
      stored.rows[0].sid,
      JSON.stringify(session),
    ]);
    const response = await post("/api/student/reset-password", {
      newPassword: "wrong-challenge-password",
    }, reset.cookie);
    expect(response.status).toBe(400);
    expect((await challengeFor(item.student.id))?.consumedAt).toBeNull();
    await app.stop();
  });

  it("authenticates with the old password before reset, then only with the new password", async () => {
    const item = await fixture();
    const before = await storage.authenticateStudentByDsidForLogin(
      item.student.digitalStudentId, item.oldPassword,
    );
    expect(before.status).toBe("success");
    if (before.status !== "success") throw new Error("expected pre-reset authentication");
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    expect((await post("/api/student/reset-password", {
      newPassword: "new-login-password",
    }, reset.cookie)).status).toBe(200);
    expect((await storage.authenticateStudentByDsidForLogin(
      item.student.digitalStudentId, item.oldPassword,
    )).status).toBe("invalid");
    const after = await storage.authenticateStudentByDsidForLogin(
      item.student.digitalStudentId, "new-login-password",
    );
    expect(after.status).toBe("success");
    if (after.status === "success") {
      expect(after.student.id).toBe(item.student.id);
      expect(after.student.schoolId).toBe(item.school.id);
      expect(after.student.digitalStudentId).toBe(item.student.digitalStudentId);
    }
    await app.stop();
  });

  it("rejects reset when the current email changes", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    await storage.updateStudent(item.student.id, item.school.id, {
      name: item.student.name,
      class: item.student.class,
      section: item.student.section,
      phone: item.student.phone,
      email: `changed-${Date.now()}@example.test`,
    });
    const before = await db.select({ passwordHash: students.passwordHash })
      .from(students).where(eq(students.id, item.student.id));
    const response = await post("/api/student/reset-password", {
      newPassword: "should-not-apply",
    }, reset.cookie);
    expect(response.status).toBe(400);
    expect((await db.select({ passwordHash: students.passwordHash }).from(students)
      .where(eq(students.id, item.student.id)))[0].passwordHash).toBe(before[0].passwordHash);
    expect((await challengeFor(item.student.id))?.consumedAt).not.toBeNull();
    await app.stop();
  });

  it("rejects independently tampered school, student, and reset-token authority", async () => {
    for (const field of ["schoolId", "studentId", "resetToken"] as const) {
      const item = await fixture();
      const other = await fixture();
      const app = await makeHarness();
      const reset = await beginReset(app, item);
      const row = await persistedSessionFor(item.student.id);
      const state = row.sess.studentPasswordRecovery as Record<string, unknown>;
      const tampered = {
        ...state,
        ...(field === "schoolId" ? { schoolId: other.school.id } : {}),
        ...(field === "studentId" ? { studentId: other.student.id } : {}),
        ...(field === "resetToken" ? { resetToken: "a".repeat(64) } : {}),
      };
      await replaceRecoveryState(item.student.id, tampered);
      const response = await post("/api/student/reset-password", {
        newPassword: `tampered-${field}-password`,
      }, reset.cookie);
      expect(response.status).toBe(400);
      for (const candidate of [item, other]) {
        const current = await db.select({ passwordHash: students.passwordHash })
          .from(students).where(eq(students.id, candidate.student.id));
        expect(current[0].passwordHash).toBe(candidate.student.passwordHash);
        const candidateChallenge = await challengeFor(candidate.student.id);
        if (candidateChallenge) expect(candidateChallenge.consumedAt).toBeNull();
      }
      await app.stop();
    }
  });

  it("rejects wrong-stage, malformed, expired, and future-dated recovery states", async () => {
    const cases = [
      { stage: "otp_pending", flow: "student_password_recovery" },
      { malformed: true },
      { flow: "student_password_recovery", stage: "password_reset", challengeId: 1, studentId: 1, schoolId: 1, resetToken: "a".repeat(64), createdAt: 1, updatedAt: 1 },
      { flow: "student_password_recovery", stage: "password_reset", challengeId: 1, studentId: 1, schoolId: 1, resetToken: "a".repeat(64), createdAt: Date.now() + 1000, updatedAt: Date.now() + 1000 },
    ];
    for (const state of cases) {
      const item = await fixture();
      const app = await makeHarness();
      const reset = await beginReset(app, item);
      await replaceRecoveryState(item.student.id, state);
      const response = await post("/api/student/reset-password", {
        newPassword: "invalid-recovery-state",
      }, reset.cookie);
      expect(response.status).toBe(400);
      expect((await db.select({ passwordHash: students.passwordHash }).from(students)
        .where(eq(students.id, item.student.id)))[0].passwordHash).toBe(item.student.passwordHash);
      await app.stop();
    }
  });

  it("returns 429 before touching storage when the reset limiter is exhausted", async () => {
    const item = await fixture();
    const app = await makeHarness(new PasswordRecoveryRateLimiter(1));
    await post("/api/student/reset-password", { newPassword: "first-limited-password" });
    const response = await post("/api/student/reset-password", { newPassword: "limited-password" });
    expect(response.status).toBe(429);
    expect((await db.select({ passwordHash: students.passwordHash }).from(students)
      .where(eq(students.id, item.student.id)))[0].passwordHash).toBe(item.student.passwordHash);
    await app.stop();
  });

  it("rolls back password, challenge, and revocation marker when session-marker persistence fails", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    const row = await persistedSessionFor(item.student.id);
    const state = row.sess.studentPasswordRecovery as {
      challengeId: number;
      studentId: number;
      schoolId: number;
      resetToken: string;
    };
    const suffix = `${Date.now()}_${serial++}`;
    const functionName = `fail_student_reset_${suffix}`;
    const triggerName = `fail_student_reset_${suffix}`;
    await pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.sid = '${studentSessionRevocationSid(item.student.id)}' THEN
          RAISE EXCEPTION 'intentional student reset marker failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON "session"
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
    try {
      await expect(storage.resetStudentPasswordAtomically(
        state.challengeId,
        state.studentId,
        state.schoolId,
        state.resetToken,
        await bcrypt.hash("rollback-password", 10),
      )).rejects.toThrow("intentional student reset marker failure");
      const [after] = await db.select().from(students).where(eq(students.id, item.student.id));
      expect(after.passwordHash).toBe(item.student.passwordHash);
      expect((await challengeFor(item.student.id))?.consumedAt).toBeNull();
      const marker = await pool.query(
        `SELECT 1 FROM "session" WHERE sid = $1`,
        [studentSessionRevocationSid(item.student.id)],
      );
      expect(marker.rows).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON "session"`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await app.stop();
    }
  });

  it("does not expose passwords, hashes, or reset secrets through logs", async () => {
    const item = await fixture();
    const app = await makeHarness();
    const reset = await beginReset(app, item);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await post("/api/student/reset-password", {
        newPassword: "secret-password",
      }, reset.cookie);
      expect(response.status).toBe(200);
      const output = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
      expect(output).not.toContain("secret-password");
      expect(output).not.toContain(item.student.passwordHash);
    } finally {
      log.mockRestore();
      error.mockRestore();
      await app.stop();
    }
  });
});