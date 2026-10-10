import assert from "node:assert/strict";
import test from "node:test";
import {
  countStudentWords,
  exceedsStudentWordLimit,
  exceedsStudentUploadLimit,
  STUDENT_FIELD_MAX_WORDS,
  STUDENT_PROFILE_PHOTO_MAX_BYTES,
  STUDENT_HOMEWORK_UPLOAD_MAX_BYTES,
  STUDENT_LEAVE_ATTACHMENT_MAX_BYTES,
} from "./student-field-limits";

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");

test("Student field word count uses trimmed whitespace-separated words", () => {
  assert.equal(countStudentWords(""), 0);
  assert.equal(countStudentWords(" \n\t "), 0);
  assert.equal(countStudentWords("  one\t two\nthree  "), 3);
  assert.equal(countStudentWords(words(500)), 500);
  assert.equal(exceedsStudentWordLimit(words(500)), false);
  assert.equal(exceedsStudentWordLimit(words(501)), true);
});

test("Student upload limits match the approved byte boundaries", () => {
  for (const maxBytes of [
    STUDENT_PROFILE_PHOTO_MAX_BYTES,
    STUDENT_HOMEWORK_UPLOAD_MAX_BYTES,
    STUDENT_LEAVE_ATTACHMENT_MAX_BYTES,
  ]) {
    assert.equal(exceedsStudentUploadLimit(maxBytes, maxBytes), false);
    assert.equal(exceedsStudentUploadLimit(maxBytes + 1, maxBytes), true);
  }
  assert.equal(STUDENT_PROFILE_PHOTO_MAX_BYTES, 5_242_880);
  assert.equal(STUDENT_HOMEWORK_UPLOAD_MAX_BYTES, 2_097_152);
  assert.equal(STUDENT_LEAVE_ATTACHMENT_MAX_BYTES, 5_242_880);
  assert.equal(STUDENT_FIELD_MAX_WORDS, 500);
});
