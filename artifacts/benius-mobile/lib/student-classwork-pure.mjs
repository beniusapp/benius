import { validDate } from './student-homework-pure.mjs';

export function classworkResource(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let pathname;
  try { pathname = new URL(value, 'https://files.invalid').pathname; } catch { return 'file'; }
  const ext = pathname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'pdf') return 'pdf';
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return 'file';
}

export function safeClassworkUrl(value, domain) {
  if (typeof value !== 'string' || !value || typeof domain !== 'string'
    || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(domain)) return null;
  const origin = `https://${domain}`;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password
      || !url.pathname.startsWith('/uploads/')
      || /%(?:2f|5c|2e|00)/i.test(url.pathname)
      || url.pathname.includes('\\')) return null;
    return url.href;
  } catch { return null; }
}

export function classworkDateAllowed(date, today) {
  return validDate(date) && validDate(today) && date <= today;
}