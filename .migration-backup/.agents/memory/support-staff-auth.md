---
name: Support Staff Auth & Sub-Module Enforcement
description: Documents the security fix and sub-module access control pattern for non-teaching support staff in the admin dashboard.
---

## The Bug
Staff login (`server/routes.ts`) was setting `req.session.userRole = "admin"` — giving staff full admin API access. Fixed to `"support_staff"`.

**Why:** The code fell through to a fallback login handler that didn't set the correct role. The fix is a single-line change in the staff login branch.

## Session Shape for Support Staff
- `req.session.staffId` — set (positive int)
- `req.session.userId` — set to `-(staffId)` (negative, truthy, used for audit logs)
- `req.session.userRole` — `"support_staff"` (NOT "admin")
- `req.session.schoolId` — correctly set to staff's school (data isolation works)
- `req.session.allowedModules` — array of colon-notation keys e.g. `["approval-center", "approval-center:gallery-hub", "teacher-registry:view"]`

## Route Auth Patterns

Most gallery/leave/library routes in teacher-routes.ts use `req.session.userRole === "teacher"` as the block condition, so they already pass for `support_staff` after the fix.

Routes that used `req.session.userRole !== "admin"` needed updating — specifically the teacher-registry CRUD and student-leaves admin-approve. Pattern used:
```ts
const isAdmin = !!(req.session.userId && req.session.userRole === "admin");
const isStaffMod = !!(req.session.staffId && req.session.userRole === "support_staff" &&
  (req.session.allowedModules ?? []).includes("MODULE:SUBKEY"));
if (!isAdmin && !isStaffMod) return res.status(403).json({ message: "Admin access required" });
```
For GET (any sub): use `.some(m => m === "MODULE" || m.startsWith("MODULE:"))`.

## Frontend `allowedSubs` Pattern

`admin-dashboard.tsx` has a `getSubsFor(moduleId)` helper:
- Returns `undefined` for admin (show everything)
- Returns filtered array of sub-keys for support_staff

Each module component receives `allowedSubs?: string[]`:
- `undefined` → admin mode, show all UI
- `string[]` → staff mode, filter tabs/tiles/buttons to those in the array

Components updated: `approval-center`, `teacher-registry`, `complaint-hub`, `performance-analytics`, `id-card-gen`.

## Sub-key → UI element mapping
- `approval-center`: `teacher-leave`, `student-leave`, `gallery-hub`, `ebook` → 4 ApprovalTiles
- `teacher-registry`: `add` → Add Teacher button; `edit` → Edit button; `deactivate` → Delete button
- `complaint-hub`: `private`, `grievances`, `escalated` → tabs
- `analytics`: `view`, `results` → tabs
- `id-card-gen`: `search`, `reissue` → tabs

**How to apply:** When adding new admin sub-modules, follow this same pattern. Add sub-keys to the permissions tree in non-teaching-staff management, add `allowedSubs` filtering inside the module component.
