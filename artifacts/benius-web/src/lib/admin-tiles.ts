export const ADMIN_TILE_DEFS: { id: string; label: string; emoji: string }[] = [
  { id: "school-setup",       label: "School Setup",          emoji: "⚙️" },
  { id: "timetable",          label: "Timetable Master",      emoji: "📅" },
  { id: "school-calendar",    label: "School Calendar",       emoji: "🗓️" },
  { id: "attendance",         label: "Attendance Overview",   emoji: "📊" },
  { id: "exam-controller",    label: "Exam Controller",       emoji: "🏆" },
  { id: "complaint-hub",      label: "Complaint Hub",         emoji: "🛡️" },
  { id: "noticeboard",        label: "Noticeboard",           emoji: "🔔" },
  { id: "approval-center",    label: "Approval Center",       emoji: "✅" },
  { id: "leave-requests",     label: "Leave Requests",        emoji: "📋" },
  { id: "teacher-registry",   label: "Teacher Registry",      emoji: "📖" },
  { id: "non-teaching-staff", label: "Support Staff",         emoji: "👷" },
  { id: "faculty-mapping",    label: "Faculty Mapping",       emoji: "🗂️" },
  { id: "student-registry",   label: "Student Registry",      emoji: "🎓" },
  { id: "fees-manager",       label: "Fees & Payments",       emoji: "💰" },
  { id: "analytics",          label: "Performance Analytics", emoji: "📈" },
  { id: "audit-logs",         label: "Audit Logs",            emoji: "🔐" },
  { id: "visitor-log",        label: "Visitor Log",           emoji: "🚪" },
  { id: "id-card-gen",        label: "ID Card Gen",           emoji: "💳" },
  { id: "assets",             label: "Assets & Inventory",    emoji: "📦" },
];

/**
 * Sub-modules per module — must match the actual tabs / sections built in each module component.
 * Adding a new module: add to ADMIN_TILE_DEFS above AND add its entry here.
 */
