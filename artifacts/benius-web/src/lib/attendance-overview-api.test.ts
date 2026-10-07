import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceOverviewQueryKeys,
  requireAttendanceJson,
} from "./attendance-overview-api";

test("attendance cache keys isolate school, session, date, and class-section", () => {
  const sessionAFirst = attendanceOverviewQueryKeys.overview(2, 101, "2026-10-08");
  const sessionB = attendanceOverviewQueryKeys.overview(2, 102, "2026-10-08");
  const sessionAAgain = attendanceOverviewQueryKeys.overview(2, 101, "2026-10-08");

  assert.notDeepEqual(sessionAFirst, sessionB);
  assert.deepEqual(sessionAFirst, sessionAAgain);
  assert.notDeepEqual(sessionAFirst, attendanceOverviewQueryKeys.overview(3, 101, "2026-10-08"));
  assert.notDeepEqual(
    attendanceOverviewQueryKeys.classDetail(2, 101, "1", "A", "2026-10-08"),
    attendanceOverviewQueryKeys.classDetail(2, 101, "1", "B", "2026-10-08"),
  );
});

test("an unsuccessful attendance response rejects with a safe generic message", async () => {
  await assert.rejects(
    requireAttendanceJson(new Response("private server detail", { status: 403 }), "Unable to load attendance."),
    /Unable to load attendance\./,
  );
});

test("a successful empty attendance response remains valid data", async () => {
  const result = await requireAttendanceJson<{ enrolledTotal: number }>(
    new Response(JSON.stringify({ enrolledTotal: 0 }), { status: 200 }),
    "Unable to load attendance.",
  );
  assert.deepEqual(result, { enrolledTotal: 0 });
});
