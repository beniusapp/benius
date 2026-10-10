import { describe, expect, it } from "vitest";
import {
  countStudentWords,
  exceedsStudentUploadLimit,
  exceedsStudentWordLimit,
  STUDENT_PROFILE_PHOTO_MAX_BYTES,
  STUDENT_HOMEWORK_UPLOAD_MAX_BYTES,
  STUDENT_LEAVE_ATTACHMENT_MAX_BYTES,
} from "@/lib/student-field-limits";

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");

describe("Student Portal field limits", () => {
  it("counts trimmed whitespace-separated words, including changing text", () => {
    expect(countStudentWords("")).toBe(0);
    expect(countStudentWords("  one\t two\nthree  ")).toBe(3);
    expect(countStudentWords(words(500))).toBe(500);
    expect(countStudentWords(`${words(500)} extra`)).toBe(501);
    expect(countStudentWords(words(499))).toBe(499);
    expect(exceedsStudentWordLimit(words(500))).toBe(false);
    expect(exceedsStudentWordLimit(words(501))).toBe(true);
  });

  it("accepts each exact upload limit and rejects a file one byte over", () => {
    for (const maxBytes of [
      STUDENT_PROFILE_PHOTO_MAX_BYTES,
      STUDENT_HOMEWORK_UPLOAD_MAX_BYTES,
      STUDENT_LEAVE_ATTACHMENT_MAX_BYTES,
    ]) {
      expect(exceedsStudentUploadLimit(new File([new Uint8Array(maxBytes)], "exact.bin"), maxBytes)).toBe(false);
      expect(exceedsStudentUploadLimit(new File([new Uint8Array(maxBytes + 1)], "large.bin"), maxBytes)).toBe(true);
    }
    expect(STUDENT_PROFILE_PHOTO_MAX_BYTES).toBe(5_242_880);
    expect(STUDENT_HOMEWORK_UPLOAD_MAX_BYTES).toBe(2_097_152);
    expect(STUDENT_LEAVE_ATTACHMENT_MAX_BYTES).toBe(5_242_880);
  });
});
