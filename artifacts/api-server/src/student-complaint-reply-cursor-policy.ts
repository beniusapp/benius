import { studentComplaintReadReceiptsEnabled } from "./student-complaint-read-receipts";

export const STUDENT_COMPLAINT_REPLY_AWARE_ENV =
  "BENIUS_STUDENT_COMPLAINT_REPLY_AWARE_ENABLED";
export const STUDENT_COMPLAINT_REPLY_CURSOR_MIGRATION_ENV =
  "BENIUS_STUDENT_COMPLAINT_REPLY_CURSOR_MIGRATION_APPLIED";

export function studentComplaintReplyAwareEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "development"
    && env[STUDENT_COMPLAINT_REPLY_AWARE_ENV] === "true"
    && env[STUDENT_COMPLAINT_REPLY_CURSOR_MIGRATION_ENV] === "true"
    && studentComplaintReadReceiptsEnabled(env);
}
