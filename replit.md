# BENIUS - Multi-Tenant School Management System

## Overview
A full-stack, enterprise-grade school management platform with:
- **Super Admin** (`/super-master`) — school provisioning
- **Principal/Admin Dashboard** (`/admin-dashboard`) — Navy & Gold Command Center with 15 tiles, Live Pulse analytics, server-side pagination for 5000+ students
- **Teacher Dashboard** (`/teacher-dashboard`) — 13-module grid with glassmorphic EdTech UI
- **Student Portal** — activation, login, 12-tile Emerald dashboard, self-service profile with verification workflow

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS, Shadcn UI, Wouter (routing), TanStack React Query, recharts
- **Backend**: Express.js, PostgreSQL, Drizzle ORM, bcryptjs, express-session + connect-pg-simple, multer
- **Language**: TypeScript

## Project Structure
- `shared/schema.ts` — All Drizzle table definitions, insert schemas, and inferred types
- `server/db.ts` — Database connection (pool + drizzle)
- `server/storage.ts` — `DatabaseStorage` class: all CRUD methods, paginated queries, audit log writer
- `server/routes.ts` — Admin API routes (schools, students, principals, school metadata, bulk CSV import)
- `server/teacher-routes.ts` — Teacher + admin extra routes (auth, attendance, homework, classwork, notices, complaints, exams, gallery, calendar, library, leave, timetable, student leaves, visitor logs, audit logs, paginated students/teachers)
- `server/index.ts` — Express server, session middleware, static file serving (`/uploads`)
- `client/src/hooks/use-school-config.ts` — Shared hook for school metadata (classes, sections, subjects, exam_types) with fallback
- `client/src/pages/` — Page components (home, super-master, login, admin-dashboard, register, student-login, student-dashboard, teacher-login, teacher-dashboard)
- `client/src/pages/teacher-modules/` — 13 teacher sub-module pages
- `client/src/pages/admin-modules/` — 14 admin sub-module pages

## Database Tables
- **schools**: id, name, code (unique)
- **users**: id, email, password_hash, role (admin/teacher), school_id, is_active (default true)
- **students**: id, school_id, digital_student_id, name, class, section, phone, dob, password_hash, photo_url, is_activated, is_active (default true)
- **teachers**: id, user_id, school_id, full_name, phone, subject, assigned_class, assigned_section, must_change_password, otp_code, otp_expires_at, reset_token, reset_token_expires_at
- **attendance_records**: id, student_id, teacher_id, school_id, date, status (present/absent/leave), edit_count, marked_by, marked_at
- **homework**: id, teacher_id, school_id, class, section, subject, content, file_url, due_date, created_at
- **homework_views**: id, homework_id, student_id, viewed_at
- **homework_submissions**: id, homework_id, student_id, school_id, file_url, status (submitted/approved/rejected), submitted_at, reviewed_at, reviewed_by
- **classwork**: id, teacher_id, school_id, class, section, subject, content, file_url, created_at
- **notices**: id, school_id, created_by_id, creator_role, target_type, target_class, target_section, notice_type, content, file_url, created_at
- **complaints**: id, ticket_id, teacher_id, student_id, school_id, complaint_type, status, content, reported_student_name, file_url, is_deleted, created_at, complainant_student_id, complainant_class, complainant_section, resolution_remarks, escalated_to_principal
- **complaint_notes**: id, complaint_id, author_id, author_role, author_name, content, created_at
- **exam_scores**: id, student_id, teacher_id, school_id, subject, exam_type, marks, total_marks, pass_marks (default 33), is_absent, class, section, published (default false), created_at
- **gallery_items**: id, school_id, uploaded_by_id, title, description, event_tag, image_url, approved, created_at
- **calendar_events**: id, school_id, title, date, event_type (holiday/academic/event)
- **library_books**: id, school_id, title, author, isbn, target_class, category, file_url, file_type, uploaded_by_id, verification_status, total_copies, available_copies
- **book_borrows**: id, book_id, borrower_id, borrower_type, school_id, borrowed_at, returned_at
- **leave_requests**: id, teacher_id, school_id, leave_type, start_date, end_date, reason, status, approved_by, created_at
- **timetable_entries**: id, teacher_id, school_id, day_of_week, period, class, section, subject
- **school_metadata**: id, school_id, meta_key (unique per school), meta_value (JSON array string), updated_at
- **student_leave_requests**: id, student_id, school_id, start_date, end_date, reason, status (pending/approved/rejected/forwarded), reviewed_by, reviewer_role, created_at
- **audit_logs**: id, school_id, action_type, entity_type, entity_id, action_by, action_by_role, details, created_at
- **visitor_logs**: id, school_id, visitor_name, purpose, host_name, phone, check_in, check_out, badge, created_at
- **student_profiles**: id, student_id (unique FK), school_id, status (draft|pending|approved|rejected), full_name, class, section, roll_no, father_name, mother_name, present_address, photo_url, photo_status (none|pending|approved), rejection_note, submitted_at, verified_at, verified_by, updated_at

