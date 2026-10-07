import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  StudentModuleActivityCursor,
  StudentModuleDotStateResponse,
  StudentModuleKey,
} from "@workspace/api-client-react";
import { useSessionView } from "@/contexts/session-view-context";
import {
  apiRequestForViewSession,
  queryClient,
  sessionFetchForViewSession,
} from "@/lib/queryClient";

const MODULE_DOT_STATE_PATH = "/api/student/module-dot-state";
const inFlightSeenRequests = new Map<string, Promise<void>>();

function moduleDotStateQueryKey(sessionId: number | null, studentId: number | null) {
  return [MODULE_DOT_STATE_PATH, sessionId, studentId] as const;
}

type Options = {
  enabled: boolean;
  studentId: number | null | undefined;
  poll?: boolean;
};

export function useStudentModuleDotState({ enabled, studentId, poll = false }: Options) {
  const { selectedSession } = useSessionView();
  const sessionId = selectedSession?.id ?? null;
  const cacheStudentId = Number.isSafeInteger(studentId) && (studentId ?? 0) > 0 ? studentId! : null;
  const queryKey = moduleDotStateQueryKey(sessionId, cacheStudentId);

  const query = useQuery<StudentModuleDotStateResponse>({
    queryKey,
    queryFn: async ({ queryKey: requestKey, signal }) => {
      const requestSessionId = requestKey[1] as number | null;
      if (requestSessionId === null) throw new Error("Academic session is required");
      const response = await sessionFetchForViewSession(
        MODULE_DOT_STATE_PATH,
        requestSessionId,
        { signal },
      );
      if (!response.ok) throw new Error(`Unable to load module activity (${response.status}).`);
      return response.json() as Promise<StudentModuleDotStateResponse>;
    },
    enabled: enabled && sessionId !== null && cacheStudentId !== null,
    refetchInterval: poll ? 60_000 : false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const markSeen = useCallback((
    module: StudentModuleKey,
    cursor: StudentModuleActivityCursor,
  ): Promise<void> => {
    if (sessionId === null || cacheStudentId === null) return Promise.resolve();
    const requestKey = `${cacheStudentId}:${sessionId}:${module}:${cursor.createdAt}:${cursor.recordId}`;
    const existing = inFlightSeenRequests.get(requestKey);
    if (existing) return existing;

    const key = moduleDotStateQueryKey(sessionId, cacheStudentId);
    const previous = queryClient.getQueryData<StudentModuleDotStateResponse>(key);
    const optimistic = previous
      ? {
          ...previous,
          [module]: {
            ...previous[module],
            hasNewActivity: false,
          },
        } as StudentModuleDotStateResponse
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
  }, [cacheStudentId, sessionId]);

  return { query, sessionId, markSeen };
}

export function useMarkStudentModuleSeenOnOpen(
  module: StudentModuleKey,
  studentId: number | null | undefined,
  enabled: boolean,
  moduleContentReady: boolean,
): void {
  const { query, sessionId, markSeen } = useStudentModuleDotState({ enabled, studentId });
  const handlingKey = studentId != null && sessionId !== null
    ? `${studentId}:${sessionId}`
    : null;
  const handledKey = useRef<string | null>(null);

  useEffect(() => {
    handledKey.current = null;
  }, [handlingKey]);

  useEffect(() => {
    if (
      sessionId === null
      || !enabled
      || !moduleContentReady
      || !query.isSuccess
      || !query.isFetchedAfterMount
      || query.isFetching
      || handlingKey === null
      || handledKey.current === handlingKey
    ) {
      return;
    }

    handledKey.current = handlingKey;
    const state = query.data[module];
    if (state.hasNewActivity && state.latestActivityCursor) {
      void markSeen(module, state.latestActivityCursor).catch(() => undefined);
    }
  }, [
    enabled,
    handlingKey,
    markSeen,
    module,
    moduleContentReady,
    query.data,
    query.isFetchedAfterMount,
    query.isFetching,
    query.isSuccess,
    sessionId,
  ]);
}
