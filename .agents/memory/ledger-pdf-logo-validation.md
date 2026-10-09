---
name: Ledger PDF image validation
description: Keep strict content validation for stored images supplied to the Ledger PDF renderer.
---

For Ledger PDF logos, retain strict PNG chunk/CRC/deflate checks and JPEG marker/EOI checks in addition to Sharp format and dimension validation. Sharp accepted a truncated PNG in a local probe even with `failOn: "error"`; PDFKit may embed PNG compressed data without fully decoding it.

**Why:** A valid extension or image header is not enough to establish that a stored logo is a complete image, and tolerant decoders can accept truncated data.

**How to apply:** If the Ledger logo resolver changes, keep regression cases for truncated/corrupt PNG and JPEG data and ensure invalid logos are omitted without breaking PDF generation.
