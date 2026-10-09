import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLedgerPdfSelectionState,
  ledgerPdfErrorMessage,
  ledgerPdfExportMode,
  reduceLedgerPdfSelectionState,
} from "./ledger-pdf-selection-state";

describe("Ledger PDF session-scoped selection state", () => {
  it("clears every selection field when the viewed session generation changes", () => {
    const previous = {
      generation: 4,
      selectedIds: new Set([12, 24]),
      selectAllMatching: true,
      excludedIds: new Set([48]),
      selectionModeActive: true,
    };

    assert.deepEqual(
      reduceLedgerPdfSelectionState(previous, { type: "reset", generation: 5 }),
      createLedgerPdfSelectionState(5),
    );
  });

  it("ignores delayed actions from the prior session, including after switching back", () => {
    const initial = {
      ...createLedgerPdfSelectionState(0),
      selectedIds: new Set([12]),
      selectionModeActive: true,
    };
    const switched = reduceLedgerPdfSelectionState(initial, {
      type: "reset",
      generation: 1,
    });
    const switchedBack = reduceLedgerPdfSelectionState(switched, {
      type: "reset",
      generation: 2,
    });
    const delayedOldSelection = reduceLedgerPdfSelectionState(switchedBack, {
      type: "selectedIds",
      generation: 0,
      update: new Set([99]),
    });
    const delayedOldReset = reduceLedgerPdfSelectionState(delayedOldSelection, {
      type: "reset",
      generation: 1,
    });

    assert.strictEqual(delayedOldSelection, switchedBack);
    assert.strictEqual(delayedOldReset, switchedBack);
    assert.deepEqual(delayedOldReset, createLedgerPdfSelectionState(2));
  });

  it("retains same-session selection updater behavior", () => {
    const initial = {
      ...createLedgerPdfSelectionState(3),
      selectedIds: new Set([12]),
    };
    const updated = reduceLedgerPdfSelectionState(initial, {
      type: "selectedIds",
      generation: 3,
      update: (previous) => new Set([...previous, 24]),
    });

    assert.deepEqual([...updated.selectedIds], [12, 24]);
  });

  it("accepts a current-session action before its reset effect and rejects later old actions", () => {
    const old = {
      ...createLedgerPdfSelectionState(2),
      selectedIds: new Set([12]),
      selectionModeActive: true,
    };
    const current = reduceLedgerPdfSelectionState(old, {
      type: "selectedIds",
      generation: 3,
      update: new Set([24]),
    });
    const delayedOld = reduceLedgerPdfSelectionState(current, {
      type: "selectedIds",
      generation: 2,
      update: new Set([99]),
    });

    assert.deepEqual([...current.selectedIds], [24]);
    assert.equal(current.selectionModeActive, false);
    assert.strictEqual(delayedOld, current);
  });
});

describe("Ledger PDF export mode", () => {
  it("does not turn an empty active explicit selection into an all-matching export", () => {
    assert.equal(
      ledgerPdfExportMode({
        selectionModeActive: true,
        selectAllMatching: false,
        selectedCount: 0,
      }),
      "empty-explicit-selection",
    );
  });

  it("keeps explicit selection, select-all and intentional no-selection modes distinct", () => {
    assert.equal(
      ledgerPdfExportMode({
        selectionModeActive: true,
        selectAllMatching: false,
        selectedCount: 2,
      }),
      "explicit",
    );
    assert.equal(
      ledgerPdfExportMode({
        selectionModeActive: true,
        selectAllMatching: true,
        selectedCount: 0,
      }),
      "all-matching",
    );
    assert.equal(
      ledgerPdfExportMode({
        selectionModeActive: false,
        selectAllMatching: false,
        selectedCount: 0,
      }),
      "all-matching",
    );
  });
});

describe("Ledger PDF response errors", () => {
  it("maps the archived read-only error code to a user-readable message", () => {
    assert.match(
      ledgerPdfErrorMessage(403, { error: "ARCHIVE_READ_ONLY" }),
      /archived and read-only/i,
    );
  });

  it("surfaces safe validation messages returned in a 400 message field", () => {
    assert.equal(
      ledgerPdfErrorMessage(400, { message: "Select at least one invoice." }),
      "Select at least one invoice.",
    );
  });

  it("does not expose server error details or arbitrary 5xx messages", () => {
    assert.equal(
      ledgerPdfErrorMessage(500, { message: "Database stack trace with credentials" }),
      "Could not generate the Ledger PDF. Please try again.",
    );
  });
});
