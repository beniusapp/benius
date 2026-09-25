import { Directory, File, Paths } from 'expo-file-system';
import { isCurrentAuthGeneration } from '@/lib/api';

const directory = () => new Directory(Paths.cache, 'benius-homework-private');
export function clearPrivateHomeworkFiles(): void {
  try { const folder = directory(); if (folder.exists) folder.delete(); } catch { /* OS may already have evicted cache. */ }
}
export function removePrivateHomeworkFile(uri: string | null): void {
  if (!uri) return;
  const folder = directory();
  if (!uri.startsWith(`${folder.uri.replace(/\/$/, '')}/`) || !/\/[a-z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$/i.test(uri)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Cache may have been evicted. */ }
}
export function persistPrivateHomeworkFile(bytes: Uint8Array, extension: string, generation: number): string {
  if (!isCurrentAuthGeneration(generation) || !/^(jpg|jpeg|png|webp|pdf)$/.test(extension))
    throw new Error('Account changed during download.');
  const folder = directory();
  folder.create({ idempotent: true, intermediates: true });
  const name = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}.${extension}`;
  const file = new File(folder, name);
  try {
    file.create();
    file.write(bytes);
    if (!isCurrentAuthGeneration(generation)) throw new Error('Account changed during download.');
    return file.uri;
  } catch (error) {
    removePrivateHomeworkFile(file.uri);
    throw error;
  }
}