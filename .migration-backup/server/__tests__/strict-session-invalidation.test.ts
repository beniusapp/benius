import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "../db";
import { storage } from "../storage";
import { userSessionRevocationSid } from "../session-revocation";

const sessionIds = [
  `teacher-session-a-${Date.now()}`,
  `teacher-session-b-${Date.now()}`,
  `other-user-session-${Date.now()}`,
];

afterAll(async () => {
  await pool.query(
    `DELETE FROM "session" WHERE sid = ANY($1::text[])`,
    [[...sessionIds, userSessionRevocationSid(987654001)]],
  );
});

describe("strict authenticated-session invalidation", () => {
  it("deletes every PostgreSQL session for the affected user and preserves other users", async () => {
    const targetUserId = 987654001;
    const otherUserId = 987654002;
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO "session" (sid, sess, expire)
       VALUES
         ($1, $2::json, $4),
         ($3, $2::json, $4),
         ($5, $6::json, $4)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [
        sessionIds[0],
        JSON.stringify({ cookie: {}, userId: targetUserId, userRole: "teacher" }),
        sessionIds[1],
        expiry,
        sessionIds[2],
        JSON.stringify({ cookie: {}, userId: otherUserId, userRole: "teacher" }),
      ],
    );

    await storage.invalidateUserSessionsStrict(targetUserId);

    const result = await pool.query<{ sid: string }>(
      `SELECT sid FROM "session" WHERE sid = ANY($1::text[]) ORDER BY sid`,
      [sessionIds],
    );
    expect(result.rows.map(row => row.sid)).toEqual([sessionIds[2]]);
  });

  it("propagates session-store failures instead of reporting best-effort success", async () => {
    const connect = vi.spyOn(pool, "connect").mockRejectedValueOnce(new Error("session store unavailable"));
    await expect(storage.invalidateUserSessionsStrict(987654003)).rejects.toThrow(
      "session store unavailable",
    );
    connect.mockRestore();
  });
});