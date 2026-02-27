import { schools, students, type School, type InsertSchool, type Student, type InsertStudent } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getSchools(): Promise<School[]>;
  getSchool(id: number): Promise<School | undefined>;
  getSchoolByCode(code: string): Promise<School | undefined>;
  createSchool(school: InsertSchool): Promise<School>;
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

  async createSchool(insertSchool: InsertSchool): Promise<School> {
    const [school] = await db.insert(schools).values(insertSchool).returning();
    return school;
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
