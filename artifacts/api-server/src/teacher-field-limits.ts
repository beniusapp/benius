export const TEACHER_PROFILE_PHOTO_MAX_BYTES = 5_242_880;
export const TEACHER_GALLERY_IMAGE_MAX_BYTES = 5_242_880;
export const TEACHER_GALLERY_MAX_IMAGES = 5;
export const TEACHER_GALLERY_MAX_TOTAL_BYTES = 26_214_400;
export const TEACHER_EBOOK_MAX_BYTES = 10_485_760;
export const TEACHER_LEAVE_REASON_MAX_WORDS = 500;

export function countTeacherWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function exceedsTeacherWordLimit(value: string): boolean {
  return countTeacherWords(value) > TEACHER_LEAVE_REASON_MAX_WORDS;
}

export function isTeacherGalleryBatchValid(fileSizes: number[]): boolean {
  return fileSizes.length <= TEACHER_GALLERY_MAX_IMAGES
    && fileSizes.every(size => size <= TEACHER_GALLERY_IMAGE_MAX_BYTES)
    && fileSizes.reduce((total, size) => total + size, 0) <= TEACHER_GALLERY_MAX_TOTAL_BYTES;
}
