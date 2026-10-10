import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_NOTIFICATION_QUERY_OPTIONS,
  ADMIN_ACTION_SOURCES,
  adminDashboardNotificationQueryKeys,
  refetchAdminNotificationSources,
  shouldShowAdminActionNotifications,
  isUnresolvedComplaintStatus,
  summarizeAdminNotifications,
  type AdminNotificationQueries,
} from "./admin-dashboard-notifications";
import { aggregateAdminUnreadParents, markAdminIdsSeen, unreadAdminIds, type AdminUnreadScope } from "./admin-dashboard-unread-state";

function testStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

function ready<T>(data: T) {
  return { data, isError: false, isLoading: false };
}

const emptyQueries = (): AdminNotificationQueries => ({
  teacherLeaves: ready([]),
  studentLeaves: ready([]),
  gallery: ready([]),
  ebooks: ready([]),
  complaints: ready([]),
});

test("seven actionable submodules count unresolved work and complaint aggregates deduplicate IDs", () => {
  const q = emptyQueries();
  q.teacherLeaves.data = [{ id: 1, status: "pending" }, { id: 2, status: "approved" }];
  q.studentLeaves.data = [{ id: 3, status: "forwarded_to_admin" }, { id: 4, status: "approved" }];
  q.gallery.data = [{ id: 5, approved: false }, { id: 6, approved: true }];
  q.ebooks.data = [{ id: 7, verificationStatus: "pending" }, { id: 8, verificationStatus: "verified" }];
  q.complaints.data = [
    { id: 9, status: "Pending", complaintType: "teacher-to-admin" },
    { id: 9, status: "Investigating", complaintType: "student-to-staff" },
    { id: 11, status: "Escalated", complaintType: "student-peer-report", escalatedToPrincipal: true },
    { id: 12, status: "Resolved", complaintType: "teacher-to-admin" },
  ];

  const summary = summarizeAdminNotifications(q);
  assert.deepEqual(summary.sources.map(({ id, count }) => [id, count]), [
    ["teacher-leave", 1], ["student-leave", 1], ["gallery", 1], ["ebooks", 1],
    ["private-complaints", 1], ["student-grievances", 1], ["escalated-complaints", 1],
  ]);
  assert.equal(summary.total, 6);
  assert.deepEqual(summary.parentBadges, {
    "leave-requests": 2,
    "approval-center": 2,
    "complaint-hub": 2,
  });
});

test("each actionable item uses its real module and supported submodule destination", () => {
  assert.deepEqual(
    ADMIN_ACTION_SOURCES.map(({ id, destination }) => [id, destination]),
    [
      ["teacher-leave", "/admin-dashboard/leave-requests/teacher-leave"],
      ["student-leave", "/admin-dashboard/leave-requests/student-leave"],
      ["gallery", "/admin-dashboard/approval-center/gallery-hub"],
      ["ebooks", "/admin-dashboard/approval-center/ebook"],
      ["private-complaints", "/admin-dashboard/complaint-hub/private"],
      ["student-grievances", "/admin-dashboard/complaint-hub/grievances"],
      ["escalated-complaints", "/admin-dashboard/complaint-hub/escalated"],
    ],
  );
});

test("session-owned query keys change with session; school-wide sources do not", () => {
  const current = adminDashboardNotificationQueryKeys(7, 10);
  const next = adminDashboardNotificationQueryKeys(7, 11);
  assert.notDeepEqual(current.teacherLeaves, next.teacherLeaves);
  assert.notDeepEqual(current.studentLeaves, next.studentLeaves);
  assert.notDeepEqual(current.complaints, next.complaints);
  assert.deepEqual(current.gallery, next.gallery);
  assert.deepEqual(current.ebooks, next.ebooks);
  assert.notDeepEqual(current.gallery, adminDashboardNotificationQueryKeys(8, 10).gallery);
});

test("partial and complete errors preserve known counts but never claim a complete aggregate", () => {
  const q = emptyQueries();
  q.teacherLeaves.data = [{ id: 1, status: "pending" }];
  q.complaints = { data: [{ id: 2, status: "Pending", complaintType: "teacher-to-admin" }], isError: true, isLoading: false };
  q.ebooks = { isError: true, isLoading: false };

  const partial = summarizeAdminNotifications(q);
  assert.equal(partial.sources.find(s => s.id === "teacher-leave")?.count, 1);
  assert.equal(partial.sources.find(s => s.id === "private-complaints")?.count, 1);
  assert.equal(partial.sources.find(s => s.id === "private-complaints")?.state, "error");
  assert.equal(partial.sources.find(s => s.id === "ebooks")?.count, undefined);
  assert.equal(partial.total, undefined);
  assert.equal(partial.complete, false);

  q.teacherLeaves = { isError: true, isLoading: false };
  q.studentLeaves = { isError: true, isLoading: false };
  q.gallery = { isError: true, isLoading: false };
  q.complaints = { isError: true, isLoading: false };
  q.ebooks = { isError: true, isLoading: false };
  const failed = summarizeAdminNotifications(q);
  assert.equal(failed.total, undefined);
  assert.equal(failed.sources.every(s => s.state === "error"), true);
});

