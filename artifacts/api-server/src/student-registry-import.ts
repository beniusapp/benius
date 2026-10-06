import type { InsertStudent } from "@workspace/db";
import {
  isConfiguredStudentPlacement,
  type StudentRegistryPlacementMetadata,
} from "./student-registry-placement";

export const STUDENT_IMPORT_BATCH_SIZE = 100;
export const STUDENT_IMPORT_MAX_ROWS = 100_000;
export const STUDENT_IMPORT_MAX_REPORTED_ERRORS = 100;
const PASSWORD_HASH_CONCURRENCY = 4;

export interface StudentImportCandidate {
  rowNumber: number;
  name: string;
  className: string;
  sectionName: string;
  phone: string;
  dob: string;
  email: string;
  rollNumber: number | null;
}

export interface StudentImportIssue {
  row: number;
  reason: string;
}

export class StudentImportIssueCollector {
  readonly issues: StudentImportIssue[] = [];
  count = 0;

  add(row: number, reason: string): void {
    this.count += 1;
    if (this.issues.length < STUDENT_IMPORT_MAX_REPORTED_ERRORS) {
      this.issues.push({ row, reason });
    }
  }

  get truncated(): boolean {
    return this.count > this.issues.length;
  }
}

export function prepareStudentImportCandidates(
  rows: Array<Record<string, string>>,
  placementMetadata: StudentRegistryPlacementMetadata[],
  issues: StudentImportIssueCollector,
  options: {
    parseDate: (value: string) => string | null;
    isValidPhone: (value: string) => boolean;
  },
): { candidates: StudentImportCandidate[]; skipped: number } {
  const candidates: StudentImportCandidate[] = [];
  const firstRowByFingerprint = new Map<string, number>();
  let skipped = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const name = (row.name ?? "").trim();
    const className = (row.class ?? "").trim();
    const sectionName = (row.section ?? "").trim();
    const phone = (row.phone || row.phonenumber || row.mobile || row.contact || "").trim();
    const dobRaw = (row.dob || row.dateofbirth || row.birthdate || "").trim();
    const email = (row.email || row.studentemail || row.emailaddress || "").trim();
    const rollRaw = (row.rollnumber || row.rollno || row.roll || "").trim();

    let reason: string | null = null;
    let dob: string | null = null;
    let rollNumber: number | null = null;

    if (!name) reason = "Missing Student name.";
    else if (!className) reason = "Missing Class.";
    else if (!sectionName) reason = "Missing Section.";
    else if (!options.isValidPhone(phone)) reason = "Missing or invalid phone number.";
    else if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reason = "Missing or invalid Student email.";
    else if (!dobRaw || !(dob = options.parseDate(dobRaw))) reason = "Missing or invalid Date of Birth.";
    else if (rollRaw) {
      const parsedRoll = Number(rollRaw);
      if (!Number.isSafeInteger(parsedRoll) || parsedRoll <= 0) reason = "Roll Number must be a positive whole number.";
      else rollNumber = parsedRoll;
    }

    if (!reason && !isConfiguredStudentPlacement(placementMetadata, className, sectionName)) {
      reason = "Class or Section is not configured for this school.";
    }
    if (reason) {
      skipped += 1;
      issues.add(rowNumber, reason);
      continue;
    }

    const candidate: StudentImportCandidate = {
      rowNumber,
      name,
      className,
      sectionName,
      phone,
      dob: dob!,
      email,
      rollNumber,
    };
    const fingerprint = JSON.stringify([
      candidate.name.toLowerCase(),
      candidate.className,
      candidate.sectionName,
      candidate.phone.replace(/[\s\-\(\)\+]/g, ""),
      candidate.dob,
      candidate.email.toLowerCase(),
      candidate.rollNumber,
    ]);
    const firstDuplicateRow = firstRowByFingerprint.get(fingerprint);
    if (firstDuplicateRow !== undefined) {
      skipped += 1;
      issues.add(rowNumber, `Duplicate of row ${firstDuplicateRow} in this file.`);
      continue;
    }

    firstRowByFingerprint.set(fingerprint, rowNumber);
    candidates.push(candidate);
  }

  return { candidates, skipped };
}

export interface StudentImportPersistence {
  allocateSerials: (count: number) => Promise<number[]>;
  hashPassword: (password: string) => Promise<string>;
  findExistingDsids: (dsids: string[]) => Promise<Set<string>>;
  insertBatch: (schoolId: number, sessionId: number, records: InsertStudent[]) => Promise<unknown>;
  insertOne: (schoolId: number, sessionId: number, record: InsertStudent) => Promise<unknown>;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isSessionOrPlacementError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "NO_ACTIVE_SESSION"
    || code === "MULTIPLE_ACTIVE_SESSIONS"
    || code === "ACTIVE_SESSION_CHANGED"
    || code === "INVALID_STUDENT_PLACEMENT";
}

function isDatabaseConstraintError(error: unknown): boolean {
  const code = errorCode(error);
  return !!code && /^(22|23)/.test(code);
}

function failureReason(error: unknown): string {
  const code = errorCode(error);
  if (code === "23505") return "Student ID conflicts with an existing record.";
  if (code === "ACTIVE_SESSION_CHANGED") return "The active academic session changed; this row was not added.";
  if (code === "INVALID_STUDENT_PLACEMENT") return "Class or Section is no longer configured for this school.";
  if (code === "NO_ACTIVE_SESSION" || code === "MULTIPLE_ACTIVE_SESSIONS") {
    return "A single active academic session is required; this row was not added.";
  }
  return "Could not save this row. No Student profile or enrollment was retained.";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<Array<{ value?: R; error?: unknown }>> {
  const results: Array<{ value?: R; error?: unknown }> = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = { value: await mapper(items[index], index) };
      } catch (error) {
        results[index] = { error };
      }
    }
  }));
  return results;
}

