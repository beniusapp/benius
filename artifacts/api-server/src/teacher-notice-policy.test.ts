import assert from "node:assert/strict";
import test from "node:test";
import {
  isTeacherNoticeAudienceWithinSchool,
  isTeacherNoticeOwnedByTeacherInSession,
} from "./teacher-notice-policy";

const scope = { schoolId: 12, sessionId: 41, teacherId: 7 };
const notice = { schoolId: 12, sessionId: 41, createdById: 7, creatorRole: "teacher" };

test("Teacher notice mutations require the same school, session, owner, and creator role", () => {
  assert.equal(isTeacherNoticeOwnedByTeacherInSession(notice, scope), true);
  assert.equal(isTeacherNoticeOwnedByTeacherInSession({ ...notice, schoolId: 13 }, scope), false);
  assert.equal(isTeacherNoticeOwnedByTeacherInSession({ ...notice, sessionId: 42 }, scope), false);
  assert.equal(isTeacherNoticeOwnedByTeacherInSession({ ...notice, sessionId: null }, scope), false);
  assert.equal(isTeacherNoticeOwnedByTeacherInSession({ ...notice, createdById: 8 }, scope), false);
  assert.equal(isTeacherNoticeOwnedByTeacherInSession({ ...notice, creatorRole: "admin" }, scope), false);
});

const school = {
  classes: ["5", "6"],
  sections: ["A", "B"],
  classSections: { "5": ["A"], "6": ["B"] },
};

test("Teacher notices can target configured class and section audiences only", () => {
  assert.equal(isTeacherNoticeAudienceWithinSchool({
    targetType: "student", targetClass: "5,6",
  }, school), true);
  assert.equal(isTeacherNoticeAudienceWithinSchool({
    targetType: "student", targetClass: "5", targetSection: "A",
  }, school), true);
  assert.equal(isTeacherNoticeAudienceWithinSchool({
    targetType: "student", targetClass: "7",
  }, school), false);
  assert.equal(isTeacherNoticeAudienceWithinSchool({
    targetType: "student", targetClass: "5", targetSection: "B",
  }, school), false);
  assert.equal(isTeacherNoticeAudienceWithinSchool({
    targetType: "student", targetSection: "A",
  }, school), false);
});

test("whole-school notices cannot carry hidden class or section restrictions", () => {
  assert.equal(isTeacherNoticeAudienceWithinSchool({ targetType: "whole_school" }, school), true);
  assert.equal(isTeacherNoticeAudienceWithinSchool({
    targetType: "whole_school", targetClass: "7",
  }, school), false);
  assert.equal(isTeacherNoticeAudienceWithinSchool({ targetType: "admin" }, school), false);
});