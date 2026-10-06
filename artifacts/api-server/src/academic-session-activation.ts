import { and, eq, inArray, sql } from "drizzle-orm";
import {
  academicSessions,
  enrollments,
  schoolMetadata,
  students,
  type AcademicSession,
} from "@workspace/db";
import { db } from "./db";
import {
  hasActiveStudentPlacementChanged,
  isConfiguredStudentPlacement,
  type StudentRegistryPlacementMetadata,
} from "./student-registry-placement";

export type AcademicSessionActivationTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ActivationStudentSnapshot {
  id: number;
  isActive: boolean;
  class: string;
  section: string;
  rollNumber: number | null;
}

export interface ActivationEnrollmentSnapshot {
  studentId: number;
  className: string;
  sectionName: string;
  rollNo: number | null;
  status: string;
}

export interface ActivationStudentState {
  id: number;
  isActive: boolean;
}

export interface ActivationPlacementCandidate {
  studentId: number;
  className: string;
  sectionName: string;
  rollNo: number | null;
  placementChanged: boolean;
}

export interface AcademicSessionActivationPreview {
  sessionId: number;
  sessionName: string;
  activeStudents: number;
  activeTargetSessionEnrollments: number;
  activeTargetEnrollmentsForActiveStudents: number;
  activeStudentsMissingTargetEnrollment: number;
  inactiveStudentsSkipped: number;
  studentsReadyToSynchronize: number;
  studentsNeedingRegistryUpdate: number;
  studentsWithUnchangedPlacement: number;
  duplicateActiveEnrollmentConflicts: number;
  foreignOrMissingStudentEnrollments: number;
  invalidTargetPlacements: number;
  canActivate: boolean;
}

export interface AcademicSessionActivationPlan {
  preview: AcademicSessionActivationPreview;
  placements: ActivationPlacementCandidate[];
}

export interface AcademicSessionActivationSummary {
  activeStudents: number;
  activeTargetSessionEnrollments: number;
  studentsSynchronized: number;
  studentsUpdated: number;
  studentsUnchanged: number;
  inactiveStudentsSkipped: number;
}

export interface AcademicSessionActivationResult {
  session: AcademicSession;
  summary: AcademicSessionActivationSummary;
}

export class AcademicSessionActivationNotFoundError extends Error {
  readonly code = "ACADEMIC_SESSION_NOT_FOUND";

  constructor() {
    super("Academic session not found for this school.");
    this.name = "AcademicSessionActivationNotFoundError";
  }
}

export class AcademicSessionActivationBlockedError extends Error {
  readonly code: string;

  constructor(readonly preview: AcademicSessionActivationPreview) {
    const reasons: string[] = [];
    if (preview.activeStudentsMissingTargetEnrollment > 0) {
      reasons.push(
        `${preview.activeStudentsMissingTargetEnrollment} active Student${preview.activeStudentsMissingTargetEnrollment === 1 ? "" : "s"} missing an Active enrollment in this session`,
      );
    }
    if (preview.duplicateActiveEnrollmentConflicts > 0) {
      reasons.push(
        `${preview.duplicateActiveEnrollmentConflicts} Student${preview.duplicateActiveEnrollmentConflicts === 1 ? "" : "s"} with duplicate Active target enrollments`,
      );
    }
    if (preview.foreignOrMissingStudentEnrollments > 0) {
      reasons.push(
        `${preview.foreignOrMissingStudentEnrollments} Active target enrollment${preview.foreignOrMissingStudentEnrollments === 1 ? "" : "s"} linked to a missing or different-school Student`,
      );
    }
    if (preview.invalidTargetPlacements > 0) {
      reasons.push(
        `${preview.invalidTargetPlacements} Active target enrollment${preview.invalidTargetPlacements === 1 ? "" : "s"} with an unconfigured class/section`,
      );
    }

    super(
      `Cannot activate this session: ${reasons.join("; ")}. No session or Student Registry changes were made.`,
    );
    this.name = "AcademicSessionActivationBlockedError";
    this.code = preview.activeStudentsMissingTargetEnrollment > 0
      && preview.duplicateActiveEnrollmentConflicts === 0
      && preview.foreignOrMissingStudentEnrollments === 0
      && preview.invalidTargetPlacements === 0
      ? "MISSING_TARGET_ENROLLMENTS"
      : "ACADEMIC_SESSION_ACTIVATION_BLOCKED";
  }
}

export function canManageAcademicSession(role: unknown): boolean {
  return role === "admin";
}

