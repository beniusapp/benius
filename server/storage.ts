import { schools, students, users, type School, type InsertSchool, type Student, type InsertStudent, type User, type InsertUser } from "@shared/schema";
import { db } from "./db";
import { pool } from "./db";
import { eq, sql, like, count, and } from "drizzle-orm";

export interface IStorage {
  getSchools(): Promise<School[]>;
  getSchool(id: number): Promise<School | undefined>;
  getSchoolByCode(code: string): Promise<School | undefined>;
  createSchoolWithPrincipal(school: InsertSchool, email: string, passwordHash: string): Promise<School>;
  deleteSchool(id: number): Promise<boolean>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserWithSchool(userId: number): Promise<{ user: User; school: School } | undefined>;
  getStudentsBySchool(schoolId: number): Promise<Student[]>;
  getStudentCountBySchool(schoolId: number): Promise<number>;
  getMaxDsidSerialForSchool(schoolCode: string): Promise<number>;
  bulkCreateStudents(studentRecords: InsertStudent[]): Promise<Student[]>;
  createStudent(student: InsertStudent): Promise<Student>;
  getStudentByDsid(dsid: string): Promise<Student | undefined>;
  getStudentByDsidPhoneDob(dsid: string, phone: string, dob: string): Promise<Student | undefined>;
  activateStudent(studentId: number, passwordHash: string): Promise<Student>;
  getStudentWithSchool(studentId: number): Promise<{ student: Student; school: School } | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getSchools(): Promise<School[]> {
    return await db.select().from(schools);
  }

  async getSchool(id: number): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.id, id));
    return school || undefined;
  }

  async getSchoolByCode(code: string): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.code, code));
    return school || undefined;
  }

  async createSchoolWithPrincipal(insertSchool: InsertSchool, email: string, passwordHash: string): Promise<School> {
    return await db.transaction(async (tx) => {
      const [school] = await tx.insert(schools).values(insertSchool).returning();
      await tx.insert(users).values({
        email,
        passwordHash,
        role: "admin",
        schoolId: school.id,
      });
      return school;
    });
  }

  async deleteSchool(id: number): Promise<boolean> {
    const result = await db.delete(schools).where(eq(schools.id, id)).returning();
    return result.length > 0;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserWithSchool(userId: number): Promise<{ user: User; school: School } | undefined> {
    const result = await db
      .select()
      .from(users)
      .innerJoin(schools, eq(users.schoolId, schools.id))
      .where(eq(users.id, userId));
    if (result.length === 0) return undefined;
    return { user: result[0].users, school: result[0].schools };
  }

  async getStudentsBySchool(schoolId: number): Promise<Student[]> {
    return await db.select().from(students).where(eq(students.schoolId, schoolId));
  }

  async getStudentCountBySchool(schoolId: number): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(students)
      .where(eq(students.schoolId, schoolId));
    return result?.value ?? 0;
  }

  async getMaxDsidSerialForSchool(schoolCode: string): Promise<number> {
    const prefix = `${schoolCode}-`;
    const rows = await db
      .select({ digitalStudentId: students.digitalStudentId })
      .from(students)
      .where(like(students.digitalStudentId, `${prefix}%`));

    let max = 0;
    for (const row of rows) {
      const suffix = row.digitalStudentId.replace(prefix, "");
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > max) {
        max = num;
      }
    }
    return max;
  }

  async bulkCreateStudents(studentRecords: InsertStudent[]): Promise<Student[]> {
    if (studentRecords.length === 0) return [];
    return await db.transaction(async (tx) => {
      const created = await tx.insert(students).values(studentRecords).returning();
      return created;
    });
  }

  async createStudent(insertStudent: InsertStudent): Promise<Student> {
    const [student] = await db.insert(students).values(insertStudent).returning();
    return student;
  }

  async getStudentByDsid(dsid: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.digitalStudentId, dsid));
    return student || undefined;
  }

  async getStudentByDsidPhoneDob(dsid: string, phone: string, dob: string): Promise<Student | undefined> {
    const [student] = await db
      .select()
      .from(students)
      .where(
        and(
          eq(students.digitalStudentId, dsid),
          eq(students.phone, phone),
          eq(students.dob, dob)
        )
      );
    return student || undefined;
  }

  async activateStudent(studentId: number, passwordHash: string): Promise<Student> {
    const [student] = await db
      .update(students)
      .set({ passwordHash, isActivated: true })
      .where(eq(students.id, studentId))
      .returning();
    return student;
  }

  async getStudentWithSchool(studentId: number): Promise<{ student: Student; school: School } | undefined> {
    const result = await db
      .select()
      .from(students)
      .innerJoin(schools, eq(students.schoolId, schools.id))
      .where(eq(students.id, studentId));
    if (result.length === 0) return undefined;
    return { student: result[0].students, school: result[0].schools };
  }
}

export const storage = new DatabaseStorage();
