/**
 * Attendance Policy Engine
 * Centralised, reusable evaluation logic – no hardcoded timings anywhere else.
 */

export interface PolicyConfig {
  policyName: string;
  expectedArrivalTime: string;   // "HH:MM" in IST
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;     // "HH:MM" in IST
  attendanceTarget: number;      // % (e.g. 85)
}

export type AttendanceStatus = "PRESENT" | "LATE" | "HALF_DAY";

export interface EvaluationResult {
  status: AttendanceStatus;
  displayStatus: string;         // "Present" | "Late" | "Half Day"
  policyApplied: string;
  evaluatedAt: Date;
}

/** Fallback used when no policy is configured for the school/class/role */
export const DEFAULT_POLICY: PolicyConfig = {
  policyName: "System Default",
  expectedArrivalTime: "09:00",
  gracePeriodMinutes: 0,
  halfDayCutoffTime: "12:00",
  attendanceTarget: 85,
};

/** Parse "HH:MM" → total minutes since midnight */
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/** Convert a UTC Date to IST "HH:MM" string */
export function utcToISTHHMM(utcDate: Date): string {
  const ist = new Date(utcDate.getTime() + 19_800_000); // +5:30
  const h = ist.getUTCHours().toString().padStart(2, "0");
  const m = ist.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Core evaluation function.
 *
 * Rules:
 *   checkIn ≤ expectedArrival + grace  →  PRESENT
 *   checkIn ≤ halfDayCutoff            →  LATE
 *   checkIn  > halfDayCutoff           →  HALF_DAY
 */
export function evaluateAttendanceStatus(
  checkInTimeIST: string,
  policy: PolicyConfig,
): EvaluationResult {
  const checkInMin  = timeToMinutes(checkInTimeIST);
  const arrivalMin  = timeToMinutes(policy.expectedArrivalTime);
  const graceLimit  = arrivalMin + policy.gracePeriodMinutes;
  const halfDayMin  = timeToMinutes(policy.halfDayCutoffTime);

  let status: AttendanceStatus;
  if (checkInMin <= graceLimit) {
    status = "PRESENT";
  } else if (checkInMin <= halfDayMin) {
    status = "LATE";
  } else {
    status = "HALF_DAY";
  }

  const displayMap: Record<AttendanceStatus, string> = {
    PRESENT: "Present",
    LATE: "Late",
    HALF_DAY: "Half Day",
  };

  return {
    status,
    displayStatus: displayMap[status],
    policyApplied: policy.policyName,
    evaluatedAt: new Date(),
  };
}

type PolicyRow = {
  targetRole: string;
  applicableClasses: string[];
  isActive: boolean;
  policyName: string;
  expectedArrivalTime: string;
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;
  attendanceTarget: number;
};

/**
 * Resolve the most specific active policy for a role + class.
 *
 * Priority:
 *   1. Active policy whose applicableClasses includes className
 *   2. Active policy with empty applicableClasses (school-wide)
 *   3. DEFAULT_POLICY
 */
export function resolvePolicy(
  policies: PolicyRow[],
  targetRole: string,
  className: string,
): PolicyConfig {
  // Match role-specific policies AND "ALL" role policies (applies to both teachers and students)
  const active = policies.filter(p => p.isActive && (p.targetRole === targetRole || p.targetRole === "ALL"));

  // 1. Exact class match (only when className is non-empty)
  if (className) {
    const exact = active.find(p => p.applicableClasses.includes(className));
    if (exact) return toPolicyConfig(exact);
  }

  // 2. School-wide policy (empty applicableClasses = applies to all)
  const schoolWide = active.find(p => p.applicableClasses.length === 0);
  if (schoolWide) return toPolicyConfig(schoolWide);

  // 3. Best-effort fallback: use first active policy for this role.
  //    Covers teachers/students with no assigned class when only
  //    class-specific policies exist in the DB.
  if (active.length > 0) return toPolicyConfig(active[0]);

  return DEFAULT_POLICY;
}

function toPolicyConfig(row: PolicyRow): PolicyConfig {
  return {
    policyName: row.policyName,
    expectedArrivalTime: row.expectedArrivalTime,
    gracePeriodMinutes: row.gracePeriodMinutes,
    halfDayCutoffTime: row.halfDayCutoffTime,
    attendanceTarget: row.attendanceTarget,
  };
}

/** Check whether a check-in time makes the teacher "late" under the resolved policy */
export function isLateCheckIn(checkInUTC: Date, policy: PolicyConfig): boolean {
  const ist = utcToISTHHMM(checkInUTC);
  const result = evaluateAttendanceStatus(ist, policy);
  return result.status === "LATE" || result.status === "HALF_DAY";
}