export function buildAcademicSessionActivationPlan(input: {
  sessionId: number;
  sessionName: string;
  activeStudents: ActivationStudentSnapshot[];
  targetEnrollments: ActivationEnrollmentSnapshot[];
  sameSchoolStudentStates: ActivationStudentState[];
  placementMetadata: StudentRegistryPlacementMetadata[];
}): AcademicSessionActivationPlan {
  const sameSchoolStudents = new Map(
    input.sameSchoolStudentStates.map((student) => [student.id, student]),
  );
  const activeStudents = new Map(
    input.activeStudents.map((student) => [student.id, student]),
  );
  const activeTargetEnrollments = input.targetEnrollments.filter(
    (enrollment) => enrollment.status === "Active",
  );
  const activeEnrollmentGroups = new Map<number, ActivationEnrollmentSnapshot[]>();

  for (const enrollment of activeTargetEnrollments) {
    const group = activeEnrollmentGroups.get(enrollment.studentId) ?? [];
    group.push(enrollment);
    activeEnrollmentGroups.set(enrollment.studentId, group);
  }

  const duplicateActiveEnrollmentConflicts = Array.from(activeEnrollmentGroups.values())
    .filter((group) => group.length > 1).length;
  const foreignOrMissingStudentEnrollments = activeTargetEnrollments.filter(
    (enrollment) => !sameSchoolStudents.has(enrollment.studentId),
  ).length;
  const activeTargetSessionEnrollments = activeTargetEnrollments.filter(
    (enrollment) => sameSchoolStudents.has(enrollment.studentId),
  ).length;
  const activeTargetEnrollmentsForActiveStudents = new Set(
    activeTargetEnrollments
      .filter((enrollment) => activeStudents.has(enrollment.studentId))
      .map((enrollment) => enrollment.studentId),
  ).size;
  const inactiveStudentsSkipped = new Set(
    activeTargetEnrollments
      .filter((enrollment) => {
        const student = sameSchoolStudents.get(enrollment.studentId);
        return student !== undefined && !student.isActive;
      })
      .map((enrollment) => enrollment.studentId),
  ).size;
  const invalidTargetPlacements = activeTargetEnrollments.filter((enrollment) =>
    sameSchoolStudents.has(enrollment.studentId)
    && !isConfiguredStudentPlacement(
      input.placementMetadata,
      enrollment.className,
      enrollment.sectionName,
    ),
  ).length;

  let activeStudentsMissingTargetEnrollment = 0;
  const placements: ActivationPlacementCandidate[] = [];

  for (const student of input.activeStudents) {
    const studentEnrollments = activeEnrollmentGroups.get(student.id) ?? [];
    if (studentEnrollments.length === 0) {
      activeStudentsMissingTargetEnrollment += 1;
      continue;
    }
    if (studentEnrollments.length !== 1) continue;

    const enrollment = studentEnrollments[0];
    if (!isConfiguredStudentPlacement(
      input.placementMetadata,
      enrollment.className,
      enrollment.sectionName,
    )) {
      continue;
    }

    placements.push({
      studentId: student.id,
      className: enrollment.className,
      sectionName: enrollment.sectionName,
      rollNo: enrollment.rollNo,
      placementChanged: hasActiveStudentPlacementChanged(student, {
        class: enrollment.className,
        section: enrollment.sectionName,
        rollNumber: enrollment.rollNo,
      }),
    });
  }

  const studentsNeedingRegistryUpdate = placements.filter(
    (placement) => placement.placementChanged,
  ).length;
  const preview: AcademicSessionActivationPreview = {
    sessionId: input.sessionId,
    sessionName: input.sessionName,
    activeStudents: input.activeStudents.length,
    activeTargetSessionEnrollments,
    activeTargetEnrollmentsForActiveStudents,
    activeStudentsMissingTargetEnrollment,
    inactiveStudentsSkipped,
    studentsReadyToSynchronize: placements.length,
    studentsNeedingRegistryUpdate,
    studentsWithUnchangedPlacement: placements.length - studentsNeedingRegistryUpdate,
    duplicateActiveEnrollmentConflicts,
    foreignOrMissingStudentEnrollments,
    invalidTargetPlacements,
    canActivate:
      activeStudentsMissingTargetEnrollment === 0
      && duplicateActiveEnrollmentConflicts === 0
      && foreignOrMissingStudentEnrollments === 0
      && invalidTargetPlacements === 0,
  };

  return { preview, placements };
}

