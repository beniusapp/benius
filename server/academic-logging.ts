import { AcademicCalculationError } from "./academic-calculation-engine";
import { AcademicScopeError } from "./academic-calculation-service";

type AcademicActorRole = "admin" | "teacher" | "student" | "unknown";

export function logAcademicFailure(input: {
  operation: string;
  error: unknown;
  schoolId?: number | null;
  sessionId?: number | null;
  actorRole?: AcademicActorRole;
}): void {
  const errorCode = input.error instanceof AcademicCalculationError ||
    input.error instanceof AcademicScopeError
    ? input.error.code
    : "UNEXPECTED_ERROR";

  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    domain: "academic",
    event: "academic_operation_failed",
    operation: input.operation,
    errorCode,
    schoolId: input.schoolId ?? null,
    sessionId: input.sessionId ?? null,
    actorRole: input.actorRole ?? "unknown",
  }));
}