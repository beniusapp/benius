export const FEES_AREAS = {
  FINANCIAL_ANALYTICS: "financial-analytics",
  FEE_STRUCTURES: "fee-structures",
  LEDGER_TRANSACTIONS: "ledger-transactions",
  REMINDERS: "reminders",
  AUDIT_LOG: "audit-log",
} as const;

export type FeesArea = typeof FEES_AREAS[keyof typeof FEES_AREAS];

const LEGACY_LEDGER_GRANTS = [
  "fees-manager:view",
  "fees-manager:record",
  "fees-manager:export",
] as const;

export function hasFeesAreaPermission(
  allowedModules: unknown,
  area: FeesArea,
): boolean {
  if (!Array.isArray(allowedModules) || !allowedModules.includes("fees-manager")) {
    return false;
  }

  const grants = allowedModules.filter((value): value is string => typeof value === "string");
  if (grants.includes(`fees-manager:${area}`)) return true;

  if (area !== FEES_AREAS.LEDGER_TRANSACTIONS) return false;

  const feeSubGrants = grants.filter(value => value.startsWith("fees-manager:"));
  const parentOnlyLegacyGrant = feeSubGrants.length === 0;
  const completeLegacyLedgerGrant = LEGACY_LEDGER_GRANTS.every(grant => grants.includes(grant));
  return parentOnlyLegacyGrant || completeLegacyLedgerGrant;
}

export function feesAreasForRequest(method: string, requestPath: string): FeesArea[] | null {
  const path = requestPath.split("?")[0].replace(/\/+$/, "") || "/";
  const verb = method.toUpperCase();

  if (
    path === "/api/fees/analytics" ||
    path === "/api/fees/analytics/pdf" ||
    path === "/api/fees/analytics/aging-students"
  ) {
    return [FEES_AREAS.FINANCIAL_ANALYTICS];
  }

  const feesRoot = "/api/admin/fees";
  if (path !== feesRoot && !path.startsWith(`${feesRoot}/`)) return null;
  const suffix = path.slice(feesRoot.length) || "/";

  // These remain explicitly Principal/Admin-only, including refund eligibility.
  if (
    suffix.startsWith("/external-settings") ||
    suffix.startsWith("/external-portal") ||
    suffix === "/bulk-delete" ||
    /^\/structures\/\d+\/generate-invoices$/.test(suffix) ||
    /^\/payments\/\d+\/(?:refund-eligibility|refunds)$/.test(suffix)
  ) {
    return null;
  }

  if (suffix === "/audit-log") return [FEES_AREAS.AUDIT_LOG];

  if (
    suffix === "/structures" ||
    /^\/structures\/\d+$/.test(suffix)
  ) {
    return [FEES_AREAS.FEE_STRUCTURES];
  }

  if (suffix === "/class-options") {
    return [FEES_AREAS.FEE_STRUCTURES, FEES_AREAS.LEDGER_TRANSACTIONS];
  }

  if (suffix === "/sessions") {
    return [FEES_AREAS.FEE_STRUCTURES, FEES_AREAS.LEDGER_TRANSACTIONS];
  }

  if (
    suffix === "/notification-config" ||
    suffix === "/notification-config/test" ||
    suffix === "/dunning-counts" ||
    suffix === "/failed-counts" ||
    suffix === "/dunning-log" ||
    suffix === "/dunning-templates" ||
    suffix === "/dunning-job-status" ||
    suffix === "/dunning-simulate" ||
    suffix === "/dunning-trigger"
  ) {
    return [FEES_AREAS.REMINDERS];
  }

  if (
    suffix === "/" ||
    suffix === "/summary" ||
    suffix === "/filter-options" ||
    suffix === "/students/search" ||
    /^\/students\/\d+\/unpaid-invoices$/.test(suffix) ||
    suffix === "/payments" ||
    suffix === "/next-receipt" ||
    suffix === "/export-ledger" ||
    suffix === "/ledger/pdf" ||
    suffix === "/payments/report/pdf" ||
    (/^\/\d+$/.test(suffix) && verb === "PATCH") ||
    /^\/payments\/\d+\/(?:receipt|offline-details|notes)$/.test(suffix) ||
    /^\/\d+\/(?:transaction-detail|transaction-pdf|invoice|invoice\/pdf|receipt)$/.test(suffix)
  ) {
    if (suffix === "/" && !["GET", "POST"].includes(verb)) return null;
    return [FEES_AREAS.LEDGER_TRANSACTIONS];
  }

  return null;
}

export function feesAreaGuard(
  req: any,
  res: any,
  requiredAreas: FeesArea | FeesArea[],
): boolean {
  const session = req.session;
  if (!session?.userId || !["admin", "support_staff"].includes(session.userRole)) {
    res.status(403).json({ message: "Fees & Payments access required." });
    return false;
  }
  if (!session.schoolId) {
    res.status(403).json({ message: "No school in session." });
    return false;
  }
  if (session.userRole === "admin") return true;

  const staffId = session.staffId;
  const validStaffSession =
    Number.isSafeInteger(staffId) &&
    staffId > 0 &&
    session.userId === -staffId &&
    Array.isArray(session.allowedModules);
  const areas = Array.isArray(requiredAreas) ? requiredAreas : [requiredAreas];
  const permitted = validStaffSession && areas.some(area =>
    hasFeesAreaPermission(session.allowedModules, area),
  );
  if (!permitted) {
    res.status(403).json({ message: "You do not have permission to access this Fees & Payments area." });
    return false;
  }
  return true;
}

export function feesRequestGuard(req: any, res: any): boolean {
  const areas = feesAreasForRequest(req.method, req.path);
  if (areas) return feesAreaGuard(req, res, areas);

  // Preserve the existing Admin-only access to Fees routes outside the five
  // Support Staff areas, such as External Portal and refunds.
  if (!req.session?.userId || req.session.userRole !== "admin") {
    res.status(403).json({ message: "Admin access required." });
    return false;
  }
  if (!req.session.schoolId) {
    res.status(403).json({ message: "No school in session." });
    return false;
  }
  return true;
}
