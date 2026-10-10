import assert from "node:assert/strict";
import test from "node:test";
import {
  countUnreadComplaintIds,
  isQualifyingTeacherReply,
  notificationEventMatchesScope,
  safeDisplayedEventIds,
} from "./student-complaint-notification-policy";

test("only activated Teacher/Admin notes on Teacher-to-Student complaints qualify", () => {
  const base = { enabled: true, complaintType: "teacher-to-student", authorRole: "teacher", schoolId: 1, sessionId: 9 };
  assert.equal(isQualifyingTeacherReply(base), true);
  assert.equal(isQualifyingTeacherReply({ ...base, authorRole: "admin" }), true);
  assert.equal(isQualifyingTeacherReply({ ...base, authorRole: "student" }), false);
  assert.equal(isQualifyingTeacherReply({ ...base, complaintType: "student-to-staff" }), false);
  assert.equal(isQualifyingTeacherReply({ ...base, enabled: false }), false);
  assert.equal(isQualifyingTeacherReply({ ...base, sessionId: null }), false);
});

test("unread count includes new complaints and replies without double-counting", () => {
  const inbox = [10, 11, 12, 13];
  const read = new Set([11, 12]);
  const replyUnread = new Set([12, 13]);
  assert.equal(countUnreadComplaintIds(inbox, read, replyUnread), 3);
});

test("a new incoming complaint is unread until its receipt is written", () => {
  const inbox = [50];
  assert.equal(countUnreadComplaintIds(inbox, new Set(), new Set()), 1);
  assert.equal(countUnreadComplaintIds(inbox, new Set([50]), new Set()), 0);
});

test("a new Teacher/Admin reply re-unreads a previously read complaint, including resolved history", () => {
  const read = new Set([50]);
  const noReply = new Set<number>();
  assert.equal(countUnreadComplaintIds([50], read, noReply), 0);
  // Reply activity is independent of complaint status; resolved items remain in the inbox/history.
  assert.equal(countUnreadComplaintIds([50], read, new Set([50])), 1);
});

test("only valid unique IDs from the loaded response can be acknowledged", () => {
  const loaded = [41, 42, 42, 0, -4, "43", Number.NaN];
  assert.deepEqual(safeDisplayedEventIds(loaded), [41, 42]);
  // Concurrent later events are absent from the acknowledgement payload.
  assert.equal(safeDisplayedEventIds([41, 42]).includes(43), false);
});

test("notification scope separates School, Student, and Academic Session", () => {
  const scope = { schoolId: 2, studentId: 41, sessionId: 2027 };
  assert.equal(notificationEventMatchesScope(scope, scope), true);
  assert.equal(notificationEventMatchesScope({ ...scope, schoolId: 3 }, scope), false);
  assert.equal(notificationEventMatchesScope({ ...scope, studentId: 42 }, scope), false);
  assert.equal(notificationEventMatchesScope({ ...scope, sessionId: 2026 }, scope), false);
});
