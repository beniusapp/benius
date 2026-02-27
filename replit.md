# BENIUS - School Management System

## Overview
A school management platform with Super Admin functionality to manage schools and students, with principal login and admin dashboard.

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS, Shadcn UI, Wouter (routing), TanStack React Query
- **Backend**: Express.js, PostgreSQL, Drizzle ORM, bcryptjs (password hashing), express-session + connect-pg-simple (sessions)
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
- `client/src/pages/admin-dashboard.tsx` - Admin dashboard (post-login)

## Database Tables
- **schools**: id (serial PK), name, code (unique)
- **users**: id (serial PK), email (unique), password_hash, role (default 'admin'), school_id (FK to schools, cascade delete)
- **students**: id (serial PK), school_id (FK to schools, cascade delete), digital_student_id (unique), name, class, section, phone, dob, password_hash, is_activated

## Key Routes
- `/` - Public home page
- `/super-master` - Hidden Super Admin panel (not linked from navigation)
- `/login` - Principal login
- `/admin-dashboard` - Admin dashboard (protected, redirects to /login if unauthenticated)

## API Endpoints
- `GET /api/schools` - List all schools
- `POST /api/schools` - Create a school + principal account (name, code, principalEmail, principalPassword)
- `DELETE /api/schools/:id` - Delete school (cascades to users + students)
- `POST /api/login` - Authenticate principal (email, password)
- `GET /api/me` - Get current authenticated user info
- `POST /api/logout` - End session

## Running
- `npm run dev` starts both Express backend and Vite frontend dev server
- `npm run db:push` pushes schema changes to PostgreSQL
