import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDENT_COMPLAINT_REPLY_AWARE_ENV,
  STUDENT_COMPLAINT_REPLY_MIGRATION_ENV,
  studentComplaintReplyAwareEnabled,
} from "./student-complaint-reply-cursor-policy";

const envWithAllGates = {
  NODE_ENV: "development",
  BENIUS_STUDENT_COMPLAINT_READ_RECEIPTS_ENABLED: "true",
  BENIUS_STUDENT_COMPLAINT_READ_RECEIPTS_MIGRATION_APPLIED: "true",
  [STUDENT_COMPLAINT_REPLY_AWARE_ENV]: "true",
  [STUDENT_COMPLAINT_REPLY_MIGRATION_ENV]: "true",
};

test("reply-aware behavior remains off by default", () => {
  assert.equal(studentComplaintReplyAwareEnabled({}), false);
  assert.equal(studentComplaintReplyAwareEnabled({
    ...envWithAllGates,
    [STUDENT_COMPLAINT_REPLY_AWARE_ENV]: undefined,
  }), false);
});

test("reply-aware behavior requires Development, both new gates and existing receipt gates", () => {
  assert.equal(studentComplaintReplyAwareEnabled(envWithAllGates), true);
  assert.equal(studentComplaintReplyAwareEnabled({
    ...envWithAllGates,
    NODE_ENV: "production",
  }), false);
  assert.equal(studentComplaintReplyAwareEnabled({
    ...envWithAllGates,
    BENIUS_STUDENT_COMPLAINT_READ_RECEIPTS_ENABLED: "false",
  }), false);
  assert.equal(studentComplaintReplyAwareEnabled({
    ...envWithAllGates,
    [STUDENT_COMPLAINT_REPLY_MIGRATION_ENV]: "false",
  }), false);
});
