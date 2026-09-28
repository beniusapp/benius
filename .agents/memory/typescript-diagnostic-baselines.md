---
name: TypeScript diagnostic baselines
description: Distinguishes an empty workspace LSP snapshot from package compiler diagnostics.
---

**Rule:** When a project defines known TypeScript diagnostic counts, use the package typecheck commands for baseline comparisons; do not interpret an empty LSP diagnostic snapshot as zero compiler diagnostics.

**Why:** The workspace LSP snapshot returned no entries while API and Web package typechecks still reported their known diagnostics.

**How to apply:** Run the API, Web, and Mobile package typechecks and compare their diagnostic totals with the documented baseline before reporting that a change added or removed errors.