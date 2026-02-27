import { schools, students, users, type School, type InsertSchool, type Student, type InsertStudent, type User, type InsertUser } from "@shared/schema";
import { db } from "./db";
import { pool } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getSchools(): Promise<School[]>;
  getSchool(id: number): Promise<School | undefined>;
  getSchoolByCode(code: string): Promise<School | undefined>;
  createSchoolWithPrincipal(school: InsertSchool, email: string, passwordHash: string): Promise<School>;
  deleteSchool(id: number): Promise<boolean>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserWithSchool(userId: number): Promise<{ user: User; school: School } | undefined>;
  getStudentsBySchool(schoolId: number): Promise<Student[]>;
  createStudent(student: InsertStudent): Promise<Student>;
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

  async createStudent(insertStudent: InsertStudent): Promise<Student> {
    const [student] = await db.insert(students).values(insertStudent).returning();
    return student;
  }
}

export const storage = new DatabaseStorage();
