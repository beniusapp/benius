import type { Request } from "express";
import {
  clearStudentRecoveryIfMatchesPersistedSession,
  stageStudentRecoverySessionMutation,
  suppressStudentRecoveryStaleSessionWrite,
} from "./student-recovery-session-store";

export const STUDENT_PASSWORD_RECOVERY_TTL_MS = 30 * 60 * 1000;

type StudentRecoveryIdentity = {
  flow: "student_password_recovery";
  challengeId: number;
  studentId: number;
  schoolId: number;
  createdAt: number;
  updatedAt: number;
};

export type StudentPasswordRecoveryOtpPending = StudentRecoveryIdentity & {
  stage: "otp_pending";
  resetToken?: never;
};

export type StudentPasswordRecoveryPasswordReset = StudentRecoveryIdentity & {
  stage: "password_reset";
  resetToken: string;
};

export type StudentPasswordRecoveryState =
  | StudentPasswordRecoveryOtpPending
  | StudentPasswordRecoveryPasswordReset;

declare module "express-session" {
  interface SessionData {
    studentPasswordRecovery?: StudentPasswordRecoveryState;
  }
}

type StudentRecoveryRequest = Pick<Request, "session">;
type PersistedStudentRecoveryRequest = Pick<Request, "session" | "sessionID">;

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validResetToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hasExactKeys(candidate: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(candidate);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
}

function structurallyValid(state: unknown): state is StudentPasswordRecoveryState {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const candidate = state as Partial<StudentPasswordRecoveryState> & Record<string, unknown>;
  if (
    candidate.flow !== "student_password_recovery"
    || !validId(candidate.challengeId)
    || !validId(candidate.studentId)
    || !validId(candidate.schoolId)
    || !validTimestamp(candidate.createdAt)
    || !validTimestamp(candidate.updatedAt)
  ) {
    return false;
  }
  if (candidate.stage === "otp_pending") {
    return hasExactKeys(candidate, [
      "flow", "stage", "challengeId", "studentId", "schoolId", "createdAt", "updatedAt",
    ]);
  }
  if (candidate.stage === "password_reset") {
    return validResetToken(candidate.resetToken) && hasExactKeys(candidate, [
      "flow", "stage", "challengeId", "studentId", "schoolId", "createdAt", "updatedAt", "resetToken",
    ]);
  }
  return false;
}

export function clearStudentPasswordRecoverySession(req: StudentRecoveryRequest): void {
  stageStudentRecoverySessionMutation(req.session, req.session.studentPasswordRecovery);
  req.session.studentPasswordRecovery = undefined;
}

export function clearStudentPasswordRecoverySessionIfMatchesInMemory(
  req: StudentRecoveryRequest,
  identity: Pick<StudentPasswordRecoveryState, "challengeId" | "studentId" | "schoolId">,
): boolean {
  const current = req.session.studentPasswordRecovery;
  if (
    !structurallyValid(current)
    || current.challengeId !== identity.challengeId
    || current.studentId !== identity.studentId
    || current.schoolId !== identity.schoolId
  ) {
    return false;
  }
  stageStudentRecoverySessionMutation(req.session, current);
  req.session.studentPasswordRecovery = undefined;
  return true;
}

export async function clearStudentPasswordRecoverySessionIfMatches(
  req: PersistedStudentRecoveryRequest,
  challengeId: number,
  studentId: number,
  schoolId: number,
): Promise<boolean> {
  const cleared = await clearStudentRecoveryIfMatchesPersistedSession(
    req.sessionID,
    challengeId,
    studentId,
    schoolId,
  );
  if (cleared) {
    suppressStudentRecoveryStaleSessionWrite(req.session);
  }
  return cleared;
}

export function startStudentPasswordRecoverySession(
  req: StudentRecoveryRequest,
  identity: {
    challengeId: number;
    studentId: number;
    schoolId: number;
  },
  now = Date.now(),
): boolean {
  if (
    !validId(identity.challengeId)
    || !validId(identity.studentId)
    || !validId(identity.schoolId)
    || !validTimestamp(now)
  ) {
    clearStudentPasswordRecoverySession(req);
    return false;
  }
  const existing = getStudentPasswordRecoverySession(req, undefined, now);
  if (existing) {
    if (existing.stage === "password_reset") return false;
    if (
      existing.challengeId === identity.challengeId
      && existing.studentId === identity.studentId
      && existing.schoolId === identity.schoolId
    ) {
      return true;
    }
  }
  stageStudentRecoverySessionMutation(req.session, existing);
  req.session.studentPasswordRecovery = {
    flow: "student_password_recovery",
    stage: "otp_pending",
    challengeId: identity.challengeId,
    studentId: identity.studentId,
    schoolId: identity.schoolId,
    createdAt: now,
    updatedAt: now,
  };
  return true;
}

export function getStudentPasswordRecoverySession(
  req: StudentRecoveryRequest,
  expectedStage?: StudentPasswordRecoveryState["stage"],
  now = Date.now(),
): StudentPasswordRecoveryState | null {
  const state = req.session.studentPasswordRecovery;
  if (
    !structurallyValid(state)
    || !validTimestamp(now)
    || state.createdAt > state.updatedAt
    || state.updatedAt > now
    || now - state.updatedAt >= STUDENT_PASSWORD_RECOVERY_TTL_MS
    || (expectedStage !== undefined && state.stage !== expectedStage)
  ) {
    clearStudentPasswordRecoverySession(req);
    return null;
  }
  return state;
}

export function markStudentPasswordRecoveryVerified(
  req: StudentRecoveryRequest,
  resetToken: string,
  now = Date.now(),
): boolean {
  if (!validResetToken(resetToken)) {
    clearStudentPasswordRecoverySession(req);
    return false;
  }
  const current = getStudentPasswordRecoverySession(req, "otp_pending", now);
  if (!current || current.stage !== "otp_pending") return false;
  stageStudentRecoverySessionMutation(req.session, current);
  req.session.studentPasswordRecovery = {
    flow: "student_password_recovery",
    stage: "password_reset",
    challengeId: current.challengeId,
    studentId: current.studentId,
    schoolId: current.schoolId,
    resetToken,
    createdAt: current.createdAt,
    updatedAt: now,
  };
  return true;
}