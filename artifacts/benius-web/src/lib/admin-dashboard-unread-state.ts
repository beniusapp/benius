import { useEffect, useState } from "react";

export type AdminUnreadSource =
  | "teacher-leave" | "student-leave" | "gallery" | "ebooks"
  | "private-complaints" | "student-grievances" | "escalated-complaints";

export interface AdminUnreadScope {
  adminId: number;
  schoolId: number;
  sessionId: number | null;
  source: AdminUnreadSource;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const EVENT_NAME = "benius-admin-unread-change";
const PREFIX = "benius-admin-unread-v1:";
const MAX_IDS_PER_SOURCE = 20000;

export function adminUnreadStorageKey(scope: AdminUnreadScope): string {
  const session = scope.source === "gallery" || scope.source === "ebooks" ? "school" : scope.sessionId ?? "active";
  return `${PREFIX}${scope.adminId}:${scope.schoolId}:${session}:${scope.source}`;
}

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readSeenAdminIds(scope: AdminUnreadScope, storage = browserStorage()): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(adminUnreadStorageKey(scope));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string =>
      typeof value === "string" && value.length > 0 && value.length <= 64,
    ));
  } catch { return new Set(); }
}

export function unreadAdminIds(
  scope: AdminUnreadScope,
  currentIds: readonly (string | number)[],
  storage = browserStorage(),
): Set<string> {
  const seen = readSeenAdminIds(scope, storage);
  return new Set(currentIds.map(String).filter(id => id && !seen.has(id)));
}

export function markAdminIdsSeen(
  scope: AdminUnreadScope,
  displayedIds: readonly (string | number)[],
  currentIds: readonly (string | number)[],
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  const live = new Set(currentIds.map(String));
  const seen = readSeenAdminIds(scope, storage);
  const next = new Set([...seen].filter(id => live.has(id)));
  for (const id of displayedIds.map(String)) if (live.has(id)) next.add(id);
  if (next.size > MAX_IDS_PER_SOURCE) return false;
  if (next.size === seen.size && [...next].every(id => seen.has(id))) return true;
  try {
    storage.setItem(adminUnreadStorageKey(scope), JSON.stringify([...next]));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT_NAME));
    return true;
  } catch { return false; }
}

export function pruneSeenAdminIds(
  scope: AdminUnreadScope,
  currentIds: readonly (string | number)[],
  storage = browserStorage(),
): void {
  if (!storage) return;
  const live = new Set(currentIds.map(String));
  const seen = readSeenAdminIds(scope, storage);
  const next = [...seen].filter(id => live.has(id));
  if (next.length === seen.size) return;
  try { storage.setItem(adminUnreadStorageKey(scope), JSON.stringify(next)); }
  catch { /* Storage unavailable: keep notifications unread. */ }
}

export function useUnreadAdminIds(scope: AdminUnreadScope, currentIds: readonly (string | number)[]): Set<string> {
  const [revision, setRevision] = useState(0);
  const idsKey = currentIds.map(String).sort().join(",");
  const storageKey = adminUnreadStorageKey(scope);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(EVENT_NAME, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT_NAME, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [storageKey]);
  void revision;
  return unreadAdminIds(scope, idsKey ? idsKey.split(",") : []);
}
