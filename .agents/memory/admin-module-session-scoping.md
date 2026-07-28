---
name: Admin Module Session Scoping
description: How to correctly wire an admin module to the academic-session switcher so it shows the right year's data and blocks writes on archived sessions.
---

## The rule

Every admin module must:
1. Use `sessionFetch(url)` (not `fetch(url, { credentials })`) for all GET queries inside `queryFn`.
2. Call `const { isArchiveMode } = useSessionView()` and add `|| isArchiveMode` (or `disabled={isArchiveMode}`) to every mutation button's `disabled` prop.

**Why:** `sessionFetch` automatically injects `x-view-session-id`, which the `checkSessionContext` middleware reads to scope all DB queries to the selected session. Without it, a module always shows the current live session's data regardless of what the admin has selected. The backend middleware already blocks writes on archived sessions, but disabling buttons on the frontend prevents confusing "Security Restriction" toast errors.

## How to apply

```tsx
// 1. imports
import { sessionFetch } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

// 2. inside component (or sub-component that has action buttons)
const { isArchiveMode } = useSessionView();

// 3. all GET queries
queryFn: async () => {
  const r = await sessionFetch(`/api/...`);   // ← NOT fetch(url, { credentials })
  return r.ok ? r.json() : fallback;
}

// 4. mutation buttons
<Button disabled={someMutation.isPending || isArchiveMode} ...>
```

## Modules completed (all 11 originally listed)

| Module | sessionFetch | isArchiveMode |
|---|---|---|
| Visitor Log | ✅ (pre-existing) | ✅ (pre-existing) |
| Fees & Payments | ✅ (pre-existing) | ✅ (pre-existing) |
| Audit Logs | ✅ (pre-existing) | n/a read-only |
| Timetable Master | ✅ | ✅ publish button |
| Exam Controller | ✅ | ✅ execute/delete/override buttons |
| Attendance Overview | ✅ | n/a read-only |
| Leave Requests | ✅ (pre-existing) | ✅ approve/reject/dialog buttons |
| Complaint Hub | ✅ (pre-existing) | ✅ resolve/investigate/bulk-delete |
| Notice Board | ✅ (pre-existing) | ✅ post/edit/delete/bulk-delete |
| ID Card Generator | ✅ | ✅ mark-printed button |
| Performance Analytics | ✅ | n/a read-only |

## Sub-components

Sub-components that own action buttons (e.g. `ComplaintCard`, `TabSettings` in complaint-hub) should call `useSessionView()` **directly inside themselves** rather than receiving `isArchiveMode` as a prop — it avoids prop-drilling and keeps the pattern consistent.
