import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  clearStudentPasswordRecoverySession,
  getStudentPasswordRecoverySession,
  markStudentPasswordRecoveryVerified,
  startStudentPasswordRecoverySession,
  STUDENT_PASSWORD_RECOVERY_TTL_MS,
} from "../student-password-recovery-session";

function request(session: Record<string, unknown> = {}): Pick<Request, "session"> {
  return { session: session as Request["session"] };
}

const identityA = { challengeId: 101, studentId: 201, schoolId: 301 };
const identityB = { challengeId: 102, studentId: 202, schoolId: 302 };
const resetToken = "a".repeat(64);

describe("Student password recovery session helpers", () => {
  it("creates one coherent OTP_PENDING identity without secrets or authentication", () => {
    const req = request();
    const now = 1_800_000_000_000;
    expect(startStudentPasswordRecoverySession(req, identityA, now)).toBe(true);
    expect(req.session.studentPasswordRecovery).toEqual({
      flow: "student_password_recovery",
      stage: "otp_pending",
      ...identityA,
      createdAt: now,
      updatedAt: now,
    });
    expect(req.session.studentPasswordRecovery).not.toHaveProperty("resetToken");
    expect(req.session.studentPasswordRecovery).not.toHaveProperty("otp");
    expect(req.session.studentPasswordRecovery).not.toHaveProperty("email");
    expect(req.session.studentId).toBeUndefined();
    expect(req.session.schoolId).toBeUndefined();
  });

  it("accepts valid state immediately before expiry and clears it at the exact boundary", () => {
    const now = 1_800_000_000_000;
    const valid = request();
    startStudentPasswordRecoverySession(valid, identityA, now);
    expect(getStudentPasswordRecoverySession(
      valid, "otp_pending", now + STUDENT_PASSWORD_RECOVERY_TTL_MS - 1,
    )).not.toBeNull();

    const expired = request();
    startStudentPasswordRecoverySession(expired, identityA, now);
    expect(getStudentPasswordRecoverySession(
      expired, "otp_pending", now + STUDENT_PASSWORD_RECOVERY_TTL_MS,
    )).toBeNull();
    expect(expired.session.studentPasswordRecovery).toBeUndefined();
  });

  it("transitions only OTP_PENDING to PASSWORD_RESET while preserving exact identity", () => {
    const req = request();
    const startedAt = 1_800_000_000_000;
    const verifiedAt = startedAt + 1;
    startStudentPasswordRecoverySession(req, identityA, startedAt);
    expect(markStudentPasswordRecoveryVerified(req, resetToken, verifiedAt)).toBe(true);
    expect(req.session.studentPasswordRecovery).toEqual({
      flow: "student_password_recovery",
      stage: "password_reset",
      ...identityA,
      resetToken,
      createdAt: startedAt,
      updatedAt: verifiedAt,
    });
    expect(markStudentPasswordRecoveryVerified(req, "b".repeat(64), verifiedAt + 1)).toBe(false);
    expect(req.session.studentPasswordRecovery).toBeUndefined();
  });

  it.each([
    ["missing challengeId", { ...identityA, challengeId: undefined }],
    ["missing studentId", { ...identityA, studentId: undefined }],
    ["missing schoolId", { ...identityA, schoolId: undefined }],
    ["zero challengeId", { ...identityA, challengeId: 0 }],
    ["unsafe studentId", { ...identityA, studentId: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects and clears invalid start identity: %s", (_label, identity) => {
    const req = request({ studentPasswordRecovery: { stale: true } });
    expect(startStudentPasswordRecoverySession(req, identity as typeof identityA)).toBe(false);
    expect(req.session.studentPasswordRecovery).toBeUndefined();
  });

  it.each([
    ["missing flow", { flow: undefined }],
    ["wrong flow", { flow: "teacher_password_recovery" }],
    ["missing stage", { stage: undefined }],
    ["unsupported stage", { stage: "verified" }],
    ["missing challengeId", { challengeId: undefined }],
    ["missing studentId", { studentId: undefined }],
    ["missing schoolId", { schoolId: undefined }],
    ["invalid createdAt", { createdAt: Number.NaN }],
    ["invalid updatedAt", { updatedAt: Number.POSITIVE_INFINITY }],
    ["createdAt after updatedAt", { createdAt: 1_800_000_000_002, updatedAt: 1_800_000_000_001 }],
    ["future timestamps", { createdAt: 1_800_000_000_002, updatedAt: 1_800_000_000_002 }],
    ["OTP state with reset token", { resetToken }],
    ["OTP state with plaintext OTP", { otp: "123456" }],
    ["OTP state with password", { password: "secret" }],
    ["OTP state with password hash", { passwordHash: "hash" }],
    ["OTP state with recovery email", { email: "student@example.test" }],
    ["OTP state with contact value", { contactValue: "student@example.test" }],
    ["reset state without token", { stage: "password_reset", resetToken: undefined }],
    ["reset state with malformed token", { stage: "password_reset", resetToken: "not-a-token" }],
    ["reset state with extra secret", { stage: "password_reset", resetToken, otp: "123456" }],
  ])("rejects and clears malformed or tampered state: %s", (_label, override) => {
    const req = request({
      studentPasswordRecovery: {
        flow: "student_password_recovery",
        stage: "otp_pending",
        ...identityA,
        createdAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
        ...override,
      },
    });
    expect(getStudentPasswordRecoverySession(req, undefined, 1_800_000_000_001)).toBeNull();
    expect(req.session.studentPasswordRecovery).toBeUndefined();
  });

  it("rejects missing state and wrong expected stage", () => {
    const missing = request();
    expect(getStudentPasswordRecoverySession(missing)).toBeNull();
    const wrongStage = request();
    startStudentPasswordRecoverySession(wrongStage, identityA, 1_800_000_000_000);
    expect(getStudentPasswordRecoverySession(
      wrongStage, "password_reset", 1_800_000_000_000,
    )).toBeNull();
    expect(wrongStage.session.studentPasswordRecovery).toBeUndefined();
  });

  it("rejects malformed token and backdated transition", () => {
    const malformed = request();
    startStudentPasswordRecoverySession(malformed, identityA, 1_800_000_000_000);
    expect(markStudentPasswordRecoveryVerified(
      malformed, "browser-token", 1_800_000_000_001,
    )).toBe(false);
    expect(malformed.session.studentPasswordRecovery).toBeUndefined();

    const backdated = request();
    startStudentPasswordRecoverySession(backdated, identityA, 1_800_000_000_000);
    expect(markStudentPasswordRecoveryVerified(
      backdated, resetToken, 1_799_999_999_999,
    )).toBe(false);
    expect(backdated.session.studentPasswordRecovery).toBeUndefined();
  });

  it("does not permit transition arguments to substitute tenant identity", () => {
    const req = request();
    const now = 1_800_000_000_000;
    startStudentPasswordRecoverySession(req, identityA, now);
    expect((markStudentPasswordRecoveryVerified as any)(
      req, resetToken, now + 1, identityB,
    )).toBe(true);
    expect(req.session.studentPasswordRecovery).toMatchObject(identityA);
    expect(req.session.studentPasswordRecovery).not.toMatchObject(identityB);
  });

  it("keeps same-identity OTP start idempotent without extending its TTL", () => {
    const req = request();
    const now = 1_800_000_000_000;
    startStudentPasswordRecoverySession(req, identityA, now);
    expect(startStudentPasswordRecoverySession(req, identityA, now + 2)).toBe(true);
    expect(req.session.studentPasswordRecovery).toMatchObject(identityA);
    expect(req.session.studentPasswordRecovery?.updatedAt).toBe(now);
  });

  it("rejects competing identity replacement until state is cleared or expired", () => {
    const req = request();
    const now = 1_800_000_000_000;
    startStudentPasswordRecoverySession(req, identityA, now);
    expect(startStudentPasswordRecoverySession(req, identityB, now + 1)).toBe(false);
    expect(req.session.studentPasswordRecovery).toMatchObject(identityA);

    clearStudentPasswordRecoverySession(req);
    expect(startStudentPasswordRecoverySession(req, identityB, now + 2)).toBe(true);
    expect(req.session.studentPasswordRecovery).toMatchObject(identityB);

    const expired = request();
    startStudentPasswordRecoverySession(expired, identityA, now);
    expect(startStudentPasswordRecoverySession(
      expired, identityB, now + STUDENT_PASSWORD_RECOVERY_TTL_MS,
    )).toBe(true);
    expect(expired.session.studentPasswordRecovery).toMatchObject(identityB);
  });

  it("does not allow a new start to downgrade PASSWORD_RESET state", () => {
    const req = request();
    const now = 1_800_000_000_000;
    startStudentPasswordRecoverySession(req, identityA, now);
    markStudentPasswordRecoveryVerified(req, resetToken, now + 1);
    expect(startStudentPasswordRecoverySession(req, identityA, now + 2)).toBe(false);
    expect(req.session.studentPasswordRecovery).toMatchObject({
      ...identityA,
      stage: "password_reset",
      resetToken,
    });
  });

  it("clear removes only Student recovery and preserves authentication and other recovery state", () => {
    const req = request({
      studentId: 999,
      schoolId: 998,
      userId: 997,
      userRole: "admin",
      pendingResetToken: "admin-token",
      teacherPasswordRecovery: { marker: "teacher" },
    });
    const before = { ...req.session };
    startStudentPasswordRecoverySession(req, identityA, 1_800_000_000_000);
    clearStudentPasswordRecoverySession(req);
    expect(req.session.studentPasswordRecovery).toBeUndefined();
    expect(req.session.studentId).toBe(before.studentId);
    expect(req.session.schoolId).toBe(before.schoolId);
    expect(req.session.userId).toBe(before.userId);
    expect(req.session.userRole).toBe(before.userRole);
    expect(req.session.pendingResetToken).toBe(before.pendingResetToken);
    expect((req.session as any).teacherPasswordRecovery).toEqual(before.teacherPasswordRecovery);
  });

  it("stores reset token only in server session state and never logs or returns it", () => {
    const req = request();
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    try {
      startStudentPasswordRecoverySession(req, identityA, 1_800_000_000_000);
      const result = markStudentPasswordRecoveryVerified(
        req, resetToken, 1_800_000_000_001,
      );
      expect(result).toBe(true);
      expect(result).not.toBe(resetToken);
      expect(req.session.studentPasswordRecovery).toMatchObject({ resetToken });
      expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
  });
});