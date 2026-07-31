/**
 * Unit tests for PDF export dimension calculations in id-card-gen.
 *
 * These tests exercise the pure helper functions extracted from executeExport
 * and verify that:
 *   - PVC CR80 pages are sized from the canvas aspect ratio (no blank space)
 *   - A4 grid layout math places cards correctly for both orientations
 *   - Portrait and landscape orientations both produce correct dimensions
 *
 * No DOM, no html2canvas, no jsPDF — pure arithmetic only.
 */

import { describe, it, expect } from "vitest";
import {
  computePvcPageDimensions,
  computeA4GridLayout,
} from "../id-card-gen";

// ---------------------------------------------------------------------------
// PVC CR80 — single-card-per-page export
// ---------------------------------------------------------------------------

describe("computePvcPageDimensions — portrait orientation", () => {
  // CR80 portrait reference width = 54 mm
  const REF_W = 54;

  it("page width equals the CR80 reference width (54 mm)", () => {
    const { pw } = computePvcPageDimensions(500, 800, "portrait");
    expect(pw).toBe(REF_W);
  });

  it("page height is derived from canvas aspect ratio (no blank space)", () => {
    // canvas 500 × 800  →  ar = 1.6  →  ph = 54 × 1.6 = 86.4
    const { ph } = computePvcPageDimensions(500, 800, "portrait");
    expect(ph).toBeCloseTo(REF_W * (800 / 500), 3);
  });

  it("pageOri is 'portrait' when ph > pw", () => {
    // Tall card: ph will exceed pw
    const { pageOri } = computePvcPageDimensions(500, 800, "portrait");
    expect(pageOri).toBe("portrait");
  });

  it("pageOri is 'landscape' when ph <= pw (very wide card)", () => {
    // Very wide canvas: 800 × 400  →  ar = 0.5  →  ph = 27 < 54
    const { pageOri } = computePvcPageDimensions(800, 400, "portrait");
    expect(pageOri).toBe("landscape");
  });

  it("page dimensions are rounded to 4 decimal places", () => {
    // 500 × 791  →  ar = 1.582  →  ph = 54 × 1.582 = 85.428
    const { ph } = computePvcPageDimensions(500, 791, "portrait");
    const expected = parseFloat((54 * (791 / 500)).toFixed(4));
    expect(ph).toBe(expected);
  });

  it("square canvas produces equal pw and ph (ph === pw)", () => {
    // 500 × 500  →  ar = 1  →  ph = 54
    const { pw, ph } = computePvcPageDimensions(500, 500, "portrait");
    expect(ph).toBe(pw);
  });
});

describe("computePvcPageDimensions — landscape orientation", () => {
  // CR80 landscape reference width = 85.6 mm
  const REF_W = 85.6;

  it("page width equals the CR80 landscape reference width (85.6 mm)", () => {
    const { pw } = computePvcPageDimensions(800, 500, "landscape");
    expect(pw).toBe(REF_W);
  });

  it("page height is derived from canvas aspect ratio", () => {
    // canvas 800 × 500  →  ar = 0.625  →  ph = 85.6 × 0.625 = 53.5
    const { ph } = computePvcPageDimensions(800, 500, "landscape");
    expect(ph).toBeCloseTo(REF_W * (500 / 800), 3);
  });

  it("standard landscape card (wide canvas) yields pageOri 'landscape'", () => {
    const { pageOri } = computePvcPageDimensions(800, 500, "landscape");
    expect(pageOri).toBe("landscape");
  });

  it("landscape card that renders taller than wide yields pageOri 'portrait'", () => {
    // Very tall canvas while orientation=landscape: ph > pw
    const { pageOri } = computePvcPageDimensions(200, 1000, "landscape");
    expect(pageOri).toBe("portrait");
  });

  it("pdf dimensions fill the canvas exactly — no blank space", () => {
    const cw = 900;
    const ch = 562;
    const { pw, ph } = computePvcPageDimensions(cw, ch, "landscape");
    // ph/pw ratio must match ch/cw ratio to 4dp
    const pdfAr = parseFloat((ph / pw).toFixed(4));
    const canvasAr = parseFloat((ch / cw).toFixed(4));
    expect(pdfAr).toBe(canvasAr);
  });
});

// ---------------------------------------------------------------------------
// A4 grid layout
// ---------------------------------------------------------------------------

