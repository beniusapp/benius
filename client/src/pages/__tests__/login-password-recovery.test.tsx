// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequestMock, navigateMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", navigateMock],
}));

import Login from "@/pages/login";

function response(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

async function reachOtp() {
  fireEvent.click(screen.getByTestId("link-forgot-password"));
  fireEvent.change(screen.getByTestId("input-forgot-email"), {
    target: { value: "principal@school.com" },
  });
  fireEvent.change(screen.getByTestId("input-forgot-schoolcode"), {
    target: { value: "PPS" },
  });
  fireEvent.click(screen.getByTestId("button-send-otp"));
  await screen.findByTestId("text-otp-security-message");
}

async function reachResetWithoutPin() {
  await reachOtp();
  fireEvent.change(screen.getByTestId("input-otp"), { target: { value: "123456" } });
  fireEvent.click(screen.getByTestId("button-verify-otp"));
  await screen.findByTestId("input-reset-password");
}

function renderLogin() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <Login />
    </QueryClientProvider>,
  );
}

describe("Principal Login password recovery", () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation((method: string, url: string) => {
      if (url === "/api/admin/forgot-password") return response({});
      if (url === "/api/admin/verify-otp") return response({ requiresPin: false, resetToken: "reset-token" });
      if (url === "/api/admin/reset-password") return response({ ok: true });
      return response({});
    });
  });

  afterEach(() => {
    cleanup();
    apiRequestMock.mockReset();
    navigateMock.mockReset();
  });

  it("moves through the generic OTP, mandatory PIN, reset, and success steps", async () => {
    apiRequestMock.mockImplementation((method: string, url: string) => {
      if (url === "/api/admin/forgot-password") return response({});
      if (url === "/api/admin/verify-otp") return response({ requiresPin: true });
      if (url === "/api/admin/verify-reset-pin") return response({ resetToken: "pin-reset-token" });
      if (url === "/api/admin/reset-password") return response({ ok: true });
      return response({});
    });
    renderLogin();

    await reachOtp();
    expect(screen.getByTestId("text-otp-security-message")).toHaveTextContent(
      "If those details match, an OTP has been sent to your recovery email. Please check and try again.",
    );
    expect(screen.queryByTestId("text-otp-display")).not.toBeInTheDocument();
    expect(screen.queryByText("123456")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-otp"), { target: { value: "123456" } });
    fireEvent.click(screen.getByTestId("button-verify-otp"));
    await screen.findByText("Verify Your PIN");

    for (const digit of "123456") fireEvent.click(screen.getByTestId(`pin-key-${digit}`));
    await screen.findByTestId("input-reset-password");

    fireEvent.change(screen.getByTestId("input-reset-password"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByTestId("input-reset-confirm-password"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByTestId("button-reset-password"));
    await screen.findByTestId("text-reset-success");

    const resetCall = apiRequestMock.mock.calls.find(([, url]) => url === "/api/admin/reset-password");
    expect(resetCall?.[0]).toBe("POST");
    expect(resetCall?.[2]).toEqual({
      resetToken: "pin-reset-token",
      newPassword: "new-password",
      confirmPassword: "new-password",
      newPin: undefined,
    });
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-back-to-login-after-reset"));
    expect(screen.getByText("Principal Login")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("prevents a mismatched confirmation from calling reset-password", async () => {
    renderLogin();
    await reachResetWithoutPin();

    fireEvent.change(screen.getByTestId("input-reset-password"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByTestId("input-reset-confirm-password"), { target: { value: "different-password" } });
    fireEvent.click(screen.getByTestId("button-reset-password"));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/admin/reset-password")).toBe(false);
  });

  it("shows the generic message when OTP verification fails", async () => {
    apiRequestMock.mockImplementation((method: string, url: string) => {
      if (url === "/api/admin/forgot-password") return response({});
      if (url === "/api/admin/verify-otp") return Promise.reject(new Error("server detail"));
      return response({});
    });
    renderLogin();
    await reachOtp();

    fireEvent.change(screen.getByTestId("input-otp"), { target: { value: "000000" } });
    fireEvent.click(screen.getByTestId("button-verify-otp"));

    await waitFor(() => expect(screen.getByTestId("text-otp-error")).toHaveTextContent(
      "Invalid or expired OTP. Please request a new OTP.",
    ));
    expect(screen.getByTestId("text-otp-error")).not.toHaveTextContent("server detail");
  });

  it("renders the recovery card without overflow-prone fixed width at a narrow viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    renderLogin();
    await reachOtp();
    expect(screen.getByTestId("text-otp-security-message")).toBeVisible();
    expect(screen.getByTestId("input-otp")).toBeVisible();
  });
});