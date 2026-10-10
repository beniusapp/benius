import assert from "node:assert/strict";
import test from "node:test";
import {
  countStudentWords,
  exceedsStudentWordLimit,
  STUDENT_FIELD_MAX_WORDS,
  STUDENT_UPLOAD_MAX_BYTES,
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

test("Student uploads use an exact 1 MiB limit", () => {
  assert.equal(STUDENT_UPLOAD_MAX_BYTES, 1_048_576);
  assert.equal(STUDENT_FIELD_MAX_WORDS, 500);
});
