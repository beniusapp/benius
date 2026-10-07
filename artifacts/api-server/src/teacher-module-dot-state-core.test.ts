import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTeacherModuleDotStateResponse,
  compareTeacherModuleCursors,
  hasOnlyTeacherModuleDotKeys,
  isTeacherModuleKey,
  latestTeacherModuleCursor,
  teacherModuleHasNewActivity,
} from "./teacher-module-dot-state-core";
import type {
  TeacherModuleActivityCursor,
  TeacherModuleKey,
} from "@workspace/api-zod";

function cursor(
  createdAt: string,
  source: TeacherModuleActivityCursor["source"],
  recordId: number,
): TeacherModuleActivityCursor {
  return { createdAt, source, recordId };
}

test("Teacher module-dot keys are limited to the four approved modules", () => {
  assert.equal(isTeacherModuleKey("noticeboard"), true);
  assert.equal(isTeacherModuleKey("complaints"), true);
  assert.equal(isTeacherModuleKey("leave"), true);
  assert.equal(isTeacherModuleKey("approval_center"), true);
  assert.equal(isTeacherModuleKey("attendance"), false);
  assert.equal(isTeacherModuleKey("homework"), false);
});

test("activity cursor ordering preserves raw timestamp precision and stable source/id ties", () => {
  assert.equal(compareTeacherModuleCursors(
    cursor("2026-10-07 10:00:00.000001", "notice", 999),
    cursor("2026-10-07 10:00:00", "notice", 1000),
  ), 1);
  assert.equal(compareTeacherModuleCursors(
    cursor("2026-10-07 10:00:00", "peer_report", 1),
    cursor("2026-10-07 10:00:00", "student_leave", 1),
  ), -1);
  assert.equal(compareTeacherModuleCursors(
    cursor("2026-10-07 10:00:00", "notice", 4),
    cursor("2026-10-07 10:00:00", "notice", 5),
  ), -1);
});

test("latest cursor is deterministic across multiple event sources", () => {
  const latest = latestTeacherModuleCursor([
    cursor("2026-10-07 10:00:00", "notice", 500),
    cursor("2026-10-07 10:00:00.000001", "student_profile_photo", 1),
    cursor("2026-10-07 10:00:00.000001", "student_profile_submission", 9),
  ]);
  assert.deepEqual(latest, cursor("2026-10-07 10:00:00.000001", "student_profile_submission", 9));
});

test("seen activity clears only through the stored observed cursor", () => {
  const observed = cursor("2026-10-07 10:00:00", "student_leave", 12);
  const newer = cursor("2026-10-07 10:00:01", "student_leave", 13);
  assert.equal(teacherModuleHasNewActivity(observed, observed), false);
  assert.equal(teacherModuleHasNewActivity(newer, observed), true);
  assert.equal(teacherModuleHasNewActivity(observed, null), true);
  assert.equal(teacherModuleHasNewActivity(null, null), false);
});

test("Teacher state response contains only the four supported modules", () => {
  const latest = {
    noticeboard: cursor("2026-10-07 10:00:00", "notice", 1),
    complaints: null,
    leave: cursor("2026-10-07 10:00:02", "student_leave", 2),
    approval_center: null,
  } satisfies Record<TeacherModuleKey, TeacherModuleActivityCursor | null>;
  const response = buildTeacherModuleDotStateResponse(latest, new Map([
    ["noticeboard", cursor("2026-10-07 10:00:00", "notice", 1)],
  ]));

  assert.deepEqual(Object.keys(response), ["noticeboard", "complaints", "leave", "approval_center"]);
  assert.equal(response.noticeboard.hasNewActivity, false);
  assert.equal(response.complaints.hasNewActivity, false);
  assert.equal(response.leave.hasNewActivity, true);
  assert.equal(response.approval_center.hasNewActivity, false);
});

test("mark-seen payload key guard rejects identity and unsupported fields", () => {
  assert.equal(hasOnlyTeacherModuleDotKeys({ module: "leave", cursor: {} }, ["module", "cursor"]), true);
  assert.equal(hasOnlyTeacherModuleDotKeys({ module: "leave", teacherId: 10 }, ["module", "cursor"]), false);
  assert.equal(hasOnlyTeacherModuleDotKeys([], ["module", "cursor"]), false);
});
