import assert from "node:assert/strict";
import test from "node:test";
import { teacherComplaintBadgeCount } from "./student-complaint-unread";

test("disabled receipt mode preserves the legacy total-record badge", () => {
  assert.equal(teacherComplaintBadgeCount([
    { id: 1, status: "Resolved", isRead: false },
    { id: 2, status: "Pending", isRead: true },
  ], false), 2);
});

test("enabled badge counts unread resolved and unresolved items alike", () => {
  assert.equal(teacherComplaintBadgeCount([
    { id: 1, status: "Resolved", isRead: false },
    { id: 2, status: "Pending", isRead: false },
    { id: 3, status: "Resolved", isRead: true },
  ], true), 2);
});

test("a read receipt clears only that complaint and leaves history intact", () => {
  const inbox = [
    { id: 4, status: "Resolved", isRead: true },
    { id: 5, status: "Pending", isRead: false },
  ];
  assert.equal(teacherComplaintBadgeCount(inbox, true), 1);
  assert.equal(inbox.length, 2);
  assert.equal(inbox[0].status, "Resolved");
});

test("new complaints become unread while failed acknowledgements remain unread", () => {
  const previouslyRead = [{ id: 9, status: "Resolved", isRead: true }];
  const afterNewArrival = [...previouslyRead, { id: 10, status: "Resolved", isRead: false }];
  const afterFailedAcknowledgement = afterNewArrival;
  assert.equal(teacherComplaintBadgeCount(afterNewArrival, true), 1);
  assert.equal(teacherComplaintBadgeCount(afterFailedAcknowledgement, true), 1);
});

test("missing receipt state is conservatively treated as unread", () => {
  assert.equal(teacherComplaintBadgeCount([{ id: 12, status: "Pending" }], true), 1);
});
