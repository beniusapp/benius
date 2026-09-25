import { isValidDateOnly } from "./ist-time";

export interface AttendanceSessionDates {
  startDate: string;
  endDate: string;
}

export function isAttendanceDateInSession(date: string, session: AttendanceSessionDates): boolean {
  return isValidDateOnly(date) && date >= session.startDate && date <= session.endDate;
}