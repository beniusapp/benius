import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { notificationConfig, schools, studentPasswordResetChallenges, students, studentVerifiedRecoveryContacts } from "@shared/schema";
import { PasswordRecoveryRateLimiter, passwordRecoverySecretsEqual, hashPasswordRecoverySecret } from "../password-recovery";
import { registerStudentPasswordRecoveryRoutes } from "../student-password-recovery-routes";
import { StudentRecoverySafePgStore } from "../student-recovery-session-store";

let serial = 0;
const schoolIds: number[] = [];
const sessionIds: string[] = [];
let baseUrl = "";

const generic = "If those details match, an OTP has been sent to your recovery email. Please check and try again.";
const invalid = "Invalid or expired OTP. Please request a new OTP.";

async function fixture(suffix = `${Date.now()}-${serial++}`) {
  const [school] = await db.insert(schools).values({
    name: `Step 4 integration ${suffix}`,
    code: `S4I-${suffix}`,
  }).returning();
  schoolIds.push(school.id);
  const [student] = await db.insert(students).values({
    schoolId: school.id,
    digitalStudentId: `S4I-${suffix}`,
    name: "Integration Student",
    class: "10",
    section: "A",
    phone: `91${String(9000000000 + serial++).slice(-8)}`,
    dob: "2010-01-01",
    passwordHash: `unchanged-${suffix}`,
    email: `student-${suffix}@example.test`,
    isActive: true,
    isActivated: true,
  }).returning();
  const [contact] = await db.insert(studentVerifiedRecoveryContacts).values({
    schoolId: school.id,
    studentId: student.id,
    contactType: "email",
    contactValue: student.email!,
    contactValueNormalized: student.email!.trim().toLowerCase(),
    verifiedAt: new Date(),
    verificationMethod: "email_otp",
  }).returning();
  await db.insert(notificationConfig).values({
    schoolId: school.id,
    emailEnabled: true,
    emailProvider: "sendgrid",
    sendgridApiKey: "integration-only-key",
    sendgridFromEmail: "school@example.test",
    sendgridFromName: "Integration School",
  });
  return { school, student, contact };
}

type Harness = {
  stop: () => Promise<void>;
  send: ReturnType<typeof vi.fn>;
};

async function makeHarness(sendImpl?: (otp: string) => Promise<void>): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(session({
    store: new StudentRecoverySafePgStore(pool),
    secret: "student-step4-integration-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
  }));
  const send = vi.fn(async (_config: any, _recipient: string, otp: string) => {
    await sendImpl?.(otp);
  });
  registerStudentPasswordRecoveryRoutes(app, {
    getSchoolByCode: code => storage.getSchoolByCode(code),
    getStudentByDsidAndSchool: (dsid, schoolId) => storage.getStudentByDsidAndSchool(dsid, schoolId),
    getVerifiedRecoveryContact: (studentId, schoolId) => storage.getStudentVerifiedRecoveryContact(studentId, schoolId),
    createChallenge: async (studentId, schoolId, contactId, otpHash, expires, ip) =>
      storage.createStudentPasswordResetChallenge(studentId, schoolId, contactId, otpHash, expires, ip),
    invalidateChallenge: (challengeId, studentId, schoolId) =>
      storage.invalidateStudentPasswordResetChallenge(challengeId, studentId, schoolId),
    getNotificationConfig: schoolId => storage.getNotificationConfig(schoolId),
    sendRecoveryEmail: send,
    verifyOtp: (challengeId, studentId, schoolId, otp) =>
      storage.verifyStudentPasswordResetOtp(challengeId, studentId, schoolId, otp),
    rateLimiter: new PasswordRecoveryRateLimiter(1000),
    getPersistedRecoveryState: async sessionId => {
      const result = await pool.query<{ sess: any }>(
        `SELECT sess FROM "session" WHERE sid = $1`,
        [sessionId],
      );
      return result.rows[0]?.sess?.studentPasswordRecovery;
    },
    isChallengeActive: async (challengeId, studentId, schoolId) => {
      const challenge = await storage.getStudentPasswordResetChallenge(challengeId, studentId, schoolId);
      return !!challenge && !challenge.consumedAt && !challenge.verifiedAt;
    },
  } as any);
  const listeningServer = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = listeningServer.address();
  if (!address || typeof address === "string") throw new Error("Integration server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    send,
    stop: () => new Promise<void>((resolve, reject) =>
      listeningServer.close(error => error ? reject(error) : resolve())
    ),
  };
}

