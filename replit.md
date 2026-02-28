# BENIUS - School Management System

## Overview
A school management platform with Super Admin functionality to manage schools, principal dashboard with student and teacher management, student self-activation, student login with digital ID cards, and a complete Teacher Module with 13 interactive sub-modules.

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS, Shadcn UI, Wouter (routing), TanStack React Query
- **Backend**: Express.js, PostgreSQL, Drizzle ORM, bcryptjs (password hashing), express-session + connect-pg-simple (sessions), multer (file uploads), csv-parse + xlsx (file parsing)
- **Language**: TypeScript

## Project Structure
- `shared/schema.ts` - Drizzle database models and Zod schemas (schools, users, students, teachers, attendance, homework, classwork, notices, complaints, examScores, galleryItems, calendarEvents, libraryBooks, bookBorrows, leaveRequests, timetableEntries)
- `server/db.ts` - Database connection pool
- `server/storage.ts` - DatabaseStorage class with all CRUD methods
- `server/routes.ts` - Express API routes for schools, students, principals
- `server/teacher-routes.ts` - Express API routes for teacher auth, attendance, homework, classwork, notices, complaints, exams, gallery, calendar, library, leave, timetable, faculty
- `server/index.ts` - Express server setup with session middleware and static file serving (/uploads)
- `client/src/pages/home.tsx` - Public landing page
- `client/src/pages/super-master.tsx` - Hidden Super Admin page
- `client/src/pages/login.tsx` - Principal login page
- `client/src/pages/admin-dashboard.tsx` - Admin dashboard with student management, teacher management, notices, calendar, leave approvals, gallery approvals, library management, timetable management
- `client/src/pages/register.tsx` - Student activation
- `client/src/pages/student-login.tsx` - Student login
- `client/src/pages/student-dashboard.tsx` - Student dashboard with digital ID card
- `client/src/pages/teacher-login.tsx` - Teacher login with first-login password change
- `client/src/pages/teacher-dashboard.tsx` - Teacher dashboard with 13-module grid and module routing
- `client/src/pages/teacher-modules/` - 13 module pages (profile, attendance, homework, classwork, noticeboard, complaint, examination, gallery, faculty-info, calendar, library, leave, timetable)

## Database Tables
- **schools**: id, name, code (unique)
- **users**: id, email (unique), password_hash, role (admin/teacher), school_id
- **students**: id, school_id, digital_student_id (unique), name, class, section, phone, dob, password_hash, is_activated
- **teachers**: id, user_id, school_id, full_name, phone, subject, assigned_class, assigned_section, must_change_password
- **attendance_records**: id, student_id, teacher_id, school_id, date, status, edit_count, marked_by, marked_at
- **homework**: id, teacher_id, school_id, class, section, content, file_url, created_at
- **classwork**: id, teacher_id, school_id, class, section, content, file_url, created_at
- **notices**: id, school_id, created_by_id, creator_role, target_type, target_class, target_section, content, file_url, created_at
- **complaints**: id, teacher_id, student_id, school_id, content, created_at
- **exam_scores**: id, student_id, teacher_id, school_id, subject, exam_type, marks, created_at
- **gallery_items**: id, school_id, uploaded_by_id, title, image_url, approved, created_at
- **calendar_events**: id, school_id, title, date, event_type
- **library_books**: id, school_id, title, author, isbn, total_copies, available_copies
- **book_borrows**: id, book_id, borrower_id, borrower_type, school_id, borrowed_at, returned_at
- **leave_requests**: id, teacher_id, school_id, leave_type, start_date, end_date, reason, status, created_at
- **timetable_entries**: id, teacher_id, school_id, day_of_week, period, class, section, subject

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
2. **Attendance** - Mark/edit class attendance (3-edit limit, 7-day window, audit trail, no future dates)
3. **Homework** - Post homework with file attachments
4. **Classwork** - Post classwork with file attachments
5. **Noticeboard** - Read admin notices, post notices to students
6. **Complaint** - File complaints against students
7. **Examination** - Enter exam scores (gradebook)
8. **Gallery** - View school gallery, upload images for approval
9. **Faculty Info** - Browse staff directory
10. **Calendar** - View color-coded school calendar
11. **Library** - Search books, borrow/return
12. **Leave** - Apply for leave, track status
13. **Timetable** - View weekly schedule

## Teacher First-Login Flow
1. Principal creates teacher with initial password
2. Teacher logs in → mustChangePassword flag triggers password change dialog
3. After changing password → redirected to teacher dashboard

## Attendance Rules
- No future dates
- 7-day edit window only
- 3 edits max per student per date
- Audit trail (teacher name + timestamp)

## Security
- Admin-only endpoints (calendar CRUD, leave approval, gallery approval, library CRUD, timetable CRUD, teacher list/delete) enforce `userRole !== "teacher"` checks
- Teacher endpoints require `req.session.teacherId`
- School ownership verified on teacher create and list endpoints
- bcryptjs password hashing, no plaintext passwords stored
- Query error states shown in UI for attendance, calendar, timetable modules

## Running
- `npm run dev` starts both Express backend and Vite frontend dev server
- `npm run db:push` pushes schema changes to PostgreSQL
