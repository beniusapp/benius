export function filterSupportStaffAllowedModules(
  allowedModules: readonly string[] | null | undefined,
): string[] {
  return (allowedModules ?? []).filter(
    module => module !== "school-setup" && !module.startsWith("school-setup:"),
  );
}

export const SUPPORT_STAFF_PARENT_ONLY_MODULE_IDS = [
  "timetable",
  "school-calendar",
  "attendance",
  "exam-controller",
  "complaint-hub",
  "noticeboard",
] as const;

export function hasSupportStaffModuleAccess(
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
): boolean {
  return moduleId !== "school-setup" &&
    (allowedModules ?? []).includes(moduleId);
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