## Admin Dashboard — Navy & Gold Command Center
- **Theme**: bg=#0A1628, cards=#1A2942, gold=#D4AF37
- **Live Pulse Header**: Total Students · Faculty Strength · Daily Presence % · Action Required (red badge)
- **15 tiles in 4 groups**:
  - Foundation: School Setup, Student Registry, Faculty Mapping, Approval Center
  - Oversight: Audit Logs, Visitor Log, Attendance Overview, Performance Analytics
  - Management: Exam Controller, Complaint Hub, Noticeboard, Timetable Master
  - Enterprise: ID Card Gen, Assets Inventory, (expandable)
- **Student Registry**: debounced search + Class/Section filters + server-side pagination (LIMIT 50, OFFSET)
- **Approval Center**: teacher leave, student leave, gallery images, e-book verifications — all pending items
- **Visitor Log**: check-in form + check-out PATCH, audit trail
- **Audit Logs**: chronological trail of all approve/reject/upload/checkin actions

## Teacher Dashboard — 14 Modules
1. **Profile** — personal info
2. **Attendance** — mark/edit, 7-day window, history table
3. **Homework** — social-feed cards, view tracking, file upload, due dates
4. **Classwork** — lesson log (mirrors homework, no due date)
5. **Noticeboard** — smart targeting (section/class/school), 5+ notice types
6. **Complaint** — Discipline & Resolution Hub, ticketing, live search, resolution threads
7. **Examination** — spreadsheet grid, Tab-key nav, dual-line recharts, 360° history
8. **Gallery** — batch upload (≤10 images), event tag, masonry grid, lightbox
9. **Faculty Info** — staff directory
10. **Calendar** — Month/Week toggle, holiday=red/academic=blue/event=green, today highlight, popovers
11. **Library** — catalog search, e-book upload (PDF/EPUB → pending verification), borrow/return, my books
12. **Leave** — My Leave (Sick/Casual/Earned balance cards, apply form, history) + Student Leave Requests tab (approve→auto-marks attendance, forward to principal)
13. **Timetable** — weekly schedule grid
14. **Student Profiles** — Verify pending student profile submissions; amber badge shows count; approve/reject with note; filtered to teacher's assigned class/section

## Multi-Tenant Security
- Admin metadata routes enforce `userRole === "admin"`
- Teacher endpoints require `req.session.teacherId`
- School ownership verified on all queries (`WHERE school_id = session.schoolId`)
- Gallery upload routes verify teacher school ownership
- Leave balance locked to own teacherId
- Student leave routes verify assigned class/section match
- Book verify route checks admin-school ownership
- Paginated admin routes verify `req.session.schoolId === params.schoolId`

## Multi-Tenant School Config
- Principal configures master lists via School Settings tile
- 4 keys: `classes`, `sections`, `subjects`, `exam_types` (stored as JSON in school_metadata)
- `useSchoolConfig(schoolId)` hook provides dynamic dropdowns with fallback defaults
- All modules use dynamic config; fallback if empty: classes (L.K.G–12), sections (A–E), exam types (UT1–Annual)

## Leave & Attendance Sync
- Teacher approve student leave → PATCH `/api/student-leaves/:id/approve` → marks attendance as "leave" for each date in range (skips Sundays)
- Teacher forward → status = "forwarded" (goes to principal approval in Approval Center)
- Admin approve student leave → same auto-attendance sync
- Teacher leave balance: `GET /api/leave/balance/:teacherId` → counts days used per type for current year

