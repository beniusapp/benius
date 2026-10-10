export type AdminActionSourceId =
  | "teacher-leave"
  | "student-leave"
  | "gallery"
  | "ebooks"
  | "complaints";

export interface AdminActionSource {
  id: AdminActionSourceId;
  label: string;
  destination: string;
  parent: "leave-requests" | "approval-center" | "complaint-hub";
}

export const ADMIN_ACTION_SOURCES: readonly AdminActionSource[] = [
  {
    id: "teacher-leave",
    label: "Pending Teacher Leave Applications",
    destination: "/admin-dashboard/leave-requests/teacher-leave",
    parent: "leave-requests",
  },
  {
    id: "student-leave",
    label: "Student Leave Applications Forwarded to Admin",
    destination: "/admin-dashboard/leave-requests/student-leave",
    parent: "leave-requests",
  },
  {
    id: "gallery",
    label: "Unapproved Gallery Items",
    destination: "/admin-dashboard/approval-center/gallery-hub",
    parent: "approval-center",
  },
  {
    id: "ebooks",
    label: "Pending E-Book Approvals",
    destination: "/admin-dashboard/approval-center/ebook",
    parent: "approval-center",
  },
  {
    id: "complaints",
    label: "Open or In-Progress Complaints",
    destination: "/admin-dashboard/complaint-hub",
    parent: "complaint-hub",
  },
];

export const ADMIN_NOTIFICATION_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchInterval: false as const,
};

export function shouldShowAdminActionNotifications(role: string | undefined): boolean {
  return role !== "support_staff";
}

export function refetchAdminNotificationSources(
  refetchers: readonly (() => Promise<unknown>)[],
): Promise<unknown[]> {
  return Promise.all(refetchers.map(refetch => refetch()));
}

export function adminDashboardNotificationQueryKeys(
  schoolId: number | undefined,
  sessionId: number | null | undefined,
) {
  return {
    teacherLeaves: ["/api/leave/school", schoolId, sessionId ?? null] as const,
    studentLeaves: ["/api/student-leaves/school", schoolId, sessionId ?? null] as const,
    complaints: ["/api/complaints/school", schoolId, sessionId ?? null] as const,
    // Gallery and E-books are school-wide data, not Academic Session data.
    gallery: ["/api/gallery", schoolId, "all"] as const,
    ebooks: ["/api/library/books", schoolId, "pending"] as const,
  };
}

export interface AdminNotificationQuery<T> {
  data?: T;
  isError: boolean;
  isLoading: boolean;
  isFetching?: boolean;
}

export interface AdminNotificationQueries {
  teacherLeaves: AdminNotificationQuery<{ status?: string }[]>;
  studentLeaves: AdminNotificationQuery<{ status?: string }[]>;
  gallery: AdminNotificationQuery<{ approved?: boolean }[]>;
  ebooks: AdminNotificationQuery<{ verificationStatus?: string }[]>;
  complaints: AdminNotificationQuery<{ status?: string }[]>;
}

export interface AdminActionCount {
  id: AdminActionSourceId;
  label: string;
  destination: string;
  parent: AdminActionSource["parent"];
  count?: number;
  state: "loading" | "error" | "ready";
}

export function summarizeAdminNotifications(queries: AdminNotificationQueries) {
  const countById: Record<AdminActionSourceId, number | undefined> = {
    "teacher-leave": queries.teacherLeaves.data?.filter(
      item => item.status?.toLowerCase() === "pending",
    ).length,
    "student-leave": queries.studentLeaves.data?.filter(
      item => item.status?.toLowerCase() === "forwarded_to_admin",
    ).length,
    gallery: queries.gallery.data?.filter(item => item.approved === false).length,
    ebooks: queries.ebooks.data?.filter(
      item => item.verificationStatus?.toLowerCase() === "pending",
    ).length,
    complaints: queries.complaints.data?.filter(item => {
      const status = item.status?.toLowerCase();
      return status === "open" || status === "in_progress";
    }).length,
  };

  const queryById = {
    "teacher-leave": queries.teacherLeaves,
    "student-leave": queries.studentLeaves,
    gallery: queries.gallery,
    ebooks: queries.ebooks,
    complaints: queries.complaints,
  } satisfies Record<AdminActionSourceId, AdminNotificationQuery<unknown[]>>;

  const sources: AdminActionCount[] = ADMIN_ACTION_SOURCES.map(source => {
    const query = queryById[source.id];
    return {
      ...source,
      count: countById[source.id],
      state: query.isError
        ? "error"
        : query.isFetching || (query.data === undefined && query.isLoading)
          ? "loading"
          : query.data === undefined
            ? "error"
            : "ready",
    };
  });

  const complete = sources.every(source => source.state === "ready");
  const total = complete
    ? sources.reduce((sum, source) => sum + (source.count ?? 0), 0)
    : undefined;

  const parentBadges = {
    "leave-requests":
      countById["teacher-leave"] !== undefined && countById["student-leave"] !== undefined
        ? countById["teacher-leave"] + countById["student-leave"]
        : undefined,
    "approval-center":
      countById.gallery !== undefined && countById.ebooks !== undefined
        ? countById.gallery + countById.ebooks
        : undefined,
    "complaint-hub": countById.complaints,
  } satisfies Record<string, number | undefined>;

  return { sources, total, parentBadges, complete };
}
