const PRIVATE_PATH = /^\/api\/mobile\/homework-submission-files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$/i;
export function validPrivateHomeworkApiPath(path) {
  return typeof path === 'string' && PRIVATE_PATH.test(`/api${path}`);
}
export const MAX_HOMEWORK_DOWNLOAD_BYTES = 12 * 1024 * 1024;

/** Never trust a file URL as an arbitrary URL or attach a bearer token to it. */
export function classifyHomeworkFile(value, domain) {
  if (typeof value !== 'string' || typeof domain !== 'string' ||
    !/^[a-z0-9.-]+(?::\d+)?$/i.test(domain) || !value || /[\\\u0000-\u001f]/.test(value)) return null;
  const origin = `https://${domain}`;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) return null;
    const privateMatch = !url.search && !url.hash && PRIVATE_PATH.exec(url.pathname);
    if (privateMatch) return { kind: 'private', path: url.pathname.slice(4), url: url.href, extension: privateMatch[1].toLowerCase() };
    if (url.pathname.startsWith('/uploads/') && !url.hash) {
      return { kind: 'legacy', path: url.pathname, url: url.href, extension: url.pathname.match(/\.(jpg|jpeg|png|webp|pdf)$/i)?.[1]?.toLowerCase() ?? '' };
    }
    return null;
  } catch { return null; }
}

/** The same principal may sign in again. Check an auth generation around BOTH network attempts. */
export async function binaryWithRefresh(initial, send, refresh, isCurrent) {
  if (!isCurrent()) throw new Error('Account changed during download.');
  let response = await send(initial);
  if (!isCurrent()) throw new Error('Account changed during download.');
  if (response.status === 401) {
    const refreshed = await refresh(initial);
    if (!isCurrent()) throw new Error('Account changed during download.');
    response = await send(refreshed);
  }
  if (!isCurrent()) throw new Error('Account changed during download.');
  return response;
}

export function validDownload(bytes, extension, contentType) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_HOMEWORK_DOWNLOAD_BYTES) return false;
  const expected = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[extension];
  if (!expected || contentType?.split(';')[0]?.trim().toLowerCase() !== expected) return false;
  if (extension === 'pdf') return bytes.length >= 5 && [37, 80, 68, 70, 45].every((b, i) => bytes[i] === b);
  if (extension === 'png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  if (extension === 'webp') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}