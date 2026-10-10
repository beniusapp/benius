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
export const PRINCIPAL_SIGNATURE_MAX_BYTES = 5_242_880;
export const SCHOOL_LOGO_MAX_BYTES = 10_485_760;
export const FEE_RECEIPT_SIGNATURE_MAX_BYTES = 5_242_880;
export const TEACHER_LEAVE_REASON_MAX_WORDS = 500;

export function countTeacherWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function isWithinWordLimit(value: string, maxWords: number): boolean {
  return countWords(value) <= maxWords;
}

export function isFileSizeWithinLimit(size: number, maxBytes: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= maxBytes;
}

export function isAdminGalleryBatchValid(fileSizes: number[]): boolean {
  return fileSizes.length > 0
    && fileSizes.length <= ADMIN_GALLERY_MAX_IMAGES
    && fileSizes.every(size => isFileSizeWithinLimit(size, TEACHER_GALLERY_IMAGE_MAX_BYTES))
    && fileSizes.reduce((total, size) => total + size, 0) <= ADMIN_GALLERY_MAX_TOTAL_BYTES;
}

export function exceedsTeacherWordLimit(value: string): boolean {
  return countTeacherWords(value) > TEACHER_LEAVE_REASON_MAX_WORDS;
}

export function isTeacherGalleryBatchValid(fileSizes: number[]): boolean {
  return fileSizes.length <= TEACHER_GALLERY_MAX_IMAGES
    && fileSizes.every(size => isFileSizeWithinLimit(size, TEACHER_GALLERY_IMAGE_MAX_BYTES))
    && fileSizes.reduce((total, size) => total + size, 0) <= TEACHER_GALLERY_MAX_TOTAL_BYTES;
}
