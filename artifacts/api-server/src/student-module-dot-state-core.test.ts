import assert from "node:assert/strict";
import test from "node:test";
import type {
  StudentModuleActivityCursor,
  StudentModuleKey,
} from "@workspace/api-zod";
import { MarkStudentModuleSeenBody } from "@workspace/api-zod";
import {
  buildStudentModuleDotStateResponse,
  compareStudentModuleCursors,
  hasOnlyOwnKeys,
  STUDENT_COMPLAINT_NOTIFICATION_ROLES,
  studentModuleHasNewActivity,
} from "./student-module-dot-state-core";

const cursor = (createdAt: string, recordId: number): StudentModuleActivityCursor => ({
  createdAt,
  recordId,
});

test("first visit treats existing visible activity as new; an empty module has no dot", () => {
  assert.equal(studentModuleHasNewActivity(cursor("2026-10-07 10:00:00", 8), null), true);
  assert.equal(studentModuleHasNewActivity(null, null), false);
});

test("timestamp ordering preserves microseconds and uses record ID to break ties", () => {
  assert.equal(compareStudentModuleCursors(
    cursor("2026-10-07 10:00:00.000002", 1),
    cursor("2026-10-07 10:00:00.000001", 999),
  ), 1);
  assert.equal(compareStudentModuleCursors(
    cursor("2026-10-07 10:00:00", 12),
    cursor("2026-10-07 10:00:00.000000", 11),
  ), 1);
});

test("same or older cursor stays cleared, while activity after the observed cursor is new", () => {
  const seen = cursor("2026-10-07 10:00:00.123456", 20);
  assert.equal(studentModuleHasNewActivity(cursor("2026-10-07 10:00:00.123456", 20), seen), false);
  assert.equal(studentModuleHasNewActivity(cursor("2026-10-07 10:00:00.123455", 99), seen), false);
  assert.equal(studentModuleHasNewActivity(cursor("2026-10-07 10:00:00.123456", 21), seen), true);
});

test("each module has independent seen state", () => {
  const latest = {
    homework: cursor("2026-10-07 10:00:00", 1),
    classwork: cursor("2026-10-07 10:00:00", 2),
    noticeboard: cursor("2026-10-07 10:00:00", 3),
    complaints: cursor("2026-10-07 10:00:00", 4),
  };
  const seen = new Map<StudentModuleKey, StudentModuleActivityCursor>([
    ["homework", latest.homework!],
  ]);

  const state = buildStudentModuleDotStateResponse(latest, seen);
  assert.equal(state.homework.hasNewActivity, false);
  assert.equal(state.classwork.hasNewActivity, true);
  assert.equal(state.noticeboard.hasNewActivity, true);
  assert.equal(state.complaints.hasNewActivity, true);
});

test("invalid timestamp cursor is rejected instead of being ordered as a date", () => {
  assert.throws(
    () => compareStudentModuleCursors(cursor("2026-10-07T10:00:00Z", 2), cursor("2026-10-07 10:00:00", 1)),
    /Invalid activity cursor timestamp/,
  );
});

test("only Teacher and Admin Complaint Notes qualify", () => {
  assert.deepEqual(STUDENT_COMPLAINT_NOTIFICATION_ROLES, ["teacher", "admin"]);
  assert.equal((STUDENT_COMPLAINT_NOTIFICATION_ROLES as readonly string[]).includes("student"), false);
});

test("mark-seen input rejects unsupported module keys and malformed cursors", () => {
  assert.equal(MarkStudentModuleSeenBody.safeParse({
    module: "fees",
    cursor: { createdAt: "2026-10-07 10:00:00", recordId: 1 },
  }).success, false);
  assert.equal(MarkStudentModuleSeenBody.safeParse({
    module: "homework",
    cursor: { createdAt: "2026-10-07T10:00:00Z", recordId: 1 },
  }).success, false);
});

test("mark-seen input rejects caller-supplied identity and cursor extras", () => {
  assert.equal(hasOnlyOwnKeys({
    module: "homework",
    cursor: { createdAt: "2026-10-07 10:00:00", recordId: 1 },
    studentId: 99,
  }, ["module", "cursor"]), false);
  assert.equal(hasOnlyOwnKeys({
    createdAt: "2026-10-07 10:00:00",
    recordId: 1,
    schoolId: 42,
  }, ["createdAt", "recordId"]), false);
});
