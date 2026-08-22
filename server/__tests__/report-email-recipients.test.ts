import { describe, expect, it, vi } from "vitest";
import { reportEmailRecipientsArraySql, storage } from "../storage";

const queryConfig = {
  escapeName: (name: string) => `"${name}"`,
  escapeParam: (index: number) => `$${index + 1}`,
  escapeString: (value: string) => `'${value.replace(/'/g, "''")}'`,
};

describe("monthly report email recipient serialization", () => {
  it("binds a single recipient as a PostgreSQL text-array element", () => {
    const query = reportEmailRecipientsArraySql(["accounts@school.org"]).toQuery(queryConfig);

    expect(query.sql).toBe("ARRAY[$1]::text[]");
    expect(query.params).toEqual(["accounts@school.org"]);
  });

  it("binds each recipient individually instead of creating a comma-delimited literal", () => {
    const query = reportEmailRecipientsArraySql([
      "accounts@school.org",
      "beniusapp@gmail.com",
    ]).toQuery(queryConfig);

    expect(query.sql).toBe("ARRAY[$1, $2]::text[]");
    expect(query.params).toEqual([
      "accounts@school.org",
      "beniusapp@gmail.com",
    ]);
    expect(query.params).not.toContain("accounts@school.org,beniusapp@gmail.com");
  });

  it("serializes an empty recipient list as an empty text array", () => {
    const query = reportEmailRecipientsArraySql([]).toQuery(queryConfig);

    expect(query.sql).toBe("ARRAY[]::text[]");
    expect(query.params).toEqual([]);
  });

  it.each([
    ["one recipient", ["accounts@school.org"]],
    ["multiple recipients", ["accounts@school.org", "beniusapp@gmail.com"]],
  ])("uses separate array values when saving %s", async (_label, recipients) => {
    const execute = vi.fn().mockResolvedValue(undefined);

    await storage.upsertReportEmailSchedule(
      99,
      { enabled: true, recipients, dayOfMonth: 1, sendTime: "09:00" },
      { execute },
    );

    const statement = execute.mock.calls[0][0];
    const query = statement.toQuery(queryConfig);
    expect(query.sql).toContain("ARRAY[");
    expect(query.params).toEqual(expect.arrayContaining(recipients));
    if (recipients.length > 1) {
      expect(query.params).not.toContain(recipients.join(","));
    }
  });
});