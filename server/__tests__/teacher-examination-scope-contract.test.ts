import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routesSource = readFileSync(resolve(process.cwd(), "server/teacher-routes.ts"), "utf8");
const storageSource = readFileSync(resolve(process.cwd(), "server/storage.ts"), "utf8");

function routeBlock(route: string, nextMarker: string): string {
  const start = routesSource.indexOf(route);
  const end = routesSource.indexOf(nextMarker, start + route.length);
  return routesSource.slice(start, end);
}

describe("Teacher Examination isolation source contract", () => {
  it("uses the validated teacher context for every directly-used score route, including publish", () => {
    const scoreSave = routeBlock('app.post("/api/exam-scores"', 'app.post("/api/exam-scores/publish"');
    const publish = routeBlock('app.post("/api/exam-scores/publish"', '// IMPORTANT: specific routes');
    const average = routeBlock('app.get("/api/exam-scores/class-average/:schoolId', 'app.get("/api/exam-scores/student/:studentId');
    const timeline = routeBlock('app.get("/api/exam-scores/student/:studentId', 'app.get("/api/exam-scores/:schoolId');
    const existingMarks = routeBlock('app.get("/api/exam-scores/:schoolId', '// ===== SCHOOL CONFIG');
    const results = routeBlock('app.get("/api/teacher/class-scores/:class/:section"', 'app.get("/api/teacher/attendance-summary/:class/:section"');

    for (const block of [scoreSave, publish, average, timeline, existingMarks, results]) {
      expect(block).toContain("resolveTeacherExaminationContext(req, res)");
      expect(block).toContain("context.schoolId");
      expect(block).toContain("context.sessionId");
    }
    expect(existingMarks).not.toContain("parseInt(schoolId)");
  });

  it("keeps score identity and reads school-and-session scoped without NULL-session matching", () => {
    const upsert = storageSource.slice(storageSource.indexOf("async upsertExamScores"), storageSource.indexOf("async publishExamScores"));
    expect(upsert).toContain("eq(examScores.schoolId, score.schoolId)");
    expect(upsert).toContain("eq(examScores.sessionId, score.sessionId)");
    expect(upsert).not.toContain("or(eq(examScores.sessionId");
  });

  it("keeps Results roster on active Student Registry without enrollment or faculty mapping", () => {
    const results = routeBlock('app.get("/api/teacher/class-scores/:class/:section"', 'app.get("/api/teacher/attendance-summary/:class/:section"');
    expect(results).toContain("getStudentsByClassSection(schoolId, cls, section)");
    expect(results).not.toContain("getStudentsByClassSectionInSession");
    expect(results).not.toContain("enrollment");
    expect(results).not.toContain("FacultyMappings");
  });
});