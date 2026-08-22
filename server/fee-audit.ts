import { and, eq, sql } from "drizzle-orm";
import { nonTeachingStaff, teachers, users } from "@shared/schema";
import { db } from "./db";
import { isIP } from "node:net";

export type FeeAuditActorType =
  | "principal"
  | "teacher"
  | "non_teaching_staff"
  | "student"
  | "system"
  | "payment_gateway"
  | "unknown";

export type FeeAuditActor = {
  actorId: number | null;
  actorTeacherId: number | null;
  actorStaffId: number | null;
  actorType: FeeAuditActorType;
  actorName: string;
  actorRole: string;
  actorIdentifier: string;
};

export type FeeAuditExecutor = {
  execute: (query: any) => Promise<any>;
};

export type FeeAuditInput = {
  schoolId: number;
  actor: FeeAuditActor;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  studentId?: number | null;
  studentName?: string | null;
  sessionId?: number | null;
  recordLabel?: string | null;
  eventKey?: string | null;
  amount?: number | null;
  currency?: string | null;
  description: string;
  ipAddress?: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  payment: "Payment Received",
  fifo_payment: "Payment Received",
  payment_successful: "Payment Received",
  payment_captured: "Payment Received",
  payment_failed: "Payment Failed",
  payment_cancelled: "Payment Cancelled",
  payment_authorized: "Payment Authorized",
  payment_blocked: "Payment Blocked",
  offline_payment_corrected: "Payment Corrected",
  refund_requested: "Refund Requested",
  refund_created: "Refund Requested",
  refund_processed: "Refund Processed",
  refund_failed: "Refund Failed",
  refund_reconciliation_required: "Refund Review Required",
  refund_superseded: "Refund Reconciled",
  refund_speed_changed: "Refund Updated",
  dispute_created: "Dispute Opened",
  dispute_won: "Dispute Won",
  dispute_lost: "Dispute Lost",
  dispute_updated: "Dispute Updated",
  dispute_closed: "Dispute Resolved",
  settings_change: "Settings Changed",
  update_notification_config: "Settings Changed",
  receipts_backfilled: "Receipts Backfilled",
  overdue: "Invoice Marked Overdue",
};

function titleCaseCode(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || "Activity Recorded";
}

export function feeAuditActionLabel(
  action: string,
  entityType?: string | null,
  entityId?: number | null,
): string {
  if (action === "create" && entityType === "fee_structure") return "Fee Structure Created";
  if (action === "update" && entityType === "fee_structure") return "Fee Structure Updated";
  if (action === "delete" && entityType === "fee_structure") return "Fee Structure Deleted";
  if (action === "create" && entityType === "fee_record") {
    return entityId == null ? "Invoices Generated" : "Invoice Created";
  }
  if (action === "update" && entityType === "fee_record") return "Invoice Updated";
  if (action === "delete" && entityType === "fee_record") {
    return entityId == null ? "Invoices Deleted" : "Invoice Deleted";
  }
  return ACTION_LABELS[action] ?? titleCaseCode(action);
}

export function cleanAuditText(value: unknown, maxLength = 1000): string | null {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function redactIpAddresses(text: string): string {
  const withoutBracketedIpv6 = text.replace(/\[([0-9A-Fa-f:.]+)\]/g, (match, candidate) =>
    isIP(candidate) === 6 ? "[IP address hidden]" : match,
  );
  const withoutIpv6 = withoutBracketedIpv6.replace(
    /(?<![A-Za-z0-9])([A-Fa-f0-9:.]*:[A-Fa-f0-9:.]+)(?![A-Za-z0-9])/g,
    (match) => {
      const trailing = match.match(/[.,;!?]+$/)?.[0] ?? "";
      const candidate = trailing ? match.slice(0, -trailing.length) : match;
      return isIP(candidate) === 6 ? `[IP address hidden]${trailing}` : match;
    },
  );
  return withoutIpv6.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP address hidden]");
}

