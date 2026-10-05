---
name: Teacher profile photo review
description: Keep photo-only review separate from full Student profile verification and history.
---

Treat a photo-only submission as a separate review from a full Student-profile approval. Approving or rejecting it should update only its photo-review state, leaving the overall profile status, verified fields, original verification timestamp, verifier, and approval snapshot unchanged.

**Why:** A photo-only decision is not a new or rejected full-profile verification. Rewriting the profile verifier or timestamp can make approval history falsely attribute a complete profile review to a photo-only action.

**How to apply:** Enforce this in single and bulk Teacher review paths on Web and Mobile. Do not include photo-only decisions in full-profile approval history unless a separate photo audit is introduced.