describe("computeA4GridLayout — portrait A4 (2 columns)", () => {
  const MARGIN = 10;
  const GAP = 6;
  const PG_W = 210;
  const PG_H = 297;
  const COLS = 2;
  const CELL_W = (PG_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;

  it("page dimensions are A4 portrait (210 × 297 mm)", () => {
    const { pgW, pgH } = computeA4GridLayout([1.6], "portrait");
    expect(pgW).toBe(PG_W);
    expect(pgH).toBe(PG_H);
  });

  it("uses 2 columns in portrait mode", () => {
    const { cols } = computeA4GridLayout([1.6], "portrait");
    expect(cols).toBe(COLS);
  });

  it("cellW is computed correctly from margins and gaps", () => {
    const { cellW } = computeA4GridLayout([1.6], "portrait");
    expect(cellW).toBeCloseTo(CELL_W, 5);
  });

  it("cellH0 equals cellW × first canvas aspect ratio", () => {
    const ar0 = 1.6;
    const { cellW, cellH0 } = computeA4GridLayout([ar0], "portrait");
    expect(cellH0).toBeCloseTo(cellW * ar0, 5);
  });

  it("rows × cols equals perPage", () => {
    const { cols, rows, perPage } = computeA4GridLayout([1.6], "portrait");
    expect(perPage).toBe(cols * rows);
  });

  it("rows is at least 1 even for a very tall card", () => {
    // Extremely tall card (ar = 10) — must still produce rows ≥ 1
    const { rows } = computeA4GridLayout([10], "portrait");
    expect(rows).toBeGreaterThanOrEqual(1);
  });

  it("first card is placed at (margin, margin)", () => {
    const { placements } = computeA4GridLayout([1.6, 1.6], "portrait");
    expect(placements[0].x).toBeCloseTo(MARGIN, 5);
    expect(placements[0].y).toBeCloseTo(MARGIN, 5);
  });

  it("second card in same row is offset by cellW + gap on x-axis", () => {
    const { placements, cellW } = computeA4GridLayout([1.6, 1.6], "portrait");
    expect(placements[1].x).toBeCloseTo(MARGIN + cellW + GAP, 5);
    expect(placements[1].y).toBeCloseTo(MARGIN, 5);
  });

  it("first card in second row is offset by cellH0 + gap on y-axis", () => {
    // Use ar=1.0 so that two rows fit on a portrait A4 page.
    // cellW ≈ 92 mm, cellH0 ≈ 92 mm → rows = floor(283 / 98) = 2
    const ar = 1.0;
    const { placements, cellH0 } = computeA4GridLayout([ar, ar, ar], "portrait");
    // 2-col layout: cards 0,1 fill row 0; card 2 is col 0 of row 1
    expect(placements[2].y).toBeCloseTo(MARGIN + cellH0 + GAP, 5);
  });

  it("each card uses its own aspect ratio for cellH", () => {
    // Two cards with different aspect ratios
    const ar1 = 1.4;
    const ar2 = 2.0;
    const { placements, cellW } = computeA4GridLayout([ar1, ar2], "portrait");
    expect(placements[0].cellH).toBeCloseTo(cellW * ar1, 5);
    expect(placements[1].cellH).toBeCloseTo(cellW * ar2, 5);
  });

  it("pageIndex increments when card count exceeds perPage", () => {
    const ar = 1.0; // small aspect ratio so multiple rows fit per page
    const layout = computeA4GridLayout(Array(20).fill(ar), "portrait");
    const { perPage, placements } = layout;
    // Every card's pageIndex must equal floor(cardIndex / perPage)
    for (let i = 0; i < 20; i++) {
      expect(placements[i].pageIndex).toBe(Math.floor(i / perPage));
    }
    // Spot-check: first card of page 1 has pageIndex 1
    expect(placements[perPage].pageIndex).toBe(1);
  });
});

describe("computeA4GridLayout — landscape A4 (3 columns)", () => {
  const MARGIN = 10;
  const GAP = 6;
  const PG_W = 297;
  const PG_H = 210;
  const COLS = 3;
  const CELL_W = (PG_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;

  it("page dimensions are A4 landscape (297 × 210 mm)", () => {
    const { pgW, pgH } = computeA4GridLayout([0.6], "landscape");
    expect(pgW).toBe(PG_W);
    expect(pgH).toBe(PG_H);
  });

  it("uses 3 columns in landscape mode", () => {
    const { cols } = computeA4GridLayout([0.6], "landscape");
    expect(cols).toBe(COLS);
  });

  it("cellW is computed correctly from landscape margins and gaps", () => {
    const { cellW } = computeA4GridLayout([0.6], "landscape");
    expect(cellW).toBeCloseTo(CELL_W, 5);
  });

  it("third card in same row has correct x offset", () => {
    const { placements, cellW } = computeA4GridLayout([0.6, 0.6, 0.6], "landscape");
    expect(placements[2].x).toBeCloseTo(MARGIN + 2 * (cellW + GAP), 5);
    expect(placements[2].y).toBeCloseTo(MARGIN, 5);
  });

  it("default fallback aspect ratio (1.585) is used when no canvases provided", () => {
    // Empty array → ar0 defaults to 1.585
    const { cellW, cellH0 } = computeA4GridLayout([], "landscape");
    expect(cellH0).toBeCloseTo(cellW * 1.585, 3);
  });
});

// ---------------------------------------------------------------------------
// Regression guard — the KEY FIX: aspect ratio is preserved
// ---------------------------------------------------------------------------

describe("PDF aspect ratio preservation (regression guard)", () => {
  it("PVC portrait: pdf aspect ratio matches canvas aspect ratio exactly", () => {
    const cases: [number, number][] = [
      [500,  793],   // typical portrait card
      [793,  500],   // wide card
      [600,  600],   // square
      [1024, 1628],  // hi-res portrait
    ];
    for (const [cw, ch] of cases) {
      const { pw, ph } = computePvcPageDimensions(cw, ch, "portrait");
      const pdfRatio    = parseFloat((ph / pw).toFixed(4));
      const canvasRatio = parseFloat((ch / cw).toFixed(4));
      expect(pdfRatio).toBe(canvasRatio);
    }
  });

  it("PVC landscape: pdf aspect ratio matches canvas aspect ratio exactly", () => {
    const cases: [number, number][] = [
      [1000, 628],
      [628,  1000],
      [900,  562],
    ];
    for (const [cw, ch] of cases) {
      const { pw, ph } = computePvcPageDimensions(cw, ch, "landscape");
      const pdfRatio    = parseFloat((ph / pw).toFixed(4));
      const canvasRatio = parseFloat((ch / cw).toFixed(4));
      expect(pdfRatio).toBe(canvasRatio);
    }
  });

  it("A4 grid: each card's cellH preserves its individual canvas aspect ratio", () => {
    const ratios = [1.4, 1.6, 1.8, 0.9, 2.1];
    const { placements, cellW } = computeA4GridLayout(ratios, "portrait");
    ratios.forEach((ar, i) => {
      expect(placements[i].cellH).toBeCloseTo(cellW * ar, 5);
    });
  });
});
