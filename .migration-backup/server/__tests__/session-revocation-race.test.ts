import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Server } from "node:http";
import { pool } from "../db";
import { storage } from "../storage";
import {
  enforceSessionRevocation,
  userSessionRevocationSid,
} from "../session-revocation";

const userId = 987655001;
let server: Server;
let baseUrl = "";

async function post(path: string, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as any,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie,
  };
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

beforeAll(async () => {
  const PgStore = connectPgSimple(session);
  const app = express();
  app.use(session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: "session-revocation-race-test-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
  }));
  app.use(enforceSessionRevocation);
  app.post("/test/login", (req, res) => {
    req.session.userId = userId;
    req.session.userRole = "teacher";
    req.session.authIssuedAt = Date.now();
    res.json({ ok: true });
  });
  app.get("/test/protected", (req, res) => {
    if (req.session.userId !== userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({ ok: true });
  });
  server = await new Promise<Server>(resolve => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())
  );
  await pool.query(
    `DELETE FROM "session"
     WHERE sid = $1 OR sess->>'userId' = $2`,
    [userSessionRevocationSid(userId), String(userId)],
  );
});

describe("session revocation race protection", () => {
  it("rejects an old authenticated session even if an in-flight request resurrects its row", async () => {
    const login = await post("/test/login");
    expect(login.status).toBe(200);
    expect(login.cookie).toBeTruthy();

    const before = await pool.query<{ sid: string; sess: unknown; expire: Date }>(
      `SELECT sid, sess, expire FROM "session" WHERE sess->>'userId' = $1 LIMIT 1`,
      [String(userId)],
    );
    expect(before.rows).toHaveLength(1);
    const stale = before.rows[0];

    await storage.invalidateUserSessionsStrict(userId);
    await pool.query(
      `INSERT INTO "session" (sid, sess, expire)
       VALUES ($1, $2::json, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [stale.sid, JSON.stringify(stale.sess), stale.expire],
    );

    const rejected = await get("/test/protected", login.cookie);
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual({ message: "Session expired. Please log in again." });

    await new Promise(resolve => setTimeout(resolve, 5));
    const freshLogin = await post("/test/login");
    expect(freshLogin.status).toBe(200);
    const accepted = await get("/test/protected", freshLogin.cookie);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ ok: true });
  });
});