import type { Express, NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  type AcademicSession,
  mobileAuthChallenges,
  schools,
  students,
  teachers,
  users,
} from "@workspace/db";
import { z } from "zod/v4";
import { db, pool } from "./db";
import { storage } from "./storage";
import {
  authenticationAttemptIsRevoked,
  studentAuthenticationAttemptIsRevoked,
} from "./session-revocation";
import {
  adminInitializationPasswordMatches,
  mobilePrincipalMatchesSession,
  refreshCredentialDecision,
  shouldFallbackToSupportStaff,
  mobileRequestUsesTrustedHttps,
} from "./mobile-auth-policy";
import {
  MOBILE_AUTH_RATE_LIMIT_WINDOW_MINUTES,
  reserveMobileAuthAttempt,
} from "./mobile-auth-rate-limit";
import {
  createMobileCredential,
  hashMobileCredential,
  MOBILE_ACCESS_TTL_MS,
  MOBILE_CHALLENGE_TTL_MS,
  MOBILE_REFRESH_TTL_MS,
} from "./mobile-auth-crypto";

type MobileRole = "admin" | "teacher" | "student" | "support_staff";
type MobilePrincipal = {
  id: number;
  principalId: number;
  entityId: number | null;
  role: MobileRole;
  schoolId: number;
  schoolName: string;
  name: string;
  passwordVersion: string;
  allowedModules?: string[];
};

const loginSchema = z.object({
  role: z.enum(["admin", "teacher", "student", "support_staff"]),
  identifier: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1024),
});
const initializeSchema = z.object({
  challengeToken: z.string().min(20).max(200),
  newPassword: z.string().min(6).max(1024),
  confirmPassword: z.string().min(6).max(1024),
  pin: z.string().regex(/^\d{6}$/),
  confirmPin: z.string().regex(/^\d{6}$/),
  recoveryEmail: z.string().email().max(255),
  recoveryPhone: z.string().regex(/^\d{10}$/),
});
const verifyPinSchema = z.object({
  challengeToken: z.string().min(20).max(200),
  pin: z.string().regex(/^\d{6}$/),
});
const refreshSchema = z.object({ refreshToken: z.string().min(30).max(200) });

type DbSession = {
  id: string;
  principal_id: number;
  principal_entity_id: number | null;
  role: MobileRole;
  school_id: number;
  access_expires_at: Date;
  expires_at: Date;
  auth_issued_at: Date;
  principal_password_version: string;
  revoked_at: Date | null;
};
type MobileAuthenticatedRequest = Request & {
  mobileAuth?: { session: DbSession; principal: MobilePrincipal };
  mobileAcademicSession?: AcademicSession;
};

function reject(res: Response, status: number, message: string) {
  return res.status(status).json({ message });
}

function rejectRateLimited(res: Response) {
  res.set("Retry-After", String(MOBILE_AUTH_RATE_LIMIT_WINDOW_MINUTES * 60));
  return reject(res, 429, "Too many mobile authentication attempts. Please try again later.");
}

function isHttpsRequest(req: Request): boolean {
  return mobileRequestUsesTrustedHttps(req);
}

function requireHttps(req: Request, res: Response, next: () => void) {
  if (!isHttpsRequest(req)) {
    reject(res, 426, "HTTPS is required for mobile authentication.");
    return;
  }
  next();
}

