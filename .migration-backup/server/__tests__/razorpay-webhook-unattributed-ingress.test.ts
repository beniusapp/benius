import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { registerFeesRoutes } from "../fees-routes";
import { db } from "../db";
import { sql } from "drizzle-orm";

let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json({ verify: (req: any, _res, buffer) => { req.rawBody = buffer; } }));
  registerFeesRoutes(app);
  server = await new Promise<http.Server>((resolve) => {
    const next = app.listen(0, () => resolve(next));
  });
  const address = server.address() as any;
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("unattributable Razorpay webhook ingress", () => {
  it("retains an unknown signed-looking delivery as unverifiable and tenant-null", async () => {
    const suffix = Math.random().toString(36).slice(2);
    const body = {
      event: "payment.failed",
      id: `evt_unknown_${suffix}`,
      payload: { payment: { entity: { id: `pay_unknown_${suffix}`, order_id: `order_unknown_${suffix}`, created_at: 1700000000 } } },
    };
    const response = await fetch(`${baseUrl}/api/webhooks/razorpay`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": "signature-present-but-unverifiable" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(202);
    const row = (await db.execute(sql`
      SELECT school_id, signature_verified, verification_status, fee_resolution_status,
             razorpay_payment_id, razorpay_order_id
      FROM payment_webhook_events WHERE provider_event_id = ${body.id}
    `)).rows[0] as any;
    expect(row).toMatchObject({
      school_id: null, signature_verified: false, verification_status: "unverifiable_unattributed",
      fee_resolution_status: "unresolved", razorpay_payment_id: body.payload.payment.entity.id,
      razorpay_order_id: body.payload.payment.entity.order_id,
    });
  });
});