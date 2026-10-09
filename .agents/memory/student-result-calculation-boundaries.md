---
name: Student result calculation boundaries
description: Why published historical Student results retain current school policy and the existing journey formula.
---

Keep changes to Student historical results separate from examination calculation changes. Historical policy versioning remains a separate decision; do not infer a policy snapshot from the session. The Student journey's raw-percentage formula is intentionally unchanged despite differing from the weighted promotion engine.

For current Web examination result views, use one shared API calculation engine rather than recalculating results in each portal. Student results must use the exact selected-session enrollment, published marks only, and omit internal promotion data. Incomplete results suppress final average, grade, and failure metrics. In Principal views, a locked Teacher recommendation is not a final outcome; only an executed Principal decision is final.

**Why:** The Student Examination/Archives correction was explicitly limited to session, enrollment cohort, and published-result visibility. Changing historical policy or reconciling formulas would affect business rules without an agreed rule for prior years. A shared current-results engine prevents portal-specific formula drift, while publication and execution boundaries protect result privacy and avoid presenting recommendations as final decisions.

**How to apply:** When working on policy snapshots or journey/weighted-result consistency, scope and confirm that business decision separately rather than folding it into a session or access-control correction. Keep Web result math in the shared API service, preserve exact session/cohort selection, and label a promotion result final only when the Principal execution record confirms it.