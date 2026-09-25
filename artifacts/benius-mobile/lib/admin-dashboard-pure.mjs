// In web dashboard order. A child permission never grants the parent module.
export const adminTiles = [
  { id: 'school-setup', label: 'School Setup', desc: 'Classes, Sections, Subjects, Exam Types', group: 'Foundation', icon: 'settings', color: '#D4AF37' },
  { id: 'timetable', label: 'Timetable Master', desc: 'Map teachers to periods and classes', group: 'Foundation', icon: 'clock', color: '#3b82f6' },
  { id: 'school-calendar', label: 'School Calendar', desc: 'Events, holidays and academic schedule', group: 'Foundation', icon: 'calendar', color: '#06b6d4' },
  { id: 'attendance', label: 'Attendance Overview', desc: 'School-wide daily presence stats', group: 'Oversight', icon: 'bar-chart-2', color: '#10b981' },
  { id: 'exam-controller', label: 'Exam Controller', desc: 'Lock scores & generate report cards', group: 'Oversight', icon: 'shield', color: '#f59e0b' },
  { id: 'complaint-hub', label: 'Complaint Hub', desc: 'All teacher complaints in one place', group: 'Oversight', icon: 'message-square', color: '#ef4444' },
  { id: 'noticeboard', label: 'Noticeboard', desc: 'Post notices to classes or whole school', group: 'Oversight', icon: 'bell', color: '#eab308' },
  { id: 'approval-center', label: 'Approval Center', desc: 'Gallery & e-book media approvals', group: 'Management', icon: 'user-check', color: '#a855f7' },
  { id: 'leave-requests', label: 'Leave Requests', desc: 'Teacher leave balances and student leave requests', group: 'Management', icon: 'calendar', color: '#22d3ee' },
  { id: 'teacher-registry', label: 'Teacher Registry', desc: 'Register & manage teaching staff', group: 'Management', icon: 'book-open', color: '#3b82f6' },
  { id: 'non-teaching-staff', label: 'Support Staff', desc: 'Admin, security, accounts & more', group: 'Management', icon: 'users', color: '#64748b' },
  { id: 'faculty-mapping', label: 'Faculty Mapping', desc: 'Assign teachers to classes & sections', group: 'Management', icon: 'users', color: '#6366f1' },
  { id: 'student-registry', label: 'Student Registry', desc: '5000+ students with smart pagination', group: 'Management', icon: 'users', color: '#8b5cf6' },
  { id: 'fees-manager', label: 'Fees & Payments', desc: 'Student fee records, dues and receipts', group: 'Management', icon: 'credit-card', color: '#10b981' },
  { id: 'analytics', label: 'Performance Analytics', desc: 'Exam scores and class analytics', group: 'Enterprise', icon: 'bar-chart-2', color: '#06b6d4' },
  { id: 'audit-logs', label: 'Audit Logs', desc: 'Immutable trail of all admin actions', group: 'Enterprise', icon: 'shield', color: '#D4AF37' },
  { id: 'visitor-log', label: 'Visitor Log', desc: 'Campus visitor check-in & check-out', group: 'Enterprise', icon: 'user', color: '#14b8a6' },
  { id: 'id-card-gen', label: 'ID Card Gen', desc: 'Generate & print student ID cards', group: 'Enterprise', icon: 'credit-card', color: '#a855f7' },
  { id: 'assets', label: 'Assets & Inventory', desc: 'Track school equipment and resources', group: 'Enterprise', icon: 'package', color: '#f97316' },
];

export const adminGroups = ['Foundation', 'Oversight', 'Management', 'Enterprise'];

export function dashboardForRole(role) {
  if (role === 'admin' || role === 'support_staff') return 'admin';
  if (role === 'student' || role === 'teacher') return role;
  return 'unsupported';
}

export function visibleAdminTiles(role, allowedModuleIds) {
  if (role === 'admin') return adminTiles;
  if (role !== 'support_staff' || !Array.isArray(allowedModuleIds)) return [];
  // Match the web: "module:submodule" is NOT a top-level module grant.
  const grants = new Set(allowedModuleIds.filter(id => typeof id === 'string' && !id.includes(':')));
  return adminTiles.filter(tile => grants.has(tile.id));
}

export function permittedSubmodules(moduleId, allowedModuleIds) {
  if (!Array.isArray(allowedModuleIds) || !allowedModuleIds.includes(moduleId)) return [];
  return allowedModuleIds.filter(id => typeof id === 'string' && id.startsWith(`${moduleId}:`) && id.slice(moduleId.length + 1) && !id.slice(moduleId.length + 1).includes(':'))
    .map(id => id.slice(moduleId.length + 1));
}

export function visibleMetrics(overview) {
  if (!overview) return [];
  return [
    ['studentCount', 'Total Students', '#D4AF37', 'users', 'student-registry'],
    ['teacherCount', 'Faculty Strength', '#3b82f6', 'book-open', 'teacher-registry'],
    ['dailyPresence', 'Daily Presence', '#10b981', 'check', 'attendance'],
    ['actionRequiredCount', 'Action Required', '#ef4444', 'bell', null],
  ].filter(([key, , , , moduleId]) => {
    if (overview.role === 'support_staff' && (!moduleId || !overview.allowedModuleIds?.includes(moduleId))) return false;
    const value = overview[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }).map(([key, label, color, icon]) => ({ key, label, color, icon, value: overview[key] }));
}