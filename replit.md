# BENIUS - School Management System

## Overview
A school management platform with Super Admin functionality to manage schools and students.

## Tech Stack
- **Frontend**: React + Vite, Tailwind CSS, Shadcn UI, Wouter (routing), TanStack React Query
- **Backend**: Express.js, PostgreSQL, Drizzle ORM
- **Language**: TypeScript

## Project Structure
- `shared/schema.ts` - Drizzle database models (schools, students) and Zod schemas
- `server/db.ts` - Database connection pool
- `server/storage.ts` - DatabaseStorage class implementing IStorage interface
- `server/routes.ts` - Express API routes (`/api/schools`)
- `client/src/pages/home.tsx` - Public landing page
- `client/src/pages/super-master.tsx` - Hidden Super Admin page (not linked from UI)

## Database Tables
- **schools**: id (serial), name, code (unique)
- **students**: id (serial), school_id (FK), digital_student_id (unique), name, class, section, phone, dob, password_hash, is_activated

## Key Routes
- `/` - Public home page
- `/super-master` - Hidden Super Admin panel (not linked from navigation)
- `POST /api/schools` - Create a new school
- `GET /api/schools` - List all schools

## Running
- `npm run dev` starts both Express backend and Vite frontend dev server
- `npm run db:push` pushes schema changes to PostgreSQL
