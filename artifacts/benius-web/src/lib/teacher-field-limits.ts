export const TEACHER_PROFILE_PHOTO_MAX_BYTES = 5_242_880;
export const TEACHER_GALLERY_IMAGE_MAX_BYTES = 5_242_880;
export const TEACHER_GALLERY_MAX_IMAGES = 5;
export const TEACHER_GALLERY_MAX_TOTAL_BYTES = 26_214_400;
export const ADMIN_GALLERY_MAX_IMAGES = 10;
export const ADMIN_GALLERY_MAX_TOTAL_BYTES = 52_428_800;
export const GALLERY_DESCRIPTION_MAX_WORDS = 1_000;
export const ADMIN_NOTICE_MAX_WORDS = 2_000;
export const TEACHER_EBOOK_MAX_BYTES = 15_728_640;
export const ADMIN_EBOOK_MAX_BYTES = 15_728_640;
export const TEACHER_LEAVE_REASON_MAX_WORDS = 500;

export function countTeacherWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function exceedsTeacherWordLimit(value: string): boolean {
  return countTeacherWords(value) > TEACHER_LEAVE_REASON_MAX_WORDS;
}

export function exceedsTeacherUploadLimit(file: File, maxBytes: number): boolean {
  return file.size > maxBytes;
}

export function isTeacherGalleryBatchValid(files: File[]): boolean {
  return files.length <= TEACHER_GALLERY_MAX_IMAGES
    && files.every(file => !exceedsTeacherUploadLimit(file, TEACHER_GALLERY_IMAGE_MAX_BYTES))
    && files.reduce((total, file) => total + file.size, 0) <= TEACHER_GALLERY_MAX_TOTAL_BYTES;
}

export function isAdminGalleryBatchValid(files: File[]): boolean {
  return files.length > 0
    && files.length <= ADMIN_GALLERY_MAX_IMAGES
    && files.every(file => file.size <= TEACHER_GALLERY_IMAGE_MAX_BYTES)
    && files.reduce((total, file) => total + file.size, 0) <= ADMIN_GALLERY_MAX_TOTAL_BYTES;
}
