import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { registerTeacherPasswordRecoveryRoutes } from "../teacher-password-recovery-routes";
import { hashPasswordRecoverySecret } from "../password-recovery";
import { userSessionRevocationSid } from "../session-revocation";
import { passwordResetChallenges, schools, teachers, users } from "@shared/schema";

let server: Server;
let baseUrl = "";
const schoolIds: number[] = [];
const sessionIds: string[] = [];
let serial = 0;

async function createAccount(label: string) {
  const suffix = `${Date.now().toString(36)}${serial++}`;
  const [school] = await db.insert(schools).values({
    name: `Route Reset ${label} ${suffix}`,
    code: `RR-${label}-${suffix}`.slice(0, 20),
  }).returning({ id: schools.id });
  schoolIds.push(school.id);
  const oldPassword = `old-password-${label}-${suffix}`;
  const [user] = await db.insert(users).values({
    email: `route-reset-${label}-${suffix}@example.test`,
    passwordHash: await bcrypt.hash(oldPassword, 10),
    role: "teacher",
    schoolId: school.id,
    isActive: true,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId: school.id,
    fullName: `Route Reset Teacher ${label}`,
    phone: `7${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Security",
    assignedClass: "1",
    assignedSection: "A",
    isActive: true,
    mustChangePassword: true,
    otpCode: "654321",
    otpExpiresAt: new Date(Date.now() + 600_000),
    resetToken: `legacy-token-${label}`,
    resetTokenExpiresAt: new Date(Date.now() + 600_000),
  }).returning();
  return { school, user, teacher, oldPassword };
}

async function post(path: string, body: Record<string, unknown>, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as any,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}

beforeAll(async () => {
  process.env.SESSION_SECRET = "teacher-reset-route-integration-secret";
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "teacher-reset-route-integration-secret",
    resave: false,
    saveUninitialized: false,
  }));
  registerTeacherPasswordRecoveryRoutes(app);
  app.post("/test/recovery", (req, res) => {
    req.session.teacherPasswordRecovery = req.body.recovery;
    res.json({ ok: true });
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
  if (schoolIds.length) {
    await db.delete(schools).where(inArray(schools.id, schoolIds));
  }
});

describe("secure Teacher password-reset route with real storage", () => {
  it("resets only the session-bound tenant, invalidates sessions, preserves legacy fields, and rejects replay", async () => {
    const accountA = await createAccount("A");
    const accountB = await createAccount("B");
    const tokenA = `route-token-a-${Date.now()}`;
    const tokenB = `route-token-b-${Date.now()}`;
    const now = new Date();
    const [challengeA] = await db.insert(passwordResetChallenges).values({
      userId: accountA.user.id,
      schoolId: accountA.school.id,
      otpHash: hashPasswordRecoverySecret("111111"),
      otpExpiresAt: new Date(now.getTime() + 600_000),
      verifiedAt: now,
      resetTokenHash: hashPasswordRecoverySecret(tokenA),
      resetTokenExpiresAt: new Date(now.getTime() + 600_000),
      requestIp: "127.0.0.1",
    }).returning();
    const [challengeB] = await db.insert(passwordResetChallenges).values({
      userId: accountB.user.id,
      schoolId: accountB.school.id,
      otpHash: hashPasswordRecoverySecret("222222"),
      otpExpiresAt: new Date(now.getTime() + 600_000),
      verifiedAt: now,
      resetTokenHash: hashPasswordRecoverySecret(tokenB),
      resetTokenExpiresAt: new Date(now.getTime() + 600_000),
      requestIp: "127.0.0.1",
    }).returning();

    for (let index = 0; index < 3; index += 1) {
      const sid = `route-reset-auth-${accountA.user.id}-${index}`;
      sessionIds.push(sid);
      await pool.query(
        `INSERT INTO "session" (sid, sess, expire)
         VALUES ($1, $2::json, $3)
         ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [
          sid,
          JSON.stringify({
            cookie: {},
            userId: accountA.user.id,
            teacherId: accountA.teacher.id,
            schoolId: accountA.school.id,
            userRole: "teacher",
            authIssuedAt: Date.now() - 1000,
          }),
          new Date(Date.now() + 60 * 60 * 1000),
        ],
      );
    }
    sessionIds.push(userSessionRevocationSid(accountA.user.id));

    const recoveryTime = Date.now();
    const seeded = await post("/test/recovery", {
      recovery: {
        flow: "teacher_password_recovery",
        stage: "password_reset",
        challengeId: challengeA.id,
        userId: accountA.user.id,
        schoolId: accountA.school.id,
        teacherId: accountA.teacher.id,
        resetToken: tokenA,
        createdAt: recoveryTime,
        updatedAt: recoveryTime,
      },
    });
    const newPassword = "new-route-password-🔐";
    const result = await post("/api/teacher/reset-password", {
      newPassword,
      confirmPassword: newPassword,
      challengeId: challengeB.id,
      userId: accountB.user.id,
      teacherId: accountB.teacher.id,
      schoolId: accountB.school.id,
      tenantId: accountB.school.id,
      resetToken: tokenB,
    }, seeded.cookie);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      message: "Your password has been reset successfully. Please log in again.",
    });
    const [storedUserA] = await db.select().from(users).where(eq(users.id, accountA.user.id));
    const [storedUserB] = await db.select().from(users).where(eq(users.id, accountB.user.id));
    const [storedTeacherA] = await db.select().from(teachers).where(eq(teachers.id, accountA.teacher.id));
    expect(await bcrypt.compare(accountA.oldPassword, storedUserA.passwordHash)).toBe(false);
    expect(await bcrypt.compare(newPassword, storedUserA.passwordHash)).toBe(true);
    expect(await bcrypt.compare(accountB.oldPassword, storedUserB.passwordHash)).toBe(true);
    expect(storedTeacherA.mustChangePassword).toBe(false);
    expect(storedTeacherA.otpCode).toBe("654321");
    expect(storedTeacherA.resetToken).toBe("legacy-token-A");

    const oldSessions = await pool.query(
      `SELECT sid FROM "session" WHERE sess->>'userId' = $1`,
      [String(accountA.user.id)],
    );
    expect(oldSessions.rows).toHaveLength(0);

    const replay = await post("/api/teacher/reset-password", {
      newPassword: "second-password",
      confirmPassword: "second-password",
    }, seeded.cookie);
    expect(replay.status).toBe(400);
    const [afterReplay] = await db.select().from(users).where(eq(users.id, accountA.user.id));
    expect(await bcrypt.compare(newPassword, afterReplay.passwordHash)).toBe(true);

    const reverseTime = Date.now();
    const seededB = await post("/test/recovery", {
      recovery: {
        flow: "teacher_password_recovery",
        stage: "password_reset",
        challengeId: challengeB.id,
        userId: accountB.user.id,
        schoolId: accountB.school.id,
        teacherId: accountB.teacher.id,
        resetToken: tokenB,
        createdAt: reverseTime,
        updatedAt: reverseTime,
      },
    }, seeded.cookie);
    const newPasswordB = "new-route-password-b";
    const reverse = await post("/api/teacher/reset-password", {
      newPassword: newPasswordB,
      confirmPassword: newPasswordB,
      challengeId: challengeA.id,
      userId: accountA.user.id,
      teacherId: accountA.teacher.id,
      schoolId: accountA.school.id,
      tenantId: accountA.school.id,
      resetToken: tokenA,
    }, seededB.cookie);
    expect(reverse.status).toBe(200);
    const [finalUserA] = await db.select().from(users).where(eq(users.id, accountA.user.id));
    const [finalUserB] = await db.select().from(users).where(eq(users.id, accountB.user.id));
    expect(await bcrypt.compare(newPassword, finalUserA.passwordHash)).toBe(true);
    expect(await bcrypt.compare(newPasswordB, finalUserB.passwordHash)).toBe(true);
  });
});