---
name: Print Fixes
description: How print is implemented for student results and asset reports — patterns that work vs ones that cause blank pages.
---

## Student Examination Results — Print

**Working pattern:** Open a new window containing only `#exam-print-area` content.
`handlePrint` in `client/src/pages/student-examination.tsx`:
1. Grab `document.getElementById("exam-print-area")`.
2. Copy all `<link rel="stylesheet">` and `<style>` tags from the current document into the new window so Tailwind compiled styles are preserved.
3. Write a minimal HTML shell with those styles + `el.outerHTML` + an inline script that calls `window.print(); window.close();` after a 400 ms delay.
4. Fall back to `window.print()` if `window.open` is blocked.

**Why:** `visibility: hidden` on `body *` (the old approach) keeps layout space, causing a blank second page. `position: fixed` on the print area repeats it on every page. `overflow: hidden` on html/body is not reliable on Android Chrome. A fresh window with only the result content has no extra height → always exactly 1 page.

**What NOT to do:**
- `position: fixed` in `@media print` → element repeats on every page.
- `visibility: hidden` + `position: absolute` → invisible DOM still adds page height → blank page 2.
- `html, body { overflow: hidden }` in `@media print` → unreliable on mobile Chrome.

The `@media print` CSS block in the `PrintStyles` component was simplified to only `{ .no-print { display: none !important; } }` — all the old visibility/position tricks were removed.

## Assets & Inventory — Generate Report

**Working pattern:** `generateAssetReport(asset, schoolName)` in `client/src/pages/admin-modules/assets-inventory.tsx`.
- Builds a complete self-contained HTML string with inline CSS (no external dependencies).
- Opens via `window.open("", "_blank")` and calls `window.print()` on load.
- School name sourced from cached `/api/me` query (`me?.schoolName ?? "School"`).
- Condition badge colour-coded per condition value.
