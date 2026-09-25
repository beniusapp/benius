import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import session from "express-session";
import type { Server } from "node:http";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { passwordResetChallenges, schools, teachers, users } from "@shared/schema";
import { registerTeacherRoutes } from "../teacher-routes";
import { userSessionRevocationSid } from "../session-revocation";

let schoolId = 0;
let otherSchoolId = 0;
let teacherId = 0;
let userId = 0;
let otherUserId = 0;
let rollbackTeacherId = 0;
let rollbackUserId = 0;
let concurrentTeacherA: { teacherId: number; userId: number };
let concurrentTeacherB: { teacherId: number; userId: number };
let server: Server;
let baseUrl = "";
const schoolIds: number[] = [];
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function createTeacher(email: string, owningSchoolId: number) {
  const [user] = await db.insert(users).values({
    email,
    passwordHash: await bcrypt.hash("teacher-email-test-password", 10),
    role: "teacher",
    schoolId: owningSchoolId,
    isActive: true,
  }).returning({ id: users.id });
  const [teacher] = await db.insert(teachers).values({
    userId: user.id,
    schoolId: owningSchoolId,
    fullName: "Email Update Teacher",
    phone: `9${String(user.id).padStart(9, "0").slice(-9)}`,
    subject: "Security",
    assignedClass: "1",
    assignedSection: "A",
  }).returning({ id: teachers.id });
  return { userId: user.id, teacherId: teacher.id };
}

beforeAll(async () => {
  const created = await db.insert(schools).values([
    { name: `Teacher Email Update A ${suffix}`, code: `TEUA-${suffix.slice(-8)}` },
    { name: `Teacher Email Update B ${suffix}`, code: `TEUB-${suffix.slice(-8)}` },
  ]).returning({ id: schools.id });
  schoolId = created[0].id;
  otherSchoolId = created[1].id;
  schoolIds.push(schoolId, otherSchoolId);
  ({ teacherId, userId } = await createTeacher(`original-${suffix}@example.test`, schoolId));
  ({ userId: otherUserId } = await createTeacher(`other-${suffix}@example.test`, otherSchoolId));
  ({ teacherId: rollbackTeacherId, userId: rollbackUserId } =
    await createTeacher(`rollback-${suffix}@example.test`, schoolId));
  concurrentTeacherA = await createTeacher(`concurrent-a-${suffix}@example.test`, schoolId);
  concurrentTeacherB = await createTeacher(`concurrent-b-${suffix}@example.test`, schoolId);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: `teacher-email-login-${suffix}`, resave: false, saveUninitialized: false }));
  registerTeacherRoutes(app);
  server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Teacher login test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
});

function profile(email?: string) {
  return {
    fullName: "Email Update Teacher",
    subject: "Security",
    assignedClass: "1",
    assignedSection: "A",
    ...(email === undefined ? {} : { email }),
  };
}

