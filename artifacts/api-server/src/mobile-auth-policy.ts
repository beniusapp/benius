import type { NextFunction, Request, Response } from "express";
import { hashMobileCredential } from "./mobile-auth-crypto";

const MOBILE_AUTH_PATH = "/api/mobile/auth";
const MOBILE_ACADEMIC_SESSIONS_PATH = "/api/mobile/academic-sessions";
const MOBILE_STUDENT_DASHBOARD_PATH = "/api/mobile/student/dashboard";

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
  const isApprovedMobileRequest = req.path === MOBILE_AUTH_PATH
    || req.path.startsWith(`${MOBILE_AUTH_PATH}/`)
    || req.path === MOBILE_ACADEMIC_SESSIONS_PATH
    || req.path.startsWith(`${MOBILE_ACADEMIC_SESSIONS_PATH}/`)
    || isStudentDashboardRequest;
  const isApiRequest = req.path === "/api" || req.path.startsWith("/api/");
  if (isApiRequest && !isApprovedMobileRequest && /^\s*Bearer\s/i.test(authorization)) {
    res.status(401).json({ message: "Bearer credentials are accepted only by mobile authentication endpoints." });
    return;
  }
  next();
}

export function shouldLogJsonResponseBody(path: string): boolean {
  return path !== MOBILE_STUDENT_DASHBOARD_PATH;
}