import { describe, expect, it } from "vitest";
import {
  countStudentWords,
  exceedsStudentUploadLimit,
  exceedsStudentWordLimit,
  STUDENT_UPLOAD_MAX_BYTES,
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

  it("accepts exactly 1 MiB and rejects larger files", () => {
    expect(STUDENT_UPLOAD_MAX_BYTES).toBe(1_048_576);
    expect(exceedsStudentUploadLimit(new File(["x".repeat(STUDENT_UPLOAD_MAX_BYTES)], "exact.pdf"))).toBe(false);
    expect(exceedsStudentUploadLimit(new File(["x".repeat(STUDENT_UPLOAD_MAX_BYTES + 1)], "large.pdf"))).toBe(true);
  });
});