## Key API Endpoints
- `POST /api/teacher-login`, `GET /api/teacher-me`, `POST /api/teacher-logout`
- `GET /api/attendance/:schoolId/:class/:section/:date`, `POST /api/attendance`
- `GET|POST /api/homework/:schoolId/:class/:section`, `PATCH|DELETE /api/homework/:id`
- `GET|POST /api/gallery/:schoolId`, `POST /api/gallery/batch` (multer array ≤10)
- `POST /api/library/ebooks` (multer single, teacher e-book upload)
- `PATCH /api/library/books/:id/verify` (admin)
- `GET /api/student-leaves/:schoolId/:class/:section`, `PATCH /api/student-leaves/:id/approve`, `PATCH /api/student-leaves/:id/forward`
- `GET /api/leave/balance/:teacherId`
- `GET /api/calendar/:schoolId`, `POST /api/calendar`, `DELETE /api/calendar/:id`
- `GET|POST /api/visitor-logs`, `GET /api/visitor-logs/:schoolId`, `PATCH /api/visitor-logs/:id/checkout`
- `GET /api/audit-logs/:schoolId`
- `GET /api/schools/:schoolId/students/paginated?q=&cls=&section=&page=` (LIMIT 50, only active students)
- `GET /api/schools/:schoolId/teachers/paginated?q=&page=` (LIMIT 50, only active teachers)
- `GET /api/student/profile` — get own student profile (studentId from session)
- `POST /api/student/profile` — save/update draft profile fields
- `GET /api/student/homework?date=YYYY-MM-DD` — list homework for student's class/section, filtered by date (assigned on or due on)
- `GET /api/student/homework/:id` — single homework item with submission status
- `POST /api/student/homework/:id/submit` — submit homework (multipart/form-data, file optional); upserts submission record
- `GET /api/student/classwork?date=YYYY-MM-DD` — list classwork for student's class/section, filtered by date
- `POST /api/student/profile/submit` — submit profile for teacher verification
- `POST /api/student/profile/photo` — upload profile photo (multer, saved to /uploads/student-photos/)
- `POST /api/student/change-password { currentPassword, newPassword }` — student self-service password change
- `GET /api/teacher/pending-profiles` — pending profiles for teacher's class/section
- `GET /api/teacher/pending-profiles/count` — count only (for badge)
- `POST /api/teacher/profiles/:studentId/approve` — approve profile
- `POST /api/teacher/profiles/:studentId/reject { note }` — reject with reason note
- `POST /api/admin/verify-password { password }` — re-auth admin for Double-Lock Modal
- `POST /api/schools/:schoolId/students/:studentId/deactivate { reason }` — soft-delete student
- `POST /api/schools/:schoolId/teachers/:teacherId/deactivate { reason }` — soft-delete teacher (deactivates user login)

## Student Profile & Data Verification System
- **Route**: `/student-profile` — protected by session guard (redirects to `/student-login` if not authenticated)
- **Status lifecycle**: draft → pending → approved | rejected (rejected restores editability)
- **Status banner**: color-coded (gray=draft, yellow=pending, green=approved, red=rejected with rejection note)
- **Photo upload**: POST to `/api/student/profile/photo` (stored in `/uploads/student-photos/`), shows PENDING/APPROVED badge overlay
- **Read-only section**: shows DSID registration data (name, class, section, phone, DOB) that cannot be self-edited
- **Editable fields**: fullName (cert), rollNo, fatherName, motherName, presentAddress — locked when pending/approved
- **Two action buttons**: "Save as Draft" (upsert only) and "Submit for Verification" (requires fullName+fatherName+motherName+address to be filled)
- **Security tab**: password change form with current/new/confirm fields, eye toggle icons
- **Teacher Verification module**: 14th teacher module (amber tile with numeric pending badge), filters profiles by teacher's `assignedClass`+`assignedSection`, shows student details, expand/collapse rows, approve → marks verified, reject → opens modal for rejection note which student sees on re-login
- **DB table**: `student_profiles` created via direct SQL in `server/index.ts` (CREATE TABLE IF NOT EXISTS)

## Secure Deactivation Workflow
- Soft delete: sets `is_active = false` on students / users (teachers); never hard deletes
- Double-Lock Security Modal: danger red theme, reason dropdown, admin password re-entry field
- Student reasons: Graduated / Transferred / Long Absence / Disciplinary Action / Other
- Teacher reasons: Resigned / Transferred / Contract Ended / Disciplinary Action / Other
- Confirm button disabled until both reason and password are filled
- On submit: verifies admin password server-side first, then deactivates + writes audit log
- Deactivated users are blocked at login (403 "account deactivated" error)
- Deactivated students are blocked at student login too
- Paginated queries filter to `is_active = true` only, so deactivated records disappear from lists
- Live Pulse student count also reflects only active students

## Global Standards
- Date format: dd/mm/yyyy (`toLocaleDateString("en-GB")`) across entire app
- All interactive elements have `data-testid` attributes
- Glassmorphic EdTech card aesthetic throughout teacher modules
- recharts for all analytics charts

## Running
- `npm run dev` — starts Express backend + Vite frontend on port 5000
- `npm run db:push` — sync Drizzle schema to PostgreSQL (never use db:push interactively; use direct SQL for new tables when needed)
