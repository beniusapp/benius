// @vitest-environment jsdom
/**
 * Component tests: student fee card flips to Paid immediately after payment
 * without a page refresh.
 *
 * Strategy
 * ─────────
 * 1. Mount the real <StudentFees /> component inside the minimal provider tree
 *    it needs (QueryClientProvider + SessionViewContext + Router).
 * 2. Pre-load the QueryClient cache so every initial data fetch returns
 *    instantly (no real network calls on mount).
 * 3. Mock global fetch for the two payment-flow network calls:
 *    • POST /api/payments/create-order → order details
 *    • POST /api/payments/verify       → { ok: true, receiptNumber }
 * 4. Mock window.Razorpay so `open()` immediately fires the success handler
 *    (skipping the real payment widget entirely).
 * 5. Assert that after the handler fires the React component re-renders and
 *    the fee card changes from "Due" to "Paid" — no page reload required.
 *
 * The SSE payment-update path (StudentSessionProvider → invalidate fees on
 * payment-update event) is tested in the second describe block by directly
 * exercising the provider's onmessage handler with a mocked EventSource.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

import { SessionViewContext } from "@/contexts/session-view-context";
import { StudentSessionProvider } from "@/contexts/student-session-provider";
import StudentFees from "@/pages/student-fees";
import { getQueryFn } from "@/lib/queryClient";

// ── Framer-motion: synchronous pass-through stubs for jsdom ──────────────────
// jsdom has no Web Animations API so framer-motion animations are a no-op;
// we stub motion.* components to plain divs to avoid RAF/WAAPI warnings while
// still rendering all children.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const PassDiv = ({ children, ...rest }: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { initial, animate, exit, transition, variants,
            whileHover, whileTap, layoutId, layout, ...safe } = rest;
    return <div {...safe}>{children}</div>;
  };
  return {
    ...actual,
    motion: {
      div:     PassDiv,
      span:    ({ children, ...r }: any) => <span {...r}>{children}</span>,
      header:  ({ children, ...r }: any) => <header {...r}>{children}</header>,
      section: ({ children, ...r }: any) => <section {...r}>{children}</section>,
      ul:      ({ children, ...r }: any) => <ul {...r}>{children}</ul>,
      li:      ({ children, ...r }: any) => <li {...r}>{children}</li>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const STUDENT = {
  id: 1,
  name: "Test Student",
  digitalStudentId: "STU-001",
  class: "10",
  section: "A",
  schoolName: "Test School",
  schoolCode: "TST",
  schoolId: 99,
};

const FEE_DUE = {
  id: 42,
  studentId: 1,
  schoolId: 99,
  feeType: "Tuition",
  feeName: "Tuition Fee",
  amount: 10000,
  dueDate: "2026-09-01",
  paidDate: null,
  status: "Due",
  receiptNumber: null,
  notes: null,
  academicYear: "2026-27",
  createdAt: "2026-08-01T00:00:00Z",
  breakdown: [],
};

const FEE_PAID = {
  ...FEE_DUE,
  status: "Paid",
  receiptNumber: "RCP-TEST-001",
  paidDate: "2026-08-12T00:00:00Z",
};

const SUMMARY = {
  previousArrears: 0,
  currentMonthCharges: 10000,
  totalOutstanding: 10000,
  totalPaid: 0,
  currentMonth: "2026-08",
};

const PORTAL_RAZORPAY_ON = {
  isEnabled: true,
  gatewayUrl: null,
  bannerMessage: null,
  razorpayEnabled: true,
  razorpayKeyId: "rzp_test_key123",
};

function makeOkJson(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/** Wrapper that provides all contexts <StudentFees /> needs. */
function Wrapper({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <Router>
      <QueryClientProvider client={queryClient}>
        <SessionViewContext.Provider
          value={{
            sessions: [],
            selectedSession: null,
            setSelectedSession: vi.fn(),
            isArchiveMode: false,
            isSessionsLoading: false,
            pendingActivation: null,
            confirmActivation: vi.fn(),
            subscribeToPaymentUpdate: () => () => { /* noop */ },
          }}
        >
          {children}
        </SessionViewContext.Provider>
      </QueryClientProvider>
    </Router>
  );
}

