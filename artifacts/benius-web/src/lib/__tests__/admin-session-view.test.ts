import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSessionDropdownPlacement,
  isLegacyAdminSessionQueryKey,
  readSavedAdminViewSessionId,
  resolveAdminViewSession,
  saveAdminViewSessionId,
  updateAdminSessionList,
} from "@/lib/admin-session-view";
import { apiRequest, sessionFetchForViewSession, setViewSessionId } from "@/lib/queryClient";

const archived = { id: 101, isActive: false, sessionName: "2027–2028" };
const active = { id: 202, isActive: true, sessionName: "2028–2029" };

describe("Admin Portal academic-session selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    setViewSessionId(null);
  });

  it("uses the authoritative activated session immediately and refreshes its active status", () => {
    const activationResponse = { ...active, isActive: true };
    const refreshedSessions = [
      { ...archived, isActive: false },
      activationResponse,
    ];

    expect(resolveAdminViewSession(refreshedSessions, activationResponse)).toBe(activationResponse);
  });

  it("updates only session-list-shaped cache data, not object-shaped prefixed caches", () => {
    const updated = updateAdminSessionList(
      [
        { ...active, isActive: true, status: "active" },
        { ...archived, isActive: false, status: "archived" },
      ],
      { ...archived, isActive: true, status: "active" },
    );

    expect(updated).toEqual([
      { ...active, isActive: false, status: "archived" },
      { ...archived, isActive: true, status: "active" },
    ]);
    expect(updateAdminSessionList(undefined, active)).toBeUndefined();
    expect(updateAdminSessionList({} as never, active)).toEqual({});
  });

  it("preserves an explicit archive selection through normal module navigation", () => {
    expect(resolveAdminViewSession([active, archived], archived)).toBe(archived);
  });

  it("restores a saved authorized archive and falls back when the saved session is unavailable", () => {
    expect(resolveAdminViewSession([active, archived], null, archived.id)).toBe(archived);
    expect(resolveAdminViewSession([active], null, archived.id)).toBe(active);
    expect(resolveAdminViewSession([active, archived], active, archived.id)).toBe(active);
  });

  it("defaults a dashboard remount or migration return to the current active session", () => {
    expect(resolveAdminViewSession([archived, active], null)).toBe(active);
  });

  it("never retains a deleted or foreign selected session", () => {
    const foreignOrDeleted = { id: 999, isActive: false, sessionName: "Foreign" };
    expect(resolveAdminViewSession([archived, active], foreignOrDeleted)).toBe(active);
  });

  it("stores selections under the authenticated school's key and rejects invalid saved values", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    saveAdminViewSessionId(1, archived.id, storage);
    saveAdminViewSessionId(2, active.id, storage);
    expect(readSavedAdminViewSessionId(1, storage)).toBe(archived.id);
    expect(readSavedAdminViewSessionId(2, storage)).toBe(active.id);
    expect(readSavedAdminViewSessionId(3, storage)).toBeNull();
    values.set("benius-admin-view-session:1", "not-a-session");
    expect(readSavedAdminViewSessionId(1, storage)).toBeNull();
    expect(readSavedAdminViewSessionId(0, storage)).toBeNull();
  });

  it("targets only legacy session-scoped module caches on a selector change", () => {
    expect(isLegacyAdminSessionQueryKey(["/api/attendance/school/1"])).toBe(true);
    expect(isLegacyAdminSessionQueryKey(["/api/complaints/school/1"])).toBe(true);
    expect(isLegacyAdminSessionQueryKey(["/api/me"])).toBe(false);
    expect(isLegacyAdminSessionQueryKey(["/api/gallery/1?all=true"])).toBe(false);
  });

  it("pins a rapidly switched request to its captured session instead of the mutable selection", async () => {
    const requests: Array<{ url: string; header: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      requests.push({
        url,
        header: new Headers(init?.headers).get("x-view-session-id"),
      });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }));

    setViewSessionId(202);
    await sessionFetchForViewSession("/api/attendance/daily-summary?session=101", 101);
    await sessionFetchForViewSession("/api/attendance/daily-summary?session=202", 202);

    expect(requests).toEqual([
      { url: "/api/attendance/daily-summary?session=101", header: "101" },
      { url: "/api/attendance/daily-summary?session=202", header: "202" },
    ]);
  });

  it("omits view-session headers only for exact authentication and Principal PIN requests", async () => {
    const requests: Array<{ url: string; method: string; header: string | null; credentials: RequestCredentials | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        header: new Headers(init?.headers).get("x-view-session-id"),
        credentials: init?.credentials,
      });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }));

    setViewSessionId(101);
    for (const url of [
      "/api/login",
      "/api/teacher-login",
      "/api/student-login",
      "/api/admin/verify-pin",
    ]) {
      await apiRequest("POST", url, {});
    }
    await apiRequest("POST", "/api/admin/fees/payments", {});
    await apiRequest("PUT", "/api/login", {});
    await apiRequest("POST", "/api/login/", {});

    expect(requests.slice(0, 4).map(request => request.header)).toEqual([null, null, null, null]);
    expect(requests.slice(0, 4).map(request => request.credentials)).toEqual([
      "include", "include", "include", "include",
    ]);
    expect(requests.slice(4).map(request => request.header)).toEqual(["101", "101", "101"]);
  });
});

describe("Admin Portal session selector placement", () => {
  const trigger = { top: 700, bottom: 732, right: 380 };

  it("opens upward when the viewport lacks room below the sticky navbar", () => {
    const placement = getSessionDropdownPlacement(trigger, { width: 400, height: 800 });
    expect(placement.direction).toBe("up");
    expect(placement.bottom).toBe(108);
    expect(placement.maxHeight).toBeLessThanOrEqual(684);
  });

  it("keeps the dropdown inside a narrow viewport and opens downward when space permits", () => {
    const placement = getSessionDropdownPlacement(
      { top: 48, bottom: 80, right: 300 },
      { width: 320, height: 640 },
    );

    expect(placement.direction).toBe("down");
    expect(placement.left).toBeGreaterThanOrEqual(8);
    expect(placement.left + placement.width).toBeLessThanOrEqual(312);
    expect(placement.maxHeight).toBeLessThanOrEqual(544);
  });
});