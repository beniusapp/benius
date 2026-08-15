---
name: Fee Receipt Signature
description: Per-tenant authorized signature for student fee receipts — upload, background removal, receipt integration.
---

## Pattern
- Stored in `schoolMetadata` table, key `"fee_receipt_signature"` (JSON value).
- Schema: `{ originalSignatureUrl, processedSignatureUrl, fileName, mimeType, fileSize, uploadedAt, updatedAt, updatedBy }`
- Legacy records may only have `fileUrl` — all resolvers fall back: `processedSignatureUrl ?? originalSignatureUrl ?? fileUrl ?? null`.

## Upload pipeline (fees-routes.ts)
1. Auth middleware (`sigAuthMiddleware`) runs BEFORE multer — uses middleware-array `[auth, multer, handler]` pattern (not Promise-wrap; Promise-wrap caused silent 200 empty-body bug in fees-routes.ts context).
2. Multer stages to `uploads/` temp dir. Handler moves original to `uploads/schools/{schoolId}/receipt-signature/sig-orig-{ts}.ext`.
3. `removeSignatureBackground(origPath, procPath)` → sharp RGBA pixel scan; pixels where `minChannel(R,G,B) >= 215` → fully transparent; 160–215 zone → proportional alpha. Saves as `sig-proc-{ts}.png`.
4. Both URLs persisted via `storage.setSchoolMetadataRaw`.
5. Response: `{ success: true, originalSignatureUrl, processedSignatureUrl, feeReceiptSignatureUrl }`.

**Why middleware-array, not Promise-wrap:**
Promise-wrapped multer inside `registerFeesRoutes` returned 200 with empty body silently — root cause unresolved, but middleware-array `[sigAuthMiddleware, sigMulterMiddleware, async handler]` works reliably.

## Receipt integration (routes.ts)
- `getSchoolMetadataRaw(student.schoolId, "fee_receipt_signature")` fetched fresh every render.
- Best URL: `processedSignatureUrl ?? originalSignatureUrl ?? fileUrl`.
- Converted to absolute URL: `${req.protocol}://${req.get("host")}${relUrl}`.
- Renders `<img>` above `.sign-line` if URL present; blank spacer if not.

## Frontend (fees-manager.tsx)
- `parseJsonResponse(res)` helper — `res.text()` then try-parse; never throws; handles empty/HTML body.
- After save: `setSynced(false)` forces re-fetch so the processed (transparent) preview loads.
- `ExternalSettings.feeReceiptSignatureUrl` is the canonical display URL.

## Dependencies
- `sharp` v0.35.3 — installed in project.
- `multer`, `path` (node:), `fs` (node:) — imported at top of fees-routes.ts.