async function resolvePrincipal(
  role: MobileRole,
  principalId: number,
  entityId: number | null,
  expectedSchoolId: number,
): Promise<MobilePrincipal | null> {
  if (role === "student") {
    const studentId = entityId ?? principalId;
    const [row] = await db.select().from(students).innerJoin(schools, eq(students.schoolId, schools.id))
      .where(and(eq(students.id, studentId), eq(students.schoolId, expectedSchoolId)));
    if (!row || !row.students.isActive || !row.students.isActivated) return null;
    return {
      id: row.students.id,
      principalId: row.students.id,
      entityId: row.students.id,
      role,
      schoolId: row.schools.id,
      schoolName: row.schools.name,
      name: row.students.name,
      passwordVersion: hashMobileCredential(row.students.passwordHash),
    };
  }
  if (role === "teacher") {
    if (entityId === null) return null;
    const [row] = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .where(and(
        eq(users.id, principalId),
        eq(users.role, "teacher"),
        eq(teachers.id, entityId),
        eq(teachers.schoolId, expectedSchoolId),
        eq(users.schoolId, expectedSchoolId),
      ));
    if (!row || !row.users.isActive || !row.teachers.isActive || row.teachers.mustChangePassword) return null;
    return {
      id: row.teachers.id,
      principalId: row.users.id,
      entityId: row.teachers.id,
      role,
      schoolId: row.schools.id,
      schoolName: row.schools.name,
      name: row.teachers.fullName,
      passwordVersion: hashMobileCredential(row.users.passwordHash),
    };
  }
  if (role === "support_staff") {
    const staff = await storage.getNonTeachingStaffById(entityId ?? principalId);
    if (!staff || !staff.isActive || staff.schoolId !== expectedSchoolId) return null;
    if (!staff.passwordHash) return null;
    const [school] = await db.select().from(schools).where(eq(schools.id, expectedSchoolId));
    if (!school) return null;
    return {
      id: staff.id,
      principalId: staff.id,
      entityId: staff.id,
      role,
      schoolId: school.id,
      schoolName: school.name,
      name: staff.fullName,
      passwordVersion: hashMobileCredential(staff.passwordHash),
      allowedModules: staff.allowedModules,
    };
  }
  const [row] = await db.select().from(users).innerJoin(schools, eq(users.schoolId, schools.id))
    .where(and(
      eq(users.id, principalId),
      eq(users.role, "admin"),
      eq(users.schoolId, expectedSchoolId),
    ));
  if (!row || !row.users.isActive || !row.users.isInitialized) return null;
  return {
    id: row.users.id,
    principalId: row.users.id,
    entityId: null,
    role: "admin",
    schoolId: row.schools.id,
    schoolName: row.schools.name,
    name: row.users.email,
    passwordVersion: hashMobileCredential(row.users.passwordHash),
  };
}

async function principalHasBeenRevoked(
  principal: MobilePrincipal,
  issuedAt: Date,
): Promise<boolean> {
  const issuedAtMs = issuedAt.getTime();
  if (principal.role === "student") {
    return studentAuthenticationAttemptIsRevoked(principal.principalId, issuedAtMs);
  }
  if (principal.role === "admin" || principal.role === "teacher") {
    return authenticationAttemptIsRevoked(principal.principalId, issuedAtMs);
  }
  return false;
}

function userPayload(principal: MobilePrincipal) {
  return {
    id: principal.id,
    name: principal.name,
    role: principal.role,
    schoolId: principal.schoolId,
    schoolName: principal.schoolName,
    ...(principal.allowedModules ? { allowedModules: principal.allowedModules } : {}),
  };
}

function authenticatedPayload(
  principal: MobilePrincipal,
  accessToken: string,
  refreshToken: string,
  accessExpiresAt: Date,
) {
  return {
    state: "authenticated" as const,
    user: userPayload(principal),
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
  };
}

async function saveChallenge(
  userId: number,
  schoolId: number,
  purpose: "admin_pin" | "admin_initialize",
  authIssuedAt: Date,
  passwordVersion: string,
) {
  const challengeToken = createMobileCredential();
  const expiresAt = new Date(Date.now() + MOBILE_CHALLENGE_TTL_MS);
  await db.insert(mobileAuthChallenges).values({
    challengeHash: hashMobileCredential(challengeToken),
    principalId: userId,
    schoolId,
    purpose,
    authIssuedAt,
    principalPasswordVersion: passwordVersion,
    expiresAt,
  });
  return challengeToken;
}

