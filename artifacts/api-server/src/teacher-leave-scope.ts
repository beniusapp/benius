export function isTeacherLeaveDateRangeWithinSession(
  startDate: string,
  endDate: string,
  sessionStartDate: string,
  sessionEndDate: string,
): boolean {
  const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  return isDateOnly(startDate)
    && isDateOnly(endDate)
    && isDateOnly(sessionStartDate)
    && isDateOnly(sessionEndDate)
    && startDate <= endDate
    && startDate >= sessionStartDate
    && endDate <= sessionEndDate;
}