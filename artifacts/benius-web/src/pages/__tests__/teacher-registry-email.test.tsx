// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequestMock, invalidateQueriesMock, toastMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  queryClient: { invalidateQueries: invalidateQueriesMock },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/contexts/session-view-context", () => ({
  useSessionView: () => ({ isArchiveMode: false }),
}));

import TeacherRegistry from "@/pages/admin-modules/teacher-registry";

const teacher = {
  id: 321,
  userId: 654,
  schoolId: 12,
  fullName: "Route Teacher",
  email: "canonical.teacher@example.test",
  phone: "9876543210",
  subject: "Mathematics",
  assignedClass: "8",
  assignedSection: "B",
  designation: "Senior Teacher",
  gender: "Female",
  dateOfBirth: "1988-04-12",
  govtIdType: "Aadhar",
  govtIdNumber: "123456789012",
  address: "12 School Road",
  joiningDate: "2018-06-01",
  qualifications: "M.Ed",
  isActive: true,
  mappings: [],
};

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

function renderRegistry() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TeacherRegistry
        schoolId={12}
        classes={["8"]}
        sections={["B"]}
        subjects={["Mathematics"]}
        allowedSubs={["edit"]}
      />
    </QueryClientProvider>,
  );
}

async function openEditModal() {
  renderRegistry();
  await screen.findByTestId(`row-teacher-reg-${teacher.id}`);
  fireEvent.click(screen.getByTestId(`button-edit-teacher-reg-${teacher.id}`));
  await screen.findByTestId("modal-edit-teacher-registry");
}

function mockTeacherQueries() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/school-config")) {
      return response({ classes: ["8"], sections: ["B"], subjects: ["Mathematics"] });
    }
    if (url.startsWith("/api/admin/teachers")) {
      return response({ data: [teacher], total: 1 });
    }
    return response({});
  }));
}

describe("Admin Teacher Registry email edit", () => {
  beforeEach(() => {
    mockTeacherQueries();
    apiRequestMock.mockResolvedValue(response({ ...teacher }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens with the canonical email populated in an editable email input", async () => {
    await openEditModal();

    const email = screen.getByTestId("input-edit-reg-email");
    expect(email).toHaveValue(teacher.email);
    expect(email).toHaveAttribute("type", "email");
    expect(email).not.toBeDisabled();
    expect(email).not.toHaveAttribute("readonly");
  });

  it("trims changed email, sends the complete edit payload without browser identity fields, and follows success behavior", async () => {
    await openEditModal();
    fireEvent.change(screen.getByTestId("input-edit-reg-email"), {
      target: { value: "  updated.teacher@example.test  " },
    });
    fireEvent.click(screen.getByTestId("button-save-edit-teacher-registry"));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      `/api/admin/teachers/${teacher.id}`,
      expect.objectContaining({
        fullName: teacher.fullName,
        email: "updated.teacher@example.test",
        phone: teacher.phone,
        designation: teacher.designation,
        subject: teacher.subject,
        assignedClass: teacher.assignedClass,
        assignedSection: teacher.assignedSection,
        gender: teacher.gender,
        dateOfBirth: teacher.dateOfBirth,
        govtIdType: teacher.govtIdType,
        govtIdNumber: teacher.govtIdNumber,
        address: teacher.address,
        joiningDate: teacher.joiningDate,
        qualifications: teacher.qualifications,
      }),
    ));

    const payload = apiRequestMock.mock.calls[0][2] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("schoolId");
    expect(payload).not.toHaveProperty("userId");
    await waitFor(() => expect(screen.queryByTestId("modal-edit-teacher-registry")).not.toBeInTheDocument());
    expect(toastMock).toHaveBeenCalledWith({ title: "Teacher Updated" });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["/api/admin/teachers"] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["/api/schools", 12, "teachers"] });
  });

  it("blocks an invalid email before issuing PATCH and shows validation", async () => {
    await openEditModal();
    fireEvent.change(screen.getByTestId("input-edit-reg-email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.submit(screen.getByTestId("input-edit-reg-email").closest("form")!);

    expect(apiRequestMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Enter a valid teacher email")).toBeVisible();
  });

  it("shows the generic duplicate-email error without exposing another account identity", async () => {
    apiRequestMock.mockRejectedValueOnce(new Error("Unable to update teacher"));
    await openEditModal();
    fireEvent.change(screen.getByTestId("input-edit-reg-email"), {
      target: { value: "already-used@example.test" },
    });
    fireEvent.click(screen.getByTestId("button-save-edit-teacher-registry"));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({
      title: "Update Failed",
      description: "Unable to update teacher",
      variant: "destructive",
    }));
    expect(JSON.stringify(toastMock.mock.calls)).not.toContain("another.account@example.test");
    expect(screen.getByTestId("modal-edit-teacher-registry")).toBeInTheDocument();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });
});