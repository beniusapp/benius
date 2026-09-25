// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  apiRequestMock,
  navigateMock,
  queryClearMock,
} = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  navigateMock: vi.fn(),
  queryClearMock: vi.fn(),
}));

let currentLocation = "/student-login";
let rerenderCurrent: (() => void) | undefined;

function simulateBrowserRouteChange(next: string) {
  currentLocation = next;
  rerenderCurrent?.();
}

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: { clear: queryClearMock },
}));

vi.mock("wouter", () => ({
  useLocation: () => [
    currentLocation,
    (next: string) => {
      currentLocation = next;
      navigateMock(next);
      rerenderCurrent?.();
    },
  ],
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        currentLocation = href;
        navigateMock(href);
        rerenderCurrent?.();
      }}
    >
      {children}
    </a>
  ),
}));

import StudentLogin from "@/pages/student-login";
import StudentForgotPassword from "@/pages/student-forgot-password";

const GENERIC_MESSAGE =
  "If those details match a student account, a verification code has been sent to the email on file.";

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

function renderPage(path = currentLocation) {
  currentLocation = path;
  const view = render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })}>
      {path === "/student-login" ? <StudentLogin /> : <StudentForgotPassword />}
    </QueryClientProvider>,
  );
  rerenderCurrent = () => view.rerender(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })}>
      {currentLocation === "/student-login" ? <StudentLogin /> : <StudentForgotPassword />}
    </QueryClientProvider>,
  );
  return view;
}

function goToOtp() {
  fireEvent.change(screen.getByTestId("input-student-recovery-school-code"), {
    target: { value: "SCH-001" },
  });
  fireEvent.change(screen.getByTestId("input-student-recovery-dsid"), {
    target: { value: "MLS-0001" },
  });
  fireEvent.click(screen.getByTestId("button-student-recovery-start"));
}

async function reachReset() {
  goToOtp();
  await screen.findByTestId("input-student-recovery-otp");
  fireEvent.change(screen.getByTestId("input-student-recovery-otp"), {
    target: { value: "12a34-56" },
  });
  fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
  await screen.findByTestId("input-student-recovery-new-password");
}

