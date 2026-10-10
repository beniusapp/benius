import type { HistoricalFeePlacement } from "./historical-fee-placement";

export function attachStatementSessionPlacement<T extends {
  feeRecordId: number | null;
  feeSessionId: number | string | null;
}>(
  rows: T[],
  sessionId: number,
  sessionLabel: string,
  placement: HistoricalFeePlacement,
) {
  return rows.map(row => {
    const linkedToSelectedSession = row.feeRecordId != null
      && Number(row.feeSessionId) === sessionId;
    return {
      ...row,
      academicSessionLabel: sessionLabel,
      className: linkedToSelectedSession
        ? (placement.available ? placement.className : "Historical placement unavailable")
        : null,
      sectionName: linkedToSelectedSession
        ? (placement.available ? placement.sectionName : "—")
        : null,
      rollNumber: linkedToSelectedSession && placement.available ? placement.rollNumber : null,
      historicalPlacementAvailable: linkedToSelectedSession && placement.available,
    };
  });
}
