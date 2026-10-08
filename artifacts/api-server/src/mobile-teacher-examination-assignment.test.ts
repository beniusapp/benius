import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import test from "node:test";
import { storage } from "./storage";
import { registerMobileTeacherModuleRoutes } from "./mobile-teacher-module-routes";

test("Mobile Teacher examination writes still require assigned class and subject", async t => {
  const replacements: Array<{ name: string; hadOwn: boolean; original: unknown }> = [];
  const replace = (name: string, implementation: (...args: any[]) => any) => {
    replacements.push({
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(storage, name),
      original: (storage as any)[name],
    });
    (storage as any)[name] = implementation;
  };

  const session = {
    id: 42,
    schoolId: 11,
    isActive: true,
    sessionName: "2026-2027",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "active",
  };
  const teacherAccount = {
    teacher: {
      id: 7,
      userId: 8,
      schoolId: 11,
      fullName: "Teacher One",
      assignedClass: "5",
      assignedSection: "A",
      subject: "Mathematics",
      isActive: true,
      mustChangePassword: false,
    },
    school: { id: 11 },
    user: { id: 8, schoolId: 11, role: "teacher", isActive: true },
  };
  const mapping = [{ className: "5", section: "A", subject: "Mathematics" }];
  const savedBatches: any[][] = [];

  replace("getTeacherWithSchool", async (teacherId: number) =>
    teacherId === teacherAccount.teacher.id ? teacherAccount : undefined
  );
  replace("getFacultyMappingsByTeacher", async () => mapping);
  replace("getAcademicSessionForSchool", async (sessionId: number, schoolId: number) =>
    sessionId === session.id && schoolId === session.schoolId ? session : undefined
  );
  replace("getClassExamTypesMap", async () => ({ "5": ["Term 1"] }));
  replace("getAttendanceRosterForSessionClass", async () => [{ id: 10 }]);
  replace("resolveClassPassPolicy", async () => ({ passPercentage: 35 }));
  replace("upsertExamScores", async (scores: any[]) => {
    savedBatches.push(scores);
    return scores;
  });

  t.after(() => {
    const target = storage as any;
    for (const { name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  const app = express();
  app.use(express.json());
  const pass: RequestHandler = (_req, _res, next) => next();
  const requireBearer: RequestHandler = (req, _res, next) => {
    (req as any).mobileAuth = {
      principal: { id: 7, principalId: 8, entityId: 7, role: "teacher", schoolId: 11 },
    };
    next();
  };
  const requireAcademicSession: RequestHandler = (req, _res, next) => {
    (req as any).mobileAcademicSession = session;
    next();
  };
  registerMobileTeacherModuleRoutes(app, pass, requireBearer, requireAcademicSession);

  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(body: unknown) {
    const response = await fetch(`${baseUrl}/api/mobile/teacher/modules/examination/save-scores`, {
      method: "POST",
      headers: { connection: "close", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const baseSubmission = {
    className: "5",
    section: "A",
    subject: "Mathematics",
    examType: "Term 1",
    totalMarks: 100,
    scores: [{ studentId: 10, marks: 72, isAbsent: false }],
  };

  const unassignedClass = await request({ ...baseSubmission, className: "6" });
  assert.equal(unassignedClass.status, 403);
  assert.match(unassignedClass.body.message, /class and section are not assigned/i);

  const unassignedSubject = await request({ ...baseSubmission, subject: "Science" });
  assert.equal(unassignedSubject.status, 403);
  assert.match(unassignedSubject.body.message, /subject is not assigned/i);
  assert.equal(savedBatches.length, 0);

  const assignedScope = await request(baseSubmission);
  assert.equal(assignedScope.status, 200);
  assert.equal(savedBatches.length, 1);
  assert.deepEqual(
    [savedBatches[0][0].schoolId, savedBatches[0][0].sessionId, savedBatches[0][0].class, savedBatches[0][0].subject],
    [11, 42, "5", "Mathematics"],
  );
  assert.equal(savedBatches[0][0].published, undefined);
});
