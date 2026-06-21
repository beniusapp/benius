/**
 * Attendance Policy Engine
 * Centralised, reusable evaluation logic – no hardcoded timings anywhere else.
 */

export interface PolicyConfig {
  policyName: string;
  expectedArrivalTime: string;   // "HH:MM" in IST
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;     // "HH:MM" in IST
  schoolEndTime: string;         // "HH:MM" in IST — check-in after this → LEAVE
  attendanceTarget: number;      // % (e.g. 85)
}

export type AttendanceStatus = "PRESENT" | "LATE" | "HALF_DAY" | "LEAVE";

export interface EvaluationResult {
  status: AttendanceStatus;
  displayStatus: string;         // "Present" | "Late" | "Half Day" | "Leave"
  policyApplied: string;
  evaluatedAt: Date;
}

/** Fallback used when no policy is configured for the school/class/role */
export const DEFAULT_POLICY: PolicyConfig = {
  policyName: "System Default",
  expectedArrivalTime: "09:00",
  gracePeriodMinutes: 0,
  halfDayCutoffTime: "12:00",
  schoolEndTime: "17:00",
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
 * Rules (in priority order):
 *   checkIn > schoolEndTime             →  LEAVE    (school has ended)
 *   checkIn ≤ expectedArrival + grace   →  PRESENT
 *   checkIn ≤ halfDayCutoff             →  LATE
 *   checkIn > halfDayCutoff             →  HALF_DAY
 */
export function evaluateAttendanceStatus(
  checkInTimeIST: string,
  policy: PolicyConfig,
): EvaluationResult {
  const checkInMin   = timeToMinutes(checkInTimeIST);
  const arrivalMin   = timeToMinutes(policy.expectedArrivalTime);
  const graceLimit   = arrivalMin + policy.gracePeriodMinutes;
  const halfDayMin   = timeToMinutes(policy.halfDayCutoffTime);
  const schoolEndMin = timeToMinutes(policy.schoolEndTime);

  let status: AttendanceStatus;
  if (checkInMin > schoolEndMin) {
    status = "LEAVE";
  } else if (checkInMin <= graceLimit) {
    status = "PRESENT";
  } else if (checkInMin <= halfDayMin) {
    status = "LATE";
  } else {
    status = "HALF_DAY";
  }

  const displayMap: Record<AttendanceStatus, string> = {
    PRESENT:  "Present",
    LATE:     "Late",
    HALF_DAY: "Half Day",
    LEAVE:    "Leave",
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
  schoolEndTime: string;
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
  const active = policies.filter(p => p.isActive && (p.targetRole === targetRole || p.targetRole === "ALL"));

  if (className) {
    const exact = active.find(p => p.applicableClasses.includes(className));
    if (exact) return toPolicyConfig(exact);
  }

  const schoolWide = active.find(p => p.applicableClasses.length === 0);
  if (schoolWide) return toPolicyConfig(schoolWide);

  if (active.length > 0) return toPolicyConfig(active[0]);

  return DEFAULT_POLICY;
}

function toPolicyConfig(row: PolicyRow): PolicyConfig {
  return {
    policyName:           row.policyName,
    expectedArrivalTime:  row.expectedArrivalTime,
    gracePeriodMinutes:   row.gracePeriodMinutes,
    halfDayCutoffTime:    row.halfDayCutoffTime,
    schoolEndTime:        row.schoolEndTime,
    attendanceTarget:     row.attendanceTarget,
  };
}

/**
 * Check whether a check-in makes a teacher "late" (not counting LEAVE — that's
 * handled separately in the calling code).
 */
export function isLateCheckIn(checkInUTC: Date, policy: PolicyConfig): boolean {
  const ist = utcToISTHHMM(checkInUTC);
  const result = evaluateAttendanceStatus(ist, policy);
  return result.status === "LATE" || result.status === "HALF_DAY";
}