describe("teacher email update transaction", () => {
  it("updates users.email, consumes recovery challenges, and revokes only target sessions", async () => {
    const sessionSid = `teacher-email-target-${suffix}`;
    const otherSessionSid = `teacher-email-other-${suffix}`;
    const otherChallenge = await db.insert(passwordResetChallenges).values({
      userId: otherUserId,
      schoolId: otherSchoolId,
      otpHash: "other-otp-hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
    }).returning({ id: passwordResetChallenges.id });
    await db.insert(passwordResetChallenges).values({
      userId,
      schoolId,
      otpHash: "otp-hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
    });
    await pool.query(
      `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2::json, $3), ($4, $5::json, $6)`,
      [
        sessionSid, JSON.stringify({ userId }), new Date(Date.now() + 60_000),
        otherSessionSid, JSON.stringify({ userId: otherUserId }), new Date(Date.now() + 60_000),
      ],
    );

    const updated = await storage.updateTeacherAssignment(
      teacherId,
      schoolId,
      profile(`changed-${suffix}@example.test`),
    );
    expect(updated?.id).toBe(teacherId);
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    expect(user.email).toBe(`changed-${suffix}@example.test`);
    const challenges = await db.select({ consumedAt: passwordResetChallenges.consumedAt })
      .from(passwordResetChallenges)
      .where(and(eq(passwordResetChallenges.userId, userId), eq(passwordResetChallenges.schoolId, schoolId)));
    expect(challenges).toHaveLength(1);
    expect(challenges[0].consumedAt).not.toBeNull();
    const sessions = await pool.query<{ sid: string }>(
      `SELECT sid FROM "session" WHERE sid IN ($1, $2)`,
      [sessionSid, otherSessionSid],
    );
    expect(sessions.rows.map(row => row.sid)).toEqual([otherSessionSid]);
    const [untouchedOtherChallenge] = await db.select({
      consumedAt: passwordResetChallenges.consumedAt,
    }).from(passwordResetChallenges).where(eq(passwordResetChallenges.id, otherChallenge[0].id));
    expect(untouchedOtherChallenge.consumedAt).toBeNull();
  });

  it("treats the exact existing email as a no-op", async () => {
    const [before] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    await db.insert(passwordResetChallenges).values({
      userId,
      schoolId,
      otpHash: "otp-hash-noop",
      otpExpiresAt: new Date(Date.now() + 60_000),
    });
    const sessionSid = `teacher-email-noop-${suffix}`;
    await pool.query(
      `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2::json, $3)`,
      [sessionSid, JSON.stringify({ userId }), new Date(Date.now() + 60_000)],
    );
    await storage.updateTeacherAssignment(teacherId, schoolId, profile(before.email));
    const [challenge] = await db.select({ consumedAt: passwordResetChallenges.consumedAt })
      .from(passwordResetChallenges)
      .where(and(
        eq(passwordResetChallenges.userId, userId),
        eq(passwordResetChallenges.schoolId, schoolId),
        isNull(passwordResetChallenges.consumedAt),
      ));
    expect(challenge).toBeDefined();
    const session = await pool.query<{ sid: string }>(
      `SELECT sid FROM "session" WHERE sid = $1`,
      [sessionSid],
    );
    expect(session.rows).toHaveLength(1);
  });

  it("uses the new email for login and rejects the old email", async () => {
    const oldLogin = await fetch(`${baseUrl}/api/teacher-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `original-${suffix}@example.test`, password: "teacher-email-test-password" }),
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await fetch(`${baseUrl}/api/teacher-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `changed-${suffix}@example.test`, password: "teacher-email-test-password" }),
    });
    expect(newLogin.status).toBe(200);
  });

  it("rejects a globally duplicate email without changing the target", async () => {
    await expect(storage.updateTeacherAssignment(
      teacherId,
      schoolId,
      profile(`other-${suffix}@example.test`),
    )).rejects.toMatchObject({ status: 409 });
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    expect(user.email).toBe(`changed-${suffix}@example.test`);
  });

  it("cannot update a Teacher through another school", async () => {
    const result = await storage.updateTeacherAssignment(
      teacherId,
      otherSchoolId,
      profile(`forged-${suffix}@example.test`),
    );
    expect(result).toBeUndefined();
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    expect(user.email).toBe(`changed-${suffix}@example.test`);
  });

  it("rolls back email, challenge, sessions, and revocation marker after final update failure", async () => {
    const sessionSid = `teacher-email-rollback-${suffix}`;
    await db.insert(passwordResetChallenges).values({
      userId: rollbackUserId,
      schoolId,
      otpHash: "rollback-otp-hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
    });
    await pool.query(
      `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2::json, $3)`,
      [sessionSid, JSON.stringify({ userId: rollbackUserId }), new Date(Date.now() + 60_000)],
    );
    await expect(storage.updateTeacherAssignment(
      rollbackTeacherId,
      schoolId,
      { ...profile(`rollback-new-${suffix}@example.test`), phone: "9".repeat(21) },
    )).rejects.toBeTruthy();

    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, rollbackUserId));
    expect(user.email).toBe(`rollback-${suffix}@example.test`);
    const [challenge] = await db.select({ consumedAt: passwordResetChallenges.consumedAt })
      .from(passwordResetChallenges)
      .where(and(eq(passwordResetChallenges.userId, rollbackUserId), eq(passwordResetChallenges.schoolId, schoolId)));
    expect(challenge.consumedAt).toBeNull();
    const sessions = await pool.query<{ sid: string }>(
      `SELECT sid FROM "session" WHERE sid = $1`,
      [sessionSid],
    );
    expect(sessions.rows).toHaveLength(1);
    const marker = await pool.query(
      `SELECT sid FROM "session" WHERE sid = $1`,
      [userSessionRevocationSid(rollbackUserId)],
    );
    expect(marker.rows).toHaveLength(0);
  });

  it("allows exactly one concurrent global-email winner without invalidating the loser", async () => {
    const targetEmail = `concurrent-winner-${suffix}@example.test`;
    const winnerCandidateSessionA = `teacher-email-concurrent-a-${suffix}`;
    const loserSessionSid = `teacher-email-loser-${suffix}`;
    await db.insert(passwordResetChallenges).values({
      userId: concurrentTeacherA.userId,
      schoolId,
      otpHash: "loser-a-otp-hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(passwordResetChallenges).values({
      userId: concurrentTeacherB.userId,
      schoolId,
      otpHash: "loser-otp-hash",
      otpExpiresAt: new Date(Date.now() + 60_000),
    });
    await pool.query(
      `INSERT INTO "session" (sid, sess, expire) VALUES ($1, $2::json, $3), ($4, $5::json, $6)`,
      [
        winnerCandidateSessionA, JSON.stringify({ userId: concurrentTeacherA.userId }), new Date(Date.now() + 60_000),
        loserSessionSid, JSON.stringify({ userId: concurrentTeacherB.userId }), new Date(Date.now() + 60_000),
      ],
    );
    const results = await Promise.allSettled([
      storage.updateTeacherAssignment(
        concurrentTeacherA.teacherId,
        schoolId,
        profile(targetEmail),
      ),
      storage.updateTeacherAssignment(
        concurrentTeacherB.teacherId,
        schoolId,
        profile(targetEmail),
      ),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const owners = await db.select({ id: users.id }).from(users).where(eq(users.email, targetEmail));
    expect(owners).toHaveLength(1);
    const [userA] = await db.select({ email: users.email }).from(users).where(eq(users.id, concurrentTeacherA.userId));
    const loserUserId = userA.email === targetEmail ? concurrentTeacherB.userId : concurrentTeacherA.userId;
    const loserSession = loserUserId === concurrentTeacherA.userId
      ? winnerCandidateSessionA
      : loserSessionSid;
    {
      const [challenge] = await db.select({ consumedAt: passwordResetChallenges.consumedAt })
        .from(passwordResetChallenges)
        .where(and(
          eq(passwordResetChallenges.userId, loserUserId),
          eq(passwordResetChallenges.schoolId, schoolId),
        ));
      expect(challenge.consumedAt).toBeNull();
      const session = await pool.query(`SELECT sid FROM "session" WHERE sid = $1`, [loserSession]);
      expect(session.rows).toHaveLength(1);
    }
  });
});