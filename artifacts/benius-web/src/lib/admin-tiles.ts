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
    { id: "gallery-hub", label: "Gallery Hub Approvals" },
    { id: "ebook",       label: "E-Book Verification" },
  ],

  // ── Leave Requests ─────────────────────────────────────────────────────────
  // Sections: teacher-leave | student-leave | leave-history  (leave-requests.tsx)
  "leave-requests": [
    { id: "teacher-leave",  label: "Teacher Leave Requests" },
    { id: "student-leave",  label: "Student Leave Requests (forwarded by teacher)" },
    { id: "leave-history",  label: "Leave Approval History" },
  ],

  // ── Teacher Registry ───────────────────────────────────────────────────────
  "teacher-registry": [
    { id: "view",       label: "View Teachers" },
    { id: "add",        label: "Add Teachers" },
    { id: "edit",       label: "Edit Teachers" },
    { id: "deactivate", label: "Deactivate Teachers" },
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
    { id: "view",       label: "View Students" },
    { id: "add",        label: "Add / Activate Students" },
    { id: "edit",       label: "Edit Students" },
    { id: "deactivate", label: "Deactivate Students" },
    { id: "export",     label: "Export Data" },
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

/**
 * Backwards-compat helper: old module-only grants still populate submodules,
 * while legacy Fees grants map only to Ledger & Transactions.
 */
export function expandModulesWithSubs(allowedModules: string[]): string[] {
  const legacyFeeGrants = ["fees-manager:view", "fees-manager:record", "fees-manager:export"];
  const hasCompleteLegacyFeeGrant = legacyFeeGrants.every(grant => allowedModules.includes(grant));
  const result = hasCompleteLegacyFeeGrant
    ? allowedModules.filter(key => !legacyFeeGrants.includes(key))
    : [...allowedModules];
  allowedModules.forEach(key => {
    if (key.includes(":")) return;
    const hasSub = allowedModules.some(k => k.startsWith(key + ":"));
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
  return (allowedModules ?? []).filter(grant => !isSchoolSetupGrant(grant));
}

export function hasSupportStaffModuleGrant(
  allowedModules: readonly string[] | null | undefined,
  moduleId: string,
): boolean {
  return !isSchoolSetupGrant(moduleId) && filterSupportStaffGrants(allowedModules).includes(moduleId);
}

export const SUPPORT_STAFF_PERMISSION_MODULES = ADMIN_TILE_DEFS.filter(
  module => module.id !== "school-setup",
);
