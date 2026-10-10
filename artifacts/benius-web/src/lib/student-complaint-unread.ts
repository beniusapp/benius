export type TeacherInboxReadState = {
  id: number;
  status: string;
  isRead?: boolean;
};

export function teacherComplaintBadgeCount(
  complaints: readonly TeacherInboxReadState[],
  readTrackingEnabled: boolean,
): number {
  return readTrackingEnabled
    ? complaints.filter(complaint => complaint.isRead !== true).length
    : complaints.length;
}
