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
  attendance: new Set(["submit", "self-check-in", "self-check-out", "self-correction"]),
  homework: new Set(["create", "edit", "delete"]),
  classwork: new Set(["create", "edit", "delete"]),
  noticeboard: new Set(["create", "edit", "delete"]),
  complaint: new Set(["create", "resolve-peer", "add-note", "edit", "delete", "self-resolve"]),
  examination: new Set(["save-scores", "publish-scores", "toggle-promotion-lock"]),
  gallery: new Set(["upload"]),
  library: new Set(["borrow", "return", "upload-ebook"]),
  timetable: new Set(["save", "delete"]),
  leave: new Set(["apply", "approve-student", "forward-student", "reject-student"]),
  "student-profiles": new Set(["approve", "reject", "approve-all"]),
};
const ADMIN_MODULE_GET = new Set([
  "/api/mobile/admin/modules/school-setup",
  "/api/mobile/admin/modules/student-registry",
  "/api/mobile/admin/modules/student-registry/stats",
  "/api/mobile/admin/modules/student-registry/export.xlsx",
  "/api/mobile/admin/modules/student-registry/deactivated/export.xlsx",
  "/api/mobile/admin/modules/attendance-overview",
  "/api/mobile/admin/modules/exam-controller",
  "/api/mobile/admin/modules/exam-controller/ledger",
  "/api/mobile/admin/modules/exam-controller/cohort",
  "/api/mobile/admin/modules/exam-controller/history",
  "/api/mobile/admin/modules/audit-logs",
  "/api/mobile/admin/modules/visitor-log",
  "/api/mobile/admin/modules/school-calendar",
  "/api/mobile/admin/modules/timetable/context",
  "/api/mobile/admin/modules/timetable/teachers",
  "/api/mobile/admin/modules/timetable/class-view",
  "/api/mobile/admin/modules/timetable/status",
  "/api/mobile/admin/modules/timetable/structure",
  "/api/mobile/admin/modules/faculty-mapping",
  "/api/mobile/admin/modules/analytics/context",
  "/api/mobile/admin/modules/analytics/view",
  "/api/mobile/admin/modules/analytics/results",
  "/api/mobile/admin/modules/id-card-gen/context",
  "/api/mobile/admin/modules/id-card-gen/roster",
  "/api/mobile/admin/modules/assets",
  "/api/mobile/admin/modules/fees",
  "/api/mobile/admin/modules/fees/external-settings",
  "/api/mobile/admin/modules/fees/reminders",
  "/api/mobile/admin/modules/fees/analytics",
  "/api/mobile/admin/modules/fees/analytics/pdf",
]);
const ADMIN_MODULE_POST = new Set([
  "/api/mobile/admin/modules/school-setup/metadata",
  "/api/mobile/admin/modules/school-setup/sessions",
  "/api/mobile/admin/modules/school-setup/grading-tiers",
  "/api/mobile/admin/modules/school-setup/exam-policy-tiers",
  "/api/mobile/admin/modules/school-setup/leave-policies",
  "/api/mobile/admin/modules/school-setup/attendance-policies",
  "/api/mobile/admin/modules/student-registry/auto-assign-roll",
  "/api/mobile/admin/modules/student-registry/bulk-deactivate",
  "/api/mobile/admin/modules/student-registry/students",
  "/api/mobile/admin/modules/student-registry/import.xlsx",
  "/api/mobile/admin/modules/exam-controller/decision",
  "/api/mobile/admin/modules/exam-controller/decision/clear",
  "/api/mobile/admin/modules/exam-controller/execute",
  "/api/mobile/admin/modules/exam-controller/reminder-all",
  "/api/mobile/admin/modules/exam-controller/ledger/delete",
  "/api/mobile/admin/modules/visitor-log/check-in",
  "/api/mobile/admin/modules/school-calendar",
  "/api/mobile/admin/modules/timetable/save",
  "/api/mobile/admin/modules/timetable/structure",
  "/api/mobile/admin/modules/timetable/publish",
  "/api/mobile/admin/modules/faculty-mapping/save",
  "/api/mobile/admin/modules/faculty-mapping/clear",
  "/api/mobile/admin/modules/assets/create",
  "/api/mobile/admin/modules/assets/update",
  "/api/mobile/admin/modules/assets/delete",
  "/api/mobile/admin/modules/fees/invoices",
  "/api/mobile/admin/modules/fees/payments",
  "/api/mobile/admin/modules/fees/structures",
  "/api/mobile/admin/modules/fees/external-settings",
  "/api/mobile/admin/modules/fees/reminders",
]);
const ADMIN_DYNAMIC_GET = /^\/api\/mobile\/admin\/modules\/fees\/(?:invoices\/[1-9]\d*\/receipt|transactions\/[1-9]\d*(?:\/receipt)?)$/;
const ADMIN_DYNAMIC_POST = /^\/api\/mobile\/admin\/modules\/(?:school-setup\/sessions\/[1-9]\d*\/(?:copy-modules|activate|delete)|school-setup\/(?:grading-tiers|exam-policy-tiers|leave-policies|attendance-policies)\/[1-9]\d*\/delete|student-registry\/students\/[1-9]\d*\/(?:update|deactivate)|visitor-log\/[1-9]\d*\/check-out|school-calendar\/[1-9]\d*\/(?:update|delete))$/;
const ADMIN_DYNAMIC_PATCH = /^\/api\/mobile\/admin\/modules\/fees\/invoices\/[1-9]\d*$/;
const ADMIN_WORKFLOW_MODULES = new Set([
  "complaint-hub", "noticeboard", "approval-center", "leave-requests",
  "teacher-registry", "non-teaching-staff",
]);
const PRIVATE_ADMIN_NOTICE_FILE_ROUTE = /^\/api\/mobile\/admin\/workflow\/private-notices\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|pdf)$/;
const PRIVATE_TEACHER_FILE_ROUTE = /^\/api\/mobile\/teacher\/modules\/(homework|classwork|noticeboard|complaint|gallery|library)\/private-files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|pdf)$/;

