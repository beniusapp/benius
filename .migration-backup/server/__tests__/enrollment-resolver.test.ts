import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  academicSessions,
  enrollments,
  schools,
  students,
} from "@shared/schema";

const schoolIds: number[] = [];
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const codeSuffix = Math.random().toString(36).slice(2, 10);

let schoolAId = 0;
let schoolBId = 0;
let studentAId = 0;
let studentBId = 0;
let sessionAId = 0;
let sessionBId = 0;
let enrollmentAId = 0;

beforeAll(async () => {
  const [schoolA, schoolB] = await db.insert(schools).values([
    { name: `Enrollment Resolver School A ${suffix}`, code: `ERSA-${codeSuffix}` },
    { name: `Enrollment Resolver School B ${suffix}`, code: `ERSB-${codeSuffix}` },
  ]).returning({ id: schools.id });
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;
  schoolIds.push(schoolAId, schoolBId);

  const [studentA, studentB] = await db.insert(students).values([
    {
      schoolId: schoolAId,
      digitalStudentId: `ERS-A-${suffix}`,
      name: "Resolver Student A",
      class: "7",
      section: "A",
      phone: "9000000001",
      dob: "2013-01-01",
      passwordHash: "test-only",
    },
    {
      schoolId: schoolBId,
      digitalStudentId: `ERS-B-${suffix}`,
      name: "Resolver Student B",
      class: "8",
      section: "B",
      phone: "9000000002",
      dob: "2012-01-01",
      passwordHash: "test-only",
    },
  ]).returning({ id: students.id });
  studentAId = studentA.id;
  studentBId = studentB.id;

  const [sessionA, sessionB] = await db.insert(academicSessions).values([
    {
      schoolId: schoolAId,
      sessionName: `Resolver-A-${suffix}`,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    },
    {
      schoolId: schoolBId,
      sessionName: `Resolver-B-${suffix}`,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    },
  ]).returning({ id: academicSessions.id });
  sessionAId = sessionA.id;
  sessionBId = sessionB.id;

  const [enrollmentA] = await db.insert(enrollments).values({
    schoolId: schoolAId,
    studentId: studentAId,
    sessionId: sessionAId,
    className: "7",
    sectionName: "C",
    status: "CustomStatus",
  }).returning({ id: enrollments.id });
  enrollmentAId = enrollmentA.id;

  // The current schema permits independently valid foreign keys whose tenant
  // columns disagree. The resolver must not expose such a relationship.
  await db.insert(enrollments).values({
    schoolId: schoolAId,
    studentId: studentBId,
    sessionId: sessionBId,
    className: "8",
    sectionName: "D",
    status: "Active",
  });
}, 30_000);

afterAll(async () => {
  if (schoolIds.length) {
    await db.delete(schools).where(inArray(schools.id, schoolIds));
  }
});

describe("resolveEnrollmentForStudentSession", () => {
  it("returns the authoritative enrollment, class, and section", async () => {
    const result = await storage.resolveEnrollmentForStudentSession(
      schoolAId,
      studentAId,
      sessionAId,
    );

    expect(result).toMatchObject({
      id: enrollmentAId,
      schoolId: schoolAId,
      studentId: studentAId,
      sessionId: sessionAId,
      className: "7",
      sectionName: "C",
      status: "CustomStatus",
    });
  });

  it("returns undefined when the enrollment is missing", async () => {
    expect(await storage.resolveEnrollmentForStudentSession(
      schoolAId,
      studentAId,
      sessionBId,
    )).toBeUndefined();
  });

  it("does not resolve a Student owned by another school", async () => {
    expect(await storage.resolveEnrollmentForStudentSession(
      schoolAId,
      studentBId,
      sessionAId,
    )).toBeUndefined();
  });

  it("does not resolve an Academic Session owned by another school", async () => {
    expect(await storage.resolveEnrollmentForStudentSession(
      schoolAId,
      studentAId,
      sessionBId,
    )).toBeUndefined();
  });

  it("does not expose a cross-tenant enrollment permitted by single-column foreign keys", async () => {
    expect(await storage.resolveEnrollmentForStudentSession(
      schoolAId,
      studentBId,
      sessionBId,
    )).toBeUndefined();
  });
});