export const MODULE_SUB_MODULES: Record<string, { id: string; label: string }[]> = {

  // ── School Setup ───────────────────────────────────────────────────────────
  // Matches SETUP_SECTIONS array in school-setup.tsx
  "school-setup": [
    { id: "academic-sessions",      label: "Academic Sessions" },
    { id: "classes",                label: "Classes" },
    { id: "sections",               label: "Sections" },
    { id: "subjects",               label: "Subjects" },
    { id: "exam-types",             label: "Exam Types" },
    { id: "class-section-mapping",  label: "Class–Section Mapping" },
    { id: "class-subject-mapping",  label: "Class–Subject Mapping" },
    { id: "class-examtype-mapping", label: "Class–Exam Type Mapping" },
    { id: "grading",                label: "Academic Policy (Grading)" },
    { id: "exam-policy",            label: "Exam & Promotion Policy" },
    { id: "leave-policy",           label: "Leave Policy" },
    { id: "attendance-policy",      label: "Attendance Policy" },
  ],

  // ── Timetable Master ───────────────────────────────────────────────────────
  // Tabs: schedule | structure | publish  (timetable-master.tsx TabType)
  "timetable": [
    { id: "schedule",  label: "Schedule Grid" },
    { id: "structure", label: "Bell Structure" },
    { id: "publish",   label: "Publish Timetable" },
  ],

  // ── School Calendar ────────────────────────────────────────────────────────
  "school-calendar": [
    { id: "events",   label: "Create / Edit Events" },
    { id: "holidays", label: "Holiday Auto-Seeder" },
  ],

  // ── Attendance Overview ────────────────────────────────────────────────────
  // Two distinct sections: student attendance + teacher attendance
  "attendance": [
    { id: "students", label: "Student Attendance" },
    { id: "teachers", label: "Teacher Attendance" },
  ],

  // ── Exam Controller ────────────────────────────────────────────────────────
  // view: "table" (ledger) | "wizard" (promotion wizard)  (exam-controller.tsx)
  "exam-controller": [
    { id: "ledger", label: "Exam Ledger" },
    { id: "wizard", label: "Promotion Wizard" },
  ],

  // ── Complaint Hub ──────────────────────────────────────────────────────────
  // TabKey: "private" | "grievances" | "escalated"  (complaint-hub.tsx)
  "complaint-hub": [
    { id: "private",    label: "Private Complaints" },
    { id: "grievances", label: "Grievances" },
    { id: "escalated",  label: "Escalated Complaints" },
  ],

  // ── Noticeboard ────────────────────────────────────────────────────────────
  // Single list view with create form and bulk-delete panel (noticeboard-admin.tsx)
  "noticeboard": [
    { id: "view",        label: "View Notices" },
    { id: "create",      label: "Create Notices" },
    { id: "bulk-delete", label: "Bulk Delete" },
  ],

  // ── Approval Center ────────────────────────────────────────────────────────
  // Sections: gallery-hub | ebook  (approval-center.tsx)
  "approval-center": [
    { id: "gallery-hub", label: "Gallery Hub" },
    { id: "ebook",       label: "E-Book Library" },
  ],

  // ── Leave Requests ─────────────────────────────────────────────────────────
  // Sections: teacher-leave | student-leave | leave-history  (leave-requests.tsx)
  "leave-requests": [
    { id: "teacher-leave",  label: "Teacher Leave" },
    { id: "student-leave",  label: "Student Leave" },
    { id: "leave-history",  label: "Leave Approval History" },
  ],

  // ── Teacher Registry ───────────────────────────────────────────────────────
  "teacher-registry": [
    { id: "add",    label: "Add Teacher" },
    { id: "edit",   label: "Edit Teacher" },
    { id: "delete", label: "Delete Teacher" },
  ],

  // ── Non-Teaching Staff ─────────────────────────────────────────────────────
  "non-teaching-staff": [
    { id: "view",        label: "View Staff" },
    { id: "add",         label: "Add Staff" },
    { id: "edit",        label: "Edit Staff" },
    { id: "permissions", label: "Edit Permissions" },
  ],

  // ── Faculty Mapping ────────────────────────────────────────────────────────
  "faculty-mapping": [
    { id: "view",   label: "View Mappings" },
    { id: "assign", label: "Assign Mappings" },
  ],

  // ── Student Registry ───────────────────────────────────────────────────────
  "student-registry": [
    { id: "add",    label: "Add Student" },
    { id: "edit",   label: "Edit Student" },
    { id: "delete", label: "Delete Student" },
  ],

  // ── Fees & Payments ────────────────────────────────────────────────────────
  "fees-manager": [
    { id: "financial-analytics", label: "Financial Analytics" },
    { id: "fee-structures", label: "Fee Structures" },
    { id: "ledger-transactions", label: "Ledger & Transactions" },
    { id: "reminders", label: "Reminders" },
    { id: "audit-log", label: "Audit Log" },
  ],

  // ── Performance Analytics ──────────────────────────────────────────────────
  // Tabs: "view" (View Marks) | "results" (Results & Report Cards)  (performance-analytics.tsx)
  "analytics": [
    { id: "view",    label: "View Marks / Scores" },
    { id: "results", label: "Results & Report Cards" },
  ],

  // ── Audit Logs ─────────────────────────────────────────────────────────────
  "audit-logs": [
    { id: "view", label: "View Audit Trail" },
  ],

  // ── Visitor Log ────────────────────────────────────────────────────────────
  // Two tables: active (checked-in) + history (checked-out)
  "visitor-log": [
    { id: "active",   label: "Active Visitors (checked-in)" },
    { id: "history",  label: "Visitor History" },
    { id: "checkin",  label: "Log New Visitor" },
    { id: "checkout", label: "Check-out Visitor" },
  ],

  // ── ID Card Gen ────────────────────────────────────────────────────────────
  // Tabs: "search" | "reissue"  (id-card-gen.tsx)
  "id-card-gen": [
    { id: "search",  label: "Search & Generate ID Cards" },
    { id: "reissue", label: "Reissue Requests" },
  ],

  // ── Assets & Inventory ─────────────────────────────────────────────────────
  "assets": [
    { id: "view",   label: "View Assets" },
    { id: "add",    label: "Add Assets" },
    { id: "edit",   label: "Edit / Update Assets" },
    { id: "delete", label: "Delete Assets" },
  ],
};

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

const REGISTRY_ACTION_MODULE_IDS = new Set(["teacher-registry", "student-registry"]);
const REGISTRY_ACTION_SUBMODULE_IDS = new Set(["add", "edit", "delete"]);

export function isSupportStaffParentOnlyModule(moduleId: string): boolean {
  return (SUPPORT_STAFF_PARENT_ONLY_MODULE_IDS as readonly string[]).includes(moduleId);
}

