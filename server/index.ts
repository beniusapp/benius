import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";
import { storage } from "./storage";
import cron from "node-cron";
import { recalculateLateFees } from "./late-fee-engine";
import { assertNoSchemaDrift } from "./schema-validator";
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
    ALTER TABLE exam_scores ADD COLUMN IF NOT EXISTS updated_by TEXT;
    ALTER TABLE exam_scores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promotion_decisions (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      class TEXT NOT NULL,
      section TEXT NOT NULL,
      term TEXT NOT NULL,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      decision TEXT NOT NULL DEFAULT 'promoted',
      target_class TEXT NOT NULL,
      target_section TEXT NOT NULL,
      edit_count INTEGER NOT NULL DEFAULT 0,
      processed_by_teacher_id INTEGER REFERENCES teachers(id),
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      locked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP,
      UNIQUE(school_id, class, section, term, student_id)
    );
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
    ALTER TABLE student_leave_requests ADD COLUMN IF NOT EXISTS admin_comment TEXT;
    ALTER TABLE student_leave_requests ADD COLUMN IF NOT EXISTS teacher_comment TEXT;
    ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS captured_date TEXT;
    ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS captured_time TEXT;
    ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS location TEXT;
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
        ALTER TABLE security_audit ALTER COLUMN event_type DROP NOT NULL;
        ALTER TABLE security_audit DROP COLUMN event_type;
      END IF;
    END $$;
    UPDATE security_audit SET action = 'unknown' WHERE action IS NULL;
    ALTER TABLE security_audit ALTER COLUMN action SET NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_policies (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      annual_limit INTEGER NOT NULL DEFAULT 12,
      target_roles TEXT NOT NULL DEFAULT 'all',
      renewal_month INTEGER NOT NULL DEFAULT 1,
      renewal_day INTEGER NOT NULL DEFAULT 1,
      expiry_behavior TEXT NOT NULL DEFAULT 'expire',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    INSERT INTO leave_policies (school_id, name, annual_limit, target_roles, renewal_month, renewal_day, expiry_behavior, is_active)
    SELECT s.id, v.name, v.annual_limit, 'all', 1, 1, 'expire', TRUE
    FROM schools s
    CROSS JOIN (VALUES ('Sick Leave', 12), ('Casual Leave', 12), ('Earned Leave', 12)) AS v(name, annual_limit)
    WHERE NOT EXISTS (SELECT 1 FROM leave_policies lp WHERE lp.school_id = s.id);
  `);

  await pool.query(`
    ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS policy_id INTEGER REFERENCES leave_policies(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notice_reads (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      read_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (student_id, notice_id)
    );

    CREATE TABLE IF NOT EXISTS non_teaching_staff (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone VARCHAR(20) NOT NULL DEFAULT '',
      designation TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS faculty_mappings (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      class_name TEXT NOT NULL,
      section TEXT NOT NULL,
      subject TEXT,
      UNIQUE (school_id, teacher_id, class_name, section)
    );

    ALTER TABLE non_teaching_staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE non_teaching_staff ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE non_teaching_staff ADD COLUMN IF NOT EXISTS allowed_modules TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE faculty_mappings ADD COLUMN IF NOT EXISTS subject TEXT;

    -- Multi-tier leave approval: migrate legacy status values to named statuses
    UPDATE student_leave_requests SET status = 'pending_teacher'   WHERE status = 'pending';
    UPDATE student_leave_requests SET status = 'forwarded_to_admin' WHERE status = 'forwarded';

    CREATE TABLE IF NOT EXISTS exam_policy_tiers (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      tier_name TEXT NOT NULL,
      applicable_classes TEXT[] NOT NULL DEFAULT '{}',
      exam_weights TEXT NOT NULL DEFAULT '{}',
      promotion_fail_rules TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE exam_policy_tiers ADD COLUMN IF NOT EXISTS results_config TEXT NOT NULL DEFAULT '{}';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fee_structures (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      fee_type VARCHAR(100) NOT NULL,
      amount INTEGER NOT NULL,
      frequency VARCHAR(20) NOT NULL DEFAULT 'annual',
      applicable_classes TEXT[] NOT NULL DEFAULT '{}',
      concession_type VARCHAR(20) NOT NULL DEFAULT 'none',
      concession_percent INTEGER NOT NULL DEFAULT 0,
      due_day_of_month INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS payment_records (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      fee_record_id INTEGER REFERENCES fee_records(id) ON DELETE SET NULL,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      payment_method VARCHAR(30) NOT NULL,
      reference_number VARCHAR(100),
      received_date DATE NOT NULL,
      amount INTEGER NOT NULL,
      cashier_notes TEXT,
      idempotency_key VARCHAR(64) UNIQUE,
      recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fee_audit_log (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT,
      ip_address TEXT,
      action VARCHAR(50) NOT NULL,
      entity_type VARCHAR(50),
      entity_id INTEGER,
      student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS external_payment_settings (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      gateway_url TEXT,
      banner_message TEXT,
      max_overcollection_percent INTEGER NOT NULL DEFAULT 150,
      last_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE external_payment_settings ADD COLUMN IF NOT EXISTS max_overcollection_percent INTEGER NOT NULL DEFAULT 150;
    ALTER TABLE fee_records ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
    ALTER TABLE fee_records ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100);
    ALTER TABLE fee_records ADD COLUMN IF NOT EXISTS late_fee_amount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS late_fee_config JSONB;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS breakdown JSONB;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS auto_generate BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS auto_gen_due_day INTEGER;
    ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS last_invoices_generated_at TIMESTAMP;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS late_fee_paid INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES academic_sessions(id) ON DELETE SET NULL;
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_payment_records_school_session ON payment_records(school_id, session_id);
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(20);
    CREATE TABLE IF NOT EXISTS receipt_sequences (
      prefix VARCHAR(10) PRIMARY KEY,
      current_number INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS notification_config (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
      sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      msg91_auth_key TEXT,
      msg91_sender_id TEXT,
      wa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      msg91_wa_number TEXT,
      msg91_wa_template TEXT,
      email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      email_provider TEXT NOT NULL DEFAULT 'sendgrid',
      sendgrid_api_key TEXT,
      sendgrid_from_email TEXT,
      sendgrid_from_name TEXT,
      mailtrap_api_key TEXT,
      mailtrap_inbox_id TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE notification_config ADD COLUMN IF NOT EXISTS email_provider TEXT NOT NULL DEFAULT 'sendgrid';
    ALTER TABLE notification_config ADD COLUMN IF NOT EXISTS mailtrap_api_key TEXT;
    ALTER TABLE notification_config ADD COLUMN IF NOT EXISTS mailtrap_inbox_id TEXT;
    CREATE TABLE IF NOT EXISTS dunning_log (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL,
      fee_record_id INTEGER NOT NULL REFERENCES fee_records(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      stage TEXT NOT NULL,
      sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL,
      error_message TEXT,
      recipient TEXT,
      student_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dunning_log_school_fee ON dunning_log(school_id, fee_record_id);
    CREATE TABLE IF NOT EXISTS dunning_templates (
      id SERIAL PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      channel TEXT NOT NULL,
      body_text TEXT NOT NULL,
      subject_text TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS dunning_templates_school_stage_channel
      ON dunning_templates(school_id, stage, channel);
    -- Dunning job status — single global row (id=1) written by runDunningJob()
    CREATE TABLE IF NOT EXISTS dunning_job_status (
      id SERIAL PRIMARY KEY,
      is_running BOOLEAN NOT NULL DEFAULT false,
      started_at TIMESTAMP,
      last_completed_at TIMESTAMP
    );
    INSERT INTO dunning_job_status (id, is_running)
      VALUES (1, false)
      ON CONFLICT (id) DO NOTHING;
  `);

  // ── Report email schedule table ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_email_schedule (
      id              SERIAL PRIMARY KEY,
      school_id       INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
      enabled         BOOLEAN NOT NULL DEFAULT FALSE,
      recipients      TEXT[]  NOT NULL DEFAULT '{}',
      last_sent_at    TIMESTAMP,
      last_sent_month VARCHAR(7),
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE report_email_schedule ADD COLUMN IF NOT EXISTS last_sent_month VARCHAR(7);
  `);

  await pool.query(`
    ALTER TABLE fee_records ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(100);
    ALTER TABLE fee_records ADD COLUMN IF NOT EXISTS razorpay_order_expires_at TIMESTAMPTZ;
  `);

  // ── fee_audit_log: structured Razorpay payment-attempt fields ────────────
  // Each payment.failed / payment_cancelled event now stores every structured
  // field Razorpay provides — error_code, error_source, error_step,
  // error_reason, payment ID, order ID, amount, currency, payment_method, and
  // the full raw Razorpay response for audit.  session_id links the attempt
  // to the exact academic session.
  await pool.query(`
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS session_id         INTEGER REFERENCES academic_sessions(id) ON DELETE SET NULL;
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100);
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS razorpay_order_id   VARCHAR(100);
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS amount              INTEGER;
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS currency            VARCHAR(10) DEFAULT 'INR';
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS error_code          VARCHAR(100);
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS error_source        VARCHAR(100);
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS error_step          VARCHAR(100);
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS error_reason        VARCHAR(100);
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS payment_method      VARCHAR(50);
    ALTER TABLE fee_audit_log ADD COLUMN IF NOT EXISTS raw_response        JSONB;
  `);

  // ── payment_records extended columns (Razorpay enrichment + payer info) ──
  // Production-safe: ADD COLUMN IF NOT EXISTS never touches existing rows/data.
  await pool.query(`
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100);
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS razorpay_order_id   VARCHAR(100);
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS razorpay_signature  TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS payment_mode        TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS bank_name           TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS card_last4          TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS vpa                 TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS payer_name          TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS payer_email         TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS payer_contact       TEXT;
    ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS gateway_status      TEXT;
  `);

  // ── Reconcile orphaned Paid fee_records that have no payment_record ───────
  // Inserts a reconstructed payment_record for any fee_record that is Paid
  // (has a receipt_number) but has no matching row in payment_records.
  // Uses ON CONFLICT DO NOTHING on idempotency_key so this is safe to run on
  // every startup — it only fires once and is a no-op on all subsequent boots.
  await pool.query(`
    INSERT INTO payment_records
      (school_id, fee_record_id, student_id, session_id, payment_method,
       reference_number, razorpay_order_id, received_date, amount,
       cashier_notes, idempotency_key, receipt_number)
    SELECT
      fr.school_id,
      fr.id                   AS fee_record_id,
      fr.student_id,
      fr.session_id,
      'Online'                AS payment_method,
      COALESCE(fr.razorpay_order_id, 'reconstructed') AS reference_number,
      fr.razorpay_order_id,
      COALESCE(fr.paid_date::date, CURRENT_DATE) AS received_date,
      fr.amount,
      'Razorpay payment — reconstructed (webhook failed, order: ' || COALESCE(fr.razorpay_order_id,'unknown') || ')' AS cashier_notes,
      'rzp_reconstructed_' || fr.receipt_number AS idempotency_key,
      fr.receipt_number
    FROM fee_records fr
    WHERE fr.status = 'Paid'
      AND fr.receipt_number LIKE 'ON%'
      AND NOT EXISTS (
        SELECT 1 FROM payment_records pr
        WHERE pr.fee_record_id = fr.id AND pr.school_id = fr.school_id
      )
    ON CONFLICT (idempotency_key) DO NOTHING
  `);

  // Back-fill session_id on existing payment_records that are linked to a fee_record
  // (safe to run on every startup — only touches rows where session_id IS NULL)
  await pool.query(`
    UPDATE payment_records pr
    SET session_id = fr.session_id
    FROM fee_records fr
    WHERE pr.fee_record_id = fr.id
      AND pr.session_id IS NULL
      AND fr.session_id IS NOT NULL
  `);

  // ── payment_attempts: unified payment-attempt ledger ─────────────────────
  // Every Razorpay interaction (captured, failed, cancelled, authorized) gets
  // a permanent row here.  This is the authoritative source for the student
  // History tab.  payment_records stays as the receipt/ledger table;
  // fee_audit_log stays for general audit events.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id                    SERIAL PRIMARY KEY,
      school_id             INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id            INTEGER REFERENCES students(id) ON DELETE SET NULL,
      fee_record_id         INTEGER,
      session_id            INTEGER,
      outcome               VARCHAR(20) NOT NULL DEFAULT 'pending',
      razorpay_payment_id   VARCHAR(100),
      razorpay_order_id     VARCHAR(100),
      amount_paise          INTEGER,
      currency              VARCHAR(10)  DEFAULT 'INR',
      amount_captured_paise INTEGER,
      amount_refunded_paise INTEGER,
      razorpay_fee_paise    INTEGER,
      razorpay_tax_paise    INTEGER,
      payment_method        VARCHAR(50),
      card_network          VARCHAR(50),
      card_last4            VARCHAR(4),
      card_type             VARCHAR(30),
      card_issuer           VARCHAR(100),
      card_name             VARCHAR(200),
      card_international    BOOLEAN,
      card_emi              BOOLEAN,
      bank_name             VARCHAR(100),
      bank_rrn              VARCHAR(100),
      bank_auth_code        VARCHAR(100),
      vpa                   VARCHAR(100),
      wallet                VARCHAR(50),
      payer_name            VARCHAR(200),
      payer_email           VARCHAR(255),
      payer_contact         VARCHAR(20),
      error_code            VARCHAR(100),
      error_description     TEXT,
      error_source          VARCHAR(100),
      error_step            VARCHAR(100),
      error_reason          VARCHAR(100),
      rzp_created_at        TIMESTAMPTZ,
      rzp_authorized_at     TIMESTAMPTZ,
      rzp_captured_at       TIMESTAMPTZ,
      rzp_failed_at         TIMESTAMPTZ,
      refund_id             VARCHAR(100),
      refund_status         VARCHAR(30),
      refund_amount_paise   INTEGER,
      refund_initiated_at   TIMESTAMPTZ,
      refund_processed_at   TIMESTAMPTZ,
      webhook_event         VARCHAR(50),
      webhook_received_at   TIMESTAMPTZ,
      webhook_verified      BOOLEAN DEFAULT FALSE,
      webhook_payload       JSONB,
      api_synced_at         TIMESTAMPTZ,
      razorpay_payment_data JSONB,
      razorpay_order_data   JSONB,
      source                VARCHAR(20) DEFAULT 'client',
      receipt_number        VARCHAR(50),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Schema evolution: external_id column + index surgery ─────────────────
  // Must run in the same query BEFORE any statement that references external_id.
  // ADD COLUMN IF NOT EXISTS is idempotent — no-op on fresh installs where
  // external_id was already created by the CREATE TABLE above (which won't
  // reach here on fresh installs since the table didn't exist yet and the
  // CREATE TABLE already has the column).  On existing deployments that created
  // the table without this column, ALTER TABLE adds it here.
  //
  // pa_school_order_cancelled is dropped because it collapsed all same-order
  // retry cancellations into one row — that was the cause of the history data
  // loss bug.  external_id provides idempotent dedup instead.
  await pool.query(`
    ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS external_id VARCHAR(50);
    DROP INDEX IF EXISTS pa_school_order_cancelled;
    CREATE UNIQUE INDEX IF NOT EXISTS pa_school_payment_id
      ON payment_attempts(school_id, razorpay_payment_id)
      WHERE razorpay_payment_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS pa_school_external_id
      ON payment_attempts(school_id, external_id)
      WHERE external_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS pa_student_idx    ON payment_attempts(student_id, school_id);
    CREATE INDEX IF NOT EXISTS pa_fee_record_idx ON payment_attempts(fee_record_id);
  `);

  // ── Back-fill ALL payment_records (online + offline) ─────────────────────
  // external_id = 'pr:<id>' guarantees idempotency across server restarts.
  // Offline payments (OP-series, no razorpay_payment_id) are the majority —
  // the previous filter that excluded them was the main data-loss bug.
  await pool.query(`
    INSERT INTO payment_attempts (
      school_id, student_id, fee_record_id, session_id,
      outcome, razorpay_payment_id, razorpay_order_id,
      amount_paise, currency, payment_method,
      card_last4, bank_name, vpa, payer_email, payer_contact,
      receipt_number, external_id, source, created_at, updated_at
    )
    SELECT
      pr.school_id, pr.student_id, pr.fee_record_id, pr.session_id,
      'captured',
      pr.razorpay_payment_id,
      pr.razorpay_order_id,
      pr.amount::integer * 100,
      'INR',
      COALESCE(pr.payment_mode, 'offline'),
      pr.card_last4, pr.bank_name, pr.vpa, pr.payer_email, pr.payer_contact,
      pr.receipt_number,
      'pr:' || pr.id,
      'migrated',
      pr.created_at,
      NOW()
    FROM payment_records pr
    ON CONFLICT DO NOTHING
  `);

  // ── Back-fill failed / cancelled attempts from fee_audit_log ─────────────
  // external_id = 'fal:<id>' lets every distinct audit-log row become its own
  // payment_attempts row, including multiple retries on the same Razorpay order.
  // The previous pa_school_order_cancelled unique index collapsed all same-order
  // cancellations into one — that was the second data-loss bug.
  await pool.query(`
    INSERT INTO payment_attempts (
      school_id, student_id, fee_record_id, session_id,
      outcome, razorpay_payment_id, razorpay_order_id,
      amount_paise, currency, payment_method,
      error_code, error_description, error_source, error_step, error_reason,
      webhook_payload, external_id, source, created_at, updated_at
    )
    SELECT
      al.school_id,
      COALESCE(al.student_id, fr.student_id),
      al.entity_id::integer,
      COALESCE(al.session_id, fr.session_id),
      CASE WHEN al.action = 'payment_cancelled' THEN 'cancelled' ELSE 'failed' END,
      al.razorpay_payment_id,
      al.razorpay_order_id,
      COALESCE(fr.amount::integer * 100, al.amount),
      COALESCE(al.currency, 'INR'),
      al.payment_method,
      al.error_code,
      al.description,
      al.error_source,
      al.error_step,
      al.error_reason,
      al.raw_response,
      'fal:' || al.id,
      'migrated',
      al.created_at,
      NOW()
    FROM fee_audit_log al
    LEFT JOIN fee_records fr ON fr.id = al.entity_id::integer
    WHERE al.action IN ('payment_failed', 'payment_cancelled')
      AND al.entity_type = 'fee_record'
      AND al.entity_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  // ── School columns ────────────────────────────────────────────────────────
  await pool.query(`
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS address_line1 TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS address_line2 TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS state TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS pin_code VARCHAR(6);
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India';
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS website TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS board TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_type TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS affiliation_number TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS udise_code TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS established_year INTEGER;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS registration_number TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS pan TEXT;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS gstin TEXT;
  `);

  // ── Principal signature column ────────────────────────────────────────────
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_url TEXT;
  `);

  // ── Schema drift guard ────────────────────────────────────────────────────
  // Verifies that every column defined in shared/schema.ts actually exists in
  // the database AFTER all migration statements above have been applied.
  // If any column is missing the server exits with code 1 so the deployment
  // health check fails loudly instead of letting a silent crash reach callers.
  //
  // RULE: whenever you add a column to shared/schema.ts you MUST also add a
  // matching `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statement to the
  // migration block above.  This check enforces that rule at every startup.
  await assertNoSchemaDrift(pool);

  await registerRoutes(httpServer, app);

  // ===== HOURLY DUNNING JOB (SMS / WhatsApp / Email) =====
  // Runs at :05 past every hour. Idempotent — skips already-sent (fee, channel, stage) triplets.
  const { runDunningJob } = await import("./dunning");
  cron.schedule("5 * * * *", async () => {
    log("Dunning job starting…", "cron");
    try { await runDunningJob(); }
    catch (err) { log(`Dunning job error: ${String(err)}`, "cron"); }
  });
  // Also run once on startup to catch any fees that fell due during downtime
  runDunningJob().catch(err => log(`Dunning startup run error: ${String(err)}`, "cron"));

  // ===== MONTHLY AUTO-INVOICE GENERATION =====
  // Runs at 06:00 on the 1st of every month.
  // For every school, finds all active fee structures with autoGenerate=true,
  // then generates invoices for eligible enrolled students (respecting applicableClasses).
  // Writes one audit-log entry per structure summarising created/skipped counts.
  async function runMonthlyAutoInvoice() {
    log("Monthly auto-invoice job starting…", "cron");
    try {
      const allSchools = await storage.getSchools();
      for (const school of allSchools) {
        const structures = await storage.getFeeStructuresBySchool(school.id);
        // Strict double-check: both autoGenerate AND isActive must be explicitly true.
        // Boolean() coercion guards against "true" string from driver edge cases.
        const autoStructures = structures.filter(
          (s: any) => Boolean(s.autoGenerate) === true && Boolean(s.isActive) === true,
        );
        if (autoStructures.length === 0) continue;

        // Use the school's active session
        const activeSession = await storage.getActiveSession(school.id);
        if (!activeSession) {
          log(`School ${school.id}: no active session — skipping`, "cron");
          continue;
        }

        // Student Registry is global/session-independent — use it as the source of truth.
        // Any active student matching applicableClasses gets an invoice regardless of
        // whether they have a session-enrollment row.
        const allActiveStudents = await storage.getStudentsBySchool(school.id);
        const schoolRoster = allActiveStudents
          .filter((s: any) => s.class && s.section)
          .map((s: any) => ({ studentId: s.id, className: s.class as string, sectionName: s.section as string }));
        const existingRecords = await storage.getFeeRecordsBySchool(school.id, { sessionId: activeSession.id });

        for (const structure of autoStructures) {
          const applicableClasses: string[] = (structure as any).applicableClasses ?? [];
          const eligible = applicableClasses.length > 0
            ? schoolRoster.filter((e: any) => applicableClasses.includes(e.className))
            : schoolRoster;

          // Due date: use autoGenDueDay if set, otherwise dueDayOfMonth, otherwise 10th
          const dueDay: number = (structure as any).autoGenDueDay ?? (structure as any).dueDayOfMonth ?? 10;
          const now = new Date();
          const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(Math.min(dueDay, 28)).padStart(2, "0")}`;

          const existingSet = new Set(existingRecords.map((r: any) => `${r.studentId}:${r.feeType}:${String(r.dueDate).slice(0, 7)}`));

          let created = 0, skipped = 0;
          for (const enrollment of eligible) {
            // Key includes year-month so we don't skip a new month's invoice just because last month exists
            const key = `${enrollment.studentId}:${structure.feeType}:${dueDate.slice(0, 7)}`;
            if (existingSet.has(key)) { skipped++; continue; }
            await storage.createFeeRecord({
              schoolId: school.id,
              studentId: enrollment.studentId,
              sessionId: activeSession.id,
              feeType: structure.feeType,
              amount: structure.amount,
              dueDate,
              status: "Due",
              notes: `Auto-generated on ${now.toLocaleDateString("en-IN")} from fee structure: ${structure.name}`,
            });
            created++;
          }

          await storage.appendFeeAuditLog({
            schoolId: school.id,
            actorId: null,
            actorName: "System (auto)",
            ipAddress: null,
            action: "auto_invoice",
            entityType: "fee_structure",
            entityId: structure.id,
            description: `Auto-invoice run for "${structure.name}" (${structure.feeType}): ${created} created, ${skipped} skipped — due ${dueDate}`,
          });

          log(`School ${school.id} | "${structure.name}": ${created} invoices created, ${skipped} skipped`, "cron");
        }
      }
      log("Monthly auto-invoice job complete", "cron");
    } catch (err) {
      log(`Monthly auto-invoice job error: ${String(err)}`, "cron");
    }
  }

  // Run at 06:00 on the 1st of every month
  cron.schedule("0 6 1 * *", runMonthlyAutoInvoice);
  log("Monthly auto-invoice job scheduled (06:00 on 1st of each month)", "cron");

  // ===== MONTHLY ANALYTICS REPORT EMAIL =====
  // Runs at 08:00 on days 28-31. Checks if today is the last day of the month
  // before sending, so it fires exactly once per month regardless of month length.
  const { runMonthlyAnalyticsReport } = await import("./analytics-report");
  cron.schedule("0 8 28-31 * *", async () => {
    // Only proceed if today is the last day of this month
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    if (tomorrow.getDate() !== 1) return; // not the last day
    log("Monthly analytics report job triggering…", "cron");
    await runMonthlyAnalyticsReport();
  });
  log("Monthly analytics report job scheduled (08:00 on last day of each month)", "cron");

  // ===== NIGHTLY OVERDUE-FEE SWEEP =====
  // Runs at 01:00 every night. Marks all "Due" fee records whose due_date has
  // passed as "Overdue" and writes an audit log entry for each change.
  cron.schedule("0 1 * * *", async () => {
    log("Nightly overdue-fee sweep starting…", "cron");
    try {
      const allSchools = await storage.getSchools();
      let totalUpdated = 0;
      for (const school of allSchools) {
        const updated = await storage.bulkUpdateOverdueFeeRecords(school.id);
        if (updated.length === 0) continue;
        totalUpdated += updated.length;
        for (const rec of updated) {
          await storage.appendFeeAuditLog({
            schoolId: school.id,
            actorId: null,
            actorName: "System (auto)",
            ipAddress: null,
            action: "auto_overdue",
            entityType: "fee_record",
            entityId: rec.id,
            description: `Fee record #${rec.id} (${rec.feeType}, ₹${rec.amount}) automatically marked Overdue — due date was ${rec.dueDate}`,
          });
        }
      }
      log(`Overdue sweep complete: ${totalUpdated} record(s) updated across ${allSchools.length} school(s)`, "cron");

      // After status sweep, recalculate stored late-fee amounts for every school
      let lfTotal = 0;
      for (const school of allSchools) {
        try {
          const n = await recalculateLateFees(school.id);
          lfTotal += n;
        } catch { /* non-critical per school */ }
      }
      if (lfTotal > 0) log(`Late fee recalc: ${lfTotal} invoice(s) updated`, "cron");
    } catch (err) {
      log(`Overdue sweep error: ${String(err)}`, "cron");
    }
  });

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

  // ── Daily overdue fee sweep ────────────────────────────────────────────────
  // Marks any "Due" fee record whose due_date is in the past as "Overdue".
  // Runs once on startup (catches records missed during downtime) then every 24 h.
  async function runOverdueFeeCheck() {
    try {
      const flagged = await storage.markOverdueFeeRecords();
      if (flagged > 0) log(`[fees] overdue sweep: ${flagged} record(s) marked Overdue`);
    } catch (e) {
      console.error("[fees] overdue sweep failed:", e);
    }
  }
  runOverdueFeeCheck();
  setInterval(runOverdueFeeCheck, 24 * 60 * 60 * 1000);
})();
