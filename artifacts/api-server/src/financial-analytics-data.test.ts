import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, pool } from "./db";
import { buildFinancialAnalytics } from "./financial-analytics-data";

test("builds independent synthetic analytics without opening a database connection", async () => {
  // Independent expected-result worksheet, in integer paise:
  // billed = 110075 + 50000 = 160075 paise (₹1,600.75).
  // receipts = 20025 + 50000 + 2575 = 72600 paise (₹726.00).
  // net remains the same ₹726.00 by the established contract.
  // outstanding = (110075 - 75025 + 5050) + (50000 - 50000 + 50000)
  //             = 90100 paise (₹901.00).
  // Efficiency = (72600 / 160075) * 100, rounded to 1 decimal = 45.4%.
  // Online/offline receipts = ₹200.25 / ₹525.75.
  const expected = {
    billed: 1600.75,
    grossCollected: 726,
    netCollected: 726,
    outstanding: 901,
    collectionEfficiency: 45.4,
    onlineCollected: 200.25,
    offlineCollected: 525.75,
    overdueAmount: 901,
  };

  const dialect = new PgDialect();
  const originalExecute = db.execute.bind(db);
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const sessionRows = [{
    id: 101,
    session_name: "Synthetic AY 2020-21",
    start_date: "2020-04-01",
    end_date: "2021-03-31",
  }];
  const billedRows = [
    {
      id: 501, fee_type: "Tuition", amount: 1000.25, late_fee_amount: 100.5,
      due_date: "2020-04-10", status: "unpaid", student_id: 71,
      student_class: "7A", lifetime_paid: 750.25, lifetime_refunded: 50.5,
    },
    {
      id: 502, fee_type: "Transport", amount: 500, late_fee_amount: 0,
      due_date: "2020-04-30", status: "paid", student_id: 72,
      student_class: "8B", lifetime_paid: 500, lifetime_refunded: 500,
    },
  ];
  const paymentRows = [
    {
      id: 601, amount: 200.25, late_fee_paid: 0, payment_method: "Portal",
      razorpay_payment_id: "synthetic-rzp-1", payment_mode: "UPI",
      received_date: "2020-04-14", created_at: "2020-04-14T05:00:00",
      created_hour_ist: 10, denomination_breakdown: null,
      fee_record_id: 501, fee_type: "Tuition", student_class: "7A",
    },
    {
      id: 602, amount: 500, late_fee_paid: 10.25, payment_method: "Cash",
      razorpay_payment_id: null, payment_mode: null,
      received_date: "2020-04-30", created_at: "2020-04-30T05:00:00",
      created_hour_ist: 10, denomination_breakdown: { "100": 2, "50": 1 },
      fee_record_id: 502, fee_type: "Transport", student_class: "8B",
    },
    {
      // Received after the academic session ended. It remains linked to the
      // 2020-21 invoice; the custom range intentionally extends beyond session.
      id: 603, amount: 25.75, late_fee_paid: 0, payment_method: "Cash",
      razorpay_payment_id: null, payment_mode: null,
      received_date: "2021-04-15", created_at: "2021-04-15T05:00:00",
      created_hour_ist: 10,
      denomination_breakdown: {
        "0500": 1, "100": 1.5, "20": 0, "10": -1, "5": Number.NaN,
      },
      fee_record_id: 501, fee_type: "Tuition", student_class: "7A",
    },
  ];
  const attemptRows = [
    {
      attempt_id: 801, outcome: "captured",
      razorpay_payment_id: "synthetic-rzp-1", amount_paise: 20025,
    },
    {
      attempt_id: 802, outcome: "failed",
      razorpay_payment_id: "synthetic-rzp-failed", amount_paise: 990000,
    },
  ];

  assert.equal(pool.totalCount, 0, "the synthetic test must start without a DB connection");
  (db as any).execute = async (query: any) => {
    const compiled = dialect.sqlToQuery(query.getSQL?.() ?? query);
    captured.push({ sql: compiled.sql, params: compiled.params });
    if (compiled.sql.includes("FROM academic_sessions")) return { rows: sessionRows };
    if (compiled.sql.includes("FROM payment_attempts pa")) return { rows: attemptRows };
    if (compiled.sql.includes("FROM payment_records pr")) return { rows: paymentRows };
    if (compiled.sql.includes("FROM fee_records fr")) return { rows: billedRows };
    throw new Error(`Unexpected synthetic query: ${compiled.sql}`);
  };

  try {
    const result = await buildFinancialAnalytics({
      schoolId: 4,
      sessionId: 101,
      preset: "custom",
      customStart: "2020-04-01",
      customEnd: "2021-04-30",
    });

    assert.equal(result.summary.billed, expected.billed);
    assert.equal(result.summary.grossCollected, expected.grossCollected);
    assert.equal(result.summary.netCollected, expected.netCollected);
    assert.equal(result.summary.outstanding, expected.outstanding);
    assert.equal(result.summary.collectionEfficiency, expected.collectionEfficiency);
    assert.equal(result.summary.onlineCollected, expected.onlineCollected);
    assert.equal(result.summary.offlineCollected, expected.offlineCollected);
    assert.equal(result.summary.overdueAmount, expected.overdueAmount);
    assert.equal(result.summary.transactionCount, 3);
    assert.equal(result.summary.totalLatePenalties, 10.25);

    assert.equal(result.filter.startDate, "2020-04-01");
    assert.equal(result.filter.endDate, "2021-04-30");
    assert.equal(result.filter.comparison, null);
    assert.equal(result.trend.reduce((sum, row) => sum + row.grossCollected, 0), expected.grossCollected);
    assert.equal(result.trend.reduce((sum, row) => sum + row.billed, 0), expected.billed);
    assert.deepEqual(
      result.classWise.map(({ class: className, billed, grossCollected, outstanding }) =>
        ({ className, billed, grossCollected, outstanding })),
      [
        { className: "7A", billed: 1100.75, grossCollected: 226, outstanding: 401 },
        { className: "8B", billed: 500, grossCollected: 500, outstanding: 500 },
      ],
    );
    assert.deepEqual(
      result.feeCategories.map(({ feeType, billed, grossCollected, outstanding }) =>
        ({ feeType, billed, grossCollected, outstanding })),
      [
        { feeType: "Transport", billed: 500, grossCollected: 500, outstanding: 500 },
        { feeType: "Tuition", billed: 1100.75, grossCollected: 226, outstanding: 401 },
      ],
    );
    assert.equal(result.aging.reduce((sum, row) => sum + row.amount, 0), expected.outstanding);
    assert.equal(result.aging.reduce((sum, row) => sum + row.count, 0), 2);
    assert.equal(result.paymentChannelSplit.totalCollected, expected.grossCollected);
    assert.equal(
      result.paymentChannelSplit.channels.reduce((sum, row) => sum + row.amount, 0),
      expected.grossCollected,
    );
    assert.equal(result.online.transactionCount, 1);
    assert.equal(result.offline.transactionCount, 2);

    // The valid breakdown documents ₹250. The malformed breakdown contributes
    // neither a denomination nor documented cash coverage, while its ₹25.75
    // persisted receipt still contributes to offline receipts and Gross.
    assert.equal(result.cashDenominations.cashCollected, 525.75);
    assert.equal(result.cashDenominations.cashPaymentCount, 2);
    assert.equal(result.cashDenominations.withBreakdownCount, 1);
    assert.equal(result.cashDenominations.withoutBreakdownCount, 1);
    assert.equal(result.cashDenominations.documentedAmount, 250);
    assert.deepEqual(
      result.cashDenominations.denominations.map(({ denomination, quantity, total }) =>
        ({ denomination, quantity, total })),
      [
        { denomination: 100, quantity: 2, total: 200 },
        { denomination: 50, quantity: 1, total: 50 },
      ],
    );

    assert.equal(captured.length, 4, "no comparison-period query is expected");
    for (const query of captured) {
      assert.ok(query.params.includes(4), "each data query must bind School A");
      if (!query.sql.includes("FROM academic_sessions")) {
        assert.ok(query.params.includes(101), "financial rows must bind selected session");
      }
    }
    assert.equal(pool.totalCount, 0, "synthetic test must not open a database connection");
  } finally {
    (db as any).execute = originalExecute;
  }
});
