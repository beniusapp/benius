# BENIUS - School Management System

## Overview
A school management platform with Super Admin functionality to manage schools, principal dashboard with student and teacher management, student self-activation, student login with digital ID cards, and a complete Teacher Module with 13 interactive sub-modules.

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS, Shadcn UI, Wouter (routing), TanStack React Query, recharts
- **Backend**: Express.js, PostgreSQL, Drizzle ORM, bcryptjs (password hashing), express-session + connect-pg-simple (sessions), multer (file uploads), csv-parse + xlsx (file parsing)
- **Language**: TypeScript

## Project Structure
- `shared/schema.ts` - Drizzle database models and Zod schemas (schools, users, students, teachers, attendance, homework, classwork, notices, complaints, complaintNotes, examScores, galleryItems, calendarEvents, libraryBooks, bookBorrows, leaveRequests, timetableEntries, schoolMetadata)
- `server/db.ts` - Database connection pool
- `server/storage.ts` - DatabaseStorage class with all CRUD methods
- `server/routes.ts` - Express API routes for schools, students, principals, school metadata (admin)
- `server/teacher-routes.ts` - Express API routes for teacher auth, attendance, homework, classwork, notices, complaints, exams, gallery, calendar, library, leave, timetable, faculty, school config, student search
- `server/index.ts` - Express server setup with session middleware and static file serving (/uploads)
- `client/src/hooks/use-school-config.ts` - Shared hook for fetching school metadata (classes, sections, subjects, exam types) with fallback values
- `client/src/pages/home.tsx` - Public landing page
- `client/src/pages/super-master.tsx` - Hidden Super Admin page
- `client/src/pages/login.tsx` - Principal login page
- `client/src/pages/admin-dashboard.tsx` - Admin dashboard with student management, teacher management, notices, calendar, leave approvals, gallery approvals, library management, timetable management, school settings
- `client/src/pages/register.tsx` - Student activation
- `client/src/pages/student-login.tsx` - Student login
- `client/src/pages/student-dashboard.tsx` - Student dashboard with digital ID card
- `client/src/pages/teacher-login.tsx` - Teacher login with first-login password change
- `client/src/pages/teacher-dashboard.tsx` - Teacher dashboard with 13-module grid and module routing
- `client/src/pages/teacher-modules/` - 13 module pages (profile, attendance, homework, classwork, noticeboard, complaint, examination, gallery, faculty-info, calendar, library, leave, timetable)

## Database Tables
- **schools**: id, name, code (unique)
- **users**: id, email (unique), password_hash, role (admin/teacher), school_id
- **students**: id, school_id, digital_student_id (unique), name, class, section, phone, dob, password_hash, photo_url, is_activated
- **teachers**: id, user_id, school_id, full_name, phone, subject, assigned_class, assigned_section, must_change_password, otp_code, otp_expires_at, reset_token, reset_token_expires_at
- **attendance_records**: id, student_id, teacher_id, school_id, date, status, edit_count, marked_by, marked_at
- **homework**: id, teacher_id, school_id, class, section, subject, content, file_url, due_date, created_at
- **homework_views**: id, homework_id, student_id, viewed_at
- **classwork**: id, teacher_id, school_id, class, section, subject, content, file_url, created_at
- **notices**: id, school_id, created_by_id, creator_role, target_type, target_class, target_section, notice_type, content, file_url, created_at
- **complaints**: id, ticket_id, teacher_id, student_id (nullable), school_id, complaint_type, status, content, reported_student_name, file_url, is_deleted, created_at
- **complaint_notes**: id, complaint_id, author_id, author_role, author_name, content, created_at
- **exam_scores**: id, student_id, teacher_id, school_id, subject, exam_type, marks, total_marks, is_absent, created_at
- **gallery_items**: id, school_id, uploaded_by_id, title, image_url, approved, created_at
- **calendar_events**: id, school_id, title, date, event_type
- **library_books**: id, school_id, title, author, isbn, total_copies, available_copies
- **book_borrows**: id, book_id, borrower_id, borrower_type, school_id, borrowed_at, returned_at
- **leave_requests**: id, teacher_id, school_id, leave_type, start_date, end_date, reason, status, created_at
- **timetable_entries**: id, teacher_id, school_id, day_of_week, period, class, section, subject
- **school_metadata**: id, school_id, meta_key (unique per school), meta_value (JSON array string), updated_at

