---
name: Academic calculation authority
description: Durable rules for authoritative academic results and promotion evaluation.
---

An academic result is authoritative only after resolving exactly one school-owned grading policy and Exam Policy for the student's enrollment-derived class in the selected session. Required subjects and weighted components must be complete; duplicates, invalid marks, ambiguous policies, and missing required attendance data block the verdict.

**Why:** Independent portal calculations previously disagreed on policy fallbacks, partial-weight normalization, grade bands, attendance, rounding, and promotion rules. Returning `false` for incomplete data also incorrectly presented a configuration/data failure as an academic failure.

**How to apply:** Use the backend academic calculation service for result and promotion decisions. Keep system verdicts separate from teacher/admin decisions. Represent incomplete evaluations with `promoted: null`, never a fallback pass/fail.

Rule 2 term dates must come from tenant- and session-scoped academic term boundaries, never from policy JSON, global calendars, or current-date heuristics. Each configured term requires one valid, non-overlapping range inside its academic session.

**Why:** Schools and sessions can use different calendars; reusing global or inferred dates can count another tenant's or another term's attendance.

**How to apply:** Resolve boundaries by school + session + term and treat missing or invalid required boundaries as incomplete data with no authoritative promotion verdict.

Academic write operations may accept an expected calculation-engine version and must reject stale versions before persisting. Promotion history, student movement, and ledger execution form one transaction; every selected row must still match its locked source scope.

**Why:** A client opened before a calculation-engine change can otherwise execute against assumptions it no longer represents, and partial promotion writes can corrupt immutable history.

**How to apply:** Return a conflict for stale versions or changed enrollment/ledger scope. Log failures using a fixed academic event schema without names, identifiers such as DSIDs, marks, policy payloads, response bodies, or stack traces.

Teacher faculty mappings are authoritative when any mappings exist; legacy assigned class/section/subject fields are fallback only for teachers with no mappings. Score publication must authorize every subject in the selected school/session/class/section/exam batch.

**Why:** Treating legacy fields as additive makes revoked mappings remain effective, while class-level publication checks let a subject teacher publish another teacher's marks.

**How to apply:** Scope every Teacher Examination request and cache key to the selected session. Validate score reads, writes, publication, and promotion-ledger access against current mappings and selected-session enrollment.

A teacher ledger decision may differ from the system verdict, but it never replaces it. Student advancement requires an authoritative promoted verdict or an explicit Admin PASS/GRACE_PASS override; FAIL/REPEAT always blocks advancement.

**Why:** Teacher judgment, Admin intervention, and the system policy verdict are separate audit concepts. Trusting any one client-supplied label as execution authority bypasses the calculation engine.

**How to apply:** Recalculate ledger suggestions server-side, mark divergence as manual intervention, and recheck the system verdict plus Admin override inside the same transaction that writes history, moves enrollment, cleans overrides, and records the audit event.