/** Build a fresh QueryClient and pre-load all caches used by <StudentFees />. */
function buildQueryClient(initialFees: object[]): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        // Provide the same default queryFn the app uses so that explicit
        // refetches triggered by refreshFeesData() (refetchFees / invalidate)
        // call the mocked global fetch rather than throwing "No queryFn".
        queryFn: getQueryFn({ on401: "returnNull" }),
      },
    },
  });
  qc.setQueryData(["/api/student-me"], STUDENT);
  qc.setQueryData(["/api/student/fees"], initialFees);
  qc.setQueryData(["/api/student/fees/summary"], SUMMARY);
  qc.setQueryData(["/api/student/fees/portal-info"], PORTAL_RAZORPAY_ON);
  qc.setQueryData(["/api/student/fees/notification-history"], []);
  return qc;
}

// ── Razorpay mock ─────────────────────────────────────────────────────────────

class MockRazorpay {
  private _opts: any;
  constructor(opts: any) {
    this._opts = opts;
  }
  on(_event: string, _cb: Function) {}
  open() {
    // Immediately fire the success handler as the real SDK would after payment.
    this._opts.handler({
      razorpay_payment_id: "pay_test_000",
      razorpay_order_id: "order_test_000",
      razorpay_signature: "sig_test",
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite A: Razorpay handler → refreshFeesData → card shows Paid
// ─────────────────────────────────────────────────────────────────────────────

describe("StudentFees — Paid status after Razorpay payment (no page refresh)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // window.Razorpay must exist before loadRazorpayScript() runs so it
    // resolves immediately (no script-tag injection needed).
    (window as any).Razorpay = MockRazorpay;

    // Mock ALL API routes the component may call:
    //   • Initial data queries (student, fees, summary, notification-history)
    //     are pre-set in the QueryClient cache with staleTime:Infinity and
    //     won't trigger fetches — EXCEPT portal-info which has staleTime:0
    //     on the query itself and therefore ALWAYS refetches on mount.
    //   • Payment-flow calls (create-order, verify) are the main subject.
    fetchSpy = vi.fn().mockImplementation((url: string) => {
      // Re-serve portal-info on every mount refetch (staleTime:0 on that query).
      if (url === "/api/student/fees/portal-info") {
        return makeOkJson(PORTAL_RAZORPAY_ON);
      }
      // refreshFeesData() triggers refetchFees() + invalidateQueries which
      // causes the fees and summary queries to re-fetch.
      if (url === "/api/student/fees") {
        return makeOkJson([FEE_DUE]);
      }
      if (url === "/api/student/fees/summary") {
        return makeOkJson(SUMMARY);
      }
      // Payment flow.
      if (url === "/api/payments/create-order") {
        return makeOkJson({
          orderId: "order_test_000",
          amount: 1000000,          // paise
          currency: "INR",
          keyId: "rzp_test_key123",
        });
      }
      if (url === "/api/payments/verify") {
        return makeOkJson({ ok: true, receiptNumber: "RCP-TEST-001" });
      }
      // Any unexpected URL is surfaced immediately in test output.
      console.warn("[fetch mock] unexpected call:", url);
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    // Explicit cleanup so each test gets a fresh DOM — auto-cleanup requires
    // vitest globals which this config doesn't enable.
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete (window as any).Razorpay;
  });

  it("verify endpoint is called after the Razorpay handler fires", async () => {
    const qc = buildQueryClient([FEE_DUE]);

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    // Wait for the Pay Now button to appear (portal data loaded).
    const payBtn = await screen.findByTestId(`button-pay-now-${FEE_DUE.id}`);
    await act(async () => { payBtn.click(); });

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/payments/verify",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("verify is called with the correct feeRecordId in the body", async () => {
    const qc = buildQueryClient([FEE_DUE]);

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    const payBtn = await screen.findByTestId(`button-pay-now-${FEE_DUE.id}`);
    await act(async () => { payBtn.click(); });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/payments/verify",
      expect.objectContaining({ method: "POST" }),
    ));

    const verifyCall = fetchSpy.mock.calls.find(
      (call: any[]) => call[0] === "/api/payments/verify",
    )!;
    const body = JSON.parse(verifyCall[1].body);
    expect(body.feeRecordId).toBe(FEE_DUE.id);
  });

  it("refreshFeesData invalidates /api/student/fees after verify completes", async () => {
    const qc = buildQueryClient([FEE_DUE]);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    const payBtn = await screen.findByTestId(`button-pay-now-${FEE_DUE.id}`);
    await act(async () => { payBtn.click(); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["/api/student/fees"] }),
      ),
    );
  });

