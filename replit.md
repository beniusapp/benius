# BENIUS - Multi-Tenant School Management System

## Overview
BENIUS is an enterprise-grade, multi-tenant school management system designed to streamline administrative tasks and enhance communication within educational institutions. It provides distinct portals for Super Admins (for school provisioning), Principals/Admins (a comprehensive command center), Teachers (a module-rich EdTech interface), and Students (a self-service dashboard). The platform aims to modernize school operations, improve data management, and foster a connected educational ecosystem, serving a wide market of K-12 and higher education institutions.

## User Preferences
I want iterative development. Ask before making major changes. I like detailed explanations.

## System Architecture
The system is built on a full-stack architecture using React + Vite for the frontend, styled with Tailwind CSS and Shadcn UI, and Express.js for the backend. Data persistence is managed with PostgreSQL and Drizzle ORM, ensuring type safety with TypeScript across the stack.

**UI/UX Decisions:**
- **Admin Dashboard:** Features a "Navy & Gold Command Center" theme (bg=#0A1628, cards=#1A2942, gold=#D4AF37) with a "Live Pulse" header and 15 functional tiles grouped by Foundation, Oversight, Management, and Enterprise.
- **Teacher Dashboard:** Utilizes a "glassmorphic EdTech UI" aesthetic with 14 distinct modules.
- **Student Portal:** Features a 12-tile "Emerald dashboard".
- **Global Standards:** All dates are formatted as dd/mm/yyyy. recharts is used for analytics visualizations.

**Technical Implementations:**
- **Routing:** Wouter on the frontend.
- **State Management/Data Fetching:** TanStack React Query for efficient data handling.
- **Authentication:** `bcryptjs` for password hashing and `express-session` with `connect-pg-simple` for session management.
- **File Uploads:** `multer` is used for handling file uploads (e.g., student photos, homework submissions, gallery images, e-books).
- **Multi-Tenant Security:** All data access and operations are strictly scoped by `school_id`, ensuring schools only access their own data. Role-based access control is enforced for admin and teacher functionalities.
- **Multi-Tenant School Configuration:** Principals can configure school-specific master lists (classes, sections, subjects, exam types) stored as JSON in `school_metadata` and accessed dynamically via a `useSchoolConfig` hook with fallback defaults.
- **Secure Deactivation Workflow:** Implements a soft-delete mechanism (`is_active = false`) for students and teachers, ensuring data retention while preventing login. A "Double-Lock Security Modal" with admin password re-entry and reason selection is required for deactivation.
- **Student Profile & Data Verification System:** Students can submit and update their profiles, which then undergo a verification lifecycle (draft → pending → approved | rejected) by teachers. Photo uploads are supported.
- **Leave & Attendance Sync:** Teacher-approved student leaves automatically update attendance records. Student leave requests can be forwarded to the principal for approval.

**Feature Specifications:**
- **Admin Dashboard:** Includes modules for school setup, student/faculty management, approval center (for various pending items), audit logs, visitor logs, attendance overview, performance analytics, exam control, complaint hub, noticeboard, timetable management (with Bell Structure + Schedule Grid tabs), and **School Calendar** (event CRUD + Indian holiday auto-seeder). Supports server-side pagination for large datasets.
- **Staff Management System (Task #47):** Three dedicated modules under Management: (1) **Teacher Registry** — full CRUD for teaching staff with paginated search, Add/Edit/Delete modals, links to school config for class/section/subject dropdowns; (2) **Non-Teaching Staff Registry** — register admin, security, accounts, and other support staff with designation presets (including custom free-text "Other") and full CRUD; (3) **Faculty Mapping (refactored)** — assignment-only view with teacher picker, multi-class/section checkbox grid with row/column toggles, save mappings via POST /api/admin/faculty-mappings, and a summary table. DB tables: `non_teaching_staff` and `faculty_mappings`. Each mapping now includes a nullable `subject` column so admins can assign a specific subject per class-section cell. Clicking a cell to toggle it on opens a subject picker dialog (quick-select from school config subjects or free-text input); hovering an assigned cell shows the subject via tooltip. The summary table displays compact assignment badges with class-section and subject side by side.
- **Teacher Dashboard:** Provides modules for profile management, attendance marking, homework/classwork assignment and tracking, notice creation, complaint resolution, exam score entry and analysis, gallery uploads, calendar viewing (month-view with per-event color codes, from `/api/teacher/calendar`), library catalog interaction, leave management (personal and student leave requests), timetable viewing (dark navy, structure-based period rows with break support), and student profile verification.
- **Student Portal:** Allows students to activate accounts, log in, view their dashboard, manage their profile (including photo upload and verification submission), view homework and classwork, submit homework, change their password, view the school calendar with color-coded event dots, and view their timetable (dark navy design with per-subject color coding and break rows from bell structure).
- **Bell Structure System:** Admins can configure a per-class daily period schedule (timetable_structure table: periodNumber, label, startTime, endTime, isBreak, sortOrder). Teacher and student timetable views dynamically use this structure to show time slots and breaks. API: GET/POST /api/timetable/structure.
- **Calendar Engine:** Multi-role calendar system. Admin can create/delete events with date range support, recurring events (stored as individual records for 10 years), and event types (holiday, academic, examination, event) with custom color codes. One-click seeder for Indian public holidays (fixed + variable) for 6 years. Teacher/student portals display the same calendar data read-only.

## External Dependencies
- **Frontend Frameworks:** React, Vite
- **Styling:** Tailwind CSS, Shadcn UI
- **Routing:** Wouter
- **Data Fetching:** TanStack React Query
- **Charting:** recharts
- **Backend Framework:** Express.js
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Authentication/Session Management:** bcryptjs, express-session, connect-pg-simple
- **File Uploads:** multer