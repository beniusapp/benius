export interface LedgerPdfSelectionState {
  generation: number;
  selectedIds: Set<number>;
  selectAllMatching: boolean;
  excludedIds: Set<number>;
  selectionModeActive: boolean;
}

export type LedgerPdfSelectionUpdate<T> = T | ((previous: T) => T);

export type LedgerPdfSelectionAction =
  | { type: "reset"; generation: number }
  | {
      type: "selectedIds";
      generation: number;
      update: LedgerPdfSelectionUpdate<Set<number>>;
    }
  | {
      type: "selectAllMatching";
      generation: number;
      update: LedgerPdfSelectionUpdate<boolean>;
    }
  | {
      type: "excludedIds";
      generation: number;
      update: LedgerPdfSelectionUpdate<Set<number>>;
    }
  | {
      type: "selectionModeActive";
      generation: number;
      update: LedgerPdfSelectionUpdate<boolean>;
    };

function applyUpdate<T>(
  previous: T,
  update: LedgerPdfSelectionUpdate<T>,
): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(previous)
    : update;
}

export function createLedgerPdfSelectionState(
  generation = 0,
): LedgerPdfSelectionState {
  return {
    generation,
    selectedIds: new Set(),
    selectAllMatching: false,
    excludedIds: new Set(),
    selectionModeActive: false,
  };
}

export function reduceLedgerPdfSelectionState(
  state: LedgerPdfSelectionState,
  action: LedgerPdfSelectionAction,
): LedgerPdfSelectionState {
  if (action.type === "reset") {
    return action.generation < state.generation
      ? state
      : createLedgerPdfSelectionState(action.generation);
  }

  if (action.generation < state.generation) return state;
  if (action.generation > state.generation) {
    return reduceLedgerPdfSelectionState(
      createLedgerPdfSelectionState(action.generation),
      action,
    );
  }

  switch (action.type) {
    case "selectedIds":
      return { ...state, selectedIds: applyUpdate(state.selectedIds, action.update) };
    case "selectAllMatching":
      return { ...state, selectAllMatching: applyUpdate(state.selectAllMatching, action.update) };
    case "excludedIds":
      return { ...state, excludedIds: applyUpdate(state.excludedIds, action.update) };
    case "selectionModeActive":
      return { ...state, selectionModeActive: applyUpdate(state.selectionModeActive, action.update) };
  }
  return state;
}

export type LedgerPdfExportMode =
  | "all-matching"
  | "explicit"
  | "empty-explicit-selection";

export function ledgerPdfExportMode(selection: {
  selectionModeActive: boolean;
  selectAllMatching: boolean;
  selectedCount: number;
}): LedgerPdfExportMode {
  if (selection.selectAllMatching) return "all-matching";
  if (selection.selectedCount > 0) return "explicit";
  if (selection.selectionModeActive) return "empty-explicit-selection";
  return "all-matching";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ledgerPdfErrorMessage(status: number, payload: unknown): string {
  if (isRecord(payload)) {
    if (payload.error === "ARCHIVE_READ_ONLY") {
      return "This Academic Session is archived and read-only. Ledger PDF export is unavailable.";
    }
    if (
      status === 400
      && typeof payload.message === "string"
      && payload.message.trim().length > 0
    ) {
      return payload.message.trim().slice(0, 300);
    }
  }

  if (status === 401 || status === 403) {
    return "You do not have permission to download this Ledger PDF.";
  }
  return "Could not generate the Ledger PDF. Please try again.";
}
