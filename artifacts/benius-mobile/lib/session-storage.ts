import type { MobileUser } from '@/lib/api';

export function academicSessionStorageKey(user: Pick<MobileUser, 'schoolId' | 'role' | 'id'>): string {
  return `benius.session.${user.schoolId}.${user.role}.${user.id}`;
}