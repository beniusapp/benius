export const STUDENT_FIELD_MAX_WORDS = 500;
export const STUDENT_UPLOAD_MAX_BYTES = 1_048_576;

export function countStudentWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function exceedsStudentWordLimit(value: string): boolean {
  return countStudentWords(value) > STUDENT_FIELD_MAX_WORDS;
}
