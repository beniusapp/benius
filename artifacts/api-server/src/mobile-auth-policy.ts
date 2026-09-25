import type { NextFunction, Request, Response } from "express";
import { hashMobileCredential } from "./mobile-auth-crypto";

const MOBILE_AUTH_PATH = "/api/mobile/auth";
const MOBILE_ACADEMIC_SESSIONS_PATH = "/api/mobile/academic-sessions";
const MOBILE_STUDENT_DASHBOARD_PATH = "/api/mobile/student/dashboard";
const MOBILE_STUDENT_PROFILE_PATH = "/api/mobile/student/profile";
const MOBILE_STUDENT_PROFILE_SUBMIT_PATH = `${MOBILE_STUDENT_PROFILE_PATH}/submit`;
const MOBILE_STUDENT_PROFILE_PHOTO_PATH = `${MOBILE_STUDENT_PROFILE_PATH}/photo`;
const MOBILE_STUDENT_PROFILE_PASSWORD_PATH = `${MOBILE_STUDENT_PROFILE_PATH}/change-password`;
const MOBILE_STUDENT_ATTENDANCE_PATH = "/api/mobile/student/attendance";
const MOBILE_STUDENT_ATTENDANCE_PATHS = new Set([
  `${MOBILE_STUDENT_ATTENDANCE_PATH}/monthly`,
  `${MOBILE_STUDENT_ATTENDANCE_PATH}/yearly`,
  `${MOBILE_STUDENT_ATTENDANCE_PATH}/stats`,
  `${MOBILE_STUDENT_ATTENDANCE_PATH}/policy`,
]);
const MOBILE_STUDENT_HOMEWORK_PATH = "/api/mobile/student/homework";
const MOBILE_STUDENT_CLASSWORK_PATH = "/api/mobile/student/classwork";
const MOBILE_HOMEWORK_FILE_PATH = "/api/mobile/homework-submission-files";
const MOBILE_HOMEWORK_FILE_ROUTE = /^\/api\/mobile\/homework-submission-files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|pdf)$/;
const MOBILE_TEACHER_ME_PATH = "/api/mobile/teacher/me";
const MOBILE_TEACHER_PENDING_COUNT_PATH = "/api/mobile/teacher/pending-profiles/count";
const MOBILE_TEACHER_PROFILE_PHOTO_PATH = "/api/mobile/teacher/profile-photo";
const MOBILE_TEACHER_CHANGE_PASSWORD_PATH = "/api/mobile/teacher/change-password";
const MOBILE_ADMIN_OVERVIEW_PATH = "/api/mobile/admin/overview";
const MOBILE_ADMIN_PROFILE_PATH = "/api/mobile/admin/profile";
const ADDITIONAL_STUDENT_GET = new Set([
  "notices", "fees", "fees/summary", "fees/payment-attempts",
  "fees/notification-history", "fees/portal-info",
  "examination/classes", "examination/types", "examination/scores",
  "examination/all-scores", "examination/journey", "examination/policy",
  "timetable", "leave", "complaints/inbox", "complaints/filed",
  "complaints/teachers", "complaints/peers", "calendar", "faculty",
  "gallery/tags", "gallery", "library",
]);
const ADDITIONAL_STUDENT_POST = new Set([
  "notices/mark-read", "leave", "leave/delete",
  "complaints/staff-grievance", "complaints/peer-report",
]);
const PRIVATE_LEAVE_FILE_ROUTE = /^\/api\/mobile\/student\/leave-files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|gif|webp|pdf|doc|docx)$/;
const TEACHER_MODULES = new Set([
  "attendance", "homework", "classwork", "noticeboard", "complaint",
  "examination", "gallery", "faculty-info", "calendar", "library",
  "leave", "timetable", "student-profiles",
]);
const TEACHER_MODULE_ACTIONS: Record<string, Set<string>> = {
  attendance: new Set(["submit"]),
  homework: new Set(["create"]),
  classwork: new Set(["create"]),
  noticeboard: new Set(["create"]),
  complaint: new Set(["create", "resolve-peer", "add-note", "edit", "delete", "self-resolve"]),
  examination: new Set(["save-scores", "publish-scores"]),
  library: new Set(["borrow", "return"]),
  leave: new Set(["apply", "approve-student", "forward-student", "reject-student"]),
  "student-profiles": new Set(["approve", "reject", "approve-all"]),
};

