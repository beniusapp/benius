---
name: Teacher Examination isolation
description: Durable tenant and academic-session boundary for every Teacher Examination score operation and calculation.
---

Teacher Examination score reads, writes, publishing, and result calculations must always use both the authenticated teacher's school and one validated academic session owned by that school. Client-supplied school identifiers are never authorization, and NULL-session historical scores never match a selected session.

**Why:** The user explicitly defined this as a non-negotiable multi-tenant requirement for this fix and all future fixes. School-only or session-only filtering can expose or combine another tenant's or academic year's examination data.

**How to apply:** Resolve the teacher from authenticated context, validate the requested session inside that teacher's school, then pass the same school/session pair through storage queries, cache identities, request transport, and calculation context. Keep the live active Student Registry roster rule separate; do not introduce enrollment or Faculty Mapping as roster prerequisites.