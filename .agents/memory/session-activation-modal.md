---
name: Student Session Activation Modal
description: Blocking confirmation modal shown to students when admin activates a new academic session via SSE.
---

## What it does
When admin activates a new session, instead of silently switching, the student portal shows a blocking modal:
- Title: "New Academic Session!" with session name pill
- Lists session-based modules (will be empty in new session): Attendance, Homework, Classwork, Noticeboard, Fees, Examination, Complaints, Leave, Timetable
- Lists global modules (unchanged): Profile, Gallery, Faculty Info, School Calendar, E-Library
- Single "Confirm & Continue" button — cannot be dismissed without confirming

## Where the logic lives
- `client/src/contexts/session-view-context.tsx` — added `pendingActivation: AcademicSession | null` and `confirmActivation: () => void` to context shape
- `client/src/contexts/student-session-provider.tsx` — SSE `session-activated` event now calls `fetchSessions()` to get the new session name, then sets `pendingActivation` instead of auto-switching; `confirmActivation()` clears it, resets `selectedSession` to null (auto-picks active), and invalidates all session-scoped query keys
- `client/src/pages/student-dashboard.tsx` — renders `<AnimatePresence>` overlay modal when `pendingActivation` is non-null; calls `confirmActivation()` on button click

## Session-based vs global module classification
**Session-based (resets each year):** attendance, homework, classwork, noticeboard, fees, examination, complaints, leave, timetable
**Global (never resets):** profile, gallery, faculty info, school calendar, e-library

## Student profile class/section
Already correct — `/api/student/profile` returns `liveData.class` and `liveData.section` directly from the `students` table (admin registry). No changes needed.
