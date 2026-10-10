export const STUDENT_FIELD_MAX_WORDS = 500;
export const STUDENT_PROFILE_PHOTO_MAX_BYTES = 5_242_880;
export const STUDENT_HOMEWORK_UPLOAD_MAX_BYTES = 2_097_152;
export const STUDENT_LEAVE_ATTACHMENT_MAX_BYTES = 5_242_880;

export function countStudentWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function exceedsStudentWordLimit(value: string): boolean {
  return countStudentWords(value) > STUDENT_FIELD_MAX_WORDS;
}

export function exceedsStudentUploadLimit(fileSize: number, maxBytes: number): boolean {
  return fileSize > maxBytes;
}
