export interface AttendanceCalendarEvent {
  date: string;
  eventType: string;
  audienceScope: string;
  title: string;
}

export function schoolWideAttendanceHoliday(
  events: readonly AttendanceCalendarEvent[],
  date: string,
): AttendanceCalendarEvent | undefined {
  return events.find(event =>
    event.date === date &&
    event.eventType === "holiday" &&
    event.audienceScope === "All_School"
  );
}

export function canSaveStudentAttendance({
  isArchiveMode, isEditable, allAtLimit, studentCount, holiday,
}: {
  isArchiveMode: boolean;
  isEditable: boolean;
  allAtLimit: boolean;
  studentCount: number;
  holiday: AttendanceCalendarEvent | undefined;
}): boolean {
  return !isArchiveMode && isEditable && !allAtLimit && studentCount > 0 && !holiday;
}