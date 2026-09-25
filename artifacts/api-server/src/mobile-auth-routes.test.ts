import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import express from "express";
import { getTableName } from "drizzle-orm";
import test from "node:test";
import { db, pool } from "./db";
import { hashMobileCredential } from "./mobile-auth-crypto";
import { registerMobileAuthRoutes } from "./mobile-auth-routes";
import { storage } from "./storage";

type FixtureUser = {
  id: number;
  email: string;
  role: string;
  schoolId: number;
  passwordHash: string;
  isActive: boolean;
  isInitialized: boolean;
  pinHash: string | null;
};

type FixtureTeacher = {
  id: number;
  userId: number;
  schoolId: number;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
};

type FixtureStudent = {
  id: number;
  schoolId: number;
  digitalStudentId: string;
  name: string;
  passwordHash: string;
  isActive: boolean;
  isActivated: boolean;
};

type FixtureStaff = {
  id: number;
  schoolId: number;
  email: string;
  fullName: string;
  passwordHash: string;
  isActive: boolean;
  allowedModules: string[];
};

type SessionFixture = {
  id: string;
  principal_id: number;
  principal_entity_id: number | null;
  role: string;
  school_id: number;
  principal_password_version: string;
  access_token_hash: string;
  access_expires_at: Date;
  auth_issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

type RefreshFixture = {
  sessionId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

type ChallengeFixture = {
  challengeHash: string;
  principalId: number;
  schoolId: number;
  purpose: string;
  authIssuedAt: Date;
  principalPasswordVersion: string;
  attemptCount: number;
  expiresAt: Date;
  consumedAt: Date | null;
};

function jsonResponse(response: Response): Promise<unknown> {
  return response.json();
}

test("mobile auth endpoints authenticate each role and enforce credential lifecycle contracts", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "route tests must never run in production mode");

  const school = { id: 1, name: "Isolated Test School", code: "AUTH-TEST" };
  const userRows = new Map<number, FixtureUser>();
  const teacherRows = new Map<number, FixtureTeacher>();
  const studentRows = new Map<number, FixtureStudent>();
  const staffRows = new Map<number, FixtureStaff>();
  const sessions = new Map<string, SessionFixture>();
  const refreshTokens = new Map<string, RefreshFixture>();
  const challenges = new Map<string, ChallengeFixture>();
  const attemptCounts = new Map<string, number>();

  const hashedPassword = await bcrypt.hash("Correct-Horse-77", 4);
  const hashedPin = await bcrypt.hash("123456", 4);
  const admin: FixtureUser = {
    id: 101, email: "admin-auth-test@example.test", role: "admin", schoolId: school.id,
    passwordHash: hashedPassword, isActive: true, isInitialized: true, pinHash: hashedPin,
  };
  const teacherUser: FixtureUser = {
    id: 102, email: "teacher-auth-test@example.test", role: "teacher", schoolId: school.id,
    passwordHash: hashedPassword, isActive: true, isInitialized: true, pinHash: null,
  };
  const initAdmin: FixtureUser = {
    id: 103, email: "init-auth-test@example.test", role: "admin", schoolId: school.id,
    passwordHash: hashedPassword, isActive: true, isInitialized: false, pinHash: null,
  };
  userRows.set(admin.id, admin);
  userRows.set(teacherUser.id, teacherUser);
  userRows.set(initAdmin.id, initAdmin);
  const teacher: FixtureTeacher = {
    id: 201, userId: teacherUser.id, schoolId: school.id, fullName: "Test Teacher",
    isActive: true, mustChangePassword: false,
  };
  teacherRows.set(teacher.id, teacher);
  const student: FixtureStudent = {
    id: 301, schoolId: school.id, digitalStudentId: "AUTH-STUDENT-301",
    name: "Test Student", passwordHash: hashedPassword, isActive: true, isActivated: true,
  };
  studentRows.set(student.id, student);
  const staff: FixtureStaff = {
    id: 401, schoolId: school.id, email: "staff-auth-test@example.test",
    fullName: "Test Support Staff", passwordHash: hashedPassword, isActive: true,
    allowedModules: ["attendance"],
  };
  staffRows.set(staff.id, staff);

  const originalDbSelect = (db as any).select;
  const originalDbInsert = (db as any).insert;
  const originalPoolQuery = (pool as any).query;
  const originalPoolConnect = (pool as any).connect;
  const storageMethods = [
    "getUserByEmail",
    "getTeacherByUserId",
    "getTeacherWithSchool",
    "getNonTeachingStaffByEmail",
    "getNonTeachingStaffById",
    "authenticateStudentByDsidForLogin",
  ] as const;
  const originalStorageMethods = new Map<string, unknown>();
  for (const method of storageMethods) originalStorageMethods.set(method, (storage as any)[method]);

  const storageFakes = {
    async getUserByEmail(email: string) {
      return [...userRows.values()].find((user) => user.email === email);
    },
    async getTeacherByUserId(userId: number) {
      return [...teacherRows.values()].find((row) => row.userId === userId);
    },
    async getTeacherWithSchool(teacherId: number) {
      const row = teacherRows.get(teacherId);
      const user = row && userRows.get(row.userId);
      if (!row || !user || row.schoolId !== school.id) return undefined;
      return { teacher: row, user, school };
    },
    async getNonTeachingStaffByEmail(email: string) {
      return [...staffRows.values()].find((row) => row.email === email);
    },
    async getNonTeachingStaffById(id: number) {
      return staffRows.get(id);
    },
    async authenticateStudentByDsidForLogin(identifier: string, password: string) {
      const row = [...studentRows.values()].find((candidate) => candidate.digitalStudentId === identifier);
      if (!row) return { status: "not_found" as const };
      if (!row.isActive) return { status: "inactive" as const };
      if (!row.isActivated) return { status: "not_activated" as const };
      if (!await bcrypt.compare(password, row.passwordHash)) return { status: "invalid" as const };
      return { status: "success" as const, student: row, authIssuedAt: Date.now() };
    },
  };
  Object.assign(storage, storageFakes);

  const sqlNumberParams = (value: unknown, output: number[] = []): number[] => {
    if (Array.isArray(value)) {
      for (const item of value) sqlNumberParams(item, output);
    } else if (value && typeof value === "object") {
      const object = value as { queryChunks?: unknown[]; value?: unknown; constructor?: { name?: string } };
      if (object.constructor?.name === "Param" && typeof object.value === "number") {
        output.push(object.value);
      } else if (object.queryChunks) {
        sqlNumberParams(object.queryChunks, output);
      }
    }
    return output;
  };
  const returnSelectRows = (tableName: string, joins: string[], whereClause: unknown) => {
    if (tableName === "schools") return [school];
    if (tableName === "users" && joins.length === 0) {
      const id = sqlNumberParams(whereClause)[0];
      return userRows.has(id) ? [userRows.get(id)] : [];
    }
    if (tableName === "users") {
      if (joins.includes("teachers")) {
        const joinedTeacher = [...teacherRows.values()][0];
        const joinedUser = joinedTeacher && userRows.get(joinedTeacher.userId);
        if (!joinedTeacher || !joinedUser || joinedTeacher.schoolId !== school.id || joinedUser.schoolId !== school.id
          || joinedUser.role !== "teacher") return [];
        return [{ users: joinedUser, teachers: joinedTeacher, schools: school }];
      }
      const principalId = sqlNumberParams(whereClause)[0];
      const joinedAdmin = userRows.get(principalId);
      if (!joinedAdmin || joinedAdmin.schoolId !== school.id || joinedAdmin.role !== "admin") return [];
      return [{ users: joinedAdmin, schools: school }];
    }
    if (tableName === "teachers") {
      const row = [...teacherRows.values()][0];
      const user = row && userRows.get(row.userId);
      if (!row || !user || !row.isActive || !user.isActive || row.mustChangePassword
        || row.schoolId !== school.id || user.schoolId !== school.id || user.role !== "teacher") return [];
      return [{ teachers: row, users: user, schools: school }];
    }
    if (tableName === "students") {
      const row = [...studentRows.values()][0];
      if (!row || !row.isActive || !row.isActivated || row.schoolId !== school.id) return [];
      return [{ students: row, schools: school }];
    }
    return [];
  };

  (db as any).select = () => {
    let tableName = "";
    const joins: string[] = [];
    let whereClause: unknown;
    const builder = {
      from(table: unknown) {
        tableName = getTableName(table as never);
        return this;
      },
      innerJoin(table: unknown) {
        joins.push(getTableName(table as never));
        return this;
      },
      where(clause: unknown) {
        whereClause = clause;
        return Promise.resolve(returnSelectRows(tableName, joins, whereClause));
      },
    };
    return builder;
  };
  (db as any).insert = (table: unknown) => ({
    values(values: Record<string, unknown>) {
      if (getTableName(table as never) !== "mobile_auth_challenges") {
        throw new Error(`Unexpected insert target in auth route test: ${getTableName(table as never)}`);
      }
      const challenge = values as unknown as ChallengeFixture;
      challenges.set(challenge.challengeHash, { ...challenge, attemptCount: 0, consumedAt: null });
      return Promise.resolve();
    },
  });

  const result = <T>(rows: T[], rowCount = rows.length) => ({ rows, rowCount });
  const fakeClientQuery = async (rawSql: string, values: unknown[] = []) => {
    const sqlText = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
    if (sqlText === "begin" || sqlText === "commit" || sqlText === "rollback") return result([]);
    if (sqlText.includes("pg_advisory_xact_lock")) return result([{}]);
    if (sqlText.includes("select count(*)::integer as attempt_count")) {
      return result([{ attempt_count: attemptCounts.get(String(values[0])) ?? 0 }]);
    }
    if (sqlText.startsWith("insert into security_audit")) {
      const ipAddress = String(values[0]);
      attemptCounts.set(ipAddress, (attemptCounts.get(ipAddress) ?? 0) + 1);
      return result([], 1);
    }
    if (sqlText.startsWith("insert into mobile_auth_sessions")) {
      const session: SessionFixture = {
        id: String(values[0]),
        principal_id: Number(values[2]),
        principal_entity_id: values[3] === null ? null : Number(values[3]),
        role: String(values[4]),
        school_id: Number(values[5]),
        principal_password_version: String(values[6]),
        access_token_hash: String(values[7]),
        access_expires_at: new Date(values[8] as Date),
        auth_issued_at: new Date(values[9] as Date),
        expires_at: new Date(values[10] as Date),
        revoked_at: null,
      };
      sessions.set(session.id, session);
      return result([], 1);
    }
    if (sqlText.startsWith("select s.id, s.principal_id, s.principal_entity_id, s.role, s.school_id")) {
      const refresh = refreshTokens.get(String(values[0]));
      const session = refresh && sessions.get(refresh.sessionId);
      if (!refresh || !session) return result([]);
      return result([{
        ...session,
        refresh_used_at: refresh.usedAt,
        refresh_revoked_at: refresh.revokedAt,
        refresh_expires_at: refresh.expiresAt,
      }]);
    }
    if (sqlText.startsWith("insert into mobile_auth_refresh_tokens") && sqlText.includes(" select ")) {
      const [sessionId, tokenHash, oldTokenHash] = values;
      const oldToken = refreshTokens.get(String(oldTokenHash));
      if (!oldToken) return result([], 0);
      refreshTokens.set(String(tokenHash), {
        sessionId: String(sessionId), familyId: oldToken.familyId, tokenHash: String(tokenHash),
        expiresAt: oldToken.expiresAt, usedAt: null, revokedAt: null,
      });
      return result([], 1);
    }
    if (sqlText.startsWith("insert into mobile_auth_refresh_tokens (session_id, family_id, token_hash")) {
      const [sessionId, tokenHash, expiresAt] = values;
      refreshTokens.set(String(tokenHash), {
        sessionId: String(sessionId), familyId: String(sessionId), tokenHash: String(tokenHash),
        expiresAt: new Date(expiresAt as Date), usedAt: null, revokedAt: null,
      });
      return result([], 1);
    }
    if (sqlText.startsWith("select principal_id, school_id, attempt_count")) {
      const challenge = challenges.get(String(values[0]));
      if (!challenge || challenge.purpose !== "admin_pin" || challenge.consumedAt
        || challenge.expiresAt.getTime() <= Date.now()) return result([]);
      return result([{
        principal_id: challenge.principalId,
        school_id: challenge.schoolId,
        attempt_count: challenge.attemptCount,
        auth_issued_at: challenge.authIssuedAt,
        principal_password_version: challenge.principalPasswordVersion,
      }]);
    }
    if (sqlText.startsWith("select principal_id, school_id, auth_issued_at, principal_password_version")) {
      const challenge = challenges.get(String(values[0]));
      if (!challenge || challenge.purpose !== "admin_initialize" || challenge.consumedAt
        || challenge.expiresAt.getTime() <= Date.now()) return result([]);
      return result([{
        principal_id: challenge.principalId,
        school_id: challenge.schoolId,
        auth_issued_at: challenge.authIssuedAt,
        principal_password_version: challenge.principalPasswordVersion,
      }]);
    }
    if (sqlText.startsWith("select password_hash, is_active, is_initialized from users")) {
      const user = userRows.get(Number(values[0]));
      if (!user || user.schoolId !== Number(values[1]) || user.role !== "admin") return result([]);
      return result([{
        password_hash: user.passwordHash,
        is_active: user.isActive,
        is_initialized: user.isInitialized,
      }]);
    }
    if (sqlText.startsWith("update users set password_hash")) {
      const user = userRows.get(Number(values[4]));
      if (!user || user.schoolId !== Number(values[5]) || user.role !== "admin"
        || !user.isActive || user.isInitialized || user.passwordHash !== values[6]) return result([], 0);
      user.passwordHash = String(values[0]);
      user.pinHash = String(values[1]);
      user.isInitialized = true;
      return result([{ id: user.id }], 1);
    }
    if (sqlText.startsWith("update mobile_auth_challenges set attempt_count")) {
      const challenge = challenges.get(String(values[0]));
      if (challenge) {
        challenge.attemptCount += 1;
        if (sqlText.includes("consumed_at = now()")) challenge.consumedAt = new Date();
      }
      return result([], challenge ? 1 : 0);
    }
    if (sqlText.startsWith("update mobile_auth_challenges set consumed_at")) {
      const challenge = challenges.get(String(values[0]));
      if (challenge) challenge.consumedAt = new Date();
      return result([], challenge ? 1 : 0);
    }
    if (sqlText.startsWith("update mobile_auth_sessions set revoked_at")) {
      const session = sessions.get(String(values[0]));
      if (session) session.revoked_at ||= new Date();
      return result([], session ? 1 : 0);
    }
    if (sqlText.startsWith("update mobile_auth_refresh_tokens set revoked_at")) {
      const sessionId = String(values[0]);
      let affected = 0;
      for (const refresh of refreshTokens.values()) {
        if (refresh.sessionId === sessionId && !refresh.revokedAt) {
          refresh.revokedAt = new Date();
          affected += 1;
        }
      }
      return result([], affected);
    }
    if (sqlText.startsWith("update mobile_auth_refresh_tokens set used_at")) {
      const refresh = refreshTokens.get(String(values[0]));
      if (!refresh || refresh.usedAt || refresh.revokedAt || refresh.expiresAt.getTime() <= Date.now()) {
        return result([], 0);
      }
      refresh.usedAt = new Date();
      return result([{ id: "refresh" }], 1);
    }
    if (sqlText.startsWith("update mobile_auth_sessions set access_token_hash")) {
      const session = sessions.get(String(values[2]));
      if (session && !session.revoked_at) {
        session.access_token_hash = String(values[0]);
        session.access_expires_at = new Date(values[1] as Date);
      }
      return result([], session && !session.revoked_at ? 1 : 0);
    }
    console.error("Unexpected fake SQL:", rawSql);
    throw new Error(`Unexpected SQL in mobile-auth route contract test: ${rawSql}`);
  };

  (pool as any).connect = async () => ({
    query: fakeClientQuery,
    release() {},
  });
  (pool as any).query = async (rawSql: string, values: unknown[] = []) => {
    const sqlText = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
    if (sqlText.includes('from "session"')) return result([]);
    if (sqlText.startsWith("select id, principal_id, principal_entity_id, role, school_id")) {
      const session = [...sessions.values()].find((candidate) =>
        candidate.access_token_hash === String(values[0])
        && !candidate.revoked_at
        && candidate.access_expires_at.getTime() > Date.now()
        && candidate.expires_at.getTime() > Date.now());
      return result(session ? [session] : []);
    }
    if (sqlText.startsWith("select s.id, s.principal_id, s.principal_entity_id, s.role, s.school_id")) {
      const token = refreshTokens.get(String(values[0]));
      const session = token && sessions.get(token.sessionId);
      if (!token || !session) return result([]);
      return result([{
        ...session,
        refresh_used_at: token.usedAt,
        refresh_revoked_at: token.revokedAt,
        refresh_expires_at: token.expiresAt,
      }]);
    }
    if (sqlText.startsWith("update mobile_auth_sessions set last_used_at")) return result([], 1);
    if (sqlText.startsWith("update mobile_auth_sessions set revoked_at")) {
      return fakeClientQuery(rawSql, values);
    }
    if (sqlText.startsWith("update mobile_auth_refresh_tokens set revoked_at")) {
      return fakeClientQuery(rawSql, values);
    }
    console.error("Unexpected fake pool SQL:", rawSql);
    throw new Error(`Unexpected pool SQL in mobile-auth route contract test: ${rawSql}`);
  };

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  registerMobileAuthRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    (db as any).select = originalDbSelect;
    (db as any).insert = originalDbInsert;
    (pool as any).query = originalPoolQuery;
    (pool as any).connect = originalPoolConnect;
    for (const [method, original] of originalStorageMethods) (storage as any)[method] = original;
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let ipSerial = 0;
  async function request(path: string, body?: unknown, accessToken?: string) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/auth/${path}`, {
      method: path === "me" ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`Unexpected non-JSON response for ${path}: ${response.status} ${await response.text()}`);
    }
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }

  const adminLogin = await request("login", {
    role: "admin", identifier: admin.email, password: "Correct-Horse-77",
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.body.state, "pin_required");
  const adminSession = await request("verify-pin", {
    challengeToken: adminLogin.body.challengeToken, pin: "123456",
  });
  assert.equal(adminSession.response.status, 200);
  assert.equal(adminSession.body.state, "authenticated");
  assert.equal(adminSession.body.user.role, "admin");
  assert.equal(adminSession.body.user.schoolId, school.id);
  assert.ok(adminSession.body.accessToken);
  const adminMe = await request("me", undefined, adminSession.body.accessToken);
  assert.equal(adminMe.response.status, 200);
  assert.equal(adminMe.body.role, "admin");

  const teacherLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(teacherLogin.response.status, 200);
  assert.equal(teacherLogin.body.user.role, "teacher");
  assert.equal(teacherLogin.body.user.id, teacher.id);
  const firstTeacherAccess = teacherLogin.body.accessToken as string;
  const firstTeacherRefresh = teacherLogin.body.refreshToken as string;
  const teacherRefresh = await request("refresh", { refreshToken: firstTeacherRefresh });
  assert.equal(teacherRefresh.response.status, 200);
  assert.notEqual(teacherRefresh.body.accessToken, firstTeacherAccess);
  assert.notEqual(teacherRefresh.body.refreshToken, firstTeacherRefresh);
  const teacherMe = await request("me", undefined, teacherRefresh.body.accessToken);
  assert.equal(teacherMe.response.status, 200);
  assert.equal(teacherMe.body.role, "teacher");
  assert.equal(teacherRefresh.body.user.id, teacher.id);
  assert.equal(teacherMe.body.id, teacher.id);
  const reusedRefresh = await request("refresh", { refreshToken: firstTeacherRefresh });
  assert.equal(reusedRefresh.response.status, 401);
  const reusedSession = await request("me", undefined, teacherRefresh.body.accessToken);
  assert.equal(reusedSession.response.status, 401);

  const studentLogin = await request("login", {
    role: "student", identifier: student.digitalStudentId, password: "Correct-Horse-77",
  });
  assert.equal(studentLogin.response.status, 200);
  assert.equal(studentLogin.body.user.role, "student");
  assert.equal(studentLogin.body.user.id, student.id);
  const studentMe = await request("me", undefined, studentLogin.body.accessToken);
  assert.equal(studentMe.response.status, 200);
  assert.equal(studentMe.body.schoolId, school.id);

  const supportLogin = await request("login", {
    role: "support_staff", identifier: staff.email, password: "Correct-Horse-77",
  });
  assert.equal(supportLogin.response.status, 200);
  assert.equal(supportLogin.body.user.role, "support_staff");
  assert.deepEqual(supportLogin.body.user.allowedModules, ["attendance"]);
  staffRows.set(staff.id, { ...staff, email: teacherUser.email });
  const supportCollision = await request("login", {
    role: "support_staff", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(supportCollision.response.status, 401);
  staffRows.set(staff.id, staff);

  const staleInitLogin = await request("login", {
    role: "admin", identifier: initAdmin.email, password: "Correct-Horse-77",
  });
  assert.equal(staleInitLogin.body.state, "initialize_required");
  initAdmin.passwordHash = await bcrypt.hash("Changed-Password-88", 4);
  const staleInit = await request("initialize", {
    challengeToken: staleInitLogin.body.challengeToken,
    newPassword: "New-Password-99", confirmPassword: "New-Password-99",
    pin: "654321", confirmPin: "654321",
    recoveryEmail: "admin-recovery@example.test", recoveryPhone: "5551234567",
  });
  assert.equal(staleInit.response.status, 403);
  assert.equal(initAdmin.isInitialized, false);
  const freshInitLogin = await request("login", {
    role: "admin", identifier: initAdmin.email, password: "Changed-Password-88",
  });
  assert.equal(freshInitLogin.body.state, "initialize_required");
  const initialized = await request("initialize", {
    challengeToken: freshInitLogin.body.challengeToken,
    newPassword: "New-Password-99", confirmPassword: "New-Password-99",
    pin: "654321", confirmPin: "654321",
    recoveryEmail: "admin-recovery@example.test", recoveryPhone: "5551234567",
  });
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.body.user.role, "admin");
  assert.equal(initAdmin.isInitialized, true);

  const tenantBoundLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(tenantBoundLogin.response.status, 200);
  teacher.schoolId = 2;
  const movedTenant = await request("me", undefined, tenantBoundLogin.body.accessToken);
  assert.equal(movedTenant.response.status, 401);
  teacher.schoolId = school.id;

  const roleBoundLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(roleBoundLogin.response.status, 200);
  teacherUser.role = "admin";
  const changedRole = await request("me", undefined, roleBoundLogin.body.accessToken);
  assert.equal(changedRole.response.status, 401);
  teacherUser.role = "teacher";

  const logoutLogin = await request("login", {
    role: "support_staff", identifier: staff.email, password: "Correct-Horse-77",
  });
  const logout = await request("logout", undefined, logoutLogin.body.accessToken);
  assert.equal(logout.response.status, 200);
  const afterLogout = await request("me", undefined, logoutLogin.body.accessToken);
  assert.equal(afterLogout.response.status, 401);

  const throttledIp = "198.51.100.250";
  for (let index = 0; index < 20; index += 1) {
    const response = await fetch(`${baseUrl}/api/mobile/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-for": throttledIp,
      },
      body: JSON.stringify({
        role: "teacher", identifier: "unknown-throttle@example.test", password: "invalid",
      }),
    });
    assert.equal(response.status, 401);
  }
  const rateLimited = await fetch(`${baseUrl}/api/mobile/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-forwarded-for": throttledIp,
    },
    body: JSON.stringify({
      role: "teacher", identifier: "unknown-throttle@example.test", password: "invalid",
    }),
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("retry-after"), "900");
});