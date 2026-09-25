import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const routesSource = fs.readFileSync(path.join(root, "server/routes.ts"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "server/storage.ts"), "utf8");
const clientSource = fs.readFileSync(path.join(root, "client/src/pages/student-examination.tsx"), "utf8");

function routeBlock(start: string, end: string): string {
  const from = routesSource.indexOf(start);
  const to = routesSource.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return routesSource.slice(from, to);
}

describe("Student Examination selected-session contract", () => {
  it("transports the selected session in the actual all-scores request", () => {
    expect(clientSource).toContain('sessionFetchForViewSession(');
    expect(clientSource).toContain('"/api/student/exam/all-scores", selectedClass, selectedSessionId');
    expect(clientSource).toContain("selectedSessionId !== null");
  });

  it("fails closed and passes the validated session to all score retrieval", () => {
    const block = routeBlock(
      'app.get("/api/student/exam/all-scores"',
      "// ===== STUDENT CLASSWORK ROUTES =====",
    );
    expect(block).toContain("resolveStudentExaminationSession(");
    expect(block).toContain("(req as any).viewSessionId");
    expect(block).toContain("getStudentAllExamScores(schoolId, student.id, cls, sessionId)");
    expect(block).not.toContain("viewSessionId ?? null");
  });

  it("uses the same validated session for student scores and class rank", () => {
    const block = routeBlock(
      'app.get("/api/student/exam/scores"',
      'app.get("/api/student/exam/journey"',
    );
    expect(block).toContain("resolveStudentExaminationSession(");
    expect(block).toContain("getStudentExamScores(schoolId, student.id, cls, examType, sessionId)");
    expect(block).toContain("getClassRank(schoolId, cls, student.section, examType, student.id, sessionId)");
  });

  it("uses exact score-session predicates so other and NULL sessions cannot enter", () => {
    const scoreStart = storageSource.indexOf("async getStudentExamScores(");
    const rankEnd = storageSource.indexOf("async getClassAverages(", scoreStart);
    const block = storageSource.slice(scoreStart, rankEnd);
    expect(block.match(/eq\(examScores\.sessionId, sessionId\)/g)).toHaveLength(3);
    expect(block).toContain("if (sessionId != null)");
  });
});