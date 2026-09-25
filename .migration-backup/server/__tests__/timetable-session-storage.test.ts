import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { academicSessions, schools, teachers, timetableEntries, timetableStructure, users } from "@shared/schema";

describe("Timetable school and academic-session storage contract", () => {
  const schoolIds: number[] = [];
  let schoolId: number;
  let teacherId: number;
  let firstSessionId: number;
  let secondSessionId: number;
  let foreignSessionId: number;

  const slot = () => ({
    dayOfWeek: 0, period: 1, class: "5", section: "A",
    teacherId, subject: "Mathematics",
  });
  const period = (startTime: string) => ({
    periodNumber: 1, label: "Period 1", startTime, endTime: "09:00",
    isBreak: false, sortOrder: 0,
  });

  beforeAll(async () => {
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 10000).toString(36)}`;
    const [firstSchool] = await db.insert(schools).values({ name: `Timetable Test ${suffix}`, code: `TT-${suffix}` }).returning();
    const [otherSchool] = await db.insert(schools).values({ name: `Other Timetable Test ${suffix}`, code: `TX-${suffix}` }).returning();
    schoolIds.push(firstSchool.id, otherSchool.id);
    schoolId = firstSchool.id;
    const [user] = await db.insert(users).values({
      schoolId, role: "teacher", email: `tt-${suffix}@example.test`, passwordHash: "test",
    }).returning();
    const [teacher] = await db.insert(teachers).values({
      schoolId, userId: user.id, fullName: "Timetable Test Teacher", phone: "0000000000",
      subject: "Mathematics", assignedClass: "5", assignedSection: "A",
    }).returning();
    teacherId = teacher.id;
    const [first, second, foreign] = await db.insert(academicSessions).values([
      { schoolId, sessionName: "first", startDate: "2025-04-01", endDate: "2026-03-31", isActive: true, status: "active" },
      { schoolId, sessionName: "second", startDate: "2026-04-01", endDate: "2027-03-31", isActive: false, status: "archived" },
      { schoolId: otherSchool.id, sessionName: "foreign", startDate: "2025-04-01", endDate: "2026-03-31", isActive: true, status: "active" },
    ]).returning();
    firstSessionId = first.id;
    secondSessionId = second.id;
    foreignSessionId = foreign.id;
  });

  beforeEach(async () => {
    await db.delete(timetableEntries).where(eq(timetableEntries.schoolId, schoolId));
    await db.delete(timetableStructure).where(eq(timetableStructure.schoolId, schoolId));
    await db.update(academicSessions).set({ isActive: false, status: "archived" })
      .where(and(eq(academicSessions.schoolId, schoolId), eq(academicSessions.id, secondSessionId)));
    await db.update(academicSessions).set({ isActive: true, status: "active" })
      .where(and(eq(academicSessions.schoolId, schoolId), eq(academicSessions.id, firstSessionId)));
  });

  afterAll(async () => {
    if (schoolIds.length) await db.delete(schools).where(inArray(schools.id, schoolIds));
  });

  it("A: rejects a missing academic session rather than returning school-wide data", async () => {
    await expect((storage.getTimetableBySchool as any)(schoolId, undefined)).rejects.toThrow(/session/i);
    await expect((storage.getTimetableStructure as any)(schoolId, undefined, "5")).rejects.toThrow(/session/i);
    await expect(storage.createTimetableEntry({ ...slot(), schoolId, sessionId: undefined as any })).rejects.toThrow(/session/i);
  });

  it("B: accepts a valid school-owned session and scopes reads", async () => {
    const created = await storage.upsertTimetableSlot(schoolId, firstSessionId, slot());
    expect(created.sessionId).toBe(firstSessionId);
    expect((await storage.getTimetableByTeacher(schoolId, firstSessionId, teacherId)).map(row => row.id)).toEqual([created.id]);
    expect((await storage.getTimetableByClassSection(schoolId, firstSessionId, "5", "A")).map(row => row.id)).toEqual([created.id]);
  });

  it("C: rejects another school's session for reads and writes", async () => {
    await expect(storage.getTimetableBySchool(schoolId, foreignSessionId)).rejects.toThrow(/does not belong/i);
    await expect(storage.upsertTimetableSlot(schoolId, foreignSessionId, slot())).rejects.toThrow(/does not belong/i);
    await expect(storage.saveTimetableStructure(schoolId, foreignSessionId, "5", [period("08:00")])).rejects.toThrow(/does not belong/i);
  });

  it("D: blocks archived-session mutations, including status and structure", async () => {
    await expect(storage.upsertTimetableSlot(schoolId, secondSessionId, slot())).rejects.toThrow(/read-only/i);
    await expect(storage.updateTimetableEntryStatus(schoolId, secondSessionId, "5", "A", "published")).rejects.toThrow(/read-only/i);
    await expect(storage.deleteTimetableSlot(schoolId, secondSessionId, "5", "A", 0, 1)).rejects.toThrow(/read-only/i);
    await expect(storage.saveTimetableStructure(schoolId, secondSessionId, "5", [period("08:00")])).rejects.toThrow(/read-only/i);
  });

  it("E: identical slots coexist in separate sessions", async () => {
    const first = await storage.upsertTimetableSlot(schoolId, firstSessionId, slot());
    await db.update(academicSessions).set({ isActive: false, status: "archived" }).where(eq(academicSessions.id, firstSessionId));
    await db.update(academicSessions).set({ isActive: true, status: "active" }).where(eq(academicSessions.id, secondSessionId));
    const second = await storage.upsertTimetableSlot(schoolId, secondSessionId, { ...slot(), subject: "English" });
    expect(first.id).not.toBe(second.id);
    expect((await db.select().from(timetableEntries).where(eq(timetableEntries.schoolId, schoolId)))).toHaveLength(2);
  });

  it("F: reads, occupancy checks, and deletions affect only the selected session", async () => {
    const first = await storage.upsertTimetableSlot(schoolId, firstSessionId, slot());
    await db.update(academicSessions).set({ isActive: false, status: "archived" }).where(eq(academicSessions.id, firstSessionId));
    await db.update(academicSessions).set({ isActive: true, status: "active" }).where(eq(academicSessions.id, secondSessionId));
    const second = await storage.upsertTimetableSlot(schoolId, secondSessionId, { ...slot(), subject: "English" });
    expect((await storage.getTimetableBySchool(schoolId, firstSessionId)).map(row => row.id)).toEqual([first.id]);
    expect((await storage.getTimetableBySchool(schoolId, secondSessionId)).map(row => row.id)).toEqual([second.id]);
    expect(await storage.checkSlotOccupancy(schoolId, secondSessionId, "5", "A", 0, 1)).toMatchObject({ subject: "English" });
    expect(await storage.deleteTimetableSlot(schoolId, secondSessionId, "5", "A", 0, 1)).toBe(true);
    expect(await storage.getTimetableEntryById(first.id, schoolId, firstSessionId)).not.toBeNull();
  });

  it("G: bell timings and breaks remain independent between sessions", async () => {
    await storage.saveTimetableStructure(schoolId, firstSessionId, "5", [
      period("08:00"),
      { periodNumber: 0, label: "Break", startTime: "09:00", endTime: "09:10", isBreak: true, sortOrder: 1 },
      { periodNumber: 0, label: "Lunch", startTime: "12:00", endTime: "12:30", isBreak: true, sortOrder: 2 },
    ]);
    await db.update(academicSessions).set({ isActive: false, status: "archived" }).where(eq(academicSessions.id, firstSessionId));
    await db.update(academicSessions).set({ isActive: true, status: "active" }).where(eq(academicSessions.id, secondSessionId));
    await storage.saveTimetableStructure(schoolId, secondSessionId, "5", [period("08:30")]);
    expect((await storage.getTimetableStructure(schoolId, firstSessionId, "5")).map(row => row.startTime)).toEqual(["08:00", "09:00", "12:00"]);
    expect((await storage.getTimetableStructure(schoolId, secondSessionId, "5")).map(row => row.startTime)).toEqual(["08:30"]);
  });

  it("H: session columns are NOT NULL and there are no NULL-session rows", async () => {
    const columns = await pool.query<{ table_name: string; is_nullable: string }>(
      "SELECT table_name, is_nullable FROM information_schema.columns WHERE table_name IN ('timetable_entries', 'timetable_structure') AND column_name = 'session_id'"
    );
    expect(columns.rows).toHaveLength(2);
    expect(columns.rows.every(row => row.is_nullable === "NO")).toBe(true);
    const counts = await pool.query<{ entry_nulls: string; structure_nulls: string }>(
      "SELECT (SELECT count(*) FROM timetable_entries WHERE session_id IS NULL) AS entry_nulls, (SELECT count(*) FROM timetable_structure WHERE session_id IS NULL) AS structure_nulls"
    );
    expect(Number(counts.rows[0].entry_nulls)).toBe(0);
    expect(Number(counts.rows[0].structure_nulls)).toBe(0);
  });
});