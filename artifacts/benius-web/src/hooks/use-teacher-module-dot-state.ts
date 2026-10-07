import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  TeacherModuleActivityCursor,
  TeacherModuleDotStateResponse,
  TeacherModuleKey,
} from "@workspace/api-client-react";
import {
  apiRequestForViewSession,
  queryClient,
  sessionFetchForViewSession,
} from "@/lib/queryClient";

const MODULE_DOT_STATE_PATH = "/api/teacher/module-dot-state";
const inFlightSeenRequests = new Map<string, Promise<void>>();

function moduleDotStateQueryKey(
  sessionId: number | null,
  teacherId: number | null,
  schoolId: number | null,
) {
  return [MODULE_DOT_STATE_PATH, schoolId, teacherId, sessionId] as const;
}

function normalizeCursorTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return value;
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}`;
}

function compareCursors(
  left: TeacherModuleActivityCursor,
  right: TeacherModuleActivityCursor,
): number {
  const leftTime = normalizeCursorTime(left.createdAt);
  const rightTime = normalizeCursorTime(right.createdAt);
  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  if (left.source < right.source) return -1;
  if (left.source > right.source) return 1;
  return Math.sign(left.recordId - right.recordId);
}

type Options = {
  enabled: boolean;
  teacherId: number | null | undefined;
  schoolId: number | null | undefined;
  sessionId: number | null;
  poll?: boolean;
};

export function useTeacherModuleDotState({
  enabled,
  teacherId,
  schoolId,
  sessionId,
  poll = false,
}: Options) {
  const cacheTeacherId = Number.isSafeInteger(teacherId) && (teacherId ?? 0) > 0 ? teacherId! : null;
  const cacheSchoolId = Number.isSafeInteger(schoolId) && (schoolId ?? 0) > 0 ? schoolId! : null;
  const queryKey = moduleDotStateQueryKey(sessionId, cacheTeacherId, cacheSchoolId);

  const query = useQuery<TeacherModuleDotStateResponse>({
    queryKey,
    queryFn: async ({ queryKey: requestKey, signal }) => {
      const requestSessionId = requestKey[3] as number | null;
      if (requestSessionId === null) throw new Error("Academic session is required");
      const response = await sessionFetchForViewSession(
        MODULE_DOT_STATE_PATH,
        requestSessionId,
        { signal },
      );
      if (!response.ok) throw new Error(`Unable to load module activity (${response.status}).`);
      return response.json() as Promise<TeacherModuleDotStateResponse>;
    },
    enabled: enabled && sessionId !== null && cacheTeacherId !== null && cacheSchoolId !== null,
    refetchInterval: poll ? 60_000 : false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const markSeen = useCallback((
    module: TeacherModuleKey,
    cursor: TeacherModuleActivityCursor,
  ): Promise<void> => {
    if (sessionId === null || cacheTeacherId === null || cacheSchoolId === null) {
      return Promise.resolve();
    }
    const requestKey = [
      cacheSchoolId,
      cacheTeacherId,
      sessionId,
      module,
      cursor.createdAt,
      cursor.source,
      cursor.recordId,
    ].join(":");
    const existing = inFlightSeenRequests.get(requestKey);
    if (existing) return existing;

    const key = moduleDotStateQueryKey(sessionId, cacheTeacherId, cacheSchoolId);
    const previous = queryClient.getQueryData<TeacherModuleDotStateResponse>(key);
    const previousModuleState = previous?.[module];
    const mayClearOptimistically = previousModuleState?.latestActivityCursor == null
      || compareCursors(previousModuleState.latestActivityCursor, cursor) <= 0;
    const optimistic = previous && mayClearOptimistically
      ? {
          ...previous,
          [module]: {
            ...previous[module],
            hasNewActivity: false,
          },
        } as TeacherModuleDotStateResponse
      : undefined;
    if (optimistic) queryClient.setQueryData(key, optimistic);

    const request = apiRequestForViewSession(
      "POST",
      `${MODULE_DOT_STATE_PATH}/seen`,
      { module, cursor },
      sessionId,
    )
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: key, exact: true });
      })
      .catch(async (error: unknown) => {
        if (optimistic && queryClient.getQueryData(key) === optimistic && previous) {
          queryClient.setQueryData(key, previous);
        }
        await queryClient.invalidateQueries({ queryKey: key, exact: true });
        throw error;
      })
      .finally(() => {
        inFlightSeenRequests.delete(requestKey);
      });
    inFlightSeenRequests.set(requestKey, request);
    return request;
  }, [cacheSchoolId, cacheTeacherId, sessionId]);

  return { query, markSeen };
}
