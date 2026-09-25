import type { Request } from "express";

export const TEACHER_PASSWORD_RECOVERY_TTL_MS = 30 * 60 * 1000;

type TeacherRecoveryIdentity = {
  flow: "teacher_password_recovery";
  challengeId: number;
  userId: number;
  schoolId: number;
  teacherId: number;
  createdAt: number;
  updatedAt: number;
};

export type TeacherPasswordRecoveryOtpPending = TeacherRecoveryIdentity & {
  stage: "otp_pending";
  resetToken?: never;
};

export type TeacherPasswordRecoveryPasswordReset = TeacherRecoveryIdentity & {
  stage: "password_reset";
  resetToken: string;
};

export type TeacherPasswordRecoveryState =
  | TeacherPasswordRecoveryOtpPending
  | TeacherPasswordRecoveryPasswordReset;

declare module "express-session" {
  interface SessionData {
    teacherPasswordRecovery?: TeacherPasswordRecoveryState;
  }
}

type TeacherRecoveryRequest = Pick<Request, "session">;

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function structurallyValid(state: unknown): state is TeacherPasswordRecoveryState {
  if (!state || typeof state !== "object") return false;
  const candidate = state as Partial<TeacherPasswordRecoveryState> & Record<string, unknown>;
  if (
    candidate.flow !== "teacher_password_recovery"
    || !validId(candidate.challengeId)
    || !validId(candidate.userId)
    || !validId(candidate.schoolId)
    || !validId(candidate.teacherId)
    || !validTimestamp(candidate.createdAt)
    || !validTimestamp(candidate.updatedAt)
  ) {
    return false;
  }
  if (candidate.stage === "otp_pending") {
    return !Object.prototype.hasOwnProperty.call(candidate, "resetToken");
  }
  if (candidate.stage === "password_reset") {
    return typeof candidate.resetToken === "string" && candidate.resetToken.length > 0;
  }
  return false;
}

export function clearTeacherPasswordRecoverySession(req: TeacherRecoveryRequest): void {
  req.session.teacherPasswordRecovery = undefined;
}

export function startTeacherPasswordRecoverySession(
  req: TeacherRecoveryRequest,
  identity: {
    challengeId: number;
    userId: number;
    schoolId: number;
    teacherId: number;
  },
  now = Date.now(),
): boolean {
  if (
    !validId(identity.challengeId)
    || !validId(identity.userId)
    || !validId(identity.schoolId)
    || !validId(identity.teacherId)
    || !validTimestamp(now)
  ) {
    clearTeacherPasswordRecoverySession(req);
    return false;
  }
  req.session.teacherPasswordRecovery = {
    flow: "teacher_password_recovery",
    stage: "otp_pending",
    challengeId: identity.challengeId,
    userId: identity.userId,
    schoolId: identity.schoolId,
    teacherId: identity.teacherId,
    createdAt: now,
    updatedAt: now,
  };
  return true;
}

export function getTeacherPasswordRecoverySession(
  req: TeacherRecoveryRequest,
  expectedStage?: TeacherPasswordRecoveryState["stage"],
  now = Date.now(),
): TeacherPasswordRecoveryState | null {
  const state = req.session.teacherPasswordRecovery;
  if (
    !structurallyValid(state)
    || !validTimestamp(now)
    || state.createdAt > state.updatedAt
    || state.updatedAt > now
    || now - state.updatedAt >= TEACHER_PASSWORD_RECOVERY_TTL_MS
    || (expectedStage !== undefined && state.stage !== expectedStage)
  ) {
    clearTeacherPasswordRecoverySession(req);
    return null;
  }
  return state;
}

export function markTeacherPasswordRecoveryVerified(
  req: TeacherRecoveryRequest,
  resetToken: string,
  now = Date.now(),
): boolean {
  if (typeof resetToken !== "string" || resetToken.length === 0) {
    clearTeacherPasswordRecoverySession(req);
    return false;
  }
  const current = getTeacherPasswordRecoverySession(req, "otp_pending", now);
  if (!current || current.stage !== "otp_pending") return false;
  req.session.teacherPasswordRecovery = {
    ...current,
    stage: "password_reset",
    resetToken,
    updatedAt: now,
  };
  return true;
}