export function filterSupportStaffAllowedModules(
  allowedModules: readonly string[] | null | undefined,
): string[] {
  return (allowedModules ?? []).flatMap(grant => {
    if (
      grant === "school-setup"
      || grant.startsWith("school-setup:")
      || grant === "non-teaching-staff"
      || grant.startsWith("non-teaching-staff:")
    ) {
      return [];
    }

    const separator = grant.indexOf(":");
    if (separator < 0) return [grant];
    const moduleId = grant.slice(0, separator);
    if (moduleId !== "teacher-registry" && moduleId !== "student-registry") return [grant];

    const legacySubmoduleId = grant.slice(separator + 1);
    const submoduleId = legacySubmoduleId === "deactivate" ? "delete" : legacySubmoduleId;
    return ["add", "edit", "delete"].includes(submoduleId)
      ? [`${moduleId}:${submoduleId}`]
      : [];
  });
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
] as const;

const REGISTRY_ACTION_MODULE_IDS = ["teacher-registry", "student-registry"] as const;

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
  if ((REGISTRY_ACTION_MODULE_IDS as readonly string[]).includes(moduleId)) {
    return grants.includes(moduleId) && grants.includes(`${moduleId}:${submoduleId}`);
  }
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
  const filteredGrants = filterSupportStaffAllowedModules(allowedModules);
  const parentGrants = new Set(filteredGrants.filter(grant => !grant.includes(":")));
  return filteredGrants.filter(grant => {
    const separator = grant.indexOf(":");
    if (separator < 0) return true;
    const parentModuleId = grant.slice(0, separator);
    if (
      (REGISTRY_ACTION_MODULE_IDS as readonly string[]).includes(parentModuleId)
      && !parentGrants.has(parentModuleId)
    ) {
      return false;
    }
    return !SUPPORT_STAFF_PARENT_ONLY_MODULE_IDS.includes(
      parentModuleId as (typeof SUPPORT_STAFF_PARENT_ONLY_MODULE_IDS)[number],
    );
  });
}
