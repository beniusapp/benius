import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  clearTeacherPasswordRecoverySession,
  getTeacherPasswordRecoverySession,
  markTeacherPasswordRecoveryVerified,
  startTeacherPasswordRecoverySession,
  TEACHER_PASSWORD_RECOVERY_TTL_MS,
} from "../teacher-password-recovery-session";

function request(session: Record<string, unknown> = {}): Pick<Request, "session"> {
  return { session: session as Request["session"] };
}

const identityA = {
  challengeId: 101,
  userId: 201,
  schoolId: 301,
  teacherId: 401,
};

const identityB = {
  challengeId: 102,
  userId: 202,
  schoolId: 302,
  teacherId: 402,
};

describe("Teacher password recovery session helpers", () => {
  it("starts a bounded OTP_PENDING state without a reset token", () => {
    const req = request();
    const now = 1_800_000_000_000;

    expect(startTeacherPasswordRecoverySession(req, identityA, now)).toBe(true);
    expect(req.session.teacherPasswordRecovery).toEqual({
      flow: "teacher_password_recovery",
      stage: "otp_pending",
      ...identityA,
      createdAt: now,
      updatedAt: now,
    });
    expect(req.session.teacherPasswordRecovery).not.toHaveProperty("resetToken");
    expect(getTeacherPasswordRecoverySession(
      req,
      "otp_pending",
      now + TEACHER_PASSWORD_RECOVERY_TTL_MS - 1,
    )).not.toBeNull();
  });

  it("rejects and clears OTP_PENDING at and after the exact expiry boundary", () => {
    const now = 1_800_000_000_000;
    const exact = request();
    startTeacherPasswordRecoverySession(exact, identityA, now);
    expect(getTeacherPasswordRecoverySession(
      exact,
      "otp_pending",
      now + TEACHER_PASSWORD_RECOVERY_TTL_MS,
    )).toBeNull();
    expect(exact.session.teacherPasswordRecovery).toBeUndefined();

    const expired = request();
    startTeacherPasswordRecoverySession(expired, identityA, now);
    expect(getTeacherPasswordRecoverySession(
      expired,
      undefined,
      now + TEACHER_PASSWORD_RECOVERY_TTL_MS + 1,
    )).toBeNull();
    expect(expired.session.teacherPasswordRecovery).toBeUndefined();
  });

  it("transitions only OTP_PENDING to PASSWORD_RESET and refreshes expiry", () => {
    const req = request();
    const startedAt = 1_800_000_000_000;
    const verifiedAt = startedAt + 60_000;
    startTeacherPasswordRecoverySession(req, identityA, startedAt);

    expect(markTeacherPasswordRecoveryVerified(req, "new-step-4-token", verifiedAt)).toBe(true);
    expect(req.session.teacherPasswordRecovery).toEqual({
      flow: "teacher_password_recovery",
      stage: "password_reset",
      ...identityA,
      resetToken: "new-step-4-token",
      createdAt: startedAt,
      updatedAt: verifiedAt,
    });
    expect(getTeacherPasswordRecoverySession(
      req,
      "password_reset",
      verifiedAt + TEACHER_PASSWORD_RECOVERY_TTL_MS - 1,
    )).not.toBeNull();
  });

  it("rejects and clears expired PASSWORD_RESET state", () => {
    const req = request();
    const startedAt = 1_800_000_000_000;
    const verifiedAt = startedAt + 60_000;
    startTeacherPasswordRecoverySession(req, identityA, startedAt);
    markTeacherPasswordRecoveryVerified(req, "new-step-4-token", verifiedAt);

    expect(getTeacherPasswordRecoverySession(
      req,
      "password_reset",
      verifiedAt + TEACHER_PASSWORD_RECOVERY_TTL_MS,
    )).toBeNull();
    expect(req.session.teacherPasswordRecovery).toBeUndefined();
  });

  it.each([
    ["missing challengeId", { ...identityA, challengeId: undefined }],
    ["missing userId", { ...identityA, userId: undefined }],
    ["missing schoolId", { ...identityA, schoolId: undefined }],
    ["missing teacherId", { ...identityA, teacherId: undefined }],
  ])("rejects %s when starting recovery", (_label, identity) => {
    const req = request();
    expect(startTeacherPasswordRecoverySession(req, identity as typeof identityA)).toBe(false);
    expect(req.session.teacherPasswordRecovery).toBeUndefined();
  });

  it.each([
    ["invalid flow marker", { flow: "admin_recovery" }],
    ["invalid stage", { stage: "verified" }],
    ["invalid challengeId", { challengeId: 0 }],
    ["invalid userId", { userId: 0 }],
    ["invalid schoolId", { schoolId: 0 }],
    ["invalid teacherId", { teacherId: 0 }],
    ["invalid creation timestamp", { createdAt: Number.NaN }],
    ["invalid update timestamp", { updatedAt: Number.NaN }],
    ["creation after update", { createdAt: 1_800_000_000_002, updatedAt: 1_800_000_000_001 }],
    ["future creation timestamp", { createdAt: 1_800_000_000_002, updatedAt: 1_800_000_000_002 }],
    ["future update timestamp", { updatedAt: 1_800_000_000_002 }],
    ["OTP_PENDING with reset token", { stage: "otp_pending", resetToken: "unexpected" }],
    ["PASSWORD_RESET without reset token", { stage: "password_reset", resetToken: undefined }],
  ])("rejects and clears malformed state: %s", (_label, override) => {
    const req = request({
      teacherPasswordRecovery: {
        flow: "teacher_password_recovery",
        stage: "otp_pending",
        ...identityA,
        createdAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
        ...override,
      },
    });

    expect(getTeacherPasswordRecoverySession(req, undefined, 1_800_000_000_001)).toBeNull();
    expect(req.session.teacherPasswordRecovery).toBeUndefined();
  });

  it("rejects a backdated verification transition and clears recovery state", () => {
    const req = request();
    const startedAt = 1_800_000_000_000;
    startTeacherPasswordRecoverySession(req, identityA, startedAt);

    expect(markTeacherPasswordRecoveryVerified(
      req,
      "server-token",
      startedAt - 1,
    )).toBe(false);
    expect(req.session.teacherPasswordRecovery).toBeUndefined();
  });

  it("rejects the wrong stage generically and clears the state", () => {
    const req = request();
    const now = 1_800_000_000_000;
    startTeacherPasswordRecoverySession(req, identityA, now);

    expect(getTeacherPasswordRecoverySession(req, "password_reset", now)).toBeNull();
    expect(req.session.teacherPasswordRecovery).toBeUndefined();
  });

  it("does not permit verification inputs to override the stored tenant identity", () => {
    const req = request();
    const now = 1_800_000_000_000;
    startTeacherPasswordRecoverySession(req, identityA, now);

    expect((markTeacherPasswordRecoveryVerified as any)(
      req,
      "server-token",
      now + 1,
      identityB,
    )).toBe(true);
    expect(req.session.teacherPasswordRecovery).toMatchObject({
      ...identityA,
      stage: "password_reset",
      resetToken: "server-token",
    });
    expect(req.session.teacherPasswordRecovery).not.toMatchObject(identityB);
  });

  it("starting a new recovery replaces stale state and clears the previous reset token", () => {
    const req = request();
    const now = 1_800_000_000_000;
    startTeacherPasswordRecoverySession(req, identityA, now);
    markTeacherPasswordRecoveryVerified(req, "old-reset-token", now + 1);

    expect(startTeacherPasswordRecoverySession(req, identityB, now + 2)).toBe(true);
    expect(req.session.teacherPasswordRecovery).toMatchObject({
      ...identityB,
      stage: "otp_pending",
    });
    expect(req.session.teacherPasswordRecovery).not.toHaveProperty("resetToken");
  });

  it("does not authenticate the Teacher or alter existing authentication state", () => {
    const anonymous = request();
    startTeacherPasswordRecoverySession(anonymous, identityA, 1_800_000_000_000);
    expect(anonymous.session.userId).toBeUndefined();
    expect(anonymous.session.teacherId).toBeUndefined();
    expect(anonymous.session.userRole).toBeUndefined();

    const authenticated = request({
      userId: 999,
      teacherId: 998,
      schoolId: 997,
      userRole: "teacher",
    });
    const authBefore = {
      userId: authenticated.session.userId,
      teacherId: authenticated.session.teacherId,
      schoolId: authenticated.session.schoolId,
      userRole: authenticated.session.userRole,
    };
    startTeacherPasswordRecoverySession(authenticated, identityA, 1_800_000_000_000);
    expect(authenticated.session).toMatchObject(authBefore);
  });

  it("keeps Teacher recovery isolated from Admin recovery state", () => {
    const req = request({
      pendingForgotChallengeId: 700,
      pendingResetUserId: 701,
      pendingResetChallengeId: 702,
      pendingResetToken: "admin-token",
    });
    const adminBefore = { ...req.session };

    startTeacherPasswordRecoverySession(req, identityA, 1_800_000_000_000);
    markTeacherPasswordRecoveryVerified(req, "teacher-token", 1_800_000_000_001);
    clearTeacherPasswordRecoverySession(req);

    expect(req.session.pendingForgotChallengeId).toBe(adminBefore.pendingForgotChallengeId);
    expect(req.session.pendingResetUserId).toBe(adminBefore.pendingResetUserId);
    expect(req.session.pendingResetChallengeId).toBe(adminBefore.pendingResetChallengeId);
    expect(req.session.pendingResetToken).toBe(adminBefore.pendingResetToken);
  });

  it("stores the reset token only in server session state and never logs it", () => {
    const req = request();
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    try {
      startTeacherPasswordRecoverySession(req, identityA, 1_800_000_000_000);
      const result = markTeacherPasswordRecoveryVerified(
        req,
        "trusted-server-reset-token",
        1_800_000_000_001,
      );
      expect(result).toBe(true);
      expect(result).not.toBe("trusted-server-reset-token");
      expect(req.session.teacherPasswordRecovery).toMatchObject({
        resetToken: "trusted-server-reset-token",
      });
      expect(spies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
  });
});