function isAdditionalStudentRequest(method: string, path: string): boolean {
  const prefix = "/api/mobile/student/";
  if (!path.startsWith(prefix)) return false;
  const relative = path.slice(prefix.length);
  if (method === "GET" && ADDITIONAL_STUDENT_GET.has(relative)) return true;
  if (method === "POST" && ADDITIONAL_STUDENT_POST.has(relative)) return true;
  if (method === "GET" && PRIVATE_LEAVE_FILE_ROUTE.test(path)) return true;
  return (method === "GET" || method === "POST")
    && /^complaints\/[1-9]\d*\/notes$/.test(relative);
}

function isTeacherModuleRequest(method: string, path: string): boolean {
  const match = /^\/api\/mobile\/teacher\/modules\/([a-z-]+)(?:\/([a-z-]+))?$/.exec(path);
  if (!match || !TEACHER_MODULES.has(match[1])) return false;
  if (method === "GET") return match[2] === undefined;
  return method === "POST" && !!match[2] && !!TEACHER_MODULE_ACTIONS[match[1]]?.has(match[2]);
}

export type RefreshPolicyInput = {
  now: number;
  tokenUsedAt: Date | null;
  tokenRevokedAt: Date | null;
  tokenExpiresAt: Date;
  sessionRevokedAt: Date | null;
  sessionExpiresAt: Date;
};

export function refreshCredentialDecision(input: RefreshPolicyInput): "rotate" | "reuse" | "expired" {
  if (input.tokenUsedAt || input.tokenRevokedAt) return "reuse";
  if (input.sessionRevokedAt
    || input.tokenExpiresAt.getTime() <= input.now
    || input.sessionExpiresAt.getTime() <= input.now) {
    return "expired";
  }
  return "rotate";
}

export function mobilePrincipalMatchesSession(
  session: {
    role: string;
    principal_id: number;
    principal_entity_id: number | null;
    school_id: number;
    principal_password_version: string;
    access_expires_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
  },
  principal: {
    role: string;
    principalId: number;
    entityId: number | null;
    schoolId: number;
    passwordVersion: string;
  } | null,
  now = Date.now(),
  requireUnexpiredAccess = true,
): boolean {
  return !!principal
    && !session.revoked_at
    && (!requireUnexpiredAccess || session.access_expires_at.getTime() > now)
    && session.expires_at.getTime() > now
    && session.role === principal.role
    && session.principal_id === principal.principalId
    && session.principal_entity_id === principal.entityId
    && session.school_id === principal.schoolId
    && session.principal_password_version === principal.passwordVersion;
}

export function adminInitializationPasswordMatches(
  currentPasswordHash: string,
  expectedPasswordVersion: string,
): boolean {
  return hashMobileCredential(currentPasswordHash) === expectedPasswordVersion;
}

export function shouldFallbackToSupportStaff(userByEmailExists: boolean): boolean {
  return !userByEmailExists;
}

function isTrustedLocalProxyAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function mobileRequestUsesTrustedHttps(
  req: Pick<Request, "headers" | "hostname" | "socket">,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  const socket = req.socket as typeof req.socket & { encrypted?: boolean };
  if (socket.encrypted === true) return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  const proxyReportedHttps = typeof forwardedProto === "string"
    && forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  if (proxyReportedHttps && isTrustedLocalProxyAddress(socket.remoteAddress)) return true;

  const host = (req.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return nodeEnv !== "production"
    && (host === "localhost" || host === "127.0.0.1" || host === "::1");
}

/** Bearer tokens authenticate only approved native-mobile API namespaces. */
export function rejectBearerOutsideMobileAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authorization = req.get("authorization") || "";
  const isStudentDashboardRequest = req.method === "GET"
    && req.path === MOBILE_STUDENT_DASHBOARD_PATH;
  const isStudentProfileRequest = (
    req.method === "GET" || req.method === "POST"
  ) && req.path === MOBILE_STUDENT_PROFILE_PATH;
  const isStudentProfileSubmitRequest = req.method === "POST"
    && req.path === MOBILE_STUDENT_PROFILE_SUBMIT_PATH;
  const isStudentProfilePhotoRequest = req.method === "POST"
    && req.path === MOBILE_STUDENT_PROFILE_PHOTO_PATH;
  const isStudentProfilePasswordRequest = req.method === "POST"
    && req.path === MOBILE_STUDENT_PROFILE_PASSWORD_PATH;
  const isStudentAttendanceRequest = req.method === "GET"
    && MOBILE_STUDENT_ATTENDANCE_PATHS.has(req.path);
  const isStudentHomeworkRequest = req.method === "GET"
    && (req.path === MOBILE_STUDENT_HOMEWORK_PATH
      || req.path === `${MOBILE_STUDENT_HOMEWORK_PATH}/pending-dates`
      || new RegExp(`^${MOBILE_STUDENT_HOMEWORK_PATH}/[1-9]\\d*$`).test(req.path));
  const isStudentHomeworkSubmitRequest = req.method === "POST"
    && new RegExp(`^${MOBILE_STUDENT_HOMEWORK_PATH}/[1-9]\\d*/submit$`).test(req.path);
  const isStudentClassworkRequest = req.method === "GET" && req.path === MOBILE_STUDENT_CLASSWORK_PATH;
  const isPrivateHomeworkFileRequest = req.method === "GET" && MOBILE_HOMEWORK_FILE_ROUTE.test(req.path);
  const isTeacherMeRequest = req.method === "GET" && req.path === MOBILE_TEACHER_ME_PATH;
  const isTeacherPendingCountRequest = req.method === "GET" && req.path === MOBILE_TEACHER_PENDING_COUNT_PATH;
  const isTeacherPhotoRequest = req.method === "POST" && req.path === MOBILE_TEACHER_PROFILE_PHOTO_PATH;
  const isTeacherPasswordRequest = req.method === "POST" && req.path === MOBILE_TEACHER_CHANGE_PASSWORD_PATH;
  const isAdminOverviewRequest = req.method === "GET" && req.path === MOBILE_ADMIN_OVERVIEW_PATH;
  const isAdminProfileRequest = req.method === "GET" && req.path === MOBILE_ADMIN_PROFILE_PATH;
  const isApprovedMobileRequest = req.path === MOBILE_AUTH_PATH
    || req.path.startsWith(`${MOBILE_AUTH_PATH}/`)
    || req.path === MOBILE_ACADEMIC_SESSIONS_PATH
    || req.path.startsWith(`${MOBILE_ACADEMIC_SESSIONS_PATH}/`)
    || isStudentDashboardRequest
    || isStudentProfileRequest
    || isStudentProfileSubmitRequest
    || isStudentProfilePhotoRequest
    || isStudentProfilePasswordRequest
    || isStudentAttendanceRequest;
  const approvedMobileRequest = isApprovedMobileRequest
    || isStudentHomeworkRequest
    || isStudentHomeworkSubmitRequest
    || isStudentClassworkRequest
    || isPrivateHomeworkFileRequest
    || isTeacherMeRequest
    || isTeacherPendingCountRequest
    || isTeacherPhotoRequest
    || isTeacherPasswordRequest
    || isAdminOverviewRequest
    || isAdminProfileRequest
    || isAdditionalStudentRequest(req.method, req.path)
    || isTeacherModuleRequest(req.method, req.path);
  const isApiRequest = req.path === "/api" || req.path.startsWith("/api/");
  if (isApiRequest && !approvedMobileRequest && /^\s*Bearer\s/i.test(authorization)) {
    res.status(401).json({ message: "Bearer credentials are accepted only by mobile authentication endpoints." });
    return;
  }
  next();
}

export function shouldLogJsonResponseBody(path: string): boolean {
  if (path.startsWith("/api/mobile/")) return false;
  if (MOBILE_STUDENT_ATTENDANCE_PATHS.has(path)) return false;
  if (path === MOBILE_STUDENT_HOMEWORK_PATH
    || path === `${MOBILE_STUDENT_HOMEWORK_PATH}/pending-dates`
    || path === MOBILE_STUDENT_CLASSWORK_PATH
    || path === MOBILE_HOMEWORK_FILE_PATH
    || path.startsWith(`${MOBILE_HOMEWORK_FILE_PATH}/`)
    || MOBILE_HOMEWORK_FILE_ROUTE.test(path)
    || new RegExp(`^${MOBILE_STUDENT_HOMEWORK_PATH}/[1-9]\\d*(?:/submit)?$`).test(path)) return false;
  return path !== MOBILE_STUDENT_DASHBOARD_PATH
    && path !== MOBILE_STUDENT_PROFILE_PATH
    && path !== MOBILE_STUDENT_PROFILE_SUBMIT_PATH
    && path !== MOBILE_STUDENT_PROFILE_PHOTO_PATH
    && path !== MOBILE_STUDENT_PROFILE_PASSWORD_PATH
    && path !== MOBILE_TEACHER_ME_PATH
    && path !== MOBILE_TEACHER_PENDING_COUNT_PATH
    && path !== MOBILE_TEACHER_PROFILE_PHOTO_PATH
    && path !== MOBILE_TEACHER_CHANGE_PASSWORD_PATH
    && path !== MOBILE_ADMIN_OVERVIEW_PATH
    && path !== MOBILE_ADMIN_PROFILE_PATH;
}