export async function persistStudentImportCandidates(
  candidates: StudentImportCandidate[],
  context: { schoolId: number; schoolCode: string; sessionId: number },
  issues: StudentImportIssueCollector,
  persistence: StudentImportPersistence,
): Promise<{ imported: number; failed: number }> {
  let imported = 0;
  let failed = 0;

  const failCandidate = (candidate: StudentImportCandidate, reason: string) => {
    failed += 1;
    issues.add(candidate.rowNumber, reason);
  };

  // Reserve and check every generated login ID before the first Student write.
  // Only compact candidate+ID pairs are retained here; password hashes are
  // made later in bounded chunks.
  const reservedRows: Array<{ candidate: StudentImportCandidate; digitalStudentId: string }> = [];
  const seenDsids = new Set<string>();
  for (let offset = 0; offset < candidates.length; offset += STUDENT_IMPORT_BATCH_SIZE) {
    const chunk = candidates.slice(offset, offset + STUDENT_IMPORT_BATCH_SIZE);
    let serials: number[];
    try {
      serials = await persistence.allocateSerials(chunk.length);
      if (serials.length !== chunk.length || serials.some(serial => !Number.isSafeInteger(serial) || serial < 1)) {
        throw new Error("Invalid serial range");
      }
    } catch {
      for (let index = offset; index < candidates.length; index += 1) {
        failCandidate(candidates[index], "Student IDs could not be reserved; no Student profiles were created.");
      }
      for (const row of reservedRows) {
        failCandidate(row.candidate, "Student IDs could not be fully checked; no Student profiles were created.");
      }
      return { imported: 0, failed };
    }

    const generatedRows = chunk.map((candidate, index) => ({
      candidate,
      digitalStudentId: `${context.schoolCode}-${String(serials[index]).padStart(4, "0")}`,
    }));
    const duplicateIds = new Set<string>();
    for (const row of generatedRows) {
      if (seenDsids.has(row.digitalStudentId)) duplicateIds.add(row.digitalStudentId);
      else seenDsids.add(row.digitalStudentId);
    }

    let existingDsids: Set<string>;
    try {
      existingDsids = await persistence.findExistingDsids(generatedRows
        .filter(row => !duplicateIds.has(row.digitalStudentId))
        .map(row => row.digitalStudentId));
    } catch {
      for (let index = offset; index < candidates.length; index += 1) {
        failCandidate(candidates[index], "Existing Student IDs could not be checked; no Student profiles were created.");
      }
      for (const row of reservedRows) {
        failCandidate(row.candidate, "Existing Student IDs could not be fully checked; no Student profiles were created.");
      }
      return { imported: 0, failed };
    }

    for (const row of generatedRows) {
      if (duplicateIds.has(row.digitalStudentId)) {
        failCandidate(row.candidate, "Generated Student ID is duplicated; this row was not added.");
      } else if (existingDsids.has(row.digitalStudentId)) {
        failCandidate(row.candidate, "Generated Student ID already exists; no existing Student was changed.");
      } else {
        reservedRows.push(row);
      }
    }
  }

  for (let offset = 0; offset < reservedRows.length; offset += STUDENT_IMPORT_BATCH_SIZE) {
    const chunk = reservedRows.slice(offset, offset + STUDENT_IMPORT_BATCH_SIZE);
    const hashedRows = await mapWithConcurrency(chunk, PASSWORD_HASH_CONCURRENCY, async ({ candidate, digitalStudentId }) => {
      const passwordHash = await persistence.hashPassword(digitalStudentId);
      const record: InsertStudent = {
        schoolId: context.schoolId,
        digitalStudentId,
        name: candidate.name,
        class: candidate.className,
        section: candidate.sectionName,
        phone: candidate.phone,
        dob: candidate.dob,
        passwordHash,
        isActivated: false,
        email: candidate.email,
        rollNumber: candidate.rollNumber,
      };
      return { candidate, record };
    });

    const rowsToWrite: Array<{ candidate: StudentImportCandidate; record: InsertStudent }> = [];
    for (let index = 0; index < hashedRows.length; index += 1) {
      const hashed = hashedRows[index];
      if (hashed.error !== undefined || !hashed.value) {
        failCandidate(chunk[index].candidate, "Student login credentials could not be prepared; this row was not added.");
      } else {
        rowsToWrite.push(hashed.value);
      }
    }
    if (rowsToWrite.length === 0) continue;

    try {
      await persistence.insertBatch(
        context.schoolId,
        context.sessionId,
        rowsToWrite.map(({ record }) => record),
      );
      imported += rowsToWrite.length;
    } catch (error) {
      if (isSessionOrPlacementError(error)) {
        const reason = failureReason(error);
        for (const { candidate } of rowsToWrite) failCandidate(candidate, reason);
        for (const { candidate } of reservedRows.slice(offset + chunk.length)) failCandidate(candidate, reason);
        break;
      }
      if (!isDatabaseConstraintError(error)) {
        for (const { candidate } of rowsToWrite) {
          failCandidate(candidate, "The database could not save this batch; no rows in it were retained.");
        }
        for (const { candidate } of reservedRows.slice(offset + chunk.length)) {
          failCandidate(candidate, "The database could not complete this import; no further rows were added.");
        }
        break;
      }

      // A constraint can affect only one row. The failed chunk transaction has
      // rolled back; retry rows serially to identify the specific failure.
      for (const { candidate, record } of rowsToWrite) {
        try {
          await persistence.insertOne(context.schoolId, context.sessionId, record);
          imported += 1;
        } catch (rowError) {
          failCandidate(candidate, failureReason(rowError));
        }
      }
    }
  }

  return { imported, failed };
}
