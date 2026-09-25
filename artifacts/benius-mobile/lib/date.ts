// Calendar dates are not instants; never parse YYYY-MM-DD with a device timezone.
export function formatSchoolDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '—';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1];
  return month ? `${match[3]} ${month} ${match[1]}` : '—';
}
// BENIUS persists bare PostgreSQL timestamps as UTC wall-clock instants.
export function formatSchoolInstant(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? '—' : `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(date)} IST`;
}