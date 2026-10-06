export function filterSupportStaffAllowedModules(
  allowedModules: readonly string[] | null | undefined,
): string[] {
  return (allowedModules ?? []).filter(
    module => module !== "school-setup"
      && !module.startsWith("school-setup:")
      && module !== "non-teaching-staff"
      && !module.startsWith("non-teaching-staff:"),
  );
}

const SUBMODULE_SCOPED_MODULE_IDS = ["approval-center", "leave-requests"] as const;

export const SUPPORT_STAFF_PARENT_ONLY_MODULE_IDS = [
  "timetable",
  "school-calendar",
  "attendance",
  "exam-controller",
  "complaint-hub",
  "noticeboard",
  "analytics",
  "audit-logs",
  "visitor-log",
  "id-card-gen",
  "assets",
  "faculty-mapping",
  "teacher-registry",
  "student-registry",
] as const;

export function hasSupportStaffModuleAccess(
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
): boolean {
  if (moduleId === "school-setup" || moduleId === "non-teaching-staff") return false;
  const grants = filterSupportStaffAllowedModules(allowedModules);
  if ((SUBMODULE_SCOPED_MODULE_IDS as readonly string[]).includes(moduleId)) {
    return grants.includes(moduleId) || grants.some(grant => grant.startsWith(`${moduleId}:`));
  }
  return grants.includes(moduleId);
}

export function hasSupportStaffSubmoduleAccess(
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
  submoduleId: string,
): boolean {
  if (moduleId === "school-setup" || moduleId === "non-teaching-staff") return false;
  const grants = filterSupportStaffAllowedModules(allowedModules);
  const scopedGrants = grants.filter(grant => grant.startsWith(`${moduleId}:`));
  if (scopedGrants.length > 0) {
    return scopedGrants.includes(`${moduleId}:${submoduleId}`);
  }
  return grants.includes(moduleId);
}

export function supportStaffModuleAccessAllowed(
  userRole: string | undefined,
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
): boolean {
  return userRole !== "support_staff" ||
    hasSupportStaffModuleAccess(allowedModules, moduleId);
}

export function adminModuleAccessAllowed(
  userRole: string | undefined,
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
): boolean {
  return userRole === "admin" ||
    (userRole === "support_staff" &&
      hasSupportStaffModuleAccess(allowedModules, moduleId));
}

export function adminModuleSubAccessAllowed(
  userRole: string | undefined,
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
  submoduleId: string,
): boolean {
  return userRole === "admin" ||
    (userRole === "support_staff" &&
      hasSupportStaffSubmoduleAccess(allowedModules, moduleId, submoduleId));
}

export function canonicalizeSupportStaffAllowedModules(
  allowedModules: readonly string[] | null | undefined,
): string[] {
  return filterSupportStaffAllowedModules(allowedModules).filter(grant => {
    const separator = grant.indexOf(":");
    if (separator < 0) return true;
    const parentModuleId = grant.slice(0, separator);
    return !SUPPORT_STAFF_PARENT_ONLY_MODULE_IDS.includes(
      parentModuleId as (typeof SUPPORT_STAFF_PARENT_ONLY_MODULE_IDS)[number],
    );
  });
}
