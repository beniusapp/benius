import type { Request, Response } from "express";
import { storage } from "./storage";

/**
 * Student Fees reads and payment actions must use a session that belongs to the
 * authenticated student's tenant. This intentionally permits archived sessions:
 * students need to review their own historical invoices, receipts, and history.
 */
export async function requireStudentFeeSession(
  req: Request,
  res: Response,
  schoolId: number,
): Promise<boolean> {
  const selectedSessionId = (req as any).viewSessionId as number | null | undefined;
  if (selectedSessionId == null) return true;

  try {
    const selectedSession = await storage.getAcademicSessionById(selectedSessionId);
    if (!selectedSession || selectedSession.schoolId !== schoolId) {
      res.status(404).json({ message: "Academic session not found" });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({
      message: "Unable to verify the selected academic session. Please retry.",
      code: "SESSION_STATUS_UNAVAILABLE",
    });
    return false;
  }
}