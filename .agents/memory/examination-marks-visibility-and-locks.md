---
name: BENIUS exam marks visibility and locked-ledger protection
description: Web Student-visible marks saves and the exact locked-ledger write boundary.
---

**Rule:** Any active, authenticated same-school Teacher may save or correct Web marks for a school-configured class, section, subject, and exam type in the active Academic Session; Faculty Mapping and legacy assigned-class/subject matches do not gate Web Add Marks. Successful saves expose only changed rows. Reject edits affecting an exact locked cohort decision term or its configured dependencies. Mobile retains its separate assignment rules and behavior.

**Why:** The user approved broader same-school access only for Web Add Marks, while preserving current-session/enrollment checks, immediate visibility, exact locked-ledger protection, and Mobile behavior.

**How to apply:** Do not add assignment checks to the Web Add Marks route. Keep school/session/configuration/enrollment validation, mark attribution, and the shared lock check; publish only rows successfully saved by Web. Do not change Mobile-specific validation or publication behavior.