## Multi-Tenant Global Configuration System
- Principal configures school-specific master lists via School Settings panel in admin dashboard
- 4 configurable keys: `classes`, `sections`, `subjects`, `exam_types` (stored as JSON arrays in school_metadata)
- Admin routes: `GET /api/school-metadata/:schoolId`, `PUT /api/school-metadata/:schoolId/:metaKey` (admin-only, role checked)
- Teacher read-only route: `GET /api/school-config/:schoolId` returns parsed config
- `useSchoolConfig(schoolId)` hook provides dynamic dropdowns with fallback to hardcoded values
- Examination, Homework, Classwork, Attendance, Noticeboard modules use dynamic dropdowns from school config
- If school config is empty, fallback values used: classes (L.K.G-12), sections (A-Z), exam types (UT1-Annual)

## Discipline & Resolution Hub (Complaints)
- 3 complaint types: teacher-to-student, student-to-student, teacher-to-admin
- Auto-generated ticket IDs: #DISC-YYYY-NNN (sequential per school)
- Status governance: Pending (red) → Investigating (orange) → Resolved (green)
- Edit/delete locked after Pending status
- Soft delete (isDeleted flag)
- Resolution Thread: expandable notes per complaint
- Live student search with debounce (300ms, min 2 chars)
- Mini-profile card after student selection (photo/initials, name, DSID, class)
- S2S privacy: student-to-student complaints visible to teachers of same class/section (with schoolId filter for multi-tenant isolation)
- Student search endpoint: `GET /api/students/search/:schoolId?q=...`

## Examination & Performance Engine
- Add Marks tab: spreadsheet grid, Tab-key nav, real-time % and grade (A+→F), absent toggle, red border guardrail, class average row
- View Marks tab: results table, click student for inline timeline
- StudentTimeline: dual-line recharts LineChart (student % vs class average %), 360° academic history across all subjects
- Grade scale: A+≥90, A≥80, B+≥70, B≥60, C+≥50, C≥40, D≥33, F<33
- Exam types: configurable via school metadata (fallback: UT1, UT2, Mid-term, UT3, Pre-Final, Annual)
- Class average endpoint: `GET /api/exam-scores/class-average/:schoolId/:class/:section/:subject`

## Key Routes
- `/` - Public home page
- `/super-master` - Hidden Super Admin panel
- `/login` - Principal login
- `/admin-dashboard` - Admin dashboard (protected)
- `/register` - Student activation page
- `/student-login` - Student login page
- `/student-dashboard` - Student dashboard (protected)
- `/teacher-login` - Teacher login with first-login password change
- `/teacher-dashboard` - Teacher dashboard with 13-module grid (protected)
- `/teacher-dashboard/:module` - Individual teacher module pages

## Teacher Module Features
1. **Profile** - View personal info
2. **Attendance** - Enhanced multi-level module with premium EdTech UI
3. **Homework** - Enhanced EdTech module with social-feed cards, due dates, view tracking
4. **Classwork** - "Class Activity / Lesson Log" module (mirrors Homework UI, no due date)
5. **Noticeboard** - Smart targeting (specific section, entire class, class range, whole school), 5+ notice types (merged from school config)
6. **Complaint** - "Discipline & Resolution Hub" with ticketing, live search, mini-profile, resolution threads
7. **Examination** - "Examination & Performance Engine" with spreadsheet grid, dual-line charts, 360° history
8. **Gallery** - View school gallery, upload images for approval
9. **Faculty Info** - Browse staff directory
10. **Calendar** - View color-coded school calendar
11. **Library** - Search books, borrow/return
12. **Leave** - Apply for leave, track status
13. **Timetable** - View weekly schedule

## Security
- Admin metadata routes enforce `userRole === "admin"` (teachers cannot modify school config)
- Teacher endpoints require `req.session.teacherId`
- School ownership verified on all data queries (WHERE school_id = current_user.school_id)
- Complaint PATCH/DELETE check ownership + Pending status
- Complaint notes/status check school ownership
- Exam endpoints validate teacher's schoolId
- bcryptjs password hashing, no plaintext passwords stored

## Global Standards
- Date format: dd/mm/yyyy (`toLocaleDateString("en-GB")`) across entire app
- UI: EdTech aesthetic (white cards, rounded-2xl, shadow-lg, gradient buttons)
- All interactive elements have `data-testid` attributes

## Running
- `npm run dev` starts both Express backend and Vite frontend dev server
- `npm run db:push` pushes schema changes to PostgreSQL