async function createSession(
  principal: MobilePrincipal,
  authIssuedAt: Date,
): Promise<{ accessToken: string; refreshToken: string; accessExpiresAt: Date }> {
  const now = Date.now();
  const accessToken = createMobileCredential();
  const refreshToken = createMobileCredential();
  const sessionId = randomUUID();
  const expiresAt = new Date(now + MOBILE_REFRESH_TTL_MS);
  const accessExpiresAt = new Date(Math.min(now + MOBILE_ACCESS_TTL_MS, expiresAt.getTime()));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO mobile_auth_sessions
        (id, device_id, principal_id, principal_entity_id, role, school_id,
         principal_password_version, access_token_hash, access_expires_at, auth_issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        sessionId, randomUUID(), principal.principalId, principal.entityId, principal.role,
        principal.schoolId, principal.passwordVersion, hashMobileCredential(accessToken),
        accessExpiresAt, authIssuedAt, expiresAt,
      ],
    );
    await client.query(
      `INSERT INTO mobile_auth_refresh_tokens (session_id, family_id, token_hash, expires_at)
       VALUES ($1, $1, $2, $3)`,
      [sessionId, hashMobileCredential(refreshToken), expiresAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { accessToken, refreshToken, accessExpiresAt };
}

async function revokeSession(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE mobile_auth_sessions SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE id = $1`,
    [sessionId],
  );
  await pool.query(
    `UPDATE mobile_auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

async function authenticateBearer(req: Request, res: Response): Promise<{
  session: DbSession;
  principal: MobilePrincipal;
} | null> {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{30,200})$/);
  if (!match) {
    reject(res, 401, "Not authenticated.");
    return null;
  }
  const result = await pool.query<DbSession>(
    `SELECT id, principal_id, principal_entity_id, role, school_id, access_expires_at,
            expires_at, auth_issued_at, principal_password_version, revoked_at
     FROM mobile_auth_sessions
     WHERE access_token_hash = $1
       AND revoked_at IS NULL
       AND access_expires_at > NOW()
       AND expires_at > NOW()
     LIMIT 1`,
    [hashMobileCredential(match[1])],
  );
  const session = result.rows[0];
  if (!session) {
    reject(res, 401, "Mobile access credential is invalid or expired.");
    return null;
  }
  const principal = await resolvePrincipal(
    session.role, session.principal_id, session.principal_entity_id, session.school_id,
  );
  if (!principal
    || !mobilePrincipalMatchesSession(session, principal)
    || await principalHasBeenRevoked(principal, session.auth_issued_at)) {
    await revokeSession(session.id);
    reject(res, 401, "Mobile session is no longer authorized.");
    return null;
  }
  await pool.query("UPDATE mobile_auth_sessions SET last_used_at = NOW() WHERE id = $1", [session.id]);
  return { session, principal };
}

export async function requireMobileBearer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = await authenticateBearer(req, res);
    if (!auth) return;
    (req as MobileAuthenticatedRequest).mobileAuth = auth;
    next();
  } catch {
    reject(res, 503, "Unable to verify mobile session.");
  }
}

/**
 * Enforces a school-scoped academic-session selection after requireMobileBearer.
 * Exported for future mobile routes whose operations depend on the selected session.
 */
export async function requireMobileAcademicSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = (req as MobileAuthenticatedRequest).mobileAuth;
  if (!auth) {
    reject(res, 401, "Not authenticated.");
    return;
  }
  const header = req.get("x-view-session-id");
  if (!header || !/^[1-9]\d*$/.test(header)) {
    reject(res, 400, "A valid x-view-session-id header is required.");
    return;
  }
  const sessionId = Number(header);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    reject(res, 400, "A valid x-view-session-id header is required.");
    return;
  }
  try {
    const session = await storage.getAcademicSessionForSchool(sessionId, auth.principal.schoolId);
    if (!session) {
      reject(res, 403, "The selected academic session is not available.");
      return;
    }
    (req as MobileAuthenticatedRequest).mobileAcademicSession = session;
    next();
  } catch {
    reject(res, 503, "Unable to verify the selected academic session.");
  }
}

async function makeAdminChallengeResponse(
  userId: number,
  schoolId: number,
  initialize: boolean,
  authIssuedAt: Date,
  passwordVersion: string,
) {
  return {
    state: initialize ? "initialize_required" as const : "pin_required" as const,
    challengeToken: await saveChallenge(
      userId, schoolId, initialize ? "admin_initialize" : "admin_pin", authIssuedAt, passwordVersion,
    ),
  };
}