describe("Student Login and Forgot Password frontend flow", () => {
  beforeEach(() => {
    currentLocation = "/student-login";
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/student/forgot-password") return response({ message: GENERIC_MESSAGE });
      if (url === "/api/student/verify-recovery-otp") return response({ success: true });
      if (url === "/api/student/reset-password") return response({ success: true });
      if (url === "/api/student-login") return response({ message: "Login successful" });
      return response({});
    });
  });

  afterEach(() => {
    cleanup();
    rerenderCurrent = undefined;
    vi.clearAllMocks();
  });

  it("renders Forgot Password while preserving the existing Student Login request", async () => {
    renderPage();
    expect(screen.getByTestId("link-student-forgot-password")).toHaveAttribute(
      "href",
      "/student/forgot-password",
    );
    fireEvent.change(screen.getByTestId("input-student-dsid"), {
      target: { value: "MLS-0001" },
    });
    fireEvent.change(screen.getByTestId("input-student-password"), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByTestId("button-student-login"));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/student-login",
      { dsid: "MLS-0001", password: "current-password" },
    ));
    expect(queryClearMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/student-dashboard");
  });

  it("navigates the Forgot Password action to the recovery start route", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("link-student-forgot-password"));
    expect(navigateMock).toHaveBeenCalledWith("/student/forgot-password");
  });

  it("submits only schoolCode and dsid and displays generic anti-enumeration copy", async () => {
    renderPage("/student/forgot-password");
    expect(screen.getByLabelText("School Code")).toBeVisible();
    expect(screen.getByLabelText("Digital Student ID (DSID)")).toBeVisible();
    goToOtp();
    await screen.findByTestId("input-student-recovery-otp");

    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/student/forgot-password",
      { schoolCode: "SCH-001", dsid: "MLS-0001" },
    );
    expect(screen.getByTestId("student-recovery-page")).toHaveTextContent(GENERIC_MESSAGE);
    expect(screen.getByTestId("student-recovery-page")).not.toHaveTextContent(/student name|school id|challenge/i);
  });

  it("normalizes OTP to six digits, rejects incomplete OTP, and sends only otp", async () => {
    renderPage("/student/forgot-password");
    goToOtp();
    await screen.findByTestId("input-student-recovery-otp");
    const otp = screen.getByTestId("input-student-recovery-otp");
    fireEvent.change(otp, { target: { value: "12a34-56-789" } });
    expect(otp).toHaveValue("123456");
    fireEvent.change(otp, { target: { value: "12345" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/student/verify-recovery-otp")).toBe(false);
    fireEvent.change(otp, { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
    await screen.findByTestId("input-student-recovery-new-password");
    expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/student/verify-recovery-otp",
      { otp: "123456" },
    );
    expect(currentLocation).toBe("/student/forgot-password/reset");
  });

  it("never puts reset authority in frontend state or URLs after OTP success", async () => {
    renderPage("/student/forgot-password");
    await reachReset();
    expect(currentLocation).toBe("/student/forgot-password/reset");
    expect(currentLocation).not.toMatch(/resetToken|challengeId|studentId|schoolId/i);
    expect(screen.queryByText(/resetToken|challengeId|studentId|schoolId/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/resetToken|challengeId/i)).not.toBeInTheDocument();
  });

  it("validates minimum length and confirmation, then sends only newPassword", async () => {
    renderPage("/student/forgot-password");
    await reachReset();
    const password = screen.getByTestId("input-student-recovery-new-password");
    const confirmation = screen.getByTestId("input-student-recovery-confirm-password");
    fireEvent.change(password, { target: { value: "short" } });
    fireEvent.change(confirmation, { target: { value: "short" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/student/reset-password")).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("at least 6");

    fireEvent.change(password, { target: { value: "valid-password" } });
    fireEvent.change(confirmation, { target: { value: "different-password" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/student/reset-password")).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");

    fireEvent.change(confirmation, { target: { value: "valid-password" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/student/reset-password",
      { newPassword: "valid-password" },
    ));
  });

  it("shows success only after API success and returns to Student Login without auto-login", async () => {
    renderPage("/student/forgot-password");
    await reachReset();
    fireEvent.change(screen.getByTestId("input-student-recovery-new-password"), {
      target: { value: "valid-password" },
    });
    fireEvent.change(screen.getByTestId("input-student-recovery-confirm-password"), {
      target: { value: "valid-password" },
    });
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    await screen.findByText("Your password has been updated. Sign in with your new password.");
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/student-login")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Return to Student Login" }));
    expect(navigateMock).toHaveBeenCalledWith("/student-login");
  });

  it("does not show false success after reset failure and offers restart", async () => {
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/student/forgot-password") return response({});
      if (url === "/api/student/verify-recovery-otp") return response({});
      if (url === "/api/student/reset-password") return Promise.reject(new Error("database details"));
      return response({});
    });
    renderPage("/student/forgot-password");
    await reachReset();
    fireEvent.change(screen.getByTestId("input-student-recovery-new-password"), {
      target: { value: "valid-password" },
    });
    fireEvent.change(screen.getByTestId("input-student-recovery-confirm-password"), {
      target: { value: "valid-password" },
    });
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be completed"));
    expect(screen.queryByText("Your password has been updated. Sign in with your new password.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-student-recovery-restart"));
    expect(navigateMock).toHaveBeenCalledWith("/student/forgot-password");
  });

  it("handles direct OTP and reset routes without creating client authority", async () => {
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    renderPage("/student/forgot-password/otp");
    expect(screen.getByTestId("input-student-recovery-otp")).toBeVisible();
    fireEvent.change(screen.getByTestId("input-student-recovery-otp"), { target: { value: "123456" } });
    apiRequestMock.mockRejectedValueOnce(new Error("challengeId=42 resetToken=secret"));
    fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be verified"));
    expect(storageSetItem).not.toHaveBeenCalled();

    cleanup();
    rerenderCurrent = undefined;
    renderPage("/student/forgot-password/reset");
    expect(screen.getByTestId("input-student-recovery-new-password")).toBeVisible();
    expect(currentLocation).not.toMatch(/resetToken|challengeId|studentId|schoolId/i);
    storageSetItem.mockRestore();
  });

  it("guards duplicate start, OTP, and reset submissions while requests are pending", async () => {
    let resolveStart!: (value: Response) => void;
    let resolveOtp!: (value: Response) => void;
    let resolveReset!: (value: Response) => void;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/student/forgot-password") return new Promise<Response>(resolve => { resolveStart = resolve; });
      if (url === "/api/student/verify-recovery-otp") return new Promise<Response>(resolve => { resolveOtp = resolve; });
      if (url === "/api/student/reset-password") return new Promise<Response>(resolve => { resolveReset = resolve; });
      return response({});
    });
    renderPage("/student/forgot-password");
    goToOtp();
    fireEvent.click(screen.getByTestId("button-student-recovery-start"));
    fireEvent.click(screen.getByTestId("button-student-recovery-start"));
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([, url]) => url === "/api/student/forgot-password")).toHaveLength(1));
    resolveStart(new Response(JSON.stringify({}), { status: 200 }));
    await screen.findByTestId("input-student-recovery-otp");
    fireEvent.change(screen.getByTestId("input-student-recovery-otp"), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
    fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([, url]) => url === "/api/student/verify-recovery-otp")).toHaveLength(1));
    resolveOtp(new Response(JSON.stringify({}), { status: 200 }));
    await screen.findByTestId("input-student-recovery-new-password");
    fireEvent.change(screen.getByTestId("input-student-recovery-new-password"), { target: { value: "valid-password" } });
    fireEvent.change(screen.getByTestId("input-student-recovery-confirm-password"), { target: { value: "valid-password" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([, url]) => url === "/api/student/reset-password")).toHaveLength(1));
    resolveReset(new Response(JSON.stringify({}), { status: 200 }));
    await screen.findByText("Your password has been updated. Sign in with your new password.");
  });

  it("keeps a pending start stale after Back/Cancel and a browser route change", async () => {
    let resolveStart!: (value: Response) => void;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/student/forgot-password") {
        return new Promise<Response>(resolve => { resolveStart = resolve; });
      }
      return response({});
    });
    renderPage("/student/forgot-password");
    fireEvent.change(screen.getByTestId("input-student-recovery-school-code"), { target: { value: "SCH-001" } });
    fireEvent.change(screen.getByTestId("input-student-recovery-dsid"), { target: { value: "MLS-0001" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-start"));
    await waitFor(() => expect(resolveStart).toBeTypeOf("function"));

    const back = screen.getByRole("button", { name: /Back to Student Login/i });
    expect(back).toBeDisabled();
    expect(currentLocation).toBe("/student/forgot-password");

    // Simulate browser Back directly; this bypasses the disabled in-app control.
    simulateBrowserRouteChange("/student/forgot-password/reset");
    expect(screen.getByTestId("input-student-recovery-new-password")).toBeVisible();
    resolveStart(new Response(JSON.stringify({ message: GENERIC_MESSAGE }), { status: 200 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(currentLocation).toBe("/student/forgot-password/reset");
    expect(screen.getByTestId("input-student-recovery-new-password")).toBeVisible();
    expect(screen.queryByTestId("input-student-recovery-otp")).not.toBeInTheDocument();
    expect(screen.queryByText("Password reset complete")).not.toBeInTheDocument();
  });

  it("keeps a pending OTP verify stale after Restart/Cancel and a route change", async () => {
    let resolveVerify!: (value: Response) => void;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/student/forgot-password") return response({ message: GENERIC_MESSAGE });
      if (url === "/api/student/verify-recovery-otp") {
        return new Promise<Response>(resolve => { resolveVerify = resolve; });
      }
      return response({});
    });
    renderPage("/student/forgot-password");
    goToOtp();
    await screen.findByTestId("input-student-recovery-otp");
    fireEvent.change(screen.getByTestId("input-student-recovery-otp"), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
    await waitFor(() => expect(resolveVerify).toBeTypeOf("function"));

    expect(screen.getByRole("button", { name: "Start again" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cancel recovery/i })).toBeDisabled();
    simulateBrowserRouteChange("/student/forgot-password");
    expect(screen.getByTestId("input-student-recovery-school-code")).toBeVisible();
    resolveVerify(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(currentLocation).toBe("/student/forgot-password");
    expect(screen.getByTestId("input-student-recovery-school-code")).toBeVisible();
    expect(screen.queryByTestId("input-student-recovery-new-password")).not.toBeInTheDocument();
  });

  it("keeps a pending reset stale after restart and route change, without showing success", async () => {
    let resolveReset!: (value: Response) => void;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/student/forgot-password") return response({ message: GENERIC_MESSAGE });
      if (url === "/api/student/verify-recovery-otp") return response({ success: true });
      if (url === "/api/student/reset-password") {
        return new Promise<Response>(resolve => { resolveReset = resolve; });
      }
      return response({});
    });
    renderPage("/student/forgot-password");
    await reachReset();
    fireEvent.change(screen.getByTestId("input-student-recovery-new-password"), { target: { value: "valid-password" } });
    fireEvent.change(screen.getByTestId("input-student-recovery-confirm-password"), { target: { value: "valid-password" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-reset"));
    await waitFor(() => expect(resolveReset).toBeTypeOf("function"));
    const restart = screen.getByTestId("button-student-recovery-restart");
    expect(restart).toBeDisabled();
    simulateBrowserRouteChange("/student/forgot-password");
    expect(screen.getByTestId("input-student-recovery-school-code")).toBeVisible();
    resolveReset(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(currentLocation).toBe("/student/forgot-password");
    expect(screen.getByTestId("input-student-recovery-school-code")).toBeVisible();
    expect(screen.queryByText("Password reset complete")).not.toBeInTheDocument();
  });

  it("does not let an older onSettled unlock a newer OTP request", async () => {
    let resolveOlder!: (value: Response) => void;
    let resolveNewer!: (value: Response) => void;
    let verifyCount = 0;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/student/forgot-password") {
        return new Promise<Response>(resolve => { resolveOlder = resolve; });
      }
      if (url === "/api/student/verify-recovery-otp") {
        verifyCount += 1;
        return new Promise<Response>(resolve => { resolveNewer = resolve; });
      }
      return response({});
    });
    renderPage("/student/forgot-password");
    fireEvent.change(screen.getByTestId("input-student-recovery-school-code"), { target: { value: "SCH-001" } });
    fireEvent.change(screen.getByTestId("input-student-recovery-dsid"), { target: { value: "MLS-0001" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-start"));
    await waitFor(() => expect(resolveOlder).toBeTypeOf("function"));
    simulateBrowserRouteChange("/student/forgot-password/otp");
    await new Promise(resolve => setTimeout(resolve, 0));
    fireEvent.change(screen.getByTestId("input-student-recovery-otp"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByTestId("input-student-recovery-otp").closest("form")!);
    await waitFor(() => expect(verifyCount).toBe(1));

    resolveOlder(new Response(JSON.stringify({ message: GENERIC_MESSAGE }), { status: 200 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    fireEvent.submit(screen.getByTestId("input-student-recovery-otp").closest("form")!);
    expect(verifyCount).toBe(1);

    resolveNewer(new Response(JSON.stringify({ message: GENERIC_MESSAGE }), { status: 200 }));
    await screen.findByTestId("input-student-recovery-new-password");
    expect(verifyCount).toBe(1);
  });

  it("keeps recovery inputs accessible, mobile-safe, and does not persist or log secrets", async () => {
    const storageSetItem = vi.spyOn(Storage.prototype, "setItem");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    renderPage("/student/forgot-password");
    expect(screen.getByTestId("student-recovery-page").querySelector(".max-w-md")).toBeTruthy();
    goToOtp();
    await screen.findByTestId("input-student-recovery-otp");
    expect(screen.getByLabelText("Six-digit verification code")).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(screen.getByTestId("input-student-recovery-otp"), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("button-student-recovery-verify"));
    await screen.findByTestId("input-student-recovery-new-password");
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    const secretOutput = JSON.stringify([...consoleLog.mock.calls, ...consoleError.mock.calls]);
    expect(storageSetItem).not.toHaveBeenCalled();
    expect(secretOutput).not.toContain("valid-password");
    expect(secretOutput).not.toContain("123456");
    expect(secretOutput).not.toContain("resetToken");
    storageSetItem.mockRestore();
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });
});