export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Port of student-attendance.tsx presentation rules. No device-local date parsing.
export function getDayCell(day) {
  if (!day.isInSession) return { tone: 'outside', dot: false, label: 'Outside academic session' };
  if ((day.isSunday || day.isHoliday) && day.status === 'none') return { tone: 'closed', dot: false, label: day.isHoliday ? (day.holidayName || 'Holiday') : 'Sunday' };
  if (day.isFuture) return { tone: 'future', dot: false, label: '' };
  if (day.isApprovedLeave && day.status === 'none') return { tone: 'leave', dot: false, label: 'Approved Leave' };
  if (day.status === 'present') return { tone: 'present', dot: false, label: 'Present' };
  if (day.status === 'absent') return { tone: 'absent', dot: false, label: 'Absent' };
  if (day.status === 'halfday' || day.status === 'half_day' || day.status === 'late') return { tone: 'partial', dot: true, label: day.status === 'late' ? 'Late' : 'Half Day' };
  if (day.status === 'leave') return { tone: 'leave', dot: false, label: 'Leave' };
  if (day.status !== 'none') return { tone: 'unknown', dot: false, label: day.status };
  return { tone: 'unmarked', dot: false, label: 'Not marked' };
}
export function getMonthlySummary(days) {
  return days.reduce((acc, d) => {
    if (!d.isInSession || d.isFuture || (d.isSunday && d.status === 'none')) return acc;
    if (d.isHoliday && d.status === 'none') { acc.holiday++; return acc; }
    if (d.isApprovedLeave && d.status === 'none') { acc.leave++; return acc; }
    if (d.status === 'present') acc.present++;
    else if (d.status === 'absent') acc.absent++;
    else if (d.status === 'halfday' || d.status === 'half_day') acc.halfDay++;
    else if (d.status === 'late') acc.late++;
    else if (d.status === 'leave') acc.leave++;
    return acc;
  }, { present: 0, absent: 0, halfDay: 0, late: 0, leave: 0, holiday: 0 });
}
export function getYearlyMonthPercentage(m) {
  if (m.workingDays === 0) return 0;
  return Math.round(((m.present + m.late + m.leave + m.halfDay * .5) / m.workingDays) * 1000) / 10;
}
export function istToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const field = (name) => Number(parts.find(p => p.type === name)?.value);
  return { year: field('year'), month: field('month'), day: field('day') };
}
export function calendarWeekday(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const value = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return value.getUTCFullYear() === +match[1] && value.getUTCMonth() === +match[2] - 1 && value.getUTCDate() === +match[3] ? value.getUTCDay() : null;
}
export function formatDateOnly(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match && calendarWeekday(date) !== null ? `${+match[3]} ${MONTH_NAMES[+match[2] - 1]} ${match[1]}` : '—';
}