import type { Request, Response } from "express";
import { storage } from "./storage";
import { parseStudentFeeSessionHeader } from "./student-fee-session-id";

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
  const parsedHeader = parseStudentFeeSessionHeader(req.headers["x-view-session-id"]);
  if (!parsedHeader.ok && parsedHeader.reason === "required") {
    res.status(400).json({
      message: "A valid selected academic session is required",
      code: "STUDENT_SESSION_REQUIRED",
    });
    return false;
  }
  if (!parsedHeader.ok) {
    res.status(400).json({
      message: "The selected academic session is invalid",
      code: "STUDENT_SESSION_INVALID",
    });
    return false;
  }
  const selectedSessionId = parsedHeader.sessionId;

  try {
    const selectedSession = await storage.getAcademicSessionById(selectedSessionId);
    if (!selectedSession || selectedSession.schoolId !== schoolId) {
      res.status(404).json({ message: "Academic session not found" });
      return false;
    }
    // checkSessionContext uses parseInt for its general-purpose header parsing.
    // Overwrite that value only after strict validation so "12junk" cannot be
    // treated as session 12 by Student Fees routes.
    (req as any).viewSessionId = selectedSessionId;
    return true;
  } catch {
    res.status(503).json({
      message: "Unable to verify the selected academic session. Please retry.",
      code: "SESSION_STATUS_UNAVAILABLE",
    });
    return false;
  }
}