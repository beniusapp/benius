import { describe, expect, it } from "vitest";
import {
  countTeacherWords,
  exceedsTeacherWordLimit,
  exceedsTeacherUploadLimit,
  isTeacherGalleryBatchValid,
  TEACHER_EBOOK_MAX_BYTES,
  TEACHER_GALLERY_IMAGE_MAX_BYTES,
  TEACHER_GALLERY_MAX_IMAGES,
  TEACHER_PROFILE_PHOTO_MAX_BYTES,
} from "./teacher-field-limits";

describe("Teacher Portal limits", () => {
  it("accepts exact photo and e-book limits and rejects one byte over", () => {
    for (const maxBytes of [TEACHER_PROFILE_PHOTO_MAX_BYTES, TEACHER_EBOOK_MAX_BYTES]) {
      expect(exceedsTeacherUploadLimit(new File([new Uint8Array(maxBytes)], "valid"), maxBytes)).toBe(false);
      expect(exceedsTeacherUploadLimit(new File([new Uint8Array(maxBytes + 1)], "large"), maxBytes)).toBe(true);
    }
  });

  it("limits Gallery to ten images with each at most 10 MB", () => {
    const exact = new File([new Uint8Array(TEACHER_GALLERY_IMAGE_MAX_BYTES)], "photo.jpg");
    const tooLarge = new File([new Uint8Array(TEACHER_GALLERY_IMAGE_MAX_BYTES + 1)], "large.jpg");
    expect(TEACHER_GALLERY_MAX_IMAGES).toBe(10);
    expect(isTeacherGalleryBatchValid(Array(10).fill(exact))).toBe(true);
    expect(isTeacherGalleryBatchValid([...Array(9).fill(exact), tooLarge])).toBe(false);
    expect(isTeacherGalleryBatchValid(Array(11).fill(exact))).toBe(false);
  });

  it("counts trimmed whitespace-separated words and caps Teacher leave at 500", () => {
    const text = (n: number) => Array.from({ length: n }, (_, index) => `word${index}`).join(" ");
    expect(countTeacherWords(" \n\t ")).toBe(0);
    expect(countTeacherWords(" one\t two\nthree ")).toBe(3);
    expect(exceedsTeacherWordLimit(text(500))).toBe(false);
    expect(exceedsTeacherWordLimit(text(501))).toBe(true);
  });
});
