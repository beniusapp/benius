export const ADMIN_TILE_DEFS: { id: string; label: string; emoji: string }[] = [
  { id: "school-setup",       label: "School Setup",          emoji: "⚙️" },
  { id: "timetable",          label: "Timetable Master",      emoji: "📅" },
  { id: "school-calendar",    label: "School Calendar",       emoji: "🗓️" },
  { id: "attendance",         label: "Attendance Overview",   emoji: "📊" },
  { id: "exam-controller",    label: "Exam Controller",       emoji: "🏆" },
  { id: "complaint-hub",      label: "Complaint Hub",         emoji: "🛡️" },
  { id: "noticeboard",        label: "Noticeboard",           emoji: "🔔" },
  { id: "approval-center",    label: "Approval Center",       emoji: "✅" },
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

export const MODULE_SUB_MODULES: Record<string, { id: string; label: string }[]> = {
  "school-setup": [
    { id: "classes",    label: "Manage Classes & Sections" },
    { id: "subjects",   label: "Manage Subjects & Exam Types" },
    { id: "metadata",   label: "School Metadata" },
  ],
  "timetable": [
    { id: "bell",     label: "Bell Structure" },
    { id: "schedule", label: "Schedule Grid" },
  ],
  "school-calendar": [
    { id: "events",   label: "Create / Edit Events" },
    { id: "holidays", label: "Holiday Seeder" },
  ],
  "attendance": [
    { id: "daily",       label: "Daily Summary" },
    { id: "reports",     label: "Reports & Export" },
    { id: "corrections", label: "Attendance Corrections" },
  ],
  "exam-controller": [
    { id: "entry",  label: "Score Entry" },
    { id: "report", label: "Report Cards" },
    { id: "lock",   label: "Lock / Unlock Exams" },
  ],
  "complaint-hub": [
    { id: "view",    label: "View Complaints" },
    { id: "resolve", label: "Resolve Complaints" },
    { id: "delete",  label: "Delete Complaints" },
  ],
  "noticeboard": [
    { id: "view",   label: "View Notices" },
    { id: "create", label: "Create Notices" },
    { id: "delete", label: "Delete Notices" },
  ],
  "approval-center": [
    { id: "leaves",   label: "Leave Approvals" },
    { id: "profiles", label: "Profile Verifications" },
    { id: "homework", label: "Homework Submissions" },
  ],
  "teacher-registry": [
    { id: "view",       label: "View Teachers" },
    { id: "add",        label: "Add Teachers" },
    { id: "edit",       label: "Edit Teachers" },
    { id: "deactivate", label: "Deactivate Teachers" },
  ],
  "non-teaching-staff": [
    { id: "view",        label: "View Staff" },
    { id: "add",         label: "Add Staff" },
    { id: "edit",        label: "Edit Staff" },
    { id: "permissions", label: "Edit Permissions" },
  ],
  "faculty-mapping": [
    { id: "view",   label: "View Mappings" },
    { id: "assign", label: "Assign Mappings" },
  ],
  "student-registry": [
    { id: "view",       label: "View Students" },
    { id: "add",        label: "Add / Activate Students" },
    { id: "edit",       label: "Edit Students" },
    { id: "deactivate", label: "Deactivate Students" },
    { id: "export",     label: "Export Data" },
  ],
  "fees-manager": [
    { id: "view",    label: "View Fee Records" },
    { id: "record",  label: "Record Payments" },
    { id: "reports", label: "Fee Reports" },
  ],
  "analytics": [
    { id: "performance", label: "Performance Charts" },
    { id: "attendance",  label: "Attendance Analytics" },
  ],
  "audit-logs": [
    { id: "view", label: "View Audit Logs" },
  ],
  "visitor-log": [
    { id: "view", label: "View Visitor Records" },
    { id: "add",  label: "Log New Visitors" },
  ],
  "id-card-gen": [
    { id: "generate", label: "Generate ID Cards" },
    { id: "template", label: "Edit Templates" },
  ],
  "assets": [
    { id: "view",   label: "View Assets" },
    { id: "add",    label: "Add Assets" },
    { id: "manage", label: "Manage Inventory" },
  ],
};

export function expandModulesWithSubs(allowedModules: string[]): string[] {
  const result = [...allowedModules];
  allowedModules.forEach(key => {
    if (key.includes(":")) return;
    const hasSub = allowedModules.some(k => k.startsWith(key + ":"));
    if (!hasSub) {
      (MODULE_SUB_MODULES[key] ?? []).forEach(sub => {
        const subKey = `${key}:${sub.id}`;
        if (!result.includes(subKey)) result.push(subKey);
      });
    }
  });
  return result;
}
