import assert from "node:assert/strict";
import test from "node:test";
import {
  countTeacherWords,
  exceedsTeacherWordLimit,
  isTeacherGalleryBatchValid,
  TEACHER_EBOOK_MAX_BYTES,
  TEACHER_GALLERY_IMAGE_MAX_BYTES,
  TEACHER_GALLERY_MAX_IMAGES,
  TEACHER_LEAVE_REASON_MAX_WORDS,
  TEACHER_PROFILE_PHOTO_MAX_BYTES,
} from "./teacher-field-limits";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

test("Teacher upload caps accept exact limits and reject one byte over", () => {
  assert.equal(TEACHER_PROFILE_PHOTO_MAX_BYTES, 5_242_880);
  assert.equal(TEACHER_GALLERY_IMAGE_MAX_BYTES, 10_485_760);
  assert.equal(TEACHER_EBOOK_MAX_BYTES, 10_485_760);
  assert.equal(isTeacherGalleryBatchValid([TEACHER_GALLERY_IMAGE_MAX_BYTES]), true);
  assert.equal(isTeacherGalleryBatchValid([TEACHER_GALLERY_IMAGE_MAX_BYTES + 1]), false);
  assert.equal(isTeacherGalleryBatchValid(Array(TEACHER_GALLERY_MAX_IMAGES).fill(TEACHER_GALLERY_IMAGE_MAX_BYTES)), true);
  assert.equal(isTeacherGalleryBatchValid(Array(11).fill(1)), false);
});

test("Teacher leave reason is whitespace-word-counted and capped at 500", () => {
  assert.equal(TEACHER_LEAVE_REASON_MAX_WORDS, 500);
  assert.equal(countTeacherWords(" \n\t "), 0);
  assert.equal(countTeacherWords("  one\t two\nthree "), 3);
  assert.equal(exceedsTeacherWordLimit(words(500)), false);
  assert.equal(exceedsTeacherWordLimit(words(501)), true);
});