function isAdditionalStudentRequest(method: string, path: string): boolean {
  const prefix = "/api/mobile/student/";
  if (!path.startsWith(prefix)) return false;
  const relative = path.slice(prefix.length);
  if (method === "GET" && ADDITIONAL_STUDENT_GET.has(relative)) return true;
  if (method === "POST" && ADDITIONAL_STUDENT_POST.has(relative)) return true;
  if (method === "GET" && /^fees\/[1-9]\d*\/(?:invoice|receipt)$/.test(relative)) return true;
  if (method === "POST" && /^payments\/(?:create-order|verify)$/.test(relative)) return true;
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

function isAdditionalAdminRequest(method: string, path: string): boolean {
  if (method === "GET" && PRIVATE_ADMIN_NOTICE_FILE_ROUTE.test(path)) return true;
  if (method === "GET" && (ADMIN_MODULE_GET.has(path) || ADMIN_DYNAMIC_GET.test(path))) return true;
  if (method === "POST" && (ADMIN_MODULE_POST.has(path) || ADMIN_DYNAMIC_POST.test(path))) return true;
  if (method === "PATCH" && ADMIN_DYNAMIC_PATCH.test(path)) return true;
  if (method === "GET" && path.startsWith("/api/mobile/admin/workflow/")) {
    const match = /^\/api\/mobile\/admin\/workflow\/([a-z-]+)$/.exec(path);
    return !!match && ADMIN_WORKFLOW_MODULES.has(match[1]);
  }
  if (method === "POST" && path.startsWith("/api/mobile/admin/workflow/")) {
    const match = /^\/api\/mobile\/admin\/workflow\/([a-z-]+)\/actions$/.exec(path);
    return !!match && ADMIN_WORKFLOW_MODULES.has(match[1]);
  }
  return false;
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
    || isTeacherModuleRequest(req.method, req.path)
    || isAdditionalAdminRequest(req.method, req.path)
    || (req.method === "GET" && PRIVATE_TEACHER_FILE_ROUTE.test(req.path));
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