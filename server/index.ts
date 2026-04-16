import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";
import path from "path";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "benius-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: false,
    },
  }),
);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // ===== DB MIGRATIONS (safe, idempotent) =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      full_name TEXT,
      class VARCHAR(20),
      section VARCHAR(10),
      roll_no VARCHAR(20),
      father_name TEXT,
      mother_name TEXT,
      present_address TEXT,
      photo_url TEXT,
      photo_status VARCHAR(20) NOT NULL DEFAULT 'none',
      rejection_note TEXT,
      submitted_at TIMESTAMP,
      verified_at TIMESTAMP,
      verified_by INTEGER,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_date DATE;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS verified_profile TEXT;
    ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS approved_snapshot TEXT;
  `);

  await pool.query(`
    ALTER TABLE exam_scores ADD COLUMN IF NOT EXISTS pass_marks INTEGER NOT NULL DEFAULT 33;
    ALTER TABLE exam_scores ADD COLUMN IF NOT EXISTS class TEXT;
    ALTER TABLE exam_scores ADD COLUMN IF NOT EXISTS section TEXT;
    ALTER TABLE exam_scores ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS complainant_student_id INTEGER REFERENCES students(id) ON DELETE CASCADE;
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS contact_number TEXT;
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS suggestions TEXT;
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS incident_date TIMESTAMP;
    ALTER TABLE complaints ALTER COLUMN teacher_id DROP NOT NULL;
  `);

  await pool.query(`
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS designation TEXT;
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS qualifications TEXT;
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS department TEXT;
  `);

  await pool.query(`
    ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS venue TEXT;
    ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS start_time TEXT;
    ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS end_time TEXT;
    ALTER TABLE student_leave_requests ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE student_leave_requests ADD COLUMN IF NOT EXISTS attachment_url TEXT;
    ALTER TABLE student_leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
  `);

  await pool.query(`
    ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
    ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS room TEXT;
    CREATE TABLE IF NOT EXISTS teacher_allocations (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      class VARCHAR(20) NOT NULL,
      section VARCHAR(10) NOT NULL,
      weekly_quota INTEGER NOT NULL DEFAULT 6
    );
  `);

  await pool.query(`
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS complainant_class VARCHAR(20);
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS complainant_section VARCHAR(10);
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS resolution_remarks TEXT;
    ALTER TABLE complaints ADD COLUMN IF NOT EXISTS escalated_to_principal BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS timetable_class_slot_unique
      ON timetable_entries (school_id, class, section, day_of_week, period);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS school_assets (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      asset_code VARCHAR(20) NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT 'Good',
      location TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS asset_logs (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      snapshot TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_phone VARCHAR(20);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_initialized BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMP;
    CREATE TABLE IF NOT EXISTS security_audit (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      school_id INTEGER,
      action VARCHAR(50) NOT NULL DEFAULT 'unknown',
      success BOOLEAN NOT NULL DEFAULT TRUE,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE security_audit ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE security_audit ADD COLUMN IF NOT EXISTS action VARCHAR(50);
    ALTER TABLE security_audit ALTER COLUMN user_id DROP NOT NULL;
    ALTER TABLE security_audit ALTER COLUMN school_id DROP NOT NULL;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='security_audit' AND column_name='event_type') THEN
        UPDATE security_audit SET action = event_type WHERE action IS NULL;
      END IF;
    END $$;
    UPDATE security_audit SET action = 'unknown' WHERE action IS NULL;
  `);

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
