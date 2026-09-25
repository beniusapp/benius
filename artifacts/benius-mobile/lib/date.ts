// Calendar dates are not instants; never parse YYYY-MM-DD with a device timezone.
export function formatSchoolDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '—';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1];
  return month ? `${match[3]} ${month} ${match[1]}` : '—';
}
// BENIUS persists bare PostgreSQL timestamps as UTC wall-clock instants.
function schoolInstant(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  return new Date(normalized);
}
export function formatSchoolInstant(value: string) {
  const date = schoolInstant(value);
  return Number.isNaN(date.getTime()) ? '—' : `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(date)} IST`;
}

// Profile displays en-GB dates, but timestamps must use the school's IST day,
// not the device's local day. Calendar-only dates never shift timezones.
export function formatSchoolProfileDate(value: string | null | undefined): string {
  if (!value) return '—';
  const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (calendar) {
    const year = Number(calendar[1]), month = Number(calendar[2]), day = Number(calendar[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
      ? `${calendar[3]}/${calendar[2]}/${calendar[1]}` : '—';
  }
  const parsed = schoolInstant(value);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(parsed);
}