export function registerMobileAuthRoutes(app: Express): void {
  app.use("/api/mobile/auth", requireHttps);
  app.use("/api/mobile/academic-sessions", requireHttps);

  app.get("/api/mobile/academic-sessions", requireMobileBearer, async (req, res) => {
    const principal = (req as MobileAuthenticatedRequest).mobileAuth!.principal;
    if (principal.role === "support_staff") {
      return reject(res, 403, "This account is not permitted to view academic sessions.");
    }
    try {
      const [sessions, activeSession] = await Promise.all([
        storage.getAcademicSessions(principal.schoolId),
        storage.getActiveSession(principal.schoolId),
      ]);
      return res.json({ sessions, activeSessionId: activeSession?.id ?? null });
    } catch {
      return reject(res, 503, "Unable to load academic sessions.");
    }
  });

  app.get(
    "/api/mobile/academic-sessions/selection",
    requireMobileBearer,
    requireMobileAcademicSession,
    (req, res) => res.json({
      session: (req as MobileAuthenticatedRequest).mobileAcademicSession!,
    }),
  );

  app.post("/api/mobile/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return reject(res, 400, "Invalid mobile login request.");
      if (!await reserveMobileAuthAttempt(req)) return rejectRateLimited(res);
      const { role, identifier, password } = parsed.data;
      const startedAt = new Date();
      let authIssuedAt = startedAt;
      let principal: MobilePrincipal | null = null;

      if (role === "student") {
        const result = await storage.authenticateStudentByDsidForLogin(identifier, password);
        if (result.status === "inactive" || result.status === "not_activated") {
          return reject(res, 403, "This student account is not active for sign-in.");
        }
        if (result.status !== "success") return reject(res, 401, "Invalid identifier or password.");
        authIssuedAt = new Date(result.authIssuedAt);
        const [school] = await db.select().from(schools).where(eq(schools.id, result.student.schoolId));
        if (!school) return reject(res, 401, "This account is no longer authorized.");
        principal = {
          id: result.student.id,
          principalId: result.student.id,
          entityId: result.student.id,
          role,
          schoolId: school.id,
          schoolName: school.name,
          name: result.student.name,
          passwordVersion: hashMobileCredential(result.student.passwordHash),
        };
      } else if (role === "support_staff") {
        const existingUser = await storage.getUserByEmail(identifier);
        if (!shouldFallbackToSupportStaff(Boolean(existingUser))) {
          return reject(res, 401, "Invalid identifier or password.");
        }
        const staff = await storage.getNonTeachingStaffByEmail(identifier);
        if (!staff || !staff.passwordHash) return reject(res, 401, "Invalid identifier or password.");
        if (!await bcrypt.compare(password, staff.passwordHash)) {
          return reject(res, 401, "Invalid identifier or password.");
        }
        const [school] = await db.select().from(schools).where(eq(schools.id, staff.schoolId));
        if (!school) return reject(res, 401, "This account is no longer authorized.");
        principal = {
          id: staff.id,
          principalId: staff.id,
          entityId: staff.id,
          role,
          schoolId: school.id,
          schoolName: school.name,
          name: staff.fullName,
          passwordVersion: hashMobileCredential(staff.passwordHash),
          allowedModules: staff.allowedModules,
        };
      } else {
        const user = await storage.getUserByEmail(identifier);
        if (!user || user.role !== role) return reject(res, 401, "Invalid identifier or password.");
        if (!user.isActive) return reject(res, 403, "This account has been deactivated.");
        if (!await bcrypt.compare(password, user.passwordHash)) {
          return reject(res, 401, "Invalid identifier or password.");
        }
        if (await authenticationAttemptIsRevoked(user.id, startedAt.getTime())) {
          return reject(res, 401, "This account is no longer authorized.");
        }
        if (role === "admin") {
          const [school] = await db.select().from(schools).where(eq(schools.id, user.schoolId));
          if (!school) return reject(res, 401, "This account is no longer authorized.");
          if (!user.isInitialized) {
            return res.json(await makeAdminChallengeResponse(
              user.id, school.id, true, startedAt, hashMobileCredential(user.passwordHash),
            ));
          }
          if (!user.pinHash) return reject(res, 403, "Administrator PIN setup is required.");
          return res.json(await makeAdminChallengeResponse(
            user.id, school.id, false, startedAt, hashMobileCredential(user.passwordHash),
          ));
        }
        const teacher = await storage.getTeacherByUserId(user.id);
        if (!teacher || !teacher.isActive || teacher.schoolId !== user.schoolId) {
          return reject(res, 403, "This teacher account is not active for sign-in.");
        }
        if (teacher.mustChangePassword) return res.json({ state: "password_change_required" });
        const data = await storage.getTeacherWithSchool(teacher.id);
        if (!data || data.user.id !== user.id || data.school.id !== user.schoolId) {
          return reject(res, 401, "This account is no longer authorized.");
        }
        principal = {
          id: teacher.id,
          principalId: user.id,
          entityId: teacher.id,
          role,
          schoolId: data.school.id,
          schoolName: data.school.name,
          name: teacher.fullName,
          passwordVersion: hashMobileCredential(data.user.passwordHash),
        };
      }

      if (!principal) return reject(res, 401, "Invalid identifier or password.");
      if (await principalHasBeenRevoked(principal, authIssuedAt)) {
        return reject(res, 401, "This account is no longer authorized.");
      }
      const credentials = await createSession(principal, authIssuedAt);
      return res.json(authenticatedPayload(
        principal, credentials.accessToken, credentials.refreshToken, credentials.accessExpiresAt,
      ));
    } catch {
      return reject(res, 503, "Mobile sign-in is temporarily unavailable.");
    }
  });

  app.post("/api/mobile/auth/verify-pin", async (req, res) => {
    const parsed = verifyPinSchema.safeParse(req.body);
    if (!parsed.success) return reject(res, 400, "Invalid PIN challenge request.");
    try {
      if (!await reserveMobileAuthAttempt(req)) return rejectRateLimited(res);
      const challengeHash = hashMobileCredential(parsed.data.challengeToken);
      const client = await pool.connect();
      let userId: number | null = null;
      let schoolId: number | null = null;
      let authIssuedAt: Date | null = null;
      let passwordVersion: string | null = null;
      try {
        await client.query("BEGIN");
        const found = await client.query<{
          principal_id: number; school_id: number; attempt_count: number;
          auth_issued_at: Date; principal_password_version: string;
        }>(
          `SELECT principal_id, school_id, attempt_count, auth_issued_at, principal_password_version
           FROM mobile_auth_challenges
           WHERE challenge_hash = $1 AND purpose = 'admin_pin'
             AND consumed_at IS NULL AND expires_at > NOW()
           FOR UPDATE`,
          [challengeHash],
        );
        const challenge = found.rows[0];
        if (!challenge) {
          await client.query("ROLLBACK");
          return reject(res, 401, "Invalid or expired challenge.");
        }
        userId = challenge.principal_id;
        schoolId = challenge.school_id;
        authIssuedAt = challenge.auth_issued_at;
        passwordVersion = challenge.principal_password_version;
        const [user] = await db.select().from(users).where(and(
          eq(users.id, userId), eq(users.schoolId, schoolId), eq(users.role, "admin"),
        ));
        if (!user || !user.isActive || !user.isInitialized || !user.pinHash) {
          await client.query("UPDATE mobile_auth_challenges SET consumed_at = NOW() WHERE challenge_hash = $1", [challengeHash]);
          await client.query("COMMIT");
          return reject(res, 403, "Administrator account state is not valid for mobile sign-in.");
        }
        if (!await bcrypt.compare(parsed.data.pin, user.pinHash)) {
          const consume = challenge.attempt_count >= 4 ? ", consumed_at = NOW()" : "";
          await client.query(
            `UPDATE mobile_auth_challenges SET attempt_count = attempt_count + 1${consume}
             WHERE challenge_hash = $1`,
            [challengeHash],
          );
          await client.query("COMMIT");
          return reject(res, 401, "Incorrect PIN.");
        }
        await client.query(
          "UPDATE mobile_auth_challenges SET consumed_at = NOW() WHERE challenge_hash = $1",
          [challengeHash],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const principal = await resolvePrincipal("admin", userId!, null, schoolId!);
      if (!principal || principal.passwordVersion !== passwordVersion) {
        return reject(res, 403, "Administrator account state is not valid for mobile sign-in.");
      }
      if (await principalHasBeenRevoked(principal, authIssuedAt!)) {
        return reject(res, 401, "This account is no longer authorized.");
      }
      const credentials = await createSession(principal, authIssuedAt!);
      return res.json(authenticatedPayload(
        principal, credentials.accessToken, credentials.refreshToken, credentials.accessExpiresAt,
      ));
    } catch {
      return reject(res, 503, "PIN verification is temporarily unavailable.");
    }
  });

  app.post("/api/mobile/auth/initialize", async (req, res) => {
    const parsed = initializeSchema.safeParse(req.body);
    if (!parsed.success) return reject(res, 400, "Invalid administrator initialization request.");
    if (parsed.data.newPassword !== parsed.data.confirmPassword) return reject(res, 400, "Passwords do not match.");
    if (parsed.data.pin !== parsed.data.confirmPin) return reject(res, 400, "PINs do not match.");
    try {
      if (!await reserveMobileAuthAttempt(req)) return rejectRateLimited(res);
      const challengeHash = hashMobileCredential(parsed.data.challengeToken);
      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      const pinHash = await bcrypt.hash(parsed.data.pin, 12);
      const client = await pool.connect();
      let userId: number | null = null;
      let schoolId: number | null = null;
      let authIssuedAt: Date | null = null;
      try {
        await client.query("BEGIN");
        const found = await client.query<{
          principal_id: number; school_id: number; auth_issued_at: Date;
          principal_password_version: string;
        }>(
          `SELECT principal_id, school_id, auth_issued_at, principal_password_version
           FROM mobile_auth_challenges
           WHERE challenge_hash = $1 AND purpose = 'admin_initialize'
             AND consumed_at IS NULL AND expires_at > NOW()
           FOR UPDATE`,
          [challengeHash],
        );
        const challenge = found.rows[0];
        if (!challenge) {
          await client.query("ROLLBACK");
          return reject(res, 401, "Invalid or expired challenge.");
        }
        const adminResult = await client.query<{
          password_hash: string;
          is_active: boolean;
          is_initialized: boolean;
        }>(
          `SELECT password_hash, is_active, is_initialized
           FROM users
           WHERE id = $1 AND school_id = $2 AND role = 'admin'
           FOR UPDATE`,
          [challenge.principal_id, challenge.school_id],
        );
        const currentAdmin = adminResult.rows[0];
        if (!currentAdmin
          || !currentAdmin.is_active
          || currentAdmin.is_initialized
          || !adminInitializationPasswordMatches(
            currentAdmin.password_hash,
            challenge.principal_password_version,
          )) {
          await client.query(
            "UPDATE mobile_auth_challenges SET consumed_at = NOW() WHERE challenge_hash = $1",
            [challengeHash],
          );
          await client.query("COMMIT");
          return reject(res, 403, "Administrator credentials changed or are not eligible for initialization.");
        }
        const updated = await client.query(
          `UPDATE users
           SET password_hash = $1, pin_hash = $2, recovery_email = $3,
               recovery_phone = $4, is_initialized = TRUE, otp_code = NULL, otp_expires_at = NULL
           WHERE id = $5 AND school_id = $6 AND role = 'admin'
             AND is_active = TRUE AND is_initialized = FALSE AND password_hash = $7
           RETURNING id`,
          [
            passwordHash, pinHash, parsed.data.recoveryEmail, parsed.data.recoveryPhone,
            challenge.principal_id, challenge.school_id, currentAdmin.password_hash,
          ],
        );
        if (updated.rowCount !== 1) {
          await client.query(
            "UPDATE mobile_auth_challenges SET consumed_at = NOW() WHERE challenge_hash = $1",
            [challengeHash],
          );
          await client.query("COMMIT");
          return reject(res, 403, "Administrator account is not eligible for initialization.");
        }
        userId = challenge.principal_id;
        schoolId = challenge.school_id;
        authIssuedAt = challenge.auth_issued_at;
        await client.query(
          "UPDATE mobile_auth_challenges SET consumed_at = NOW() WHERE challenge_hash = $1",
          [challengeHash],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const principal = await resolvePrincipal("admin", userId!, null, schoolId!);
      if (!principal) {
        return reject(res, 403, "Administrator account state is not valid.");
      }
      if (await principalHasBeenRevoked(principal, authIssuedAt!)) {
        return reject(res, 401, "This account is no longer authorized.");
      }
      const credentials = await createSession(principal, authIssuedAt!);
      return res.json(authenticatedPayload(
        principal, credentials.accessToken, credentials.refreshToken, credentials.accessExpiresAt,
      ));
    } catch {
      return reject(res, 503, "Administrator initialization is temporarily unavailable.");
    }
  });

  app.post("/api/mobile/auth/refresh", async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return reject(res, 400, "Invalid refresh request.");
    try {
      const tokenHash = hashMobileCredential(parsed.data.refreshToken);
      const client = await pool.connect();
      let session: DbSession | null = null;
      let nextAccessToken = "";
      let nextRefreshToken = "";
      let nextAccessExpiresAt: Date | null = null;
      let failure: "invalid" | "expired" | "reuse" | null = null;
      try {
        await client.query("BEGIN");
        const result = await client.query<DbSession & {
          refresh_used_at: Date | null;
          refresh_revoked_at: Date | null;
          refresh_expires_at: Date;
        }>(
          `SELECT s.id, s.principal_id, s.principal_entity_id, s.role, s.school_id,
                  s.access_expires_at, s.expires_at, s.auth_issued_at,
                  s.principal_password_version, s.revoked_at,
                  r.used_at AS refresh_used_at, r.revoked_at AS refresh_revoked_at,
                  r.expires_at AS refresh_expires_at
           FROM mobile_auth_refresh_tokens r
           JOIN mobile_auth_sessions s ON s.id = r.session_id
           WHERE r.token_hash = $1
           FOR UPDATE OF r, s`,
          [tokenHash],
        );
        const row = result.rows[0];
        if (!row) {
          failure = "invalid";
        } else {
          const refreshDecision = refreshCredentialDecision({
            now: Date.now(),
            tokenUsedAt: row.refresh_used_at,
            tokenRevokedAt: row.refresh_revoked_at,
            tokenExpiresAt: row.refresh_expires_at,
            sessionRevokedAt: row.revoked_at,
            sessionExpiresAt: row.expires_at,
          });
          if (refreshDecision === "reuse") {
            await client.query(
              `UPDATE mobile_auth_sessions SET revoked_at = COALESCE(revoked_at, NOW())
               WHERE id = $1`,
              [row.id],
            );
            await client.query(
              `UPDATE mobile_auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW())
               WHERE session_id = $1 AND revoked_at IS NULL`,
              [row.id],
            );
            failure = "reuse";
          } else if (refreshDecision === "expired") {
            failure = "expired";
          } else {
            session = row;
            nextAccessToken = createMobileCredential();
            nextRefreshToken = createMobileCredential();
            nextAccessExpiresAt = new Date(Math.min(Date.now() + MOBILE_ACCESS_TTL_MS, new Date(row.expires_at).getTime()));
            const consumed = await client.query(
              `UPDATE mobile_auth_refresh_tokens SET used_at = NOW()
               WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
               RETURNING id`,
              [tokenHash],
            );
            if (consumed.rowCount !== 1) {
              failure = "reuse";
              await client.query(
                "UPDATE mobile_auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1",
                [row.id],
              );
            } else {
              await client.query(
                `UPDATE mobile_auth_sessions
                 SET access_token_hash = $1, access_expires_at = $2, last_used_at = NOW()
                 WHERE id = $3 AND revoked_at IS NULL`,
                [hashMobileCredential(nextAccessToken), nextAccessExpiresAt, row.id],
              );
              await client.query(
                `INSERT INTO mobile_auth_refresh_tokens (session_id, family_id, token_hash, expires_at)
                 SELECT $1, family_id, $2, expires_at
                 FROM mobile_auth_refresh_tokens WHERE token_hash = $3`,
                [row.id, hashMobileCredential(nextRefreshToken), tokenHash],
              );
            }
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (failure || !session || !nextAccessExpiresAt) {
        return reject(res, 401, failure === "expired"
          ? "Refresh credential has expired."
          : "Refresh credential is invalid or has been revoked.");
      }
      const principal = await resolvePrincipal(
        session.role, session.principal_id, session.principal_entity_id, session.school_id,
      );
      if (!principal
        || !mobilePrincipalMatchesSession(session, principal, Date.now(), false)
        || await principalHasBeenRevoked(principal, session.auth_issued_at)) {
        await revokeSession(session.id);
        return reject(res, 401, "Mobile session is no longer authorized.");
      }
      return res.json(authenticatedPayload(
        principal, nextAccessToken, nextRefreshToken, nextAccessExpiresAt,
      ));
    } catch {
      return reject(res, 503, "Mobile credential refresh is temporarily unavailable.");
    }
  });

  app.get("/api/mobile/auth/me", requireMobileBearer, (req, res) => {
    const auth = (req as MobileAuthenticatedRequest).mobileAuth!;
    return res.json(userPayload(auth.principal));
  });

  app.post("/api/mobile/auth/logout", requireMobileBearer, async (req, res) => {
    const auth = (req as MobileAuthenticatedRequest).mobileAuth!;
    try {
      await revokeSession(auth.session.id);
      return res.json({ message: "Mobile session logged out." });
    } catch {
      return reject(res, 503, "Unable to revoke mobile session.");
    }
  });
}