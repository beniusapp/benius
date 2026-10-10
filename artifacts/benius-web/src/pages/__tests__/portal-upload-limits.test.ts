import { describe, expect, it } from "vitest";
import {
  ADMIN_EBOOK_MAX_BYTES,
  ADMIN_GALLERY_MAX_IMAGES,
  ADMIN_GALLERY_MAX_TOTAL_BYTES,
  ADMIN_NOTICE_MAX_WORDS,
  countWords,
  countTeacherWords,
  exceedsTeacherUploadLimit,
  exceedsTeacherWordLimit,
  GALLERY_DESCRIPTION_MAX_WORDS,
  isAdminGalleryBatchValid,
  isTeacherGalleryBatchValid,
  TEACHER_EBOOK_MAX_BYTES,
  TEACHER_GALLERY_MAX_IMAGES,
  TEACHER_GALLERY_MAX_TOTAL_BYTES,
  TEACHER_LEAVE_REASON_MAX_WORDS,
  TEACHER_PROFILE_PHOTO_MAX_BYTES,
} from "../../lib/teacher-field-limits";

const image = (size: number) => ({ size }) as File;
const words = (count: number) => Array(count).fill("word").join(" ");

describe("Admin and Teacher upload limits", () => {
  it("accepts the exact Admin Gallery limits and rejects 11 images or one oversized image", () => {
    expect(ADMIN_GALLERY_MAX_IMAGES).toBe(10);
    expect(ADMIN_GALLERY_MAX_TOTAL_BYTES).toBe(52_428_800);
    expect(isAdminGalleryBatchValid(Array(10).fill(image(5_242_880)))).toBe(true);
    expect(isAdminGalleryBatchValid(Array(11).fill(image(1)))).toBe(false);
    expect(isAdminGalleryBatchValid([image(5_242_881)])).toBe(false);
  });

  it("keeps Teacher Gallery at five images and 25 MiB", () => {
    expect(TEACHER_GALLERY_MAX_IMAGES).toBe(5);
    expect(TEACHER_GALLERY_MAX_TOTAL_BYTES).toBe(26_214_400);
    expect(isTeacherGalleryBatchValid(Array(5).fill(image(5_242_880)))).toBe(true);
    expect(isTeacherGalleryBatchValid(Array(6).fill(image(1)))).toBe(false);
    expect(isTeacherGalleryBatchValid([image(5_242_881)])).toBe(false);
  });

  it("counts trimmed words and verifies Admin notice and Gallery description boundaries", () => {
    expect(countWords(" \t\n")).toBe(0);
    expect(countWords(" one\t two\nthree ")).toBe(3);
    expect(countWords(words(ADMIN_NOTICE_MAX_WORDS))).toBe(2_000);
    expect(countWords(words(ADMIN_NOTICE_MAX_WORDS + 1))).toBe(2_001);
    expect(countWords(words(GALLERY_DESCRIPTION_MAX_WORDS))).toBe(1_000);
    expect(countWords(words(GALLERY_DESCRIPTION_MAX_WORDS + 1))).toBe(1_001);
  });

  it("keeps both E-Book caps at 15 MiB", () => {
    expect(ADMIN_EBOOK_MAX_BYTES).toBe(15_728_640);
    expect(TEACHER_EBOOK_MAX_BYTES).toBe(15_728_640);
    expect(exceedsTeacherUploadLimit(new File([new Uint8Array(TEACHER_EBOOK_MAX_BYTES)], "ebook.pdf"), TEACHER_EBOOK_MAX_BYTES)).toBe(false);
    expect(exceedsTeacherUploadLimit(new File([new Uint8Array(TEACHER_EBOOK_MAX_BYTES + 1)], "ebook.pdf"), TEACHER_EBOOK_MAX_BYTES)).toBe(true);
  });

  it("preserves Teacher Profile photo and Leave reason boundaries", () => {
    expect(TEACHER_PROFILE_PHOTO_MAX_BYTES).toBe(5_242_880);
    expect(exceedsTeacherUploadLimit(new File([new Uint8Array(TEACHER_PROFILE_PHOTO_MAX_BYTES)], "photo.jpg"), TEACHER_PROFILE_PHOTO_MAX_BYTES)).toBe(false);
    expect(exceedsTeacherUploadLimit(new File([new Uint8Array(TEACHER_PROFILE_PHOTO_MAX_BYTES + 1)], "photo.jpg"), TEACHER_PROFILE_PHOTO_MAX_BYTES)).toBe(true);
    const words = (count: number) => Array(count).fill("word").join(" ");
    expect(TEACHER_LEAVE_REASON_MAX_WORDS).toBe(500);
    expect(countTeacherWords(words(500))).toBe(500);
    expect(exceedsTeacherWordLimit(words(500))).toBe(false);
    expect(exceedsTeacherWordLimit(words(501))).toBe(true);
  });
});