  it("refreshFeesData invalidates /api/student/fees/summary after verify", async () => {
    const qc = buildQueryClient([FEE_DUE]);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    const payBtn = await screen.findByTestId(`button-pay-now-${FEE_DUE.id}`);
    await act(async () => { payBtn.click(); });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["/api/student/fees/summary"] }),
      ),
    );
  });

  it("fee card flips from Due to Paid after payment — no page reload", async () => {
    const qc = buildQueryClient([FEE_DUE]);

    // After verify resolves the component will call refetchFees(); we update
    // the cache directly (as invalidateQueries + refetch would do in prod)
    // so the component re-renders with Paid status.
    let feesPayload: object[] = [FEE_DUE];
    fetchSpy.mockImplementation((url: string) => {
      // portal-info always refetches on mount (staleTime:0) — must return valid data.
      if (url === "/api/student/fees/portal-info") return makeOkJson(PORTAL_RAZORPAY_ON);
      // Fees/summary may be refetched after refreshFeesData(); return dynamic payload.
      if (url === "/api/student/fees") return makeOkJson(feesPayload);
      if (url === "/api/student/fees/summary") return makeOkJson(SUMMARY);
      if (url === "/api/payments/create-order") {
        return makeOkJson({
          orderId: "order_test_000",
          amount: 1000000,
          currency: "INR",
          keyId: "rzp_test_key123",
        });
      }
      if (url === "/api/payments/verify") {
        // Flip feesPayload so the ensuing refetch (from refreshFeesData) sees Paid.
        feesPayload = [FEE_PAID];
        return makeOkJson({ ok: true, receiptNumber: "RCP-TEST-001" });
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    // Confirm card starts as Due.
    const dueCard = await screen.findByTestId(`card-fee-${FEE_DUE.id}`);
    expect(dueCard).toBeInTheDocument();

    // Trigger payment.
    const payBtn = await screen.findByTestId(`button-pay-now-${FEE_DUE.id}`);
    await act(async () => { payBtn.click(); });

    // After payment completes the outstanding card should disappear
    // (it moves to the history tab) — confirm Pay Now button is gone.
    await waitFor(() =>
      expect(
        screen.queryByTestId(`button-pay-now-${FEE_DUE.id}`),
      ).not.toBeInTheDocument(),
    );

    // Switch to History tab and confirm the Paid card is visible.
    const historyTab = screen.getByRole("button", { name: /history/i });
    await act(async () => { historyTab.click(); });

    await waitFor(() =>
      expect(
        screen.getByTestId(`card-fee-paid-${FEE_PAID.id}`),
      ).toBeInTheDocument(),
    );
  });

  it("verify call still fires even when create-order succeeds but user pays instantly", async () => {
    const qc = buildQueryClient([FEE_DUE]);

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    const payBtn = await screen.findByTestId(`button-pay-now-${FEE_DUE.id}`);
    await act(async () => { payBtn.click(); });

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.filter((call: any[]) => call[0] === "/api/payments/verify"),
      ).toHaveLength(1),
    );
  });

  it("refreshFeesData runs even when verify returns a network error (verify is in .finally)", async () => {
    const qc = buildQueryClient([FEE_DUE]);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    fetchSpy.mockImplementation((url: string) => {
      // portal-info always refetches on mount (staleTime:0) — must return valid data.
      if (url === "/api/student/fees/portal-info") return makeOkJson(PORTAL_RAZORPAY_ON);
      // Fees/summary may be refetched after refreshFeesData().
      if (url === "/api/student/fees") return makeOkJson([FEE_DUE]);
      if (url === "/api/student/fees/summary") return makeOkJson(SUMMARY);
      if (url === "/api/payments/create-order") {
        return makeOkJson({
          orderId: "order_test_000",
          amount: 1000000,
          currency: "INR",
          keyId: "rzp_test_key123",
        });
      }
      if (url === "/api/payments/verify") {
        // Simulate network error — verify fails entirely.
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    const payBtn = await screen.findByTestId(`button-pay-now-${FEE_DUE.id}`);
    await act(async () => { payBtn.click(); });

    // The .finally() guard must trigger even on network failure.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["/api/student/fees"] }),
      ),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite B: fee card StatusPill shows correct label after data update
//
// Instead of reimplementing StatusPill's logic in the test, these tests
// mount a lightweight version of the fee-card scenario by pre-loading
// the QueryClient with a Paid fee and confirming the rendered card
// (data-testid="card-fee-paid-*") appears in the History tab.
// This exercises the real StatusPill component from student-fees.tsx.
// ─────────────────────────────────────────────────────────────────────────────

describe("Fee card shows correct Paid/Due status from server data", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url === "/api/student/fees/portal-info") return makeOkJson(PORTAL_RAZORPAY_ON);
      if (url === "/api/student/fees") return makeOkJson([FEE_PAID]);
      if (url === "/api/student/fees/summary") return makeOkJson(SUMMARY);
      return Promise.resolve(new Response(null, { status: 404 }));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fee card with status Paid appears in the History tab", async () => {
    // Pre-load cache with a single Paid fee record.
    const qc = buildQueryClient([FEE_PAID]);

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    // Switch to History tab and confirm the paid card is rendered.
    const historyTab = await screen.findByRole("button", { name: /history/i });
    await act(async () => { historyTab.click(); });

    await waitFor(() =>
      expect(screen.getByTestId(`card-fee-paid-${FEE_PAID.id}`)).toBeInTheDocument(),
    );
  });

  it("Outstanding tab shows Pay Now when fee is Due", async () => {
    const qc = buildQueryClient([FEE_DUE]);

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    // Pay Now button appears only for outstanding (Due/Overdue) fees
    // when Razorpay is enabled — confirms the card renders as a Due card.
    await waitFor(() =>
      expect(screen.getByTestId(`button-pay-now-${FEE_DUE.id}`)).toBeInTheDocument(),
    );
  });

  it("Paid fee does NOT appear in the Outstanding tab", async () => {
    const qc = buildQueryClient([FEE_PAID]);

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    // Outstanding tab is active by default; Pay Now button must NOT be present
    // because the fee is already Paid (pendingRecords is empty).
    await waitFor(() =>
      expect(
        screen.queryByTestId(`button-pay-now-${FEE_PAID.id}`),
      ).not.toBeInTheDocument(),
    );
  });

  it("card-fee-paid testid appears after cache is updated to Paid", async () => {
    // Start with Due, then programmatically flip the cache to Paid and confirm
    // the paid card renders in the History tab — mirrors what refreshFeesData
    // triggers after a successful verify call.
    const qc = buildQueryClient([FEE_DUE]);

    render(
      <Wrapper queryClient={qc}>
        <StudentFees />
      </Wrapper>,
    );

    // Confirm Due card is initially visible.
    await waitFor(() =>
      expect(screen.getByTestId(`card-fee-${FEE_DUE.id}`)).toBeInTheDocument(),
    );

    // Simulate what refreshFeesData does: update the cache.
    await act(async () => {
      qc.setQueryData(["/api/student/fees"], [FEE_PAID]);
    });

    // Switch to History tab and confirm the paid card now renders.
    const historyTab = screen.getByRole("button", { name: /history/i });
    await act(async () => { historyTab.click(); });

    await waitFor(() =>
      expect(screen.getByTestId(`card-fee-paid-${FEE_PAID.id}`)).toBeInTheDocument(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite C: shared SSE connection — payment-update path
//
// Mounts <StudentFees /> inside the real <StudentSessionProvider> to confirm:
//   1. Only one EventSource socket is opened per browser tab.
//   2. A payment-update message delivered through the provider's EventSource
//      causes StudentFees to invalidate /api/student/fees and
//      /api/student/fees/summary — without opening a second socket.
// ─────────────────────────────────────────────────────────────────────────────

describe("StudentFees — shared SSE connection via StudentSessionProvider", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let eventSourceInstances: any[] = [];
  let EventSourceSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    eventSourceInstances = [];

    // Minimal EventSource mock: captures every constructed instance so tests
    // can fire synthetic messages and count how many sockets were opened.
    EventSourceSpy = vi.fn().mockImplementation(function(this: any, _url: string) {
      this.onmessage = null;
      this.close = vi.fn();
      eventSourceInstances.push(this);
    });
    vi.stubGlobal("EventSource", EventSourceSpy);

    // Stub fetch for all routes the component and provider may call.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url === "/api/student/fees/portal-info") return makeOkJson(PORTAL_RAZORPAY_ON);
      if (url === "/api/student/academic-sessions") return makeOkJson([]);
      if (url === "/api/student/fees") return makeOkJson([FEE_DUE]);
      if (url === "/api/student/fees/summary") return makeOkJson(SUMMARY);
      return Promise.resolve(new Response(null, { status: 404 }));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    eventSourceInstances = [];
  });

  /** Wrapper using the real StudentSessionProvider (not the mock context). */
  function RealProviderWrapper({
    queryClient,
    children,
  }: {
    queryClient: QueryClient;
    children: React.ReactNode;
  }) {
    return (
      <Router>
        <QueryClientProvider client={queryClient}>
          <StudentSessionProvider>
            {children}
          </StudentSessionProvider>
        </QueryClientProvider>
      </Router>
    );
  }

  it("opens exactly one EventSource when StudentFees is mounted", async () => {
    const qc = buildQueryClient([FEE_DUE]);

    render(
      <RealProviderWrapper queryClient={qc}>
        <StudentFees />
      </RealProviderWrapper>,
    );

    // Wait for the component to settle (provider effect runs on mount).
    await waitFor(() => expect(eventSourceInstances.length).toBeGreaterThan(0));

    // Only the provider's single shared socket should exist — not a second one
    // from the fees page itself.
    expect(eventSourceInstances).toHaveLength(1);
  });

  it("payment-update SSE event invalidates fee queries without a second socket", async () => {
    const qc = buildQueryClient([FEE_DUE]);
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    render(
      <RealProviderWrapper queryClient={qc}>
        <StudentFees />
      </RealProviderWrapper>,
    );

    // Wait for the provider's EventSource to be created.
    await waitFor(() => expect(eventSourceInstances.length).toBeGreaterThan(0));

    const [providerES] = eventSourceInstances;

    // Fire a payment-update through the provider's single socket.
    await act(async () => {
      providerES.onmessage?.({
        data: JSON.stringify({
          type: "payment-update",
          feeRecordId: FEE_DUE.id,
          receiptNumber: "RCP-SSE-001",
        }),
      });
    });

    // Both fee caches must be invalidated.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/student/fees"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/student/fees/summary"] }),
    );

    // Confirm no extra sockets were opened.
    expect(eventSourceInstances).toHaveLength(1);
  });
});
