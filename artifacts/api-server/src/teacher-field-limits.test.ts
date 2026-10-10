import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_EBOOK_MAX_BYTES,
  ADMIN_GALLERY_MAX_IMAGES,
  ADMIN_GALLERY_MAX_TOTAL_BYTES,
  ADMIN_NOTICE_MAX_WORDS,
  countWords,
  countTeacherWords,
  exceedsTeacherWordLimit,
  GALLERY_DESCRIPTION_MAX_WORDS,
  isAdminGalleryBatchValid,
  isFileSizeWithinLimit,
  isTeacherGalleryBatchValid,
  isWithinWordLimit,
  FEE_RECEIPT_SIGNATURE_MAX_BYTES,
  PRINCIPAL_SIGNATURE_MAX_BYTES,
  SCHOOL_LOGO_MAX_BYTES,
  TEACHER_EBOOK_MAX_BYTES,
  TEACHER_GALLERY_IMAGE_MAX_BYTES,
  TEACHER_GALLERY_MAX_IMAGES,
  TEACHER_GALLERY_MAX_TOTAL_BYTES,
  TEACHER_LEAVE_REASON_MAX_WORDS,
  TEACHER_PROFILE_PHOTO_MAX_BYTES,
} from "./teacher-field-limits";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

test("Teacher upload caps accept exact limits and reject one byte over", () => {
  assert.equal(TEACHER_PROFILE_PHOTO_MAX_BYTES, 5_242_880);
  assert.equal(TEACHER_GALLERY_IMAGE_MAX_BYTES, 5_242_880);
  assert.equal(TEACHER_EBOOK_MAX_BYTES, 15_728_640);
  assert.equal(TEACHER_GALLERY_MAX_IMAGES, 5);
  assert.equal(TEACHER_GALLERY_MAX_TOTAL_BYTES, 26_214_400);
  assert.equal(isTeacherGalleryBatchValid([TEACHER_GALLERY_IMAGE_MAX_BYTES]), true);
  assert.equal(isTeacherGalleryBatchValid([TEACHER_GALLERY_IMAGE_MAX_BYTES + 1]), false);
  assert.equal(isTeacherGalleryBatchValid(Array(TEACHER_GALLERY_MAX_IMAGES).fill(TEACHER_GALLERY_IMAGE_MAX_BYTES)), true);
  assert.equal(isTeacherGalleryBatchValid(Array(6).fill(1)), false);
  assert.equal(isTeacherGalleryBatchValid(Array(5).fill(TEACHER_GALLERY_IMAGE_MAX_BYTES + 1)), false);
  assert.equal(isTeacherGalleryBatchValid([TEACHER_GALLERY_MAX_TOTAL_BYTES + 1]), false);
});

test("Admin gallery and e-book limits enforce exact byte and count boundaries", () => {
  assert.equal(ADMIN_EBOOK_MAX_BYTES, 15_728_640);
  assert.equal(ADMIN_GALLERY_MAX_IMAGES, 10);
  assert.equal(ADMIN_GALLERY_MAX_TOTAL_BYTES, 52_428_800);
  assert.equal(isAdminGalleryBatchValid(Array(10).fill(5_242_880)), true);
  assert.equal(isAdminGalleryBatchValid(Array(11).fill(1)), false);
  assert.equal(isAdminGalleryBatchValid(Array(10).fill(5_242_881)), false);
  assert.equal(isAdminGalleryBatchValid([52_428_801]), false);
  assert.equal(isAdminGalleryBatchValid([5_242_880]), true);
});

test("Principal signature, school logo, and fee receipt signature use their approved caps", () => {
  assert.equal(PRINCIPAL_SIGNATURE_MAX_BYTES, 5_242_880);
  assert.equal(SCHOOL_LOGO_MAX_BYTES, 10_485_760);
  assert.equal(FEE_RECEIPT_SIGNATURE_MAX_BYTES, 5_242_880);
  for (const limit of [PRINCIPAL_SIGNATURE_MAX_BYTES, SCHOOL_LOGO_MAX_BYTES, FEE_RECEIPT_SIGNATURE_MAX_BYTES, ADMIN_EBOOK_MAX_BYTES, TEACHER_EBOOK_MAX_BYTES]) {
    assert.equal(isFileSizeWithinLimit(limit, limit), true);
    assert.equal(isFileSizeWithinLimit(limit + 1, limit), false);
  }
});

test("Admin notice and gallery descriptions use trimmed whitespace word counts", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  assert.equal(GALLERY_DESCRIPTION_MAX_WORDS, 1_000);
  assert.equal(ADMIN_NOTICE_MAX_WORDS, 2_000);
  assert.equal(countWords(" \n\t "), 0);
  assert.equal(countWords(" one\t two\nthree "), 3);
  assert.equal(countWords(words(1_000)), 1_000);
  assert.equal(countWords(words(2_000)), 2_000);
  assert.equal(countWords(words(2_001)), 2_001);
  assert.equal(isWithinWordLimit(words(1_000), GALLERY_DESCRIPTION_MAX_WORDS), true);
  assert.equal(isWithinWordLimit(words(1_001), GALLERY_DESCRIPTION_MAX_WORDS), false);
  assert.equal(isWithinWordLimit(words(2_000), ADMIN_NOTICE_MAX_WORDS), true);
  assert.equal(isWithinWordLimit(words(2_001), ADMIN_NOTICE_MAX_WORDS), false);
});

test("Teacher leave reason is whitespace-word-counted and capped at 500", () => {
  assert.equal(TEACHER_LEAVE_REASON_MAX_WORDS, 500);
  assert.equal(countTeacherWords(" \n\t "), 0);
  assert.equal(countTeacherWords("  one\t two\nthree "), 3);
  assert.equal(exceedsTeacherWordLimit(words(500)), false);
  assert.equal(exceedsTeacherWordLimit(words(501)), true);
});
