// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequestMock, navigateMock, toastMock, queryClearMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  navigateMock: vi.fn(),
  toastMock: vi.fn(),
  queryClearMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: { clear: queryClearMock },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/teacher-login", navigateMock],
}));

import TeacherLogin from "@/pages/teacher-login";

function response(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

function renderTeacherLogin() {
  return render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })}>
      <TeacherLogin />
    </QueryClientProvider>,
  );
}

function openRecovery() {
  fireEvent.click(screen.getByTestId("link-forgot-password"));
}

async function submitRecovery() {
  openRecovery();
  fireEvent.change(screen.getByTestId("input-forgot-school-code"), {
    target: { value: "SCH-001" },
  });
  fireEvent.change(screen.getByTestId("input-forgot-email"), {
    target: { value: "teacher@school.test" },
  });
  fireEvent.click(screen.getByTestId("button-send-otp"));
  await screen.findByTestId("input-otp");
}

async function reachPasswordReset() {
  await submitRecovery();
  fireEvent.change(screen.getByTestId("input-otp"), { target: { value: "123456" } });
  fireEvent.click(screen.getByTestId("button-verify-otp"));
  await screen.findByTestId("input-reset-new-password");
}

describe("Teacher Login secure password recovery", () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/teacher/forgot-password") {
        return response({
          message: "If those details match, an OTP has been sent to your recovery email. Please check and try again.",
        });
      }
      if (url === "/api/teacher/verify-otp") {
        return response({ success: true, message: "OTP verified." });
      }
      if (url === "/api/teacher/reset-password") {
        return response({
          success: true,
          message: "Your password has been reset successfully. Please log in again.",
        });
      }
      if (url === "/api/teacher-login") {
        return response({ message: "Login successful", mustChangePassword: false });
      }
      return response({});
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders normal Teacher Login and keeps its existing login contract functional", async () => {
    renderTeacherLogin();
    expect(screen.getByTestId("text-page-title")).toHaveTextContent("Teacher Login");
    fireEvent.change(screen.getByTestId("input-email"), {
      target: { value: "teacher@school.test" },
    });
    fireEvent.change(screen.getByTestId("input-password"), {
      target: { value: "current-password" },
    });
    fireEvent.click(screen.getByTestId("button-login"));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "POST",
      "/api/teacher-login",
      { email: "teacher@school.test", password: "current-password" },
    ));
    expect(navigateMock).toHaveBeenCalledWith("/teacher-dashboard");
  });

  it("opens a School Code and Email recovery form without phone or browser identity fields", () => {
    renderTeacherLogin();
    openRecovery();
    expect(screen.getByLabelText("School Code")).toBeVisible();
    expect(screen.getByLabelText("Registered Email")).toBeVisible();
    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/teacher id/i)).not.toBeInTheDocument();
  });

  it("sends only schoolCode and email, then displays the generic recovery message", async () => {
    renderTeacherLogin();
    await submitRecovery();
    const forgotCall = apiRequestMock.mock.calls.find(([, url]) =>
      url === "/api/teacher/forgot-password"
    );
    expect(forgotCall).toEqual([
      "POST",
      "/api/teacher/forgot-password",
      { schoolCode: "SCH-001", email: "teacher@school.test" },
    ]);
    expect(screen.getByTestId("text-otp-message")).toHaveTextContent(
      "If those details match, an OTP has been sent to your recovery email. Please check and try again.",
    );
  });

  it("sends only a six-digit OTP and does not expect or store a reset token", async () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");
    renderTeacherLogin();
    await submitRecovery();
    fireEvent.change(screen.getByTestId("input-otp"), {
      target: { value: "12a34-56" },
    });
    expect(screen.getByTestId("input-otp")).toHaveValue("123456");
    fireEvent.click(screen.getByTestId("button-verify-otp"));
    await screen.findByTestId("input-reset-new-password");

    const verifyCall = apiRequestMock.mock.calls.find(([, url]) =>
      url === "/api/teacher/verify-otp"
    );
    expect(verifyCall).toEqual(["POST", "/api/teacher/verify-otp", { otp: "123456" }]);
    expect(localStorageSpy).not.toHaveBeenCalled();
  });

  it("validates exact passwords and sends only newPassword and confirmPassword", async () => {
    renderTeacherLogin();
    await reachPasswordReset();

    fireEvent.change(screen.getByTestId("input-reset-new-password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByTestId("input-reset-confirm-password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByTestId("button-reset-password"));
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/teacher/reset-password")).toBe(false);

    fireEvent.change(screen.getByTestId("input-reset-new-password"), {
      target: { value: "new-password-🔐" },
    });
    fireEvent.change(screen.getByTestId("input-reset-confirm-password"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByTestId("button-reset-password"));
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/teacher/reset-password")).toBe(false);

    fireEvent.change(screen.getByTestId("input-reset-confirm-password"), {
      target: { value: "new-password-🔐" },
    });
    fireEvent.click(screen.getByTestId("button-reset-password"));
    await screen.findByTestId("reset-success-state");

    const resetCall = apiRequestMock.mock.calls.find(([, url]) =>
      url === "/api/teacher/reset-password"
    );
    expect(resetCall).toEqual([
      "POST",
      "/api/teacher/reset-password",
      {
        newPassword: "new-password-🔐",
        confirmPassword: "new-password-🔐",
      },
    ]);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows success without automatic login and Back to Login clears recovery state", async () => {
    renderTeacherLogin();
    await reachPasswordReset();
    fireEvent.change(screen.getByTestId("input-reset-new-password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByTestId("input-reset-confirm-password"), {
      target: { value: "new-password" },
    });
    fireEvent.click(screen.getByTestId("button-reset-password"));
    await screen.findByTestId("text-reset-success");
    expect(navigateMock).not.toHaveBeenCalled();
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/teacher-login")).toBe(false);

    fireEvent.click(screen.getByTestId("button-back-to-login-after-reset"));
    expect(screen.getByTestId("text-page-title")).toHaveTextContent("Teacher Login");
    openRecovery();
    expect(screen.getByTestId("input-forgot-school-code")).toHaveValue("");
    expect(screen.getByTestId("input-forgot-email")).toHaveValue("");
  });

  it("uses safe generic OTP and reset errors without exposing provider details", async () => {
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/teacher/forgot-password") return response({ message: "Generic message" });
      if (url === "/api/teacher/verify-otp") {
        return Promise.reject(new Error("SendGrid provider key rejected; challengeId=44"));
      }
      return response({});
    });
    renderTeacherLogin();
    await submitRecovery();
    fireEvent.change(screen.getByTestId("input-otp"), { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("button-verify-otp"));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Unable to Verify OTP",
      description: "The OTP is invalid or expired. Please request a new OTP and try again.",
      variant: "destructive",
    })));
    expect(JSON.stringify(toastMock.mock.calls)).not.toContain("SendGrid");
    expect(JSON.stringify(toastMock.mock.calls)).not.toContain("challengeId");
  });

  it("prevents duplicate Forgot Password submissions and stays mobile-width safe", async () => {
    let resolveForgot!: (value: Response) => void;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/teacher/forgot-password") {
        return new Promise<Response>(resolve => {
          resolveForgot = resolve;
        });
      }
      return response({});
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    renderTeacherLogin();
    openRecovery();
    fireEvent.change(screen.getByTestId("input-forgot-school-code"), {
      target: { value: "SCH-001" },
    });
    fireEvent.change(screen.getByTestId("input-forgot-email"), {
      target: { value: "teacher@school.test" },
    });
    const button = screen.getByTestId("button-send-otp");
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([, url]) =>
      url === "/api/teacher/forgot-password"
    )).toHaveLength(1));
    await waitFor(() => expect(button).toBeDisabled());

    resolveForgot(new Response(JSON.stringify({ message: GENERIC_RECOVERY_MESSAGE_FOR_TEST }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    expect(await screen.findByTestId("input-otp")).toHaveClass("w-full");
  });

  it("prevents duplicate OTP and password-reset submissions in the same render tick", async () => {
    let resolveVerify!: (value: Response) => void;
    let resolveReset!: (value: Response) => void;
    apiRequestMock.mockImplementation((_method: string, url: string) => {
      if (url === "/api/teacher/forgot-password") {
        return response({ message: GENERIC_RECOVERY_MESSAGE_FOR_TEST });
      }
      if (url === "/api/teacher/verify-otp") {
        return new Promise<Response>(resolve => {
          resolveVerify = resolve;
        });
      }
      if (url === "/api/teacher/reset-password") {
        return new Promise<Response>(resolve => {
          resolveReset = resolve;
        });
      }
      return response({});
    });
    renderTeacherLogin();
    await submitRecovery();
    fireEvent.change(screen.getByTestId("input-otp"), { target: { value: "123456" } });
    const verifyButton = screen.getByTestId("button-verify-otp");
    fireEvent.click(verifyButton);
    fireEvent.click(verifyButton);
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([, url]) =>
      url === "/api/teacher/verify-otp"
    )).toHaveLength(1));

    resolveVerify(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await screen.findByTestId("input-reset-new-password");
    fireEvent.change(screen.getByTestId("input-reset-new-password"), {
      target: { value: "new-password" },
    });
    fireEvent.change(screen.getByTestId("input-reset-confirm-password"), {
      target: { value: "new-password" },
    });
    const resetButton = screen.getByTestId("button-reset-password");
    fireEvent.click(resetButton);
    fireEvent.click(resetButton);
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([, url]) =>
      url === "/api/teacher/reset-password"
    )).toHaveLength(1));

    resolveReset(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    expect(await screen.findByTestId("reset-success-state")).toBeVisible();
  });
});

const GENERIC_RECOVERY_MESSAGE_FOR_TEST =
  "If those details match, an OTP has been sent to your recovery email. Please check and try again.";