test("initial loading and genuine zero-pending states are distinct", () => {
  const loading: AdminNotificationQueries = {
    teacherLeaves: { isError: false, isLoading: true },
    studentLeaves: { isError: false, isLoading: true },
    gallery: { isError: false, isLoading: true },
    ebooks: { isError: false, isLoading: true },
    complaints: { isError: false, isLoading: true },
  };
  const loadingSummary = summarizeAdminNotifications(loading);
  assert.equal(loadingSummary.total, undefined);
  assert.equal(loadingSummary.sources.every(s => s.state === "loading"), true);

  const empty = summarizeAdminNotifications(emptyQueries());
  assert.equal(empty.total, 0);
  assert.equal(empty.complete, true);
  assert.equal(empty.sources.every(s => s.count === 0 && s.state === "ready"), true);

  const refreshing = emptyQueries();
  refreshing.gallery.isFetching = true;
  const refreshingSummary = summarizeAdminNotifications(refreshing);
  assert.equal(refreshingSummary.sources.find(s => s.id === "gallery")?.state, "loading");
  assert.equal(refreshingSummary.total, undefined);
});

test("dashboard refreshes deliberately without polling and unresolved work is not cleared by opening a module", async () => {
  assert.equal(ADMIN_NOTIFICATION_QUERY_OPTIONS.staleTime, 0);
  assert.equal(ADMIN_NOTIFICATION_QUERY_OPTIONS.refetchOnMount, "always");
  assert.equal(ADMIN_NOTIFICATION_QUERY_OPTIONS.refetchInterval, false);

  let calls = 0;
  await refetchAdminNotificationSources(Array.from({ length: 5 }, () => async () => {
    calls += 1;
    return undefined;
  }));
  assert.equal(calls, 5);

  const q = emptyQueries();
  q.teacherLeaves.data = [{ id: 1, status: "pending" }];
  const before = summarizeAdminNotifications(q);
  const afterOpeningModule = summarizeAdminNotifications(q);
  assert.equal(before.sources.find(s => s.id === "teacher-leave")?.count, 1);
  assert.deepEqual(afterOpeningModule, before);
});

test("complaint status normalization counts the canonical active states and excludes terminal resolution", () => {
  assert.equal(isUnresolvedComplaintStatus(" Pending "), true);
  assert.equal(isUnresolvedComplaintStatus("investigating"), true);
  assert.equal(isUnresolvedComplaintStatus("Escalated"), true);
  assert.equal(isUnresolvedComplaintStatus("in progress"), true);
  assert.equal(isUnresolvedComplaintStatus("Resolved"), false);
  assert.equal(isUnresolvedComplaintStatus(null), false);
});

test("browser-local seen IDs isolate Admin, School, Academic Session, and submodule; new IDs stay unread", () => {
  const storage = testStorage();
  const scope: AdminUnreadScope = { adminId: 3, schoolId: 8, sessionId: 2026, source: "teacher-leave" };
  assert.deepEqual([...unreadAdminIds(scope, [11, 12], storage)], ["11", "12"]);
  assert.equal(markAdminIdsSeen(scope, [11], [11, 12], storage), true);
  assert.deepEqual([...unreadAdminIds(scope, [11, 12], storage)], ["12"]);
  assert.deepEqual([...unreadAdminIds({ ...scope, source: "student-leave" }, [11, 12], storage)], ["11", "12"]);
  assert.deepEqual([...unreadAdminIds({ ...scope, sessionId: 2027 }, [11, 12], storage)], ["11", "12"]);
  assert.deepEqual([...unreadAdminIds({ ...scope, schoolId: 9 }, [11, 12], storage)], ["11", "12"]);
  assert.deepEqual([...unreadAdminIds({ ...scope, adminId: 4 }, [11, 12], storage)], ["11", "12"]);
  assert.deepEqual([...unreadAdminIds(scope, [11, 12, 13], storage)], ["12", "13"]);
});

test("gallery and e-book seen state is school-wide across Academic Sessions", () => {
  const storage = testStorage();
  const scope: AdminUnreadScope = { adminId: 3, schoolId: 8, sessionId: 2026, source: "gallery" };
  assert.equal(markAdminIdsSeen(scope, [21], [21], storage), true);
  assert.deepEqual([...unreadAdminIds({ ...scope, sessionId: 2027 }, [21], storage)], []);
  const ebooks = { ...scope, source: "ebooks" as const };
  assert.equal(markAdminIdsSeen(ebooks, [22], [22], storage), true);
  assert.deepEqual([...unreadAdminIds({ ...ebooks, sessionId: 2027 }, [22], storage)], []);
});

test("parent unread indicator stays on until every relevant child is seen", () => {
  const allSeen = {
    teacherLeave: false, studentLeave: false, gallery: false, ebooks: false,
    privateComplaints: false, studentGrievances: false, escalatedComplaints: false,
  };
  assert.deepEqual(aggregateAdminUnreadParents({ ...allSeen, studentLeave: true }), {
    "leave-requests": true, "approval-center": false, "complaint-hub": false,
  });
  assert.equal(aggregateAdminUnreadParents({ ...allSeen, privateComplaints: true, studentGrievances: true })["complaint-hub"], true);
  assert.equal(aggregateAdminUnreadParents(allSeen)["complaint-hub"], false);
});

test("malformed storage fails safely and does not hide unread records", () => {
  const storage = testStorage();
  const scope: AdminUnreadScope = { adminId: 3, schoolId: 8, sessionId: 2026, source: "ebooks" };
  storage.values.set(`benius-admin-unread-v1:3:8:school:ebooks`, "{broken");
  assert.deepEqual([...unreadAdminIds(scope, [31], storage)], ["31"]);
});

test("Support Staff do not see the cross-module Action Required aggregate", () => {
  assert.equal(shouldShowAdminActionNotifications("support_staff"), false);
  assert.equal(shouldShowAdminActionNotifications("admin"), true);
  assert.equal(shouldShowAdminActionNotifications(undefined), true);
});