export async function inspectAcademicSessionActivation(
  tx: AcademicSessionActivationTransaction,
  sessionId: number,
  schoolId: number,
  lockForActivation = false,
): Promise<{
  session: AcademicSession;
  plan: AcademicSessionActivationPlan;
}> {
  if (lockForActivation) {
    // Serialize activation transitions for this school without a schema change.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, 0)`);
    await tx
      .select({ id: academicSessions.id })
      .from(academicSessions)
      .where(eq(academicSessions.schoolId, schoolId))
      .orderBy(academicSessions.id)
      .for("update");
  }

  const [session] = await tx
    .select()
    .from(academicSessions)
    .where(and(
      eq(academicSessions.id, sessionId),
      eq(academicSessions.schoolId, schoolId),
    ))
    .limit(1);
  if (!session) throw new AcademicSessionActivationNotFoundError();

  const activeStudents = lockForActivation
    ? await tx
      .select({
        id: students.id,
        isActive: students.isActive,
        class: students.class,
        section: students.section,
        rollNumber: students.rollNumber,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.isActive, true)))
      .orderBy(students.id)
      .for("update")
    : await tx
      .select({
        id: students.id,
        isActive: students.isActive,
        class: students.class,
        section: students.section,
        rollNumber: students.rollNumber,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.isActive, true)))
      .orderBy(students.id);

  const targetEnrollments = lockForActivation
    ? await tx
      .select({
        studentId: enrollments.studentId,
        className: enrollments.className,
        sectionName: enrollments.sectionName,
        rollNo: enrollments.rollNo,
        status: enrollments.status,
      })
      .from(enrollments)
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      ))
      .orderBy(enrollments.studentId, enrollments.id)
      .for("update")
    : await tx
      .select({
        studentId: enrollments.studentId,
        className: enrollments.className,
        sectionName: enrollments.sectionName,
        rollNo: enrollments.rollNo,
        status: enrollments.status,
      })
      .from(enrollments)
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      ))
      .orderBy(enrollments.studentId, enrollments.id);

  const targetStudentIds = [...new Set(
    targetEnrollments
      .filter((enrollment) => enrollment.status === "Active")
      .map((enrollment) => enrollment.studentId),
  )];
  const sameSchoolStudentStates = targetStudentIds.length === 0
    ? []
    : lockForActivation
      ? await tx
        .select({ id: students.id, isActive: students.isActive })
        .from(students)
        .where(and(
          eq(students.schoolId, schoolId),
          inArray(students.id, targetStudentIds),
        ))
        .orderBy(students.id)
        .for("update")
      : await tx
        .select({ id: students.id, isActive: students.isActive })
        .from(students)
        .where(and(
          eq(students.schoolId, schoolId),
          inArray(students.id, targetStudentIds),
        ))
        .orderBy(students.id);

  const placementMetadata = await tx
    .select({
      metaKey: schoolMetadata.metaKey,
      metaValue: schoolMetadata.metaValue,
    })
    .from(schoolMetadata)
    .where(and(
      eq(schoolMetadata.schoolId, schoolId),
      inArray(schoolMetadata.metaKey, ["classes", "sections", "class_sections"]),
    ));

  return {
    session,
    plan: buildAcademicSessionActivationPlan({
      sessionId,
      sessionName: session.sessionName,
      activeStudents,
      targetEnrollments,
      sameSchoolStudentStates,
      placementMetadata,
    }),
  };
}

export async function activateAcademicSessionInTransaction(
  tx: AcademicSessionActivationTransaction,
  sessionId: number,
  schoolId: number,
): Promise<AcademicSessionActivationResult> {
  const { plan } = await inspectAcademicSessionActivation(tx, sessionId, schoolId, true);
  if (!plan.preview.canActivate) {
    throw new AcademicSessionActivationBlockedError(plan.preview);
  }

  // No session or Student writes occur until every target placement is valid.
  await tx
    .update(academicSessions)
    .set({ isActive: false, status: "archived" })
    .where(eq(academicSessions.schoolId, schoolId));

  const [session] = await tx
    .update(academicSessions)
    .set({ isActive: true, status: "active" })
    .where(and(
      eq(academicSessions.id, sessionId),
      eq(academicSessions.schoolId, schoolId),
    ))
    .returning();
  if (!session) throw new AcademicSessionActivationNotFoundError();

  let studentsUpdated = 0;
  for (const placement of plan.placements) {
    if (!placement.placementChanged) continue;
    const [updatedStudent] = await tx
      .update(students)
      .set({
        class: placement.className,
        section: placement.sectionName,
        rollNumber: placement.rollNo,
        idCardPendingReissue: true,
      })
      .where(and(
        eq(students.id, placement.studentId),
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
      ))
      .returning({ id: students.id });
    if (!updatedStudent) {
      throw new Error("Student placement changed during session activation; all changes were rolled back.");
    }
    studentsUpdated += 1;
  }

  return {
    session,
    summary: {
      activeStudents: plan.preview.activeStudents,
      activeTargetSessionEnrollments: plan.preview.activeTargetSessionEnrollments,
      studentsSynchronized: plan.preview.studentsReadyToSynchronize,
      studentsUpdated,
      studentsUnchanged: plan.preview.studentsWithUnchangedPlacement,
      inactiveStudentsSkipped: plan.preview.inactiveStudentsSkipped,
    },
  };
}