export function shouldAutoGrantSubmodulePermissions(moduleId: string): boolean {
  return !REGISTRY_ACTION_MODULE_IDS.has(moduleId);
}

function normalizeRegistryActionGrant(grant: string): string | null {
  const separator = grant.indexOf(":");
  if (separator < 0) return grant;

  const moduleId = grant.slice(0, separator);
  if (!REGISTRY_ACTION_MODULE_IDS.has(moduleId)) return grant;

  const legacySubmoduleId = grant.slice(separator + 1);
  const submoduleId = legacySubmoduleId === "deactivate" ? "delete" : legacySubmoduleId;
  return REGISTRY_ACTION_SUBMODULE_IDS.has(submoduleId)
    ? `${moduleId}:${submoduleId}`
    : null;
}

/**
 * Backwards-compat helper: old module-only grants still populate submodules,
 * while legacy Fees grants map only to Ledger & Transactions.
 */
export function expandModulesWithSubs(allowedModules: string[]): string[] {
  const normalizedGrants = filterSupportStaffGrants(allowedModules);
  const legacyFeeGrants = ["fees-manager:view", "fees-manager:record", "fees-manager:export"];
  const hasCompleteLegacyFeeGrant = legacyFeeGrants.every(grant => normalizedGrants.includes(grant));
  const result = hasCompleteLegacyFeeGrant
    ? normalizedGrants.filter(key => !legacyFeeGrants.includes(key))
    : [...normalizedGrants];
  normalizedGrants.forEach(key => {
    if (key.includes(":")) return;
    if (isSupportStaffParentOnlyModule(key) || REGISTRY_ACTION_MODULE_IDS.has(key)) return;
    const hasSub = normalizedGrants.some(k => k.startsWith(key + ":"));
    if (!hasSub) {
      const subs = key === "fees-manager"
        ? MODULE_SUB_MODULES[key]?.filter(sub => sub.id === "ledger-transactions")
        : MODULE_SUB_MODULES[key];
      (subs ?? []).forEach(sub => {
        const subKey = `${key}:${sub.id}`;
        if (!result.includes(subKey)) result.push(subKey);
      });
    }
  });
  if (hasCompleteLegacyFeeGrant) {
    const ledgerGrant = "fees-manager:ledger-transactions";
    if (result.includes("fees-manager") && !result.includes(ledgerGrant)) result.push(ledgerGrant);
  }
  return result;
}

export function isSchoolSetupGrant(grant: string): boolean {
  return grant === "school-setup" || grant.startsWith("school-setup:");
}

export function filterSupportStaffGrants(
  allowedModules: readonly string[] | null | undefined,
): string[] {
  return (allowedModules ?? []).flatMap(grant => {
    if (
      isSchoolSetupGrant(grant)
      || grant === "non-teaching-staff"
      || grant.startsWith("non-teaching-staff:")
    ) {
      return [];
    }
    const normalizedGrant = normalizeRegistryActionGrant(grant);
    return normalizedGrant ? [normalizedGrant] : [];
  });
}

export function canonicalizeSupportStaffGrants(
  allowedModules: readonly string[] | null | undefined,
): string[] {
  const filteredGrants = filterSupportStaffGrants(allowedModules);
  const parentGrants = new Set(filteredGrants.filter(grant => !grant.includes(":")));
  return filteredGrants.filter(grant => {
    const separator = grant.indexOf(":");
    if (separator < 0) return true;
    const parentModuleId = grant.slice(0, separator);
    if (REGISTRY_ACTION_MODULE_IDS.has(parentModuleId) && !parentGrants.has(parentModuleId)) {
      return false;
    }
    return !isSupportStaffParentOnlyModule(parentModuleId);
  });
}

export function hasSupportStaffModuleGrant(
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
): boolean {
  if (isSchoolSetupGrant(moduleId) || moduleId === "non-teaching-staff") return false;
  const grants = filterSupportStaffGrants(allowedModules);
  if (grants.includes(moduleId)) return true;
  return (moduleId === "approval-center" || moduleId === "leave-requests")
    && grants.some(grant => grant.startsWith(`${moduleId}:`));
}

export const SUPPORT_STAFF_PERMISSION_MODULES = ADMIN_TILE_DEFS.filter(
  module => module.id !== "school-setup" && module.id !== "non-teaching-staff",
);