async function post(path: string, body: Record<string, unknown>, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
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

beforeAll(async () => {
  process.env.SESSION_SECRET = "student-step4-integration-session-secret";
});

afterAll(async () => {
  if (sessionIds.length) {
    await pool.query(`DELETE FROM "session" WHERE sid = ANY($1::text[])`, [sessionIds]);
  }
  if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
});

describe("Student Step 4 PostgreSQL HTTP integration", () => {
  it("persists OTP_PENDING, hashes OTP, and preserves password hash", async () => {
    const { school, student } = await fixture();
    const app = await makeHarness();
    const result = await post("/api/student/forgot-password", {
      schoolCode: school.code,
      dsid: student.digitalStudentId,
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: generic });
    expect(JSON.stringify(result.body)).not.toMatch(/token|challengeId|studentId|schoolId/i);
    const [stored] = await db.select().from(studentPasswordResetChallenges)
      .where(eq(studentPasswordResetChallenges.studentId, student.id));
    expect(stored).toMatchObject({ schoolId: school.id, studentId: student.id, attemptCount: 0 });
    const otp = app.send.mock.calls[0][2] as string;
    expect(stored.otpHash).not.toBe(otp);
    expect(passwordRecoverySecretsEqual(stored.otpHash, hashPasswordRecoverySecret(otp))).toBe(true);
    expect(stored.otpHash).not.toContain(otp);
    const session = await pool.query<{ sess: any }>(
      `SELECT sess FROM "session"
       WHERE sess->'studentPasswordRecovery'->>'studentId' = $1
       ORDER BY expire DESC LIMIT 1`,
      [String(student.id)],
    );
    expect(session.rows[0].sess.studentPasswordRecovery).toMatchObject({
      stage: "otp_pending", challengeId: stored.id, studentId: student.id, schoolId: school.id,
    });
    const [unchanged] = await db.select({ passwordHash: students.passwordHash })
      .from(students).where(eq(students.id, student.id));
    expect(unchanged.passwordHash).toBe(student.passwordHash);
    await app.stop();
  });

  it("keeps same DSIDs isolated by school and returns generic wrong-school responses", async () => {
    const a = await fixture();
    const b = await fixture();
    const app = await makeHarness();
    const wrong = await post("/api/student/forgot-password", { schoolCode: b.school.code, dsid: a.student.digitalStudentId });
    expect(wrong.body).toEqual({ message: generic });
    expect(app.send).not.toHaveBeenCalled();
    const right = await post("/api/student/forgot-password", { schoolCode: a.school.code, dsid: a.student.digitalStudentId });
    expect(right.body).toEqual({ message: generic });
    expect(app.send).toHaveBeenCalledTimes(1);
    await app.stop();
  });

  it("allows exactly one concurrent correct OTP verifier and leaves PASSWORD_RESET server-bound", async () => {
    const { school, student } = await fixture();
    const app = await makeHarness();
    const forgot = await post("/api/student/forgot-password", { schoolCode: school.code, dsid: student.digitalStudentId });
    const otp = app.send.mock.calls[0][2] as string;
    const results = await Promise.all([
      post("/api/student/verify-recovery-otp", { otp }, forgot.cookie),
      post("/api/student/verify-recovery-otp", { otp }, forgot.cookie),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
    expect(results.find(result => result.status === 400)?.body).toEqual({ message: invalid });
    const [challenge] = await db.select().from(studentPasswordResetChallenges)
      .where(eq(studentPasswordResetChallenges.studentId, student.id));
    expect(challenge.verifiedAt).not.toBeNull();
    expect(challenge.resetTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge.resetTokenHash).not.toContain(otp);
    await app.stop();
  });

  it("converges simultaneous forgot requests to one latest active challenge", async () => {
    const { school, student } = await fixture();
    const app = await makeHarness();
    const baseline = await post("/api/student/forgot-password", {
      schoolCode: school.code,
      dsid: student.digitalStudentId,
    });
    const [first, second] = await Promise.all([
      post("/api/student/forgot-password", {
        schoolCode: school.code,
        dsid: student.digitalStudentId,
      }, baseline.cookie),
      post("/api/student/forgot-password", {
        schoolCode: school.code,
        dsid: student.digitalStudentId,
      }, baseline.cookie),
    ]);
    expect(first.body).toEqual({ message: generic });
    expect(second.body).toEqual({ message: generic });
    const challenges = await db.select().from(studentPasswordResetChallenges)
      .where(eq(studentPasswordResetChallenges.studentId, student.id));
    const active = challenges.filter(challenge => !challenge.consumedAt);
    expect(active).toHaveLength(1);
    const session = await pool.query<{ sess: any }>(
      `SELECT sess FROM "session"
       WHERE sess->'studentPasswordRecovery'->>'studentId' = $1
       ORDER BY expire DESC LIMIT 1`,
      [String(student.id)],
    );
    expect(session.rows[0].sess.studentPasswordRecovery.challengeId).toBe(active[0].id);
    const otp = app.send.mock.calls.find(call => {
      const value = call[2] as string;
      return passwordRecoverySecretsEqual(active[0].otpHash, hashPasswordRecoverySecret(value));
    })?.[2] as string | undefined;
    expect(otp).toMatch(/^\d{6}$/);
    const verified = await post("/api/student/verify-recovery-otp", { otp }, baseline.cookie);
    expect(verified.status).toBe(200);
    await app.stop();
  });

  it("blocks verification after current contact revocation or Student deactivation", async () => {
    const contactCase = await fixture();
    const app = await makeHarness();
    const contactForgot = await post("/api/student/forgot-password", {
      schoolCode: contactCase.school.code,
      dsid: contactCase.student.digitalStudentId,
    });
    const contactOtp = app.send.mock.calls.at(-1)![2] as string;
    await db.update(studentVerifiedRecoveryContacts)
      .set({ verifiedAt: null })
      .where(eq(studentVerifiedRecoveryContacts.id, contactCase.contact.id));
    const revoked = await post("/api/student/verify-recovery-otp", { otp: contactOtp }, contactForgot.cookie);
    expect(revoked.status).toBe(400);
    expect(revoked.body).toEqual({ message: invalid });

    const inactiveCase = await fixture();
    const inactiveForgot = await post("/api/student/forgot-password", {
      schoolCode: inactiveCase.school.code,
      dsid: inactiveCase.student.digitalStudentId,
    });
    const inactiveOtp = app.send.mock.calls.at(-1)![2] as string;
    await db.update(students).set({ isActive: false })
      .where(eq(students.id, inactiveCase.student.id));
    const inactive = await post("/api/student/verify-recovery-otp", { otp: inactiveOtp }, inactiveForgot.cookie);
    expect(inactive.status).toBe(400);
    expect(inactive.body).toEqual({ message: invalid });
    await app.stop();
  });

  it("does not let a late failed delivery A clear successful B", async () => {
    const a = await fixture();
    let releaseA!: () => void;
    const gateA = new Promise<void>(resolve => { releaseA = resolve; });
    let invocation = 0;
    const app = await makeHarness(async otp => {
      const ordinal = ++invocation;
      if (ordinal === 2) await gateA;
      if (ordinal === 2) throw new Error(`delivery failed ${otp}`);
    });
    const baseline = await post("/api/student/forgot-password", {
      schoolCode: a.school.code,
      dsid: a.student.digitalStudentId,
    });
    const requestA = post("/api/student/forgot-password", { schoolCode: a.school.code, dsid: a.student.digitalStudentId }, baseline.cookie);
    await new Promise(resolve => setTimeout(resolve, 30));
    const requestB = post("/api/student/forgot-password", { schoolCode: a.school.code, dsid: a.student.digitalStudentId }, baseline.cookie);
    await new Promise(resolve => setTimeout(resolve, 30));
    releaseA();
    const [resultA, resultB] = await Promise.all([requestA, requestB]);
    expect(resultA.status).toBe(200);
    expect(resultB.status).toBe(200);
    const latest = await db.select().from(studentPasswordResetChallenges)
      .where(eq(studentPasswordResetChallenges.studentId, a.student.id));
    const active = latest.filter(challenge => !challenge.consumedAt);
    expect(active).toHaveLength(1);
    expect(invocation).toBe(3);
    const otpB = app.send.mock.calls[2][2] as string;
    expect(passwordRecoverySecretsEqual(active[0].otpHash, hashPasswordRecoverySecret(otpB))).toBe(true);
    const verified = await post("/api/student/verify-recovery-otp", { otp: otpB }, baseline.cookie);
    expect(verified.status).toBe(200);
    await app.stop();
  });
});