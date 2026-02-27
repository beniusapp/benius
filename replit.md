# BENIUS - School Management System

## Overview
A school management platform with Super Admin functionality to manage schools and students, with principal login, admin dashboard, CSV/Excel bulk student upload, manual student creation, student self-activation, student login, and digital student ID cards.

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS, Shadcn UI, Wouter (routing), TanStack React Query
- **Backend**: Express.js, PostgreSQL, Drizzle ORM, bcryptjs (password hashing), express-session + connect-pg-simple (sessions), multer (file uploads), csv-parse + xlsx (file parsing)
- **Language**: TypeScript

## Project Structure
- `shared/schema.ts` - Drizzle database models (schools, users, students) and Zod schemas
- `server/db.ts` - Database connection pool
- `server/storage.ts` - DatabaseStorage class implementing IStorage interface
- `server/routes.ts` - Express API routes
- `server/index.ts` - Express server setup with session middleware
- `client/src/pages/home.tsx` - Public landing page
- `client/src/pages/super-master.tsx` - Hidden Super Admin page (not linked from UI)
- `client/src/pages/login.tsx` - Principal login page
- `client/src/pages/admin-dashboard.tsx` - Admin dashboard with student table, upload, and manual add form
- `client/src/pages/register.tsx` - Student activation (verify DSID+Phone+DOB, set password)
- `client/src/pages/student-login.tsx` - Student login (DSID + password)
- `client/src/pages/student-dashboard.tsx` - Student dashboard with welcome + digital ID card

## Database Tables
- **schools**: id (serial PK), name, code (unique)
- **users**: id (serial PK), email (unique), password_hash, role (default 'admin'), school_id (FK to schools, cascade delete)
- **students**: id (serial PK), school_id (FK to schools, cascade delete), digital_student_id (unique, format: CODE-NNNN), name, class, section, phone, dob, password_hash, is_activated

## Key Routes
- `/` - Public home page
- `/super-master` - Hidden Super Admin panel (not linked from navigation)
- `/login` - Principal login
- `/admin-dashboard` - Admin dashboard (protected, redirects to /login if unauthenticated)
- `/register` - Student activation page (verify identity, create password)
- `/student-login` - Student login page (DSID + password)
- `/student-dashboard` - Student dashboard (protected, redirects to /student-login if unauthenticated)

## API Endpoints
- `GET /api/schools` - List all schools
- `POST /api/schools` - Create a school + principal account (name, code, principalEmail, principalPassword)
- `DELETE /api/schools/:id` - Delete school (cascades to users + students)
- `POST /api/login` - Authenticate principal (email, password)
- `GET /api/me` - Get current authenticated user info (includes studentCount, schoolCode)
- `POST /api/logout` - End session
- `GET /api/schools/:schoolId/students` - List students for a school (authenticated)
- `POST /api/schools/:schoolId/students/upload` - Bulk upload students via CSV/Excel (multipart file)
- `POST /api/schools/:schoolId/students` - Manually add a single student (name, class, section, phone, dob)
- `POST /api/students/verify` - Verify student identity (dsid, phone, dob) for activation
- `POST /api/students/activate` - Activate student account (dsid, phone, dob, password)
- `POST /api/student-login` - Authenticate student (dsid, password)
- `GET /api/student-me` - Get current authenticated student info (includes schoolName)
- `POST /api/student-logout` - End student session

## DSID Generation
- Format: `{SCHOOL_CODE}-{SERIAL}` padded to 4 digits (e.g., MLS-0001)
- Serial is determined by finding the max existing serial for the school code
- Default password for new students is the hashed DSID
- All new students are created with is_activated = false

## Student Onboarding Flow
1. Principal adds students (manual form or CSV/Excel upload) → students created with is_activated=false
2. Student visits /register → enters DSID, Phone, DOB to verify identity
3. If verified, student creates their own password → is_activated flipped to true
4. Student logs in at /student-login with DSID + password → sees their dashboard with digital ID card

## Running
- `npm run dev` starts both Express backend and Vite frontend dev server
- `npm run db:push` pushes schema changes to PostgreSQL
