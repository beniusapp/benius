const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export function istToday(at = new Date()) {
  const parts = formatter.formatToParts(at);
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addDays(date, delta) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
export function weekDates(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = addDays(date, -(day === 0 ? 6 : day - 1));
  return Array.from({ length: 6 }, (_, index) => addDays(monday, index));
}
export function monthGrid(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const year = Number(month.slice(0, 4));
  if (year < 1 || year > 9999) return [];
  const first = new Date(`${month}-01T12:00:00Z`);
  const days = new Date(Date.UTC(year, Number(month.slice(5)), 0)).getUTCDate();
  return [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
}
export function shiftMonth(month, delta) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
export function homeworkStatus(submission) {
  if (!submission || submission.status === 'rejected') return 'Pending';
  if (submission.status === 'approved') return 'Completed';
  return 'Submitted';
}
export function safeHomeworkUrl(value, domain) {
  if (typeof value !== 'string' || !value || typeof domain !== 'string' || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(domain)) return null;
  const origin = `https://${domain}`;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.protocol !== 'https:' || !url.pathname.startsWith('/uploads/') || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
export function validHomeworkFile(file) {
  if (!file || !file.uri || !file.name || !Number.isFinite(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) return false;
  const ext = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  const allowed = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };
  return !!ext && allowed[ext] === file.mimeType;
}