function redactSensitiveAuditText(value: unknown, maxLength: number): string | null {
  const text = cleanAuditText(value, maxLength);
  if (!text) return null;
  return redactIpAddresses(text)
    .replace(/\b(?:pay|order|rfnd|disp|evt|plink|inv|cust|card)_[A-Za-z0-9_-]+\b/gi, "[provider reference hidden]")
    .replace(/\b(?:signature|token|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[credential hidden]")
    .replace(/\b(?:raw_response|payload|gateway_response|error_code|error_source|error_step|error_reason|payer_contact|payer_email|contact|phone|mobile|vpa|card_last4)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[technical field hidden]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email hidden]")
    .replace(/\b[A-Za-z0-9][A-Za-z0-9._-]{1,}@[A-Za-z][A-Za-z0-9.-]{1,}\b/g, "[payment address hidden]")
    .replace(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[phone hidden]")
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, "[account or card number hidden]")
    .replace(/\b(?:last\s*4|card)\s*[:#-]?\s*(?:\*{2,}|x{2,})?\d{4}\b/gi, "[card detail hidden]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[technical value hidden]")
    .replace(/\b[A-Za-z0-9+/_=-]{40,}\b/g, "[technical value hidden]");
}

export function safeFeeAuditRecordLabel(value: unknown): string | null {
  const label = redactSensitiveAuditText(value, 200);
  if (!label) return null;
  if (/[{[]/.test(label) && /["'][A-Za-z_][A-Za-z0-9_]*["']\s*:/.test(label)) {
    return "Record details hidden";
  }
  return label;
}

/**
 * Legacy rows sometimes embedded gateway identifiers in their prose. The
 * operational register exposes a safe summary only; detailed evidence remains
 * in Payment Attempts and Full Transaction Detail.
 */
export function safeFeeAuditDescription(input: {
  action: string;
  description: unknown;
  recordLabel?: string | null;
}): string {
  const record = safeFeeAuditRecordLabel(input.recordLabel) ?? "the selected record";
  const fixed: Record<string, string> = {
    payment_failed: `Online payment failed for ${record}. No payment was recorded.`,
    payment_authorized: `Online payment was authorized for ${record} and awaited capture.`,
    payment_cancelled: `Online checkout was cancelled for ${record}. No payment was recorded.`,
    refund_initiated: `A refund was accepted for processing for ${record}.`,
    refund_created: `A refund was accepted for processing for ${record}.`,
    refund_processed: `A refund was completed for ${record}.`,
    refund_failed: `A refund for ${record} could not be completed and requires review.`,
    refund_reconciliation_required: `A refund for ${record} could not be confirmed and requires reconciliation.`,
    refund_superseded: `A refund reservation for ${record} was reconciled without creating a duplicate refund.`,
    refund_updated: `Refund processing was updated for ${record}.`,
    refund_speed_changed: `Refund processing was updated for ${record}.`,
    dispute_created: `A payment dispute was opened for ${record}.`,
    dispute_won: `A payment dispute was resolved in the school's favour for ${record}.`,
    dispute_lost: `A payment dispute was resolved against the school for ${record}.`,
    dispute_updated: `A payment dispute was updated for ${record}.`,
  };
  if (fixed[input.action]) return fixed[input.action];

  const description = cleanAuditText(input.description, 1000) ?? "Activity recorded.";
  const technicalAction = /(payment|refund|dispute|gateway|webhook|razorpay|legacy)/i.test(input.action);
  const looksLikeRawPayload =
    /(?:^|[\s{,"])["']?(?:raw_response|payload|gateway_response|error_code|error_source|error_step|error_reason|payer_contact|payer_email|card_last4|vpa)["']?\s*[:=]/i.test(description)
    || (/[{[]/.test(description) && /["'][A-Za-z_][A-Za-z0-9_]*["']\s*:/.test(description));
  if (technicalAction && looksLikeRawPayload) {
    return `Payment gateway activity was recorded for ${record}. Detailed evidence is available in Full Transaction Detail.`;
  }

  return redactSensitiveAuditText(description, 1000) ?? "Activity recorded.";
}

function formatInternalId(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(4, "0")}`;
}

export const SYSTEM_FEE_AUDIT_ACTOR: FeeAuditActor = Object.freeze({
  actorId: null,
  actorTeacherId: null,
  actorStaffId: null,
  actorType: "system",
  actorName: "System",
  actorRole: "System",
  actorIdentifier: "SYSTEM",
});

export const RAZORPAY_FEE_AUDIT_ACTOR: FeeAuditActor = Object.freeze({
  actorId: null,
  actorTeacherId: null,
  actorStaffId: null,
  actorType: "payment_gateway",
  actorName: "Razorpay",
  actorRole: "Payment Gateway",
  actorIdentifier: "RAZORPAY",
});

export const UNKNOWN_FEE_AUDIT_ACTOR: FeeAuditActor = Object.freeze({
  actorId: null,
  actorTeacherId: null,
  actorStaffId: null,
  actorType: "unknown",
  actorName: "Unknown Actor",
  actorRole: "Unknown",
  actorIdentifier: "UNKNOWN",
});

/**
 * Resolves the authenticated actor from server-owned session state only.
 * Request bodies and query parameters are deliberately ignored.
 */
export async function resolveFeeAuditActor(req: any, schoolId: number): Promise<FeeAuditActor> {
  if (req.session?.userRole === "support_staff" && Number.isInteger(req.session.staffId)) {
    const [staff] = await db.select({
      id: nonTeachingStaff.id,
      schoolId: nonTeachingStaff.schoolId,
      fullName: nonTeachingStaff.fullName,
    }).from(nonTeachingStaff).where(and(
      eq(nonTeachingStaff.id, req.session.staffId),
      eq(nonTeachingStaff.schoolId, schoolId),
    ));
    if (!staff) return UNKNOWN_FEE_AUDIT_ACTOR;
    return {
      actorId: null,
      actorTeacherId: null,
      actorStaffId: staff.id,
      actorType: "non_teaching_staff",
      actorName: staff.fullName,
      actorRole: "Non-Teaching Staff",
      actorIdentifier: formatInternalId("NTS", staff.id),
    };
  }

  if (req.session?.userRole === "teacher" && Number.isInteger(req.session.teacherId)) {
    const [teacher] = await db.select({
      id: teachers.id,
      userId: teachers.userId,
      schoolId: teachers.schoolId,
      fullName: teachers.fullName,
      digitalTeacherId: teachers.digitalTeacherId,
    }).from(teachers).where(and(
      eq(teachers.id, req.session.teacherId),
      eq(teachers.schoolId, schoolId),
    ));
    if (!teacher || teacher.userId !== req.session.userId) return UNKNOWN_FEE_AUDIT_ACTOR;
    return {
      actorId: teacher.userId,
      actorTeacherId: teacher.id,
      actorStaffId: null,
      actorType: "teacher",
      actorName: teacher.fullName,
      actorRole: "Teacher",
      actorIdentifier: teacher.digitalTeacherId || formatInternalId("TCH", teacher.id),
    };
  }

  if (req.session?.userRole === "admin" && Number.isInteger(req.session.userId) && req.session.userId > 0) {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      role: users.role,
    }).from(users).where(and(
      eq(users.id, req.session.userId),
      eq(users.schoolId, schoolId),
      eq(users.role, "admin"),
    ));
    if (!user) return UNKNOWN_FEE_AUDIT_ACTOR;
    return {
      actorId: user.id,
      actorTeacherId: null,
      actorStaffId: null,
      actorType: "principal",
      actorName: user.email,
      actorRole: "Principal",
      actorIdentifier: formatInternalId("USR", user.id),
    };
  }

  return UNKNOWN_FEE_AUDIT_ACTOR;
}

export function requestIpAddress(req: any): string | null {
  const forwarded = req.headers?.["x-forwarded-for"] as string | string[] | undefined;
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return cleanAuditText(first?.trim() ?? req.socket?.remoteAddress ?? null, 120);
}

/**
 * Inserts one operational audit event. It never catches its own errors: callers
 * performing a financial mutation must let the surrounding transaction roll back.
 */
export async function appendFeeAudit(
  input: FeeAuditInput,
  executor: FeeAuditExecutor = db,
): Promise<number> {
  const result = await executor.execute(sql`
    INSERT INTO fee_audit_log (
      school_id, actor_id, actor_teacher_id, actor_staff_id, actor_type,
      actor_name, actor_role, actor_identifier, ip_address, action,
      entity_type, entity_id, student_id, student_name, session_id,
      record_label, event_key, amount, currency, description, created_at
    ) VALUES (
      ${input.schoolId}, ${input.actor.actorId}, ${input.actor.actorTeacherId},
      ${input.actor.actorStaffId}, ${input.actor.actorType},
      ${cleanAuditText(input.actor.actorName, 200) ?? "Unknown Actor"},
      ${cleanAuditText(input.actor.actorRole, 80) ?? "Unknown"},
      ${cleanAuditText(input.actor.actorIdentifier, 100) ?? "UNKNOWN"},
      ${cleanAuditText(input.ipAddress, 120)}, ${cleanAuditText(input.action, 50) ?? "activity"},
      ${cleanAuditText(input.entityType, 50)}, ${input.entityId ?? null},
      ${input.studentId ?? null}, ${cleanAuditText(input.studentName, 200)},
      ${input.sessionId ?? null}, ${cleanAuditText(input.recordLabel, 200)},
      ${cleanAuditText(input.eventKey, 200)},
      ${input.amount ?? null}, ${cleanAuditText(input.currency, 10) ?? "INR"},
      ${cleanAuditText(input.description, 1000) ?? "Activity recorded."}, NOW()
    )
    ON CONFLICT (school_id, event_key) WHERE event_key IS NOT NULL DO NOTHING
    RETURNING id
  `);
  let id = Number((result.rows[0] as any)?.id);
  if ((!Number.isSafeInteger(id) || id <= 0) && input.eventKey) {
    const existing = await executor.execute(sql`
      SELECT id FROM fee_audit_log
      WHERE school_id = ${input.schoolId}
        AND event_key = ${cleanAuditText(input.eventKey, 200)}
      LIMIT 1
    `);
    id = Number((existing.rows[0] as any)?.id);
  }
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Audit entry was not persisted.");
  return id;
}

export function describeFeeAuditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: Record<string, { label: string; format?: (value: unknown) => string }>,
): string {
  const changes: string[] = [];
  for (const [key, config] of Object.entries(fields)) {
    if (!(key in after) || Object.is(before[key], after[key])) continue;
    const format = config.format ?? ((value: unknown) => value == null || value === "" ? "none" : String(value));
    changes.push(`changed ${config.label} from ${format(before[key])} to ${format(after[key])}`);
  }
  return changes.join(", ");
}