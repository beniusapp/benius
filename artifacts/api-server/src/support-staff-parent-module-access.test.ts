import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { registerAdminCalendarRoutes } from "./admin-calendar-routes";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

test("Support Staff Timetable and School Calendar access uses parent grants and preserves school/session scope", async (t) => {
  const replacements: Array<{ name: string; hadOwn: boolean; original: unknown }> = [];
  const replaceStorage = (name: string, implementation: (...args: any[]) => any) => {
    const target = storage as any;
    replacements.push({
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(target, name),
      original: target[name],
    });
    target[name] = implementation;
  };
  const calls = {
    metadataReads: [] as number[],
    calendarReads: [] as number[],
    calendarRangeReads: [] as Array<[number, string, string]>,
    calendarCreates: [] as any[],
    recurringCalendarCreates: [] as any[][],
    calendarUpdates: [] as Array<[number, number, any]>,
    calendarDeletes: [] as Array<[number, number]>,
    classReads: [] as Array<[number, number, string, string]>,
    structureReads: [] as Array<[number, number, string]>,
    batchWrites: [] as Array<[number, number]>,
  };
  const sessions = [
    { id: 101, schoolId: 1, isActive: true },
    { id: 102, schoolId: 1, isActive: false },
    { id: 201, schoolId: 2, isActive: true },
  ];

  replaceStorage("getAllSchoolMetadata", async (schoolId: number) => {
    calls.metadataReads.push(schoolId);
    return { classes: ["5"], sections: ["A"], subjects: ["Mathematics"] };
  });
  replaceStorage("getClassSectionsMap", async (schoolId: number) => {
    calls.metadataReads.push(schoolId);
    return { "5": ["A"] };
  });
  replaceStorage("getCalendarEvents", async (schoolId: number) => {
    calls.calendarReads.push(schoolId);
    return [{ id: 1, schoolId, title: "Founders Day" }];
  });
  replaceStorage("getCalendarEventsByRange", async (
    schoolId: number,
    startDate: string,
    endDate: string,
  ) => {
    calls.calendarRangeReads.push([schoolId, startDate, endDate]);
    return [{ id: 1, schoolId, date: startDate }];
  });
  replaceStorage("createCalendarEvent", async (event: any) => {
    calls.calendarCreates.push(event);
    return { id: 2, ...event };
  });
  replaceStorage("createCalendarEvents", async (events: any[]) => {
    calls.recurringCalendarCreates.push(events);
    return events.map((event, index) => ({ id: index + 10, ...event }));
  });
  replaceStorage("updateCalendarEvent", async (
    id: number,
    schoolId: number,
    update: any,
  ) => {
    calls.calendarUpdates.push([id, schoolId, update]);
    return { id, schoolId, ...update };
  });
  replaceStorage("deleteCalendarEventBySchool", async (id: number, schoolId: number) => {
    calls.calendarDeletes.push([id, schoolId]);
    return true;
  });
  replaceStorage("getAcademicSessionForSchool", async (id: number, schoolId: number) =>
    sessions.find(session => session.id === id && session.schoolId === schoolId),
  );
  replaceStorage("getTimetableByClassSection", async (
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ) => {
    calls.classReads.push([schoolId, sessionId, cls, section]);
    return [{ schoolId, sessionId, class: cls, section, subject: "History" }];
  });
  replaceStorage("getTimetableStructure", async (
    schoolId: number,
    sessionId: number,
    cls: string,
  ) => {
    calls.structureReads.push([schoolId, sessionId, cls]);
    return [{ schoolId, sessionId, class: cls, periodNumber: 1 }];
  });
  replaceStorage("getTeacherById", async (id: number) => ({
    id,
    schoolId: 1,
    fullName: "Timetable Teacher",
  }));
  replaceStorage("upsertTimetableSlot", async (
    schoolId: number,
    sessionId: number,
    change: any,
  ) => {
    calls.batchWrites.push([schoolId, sessionId]);
    return { id: 3, schoolId, sessionId, ...change };
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
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "support_staff";
    const allowedModules = (req.get("x-test-grants") ?? "")
      .split(",")
      .filter(Boolean);
    const schoolId = Number(req.get("x-test-school") ?? 1);
    (req as any).session = role === "admin"
      ? { userId: 70, userRole: "admin", schoolId, allowedModules }
      : {
        userId: -7,
        staffId: 7,
        userRole: "support_staff",
        schoolId,
        allowedModules,
      };
    next();
  });
  registerAdminCalendarRoutes(app);
  registerTeacherRoutes(app);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      role?: "admin" | "support_staff";
      grants?: string[];
      schoolId?: number;
      viewSessionId?: number;
    } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.role ? { "x-test-role": options.role } : {}),
        ...(options.grants ? { "x-test-grants": options.grants.join(",") } : {}),
        ...(options.schoolId ? { "x-test-school": String(options.schoolId) } : {}),
        ...(options.viewSessionId
          ? { "x-view-session-id": String(options.viewSessionId) }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const deniedRequests = [
    await request("/api/admin/calendar/context"),
    await request("/api/admin/calendar?month=10&year=2026"),
    await request("/api/admin/calendar", {
      method: "POST",
      body: { title: "Holiday", eventType: "holiday", startDate: "2026-10-06" },
    }),
    await request("/api/admin/calendar/1", {
      method: "PATCH",
      body: { title: "Holiday", eventType: "holiday", date: "2026-10-06" },
    }),
    await request("/api/admin/calendar/1", { method: "DELETE" }),
    await request("/api/calendar/1"),
    await request("/api/calendar", {
      method: "POST",
      body: { title: "Holiday", date: "2026-10-06", eventType: "holiday", schoolId: 1 },
    }),
    await request("/api/calendar/1", { method: "DELETE" }),
    await request("/api/admin/timetable/context"),
    await request("/api/timetable/teacher/9"),
    await request("/api/timetable/school/1"),
    await request("/api/timetable/1", { method: "DELETE" }),
    await request("/api/timetable/publish", {
      method: "PATCH",
      body: { class: "5", section: "A" },
    }),
    await request("/api/timetable/class-status"),
    await request("/api/timetable/class-view?class=5&section=A"),
    await request("/api/timetable/slot-check?class=5&section=A&dayOfWeek=1&period=1"),
    await request("/api/timetable/admin/save-batch", {
      method: "POST",
      body: { changes: [] },
    }),
    await request("/api/timetable/structure?class=5"),
    await request("/api/timetable/structure", {
      method: "POST",
      body: { class: "5", rows: [] },
    }),
    await request("/api/timetable/structure/1", { method: "DELETE" }),
    await request("/api/timetable", {
      method: "POST",
      body: {
        teacherId: 9,
        dayOfWeek: 1,
        period: 1,
        class: "5",
        section: "A",
        subject: "Mathematics",
      },
    }),
  ];
  assert.deepEqual(deniedRequests.map(response => response.status), Array(21).fill(403));

  const legacyChildOnly = { grants: [
    "timetable:schedule",
    "timetable:publish",
    "school-calendar:events",
    "school-calendar:holidays",
  ] };
  assert.equal(
    (await request("/api/admin/timetable/context", legacyChildOnly)).status,
    403,
  );
  assert.equal(
    (await request("/api/admin/calendar/context", legacyChildOnly)).status,
    403,
  );
  assert.equal(
    (await request("/api/admin/calendar", legacyChildOnly)).status,
    403,
  );
  assert.equal(
    (await request("/api/timetable/class-view?class=5&section=A", {
      ...legacyChildOnly,
      viewSessionId: 101,
    })).status,
    403,
  );

  const timetableContext = await request("/api/admin/timetable/context", {
    grants: ["timetable"],
  });
  assert.equal(timetableContext.status, 200);
  assert.deepEqual(timetableContext.body, {
    classes: ["5"],
    sections: ["A"],
    subjects: ["Mathematics"],
  });
  const calendarContext = await request("/api/admin/calendar/context", {
    grants: ["school-calendar"],
  });
  assert.equal(calendarContext.status, 200);
  assert.deepEqual(calendarContext.body, {
    classes: ["5"],
    sections: ["A"],
    classSections: { "5": ["A"] },
  });
  const calendarMonth = await request("/api/admin/calendar?month=10&year=2026", {
    grants: ["school-calendar"],
  });
  assert.equal(calendarMonth.status, 200);
  assert.deepEqual(calls.calendarRangeReads, [[1, "2026-10-01", "2026-10-31"]]);
  const annualHoliday = await request("/api/admin/calendar", {
    method: "POST",
    grants: ["school-calendar"],
    body: {
      title: "Annual Holiday",
      eventType: "holiday",
      startDate: "2026-10-06",
      isRecurring: true,
      schoolId: 2,
    },
  });
  assert.equal(annualHoliday.status, 201);
  assert.equal(calls.recurringCalendarCreates[0].length, 101);
  assert.ok(calls.recurringCalendarCreates[0].every(event => event.schoolId === 1));
  const calendarUpdate = await request("/api/admin/calendar/12", {
    method: "PATCH",
    grants: ["school-calendar"],
    body: {
      title: "Updated Holiday",
      eventType: "holiday",
      date: "2026-10-06",
    },
  });
  assert.equal(calendarUpdate.status, 200);
  assert.equal(calls.calendarUpdates[0][0], 12);
  assert.equal(calls.calendarUpdates[0][1], 1);
  const adminCalendarDelete = await request("/api/admin/calendar/13", {
    method: "DELETE",
    grants: ["school-calendar"],
  });
  assert.equal(adminCalendarDelete.status, 200);
  assert.deepEqual(calls.calendarDeletes.at(-1), [13, 1]);

  const selectedSessionView = await request(
    "/api/timetable/class-view?class=5&section=A",
    { grants: ["timetable"], viewSessionId: 102 },
  );
  assert.equal(selectedSessionView.status, 200);
  assert.deepEqual(calls.classReads.at(-1), [1, 102, "5", "A"]);
  assert.deepEqual(calls.structureReads.at(-1), [1, 102, "5"]);

  const archivedWrite = await request("/api/timetable/admin/save-batch", {
    method: "POST",
    grants: ["timetable"],
    viewSessionId: 102,
    body: {
      changes: [{
        dayOfWeek: 1,
        period: 1,
        class: "5",
        section: "A",
        teacherId: 9,
        subject: "Mathematics",
      }],
    },
  });
  assert.equal(archivedWrite.status, 403);
  assert.equal(calls.batchWrites.length, 0);
  const activeWrite = await request("/api/timetable/admin/save-batch", {
    method: "POST",
    grants: ["timetable"],
    viewSessionId: 101,
    body: {
      changes: [{
        dayOfWeek: 1,
        period: 1,
        class: "5",
        section: "A",
        teacherId: 9,
        subject: "Mathematics",
      }],
    },
  });
  assert.equal(activeWrite.status, 200);
  assert.deepEqual(calls.batchWrites, [[1, 101]]);

  assert.equal(
    (await request("/api/timetable/school/2", {
      grants: ["timetable"],
      viewSessionId: 101,
    })).status,
    403,
  );
  assert.equal(
    (await request("/api/calendar/2", { grants: ["school-calendar"] })).status,
    403,
  );
  const calendarList = await request("/api/calendar/1", {
    grants: ["school-calendar"],
  });
  assert.equal(calendarList.status, 200);
  assert.deepEqual(calls.calendarReads, [1]);
  const calendarCreate = await request("/api/calendar", {
    method: "POST",
    grants: ["school-calendar"],
    body: {
      title: "Founders Day",
      date: "2026-10-06",
      eventType: "holiday",
      schoolId: 1,
    },
  });
  assert.equal(calendarCreate.status, 201);
  assert.equal(calls.calendarCreates[0].schoolId, 1);
  const calendarDelete = await request("/api/calendar/44", {
    method: "DELETE",
    grants: ["school-calendar"],
  });
  assert.equal(calendarDelete.status, 200);
  assert.deepEqual(calls.calendarDeletes, [[13, 1], [44, 1]]);

  const adminTimetableContext = await request("/api/admin/timetable/context", {
    role: "admin",
  });
  const adminCalendarContext = await request("/api/admin/calendar/context", {
    role: "admin",
  });
  const adminCalendarList = await request("/api/admin/calendar", { role: "admin" });
  assert.equal(adminTimetableContext.status, 200);
  assert.equal(adminCalendarContext.status, 200);
  assert.equal(adminCalendarList.status, 200);
});
