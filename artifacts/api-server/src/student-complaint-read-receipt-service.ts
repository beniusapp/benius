import type { StudentComplaintReceiptScope } from "./student-complaint-read-receipt-policy";

export class StudentComplaintNotInInboxError extends Error {
  constructor() {
    super("Complaint not found");
    this.name = "StudentComplaintNotInInboxError";
  }
}

export type StudentComplaintReadReceiptStore = {
  getAuthorizedInboxComplaintIds(scope: StudentComplaintReceiptScope): Promise<ReadonlySet<number>>;
  insertReceiptOnce(scope: StudentComplaintReceiptScope, complaintId: number): Promise<void>;
};

export async function markAuthorizedStudentComplaintRead(
  scope: StudentComplaintReceiptScope,
  complaintId: number,
  store: StudentComplaintReadReceiptStore,
): Promise<void> {
  const inboxIds = await store.getAuthorizedInboxComplaintIds(scope);
  if (!inboxIds.has(complaintId)) throw new StudentComplaintNotInInboxError();
  await store.insertReceiptOnce(scope, complaintId);
}
