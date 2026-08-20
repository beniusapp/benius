import { describe, expect, it } from "vitest";
import { db } from "../db";
import { sql } from "drizzle-orm";

const uid = () => Math.random().toString(36).slice(2);

describe("immutable webhook delivery forensics", () => {
  it("retains duplicate deliveries independently and keeps processing history append-only", async () => {
    const eventId = `forensic-${uid()}`;
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const row = (await db.execute(sql`
        INSERT INTO payment_webhook_events
          (school_id, provider, provider_event_id, event_type, payload)
        VALUES (NULL, 'test', ${eventId}, 'payment.captured', '{}'::jsonb)
        RETURNING id
      `)).rows[0] as any;
      ids.push(Number(row.id));
    }
    expect(ids).toHaveLength(4);

    await db.execute(sql`
      INSERT INTO payment_webhook_processing_events (webhook_delivery_id, status)
      VALUES (${ids[0]}, 'started'), (${ids[0]}, 'failed'), (${ids[0]}, 'succeeded')
    `);
    const processing = await db.execute(sql`
      SELECT id, status FROM payment_webhook_processing_events
      WHERE webhook_delivery_id = ${ids[0]} ORDER BY id
    `);
    expect(processing.rows.map((row: any) => row.status)).toEqual(["started", "failed", "succeeded"]);
    const processingId = Number((processing.rows[0] as any).id);

    await expect(db.execute(sql`
      UPDATE payment_webhook_events SET event_type = 'tampered' WHERE id = ${ids[0]}
    `)).rejects.toThrow();
    await expect(db.execute(sql`
      DELETE FROM payment_webhook_events WHERE id = ${ids[0]}
    `)).rejects.toThrow();
    const original = await db.execute(sql`
      SELECT event_type, provider_event_id FROM payment_webhook_events WHERE id = ${ids[0]}
    `);
    expect(original.rows[0]).toMatchObject({ event_type: "payment.captured", provider_event_id: eventId });
    await expect(db.execute(sql`
      UPDATE payment_webhook_processing_events SET status = 'tampered' WHERE id = ${processingId}
    `)).rejects.toThrow();
    await expect(db.execute(sql`
      DELETE FROM payment_webhook_processing_events WHERE id = ${processingId}
    `)).rejects.toThrow();
  });
});