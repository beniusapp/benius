import { describe, expect, it } from "vitest";
import { addCalendarDays, formatDateOnly, formatDateTimeIST, formatInstantIST, getAcademicYearForISTDate, todayInIST } from "../ist-time";

describe("IST date/time policy", () => {
  it("formats the same persisted instant in IST regardless of host timezone", () => {
    expect(formatDateTimeIST("2026-03-31 18:30:00")).toBe("01 Apr 2026, 12:00 AM IST");
    expect(formatInstantIST("2026-03-31T18:30:00Z")).toContain("01 Apr 2026");
  });

  it("keeps calendar DATE values calendar-only", () => {
    expect(formatDateOnly("2026-04-01")).toBe("01 Apr 2026");
    expect(addCalendarDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("uses IST boundaries for the business date and academic year", () => {
    expect(todayInIST(new Date("2026-03-31T18:29:59Z"))).toBe("2026-03-31");
    expect(todayInIST(new Date("2026-03-31T18:30:00Z"))).toBe("2026-04-01");
    expect(getAcademicYearForISTDate("2026-03-31")).toBe("2025-2026");
    expect(getAcademicYearForISTDate("2026-04-01")).toBe("2026-2027");
  });
});