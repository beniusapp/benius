---
name: Support Staff scoped permissions
description: Permission boundaries for the Approval Center, Leave Requests, and Support Staff management.
---

Approval Center and Leave Requests are child-scoped exceptions to the parent-only Support Staff modules. A child grant authorizes only that child; when any child grants are present, a root grant does not authorize siblings. A legacy root-only grant remains full access because the permission editor's root toggle grants all children. Leave Approval History is read-only and exposes both Teacher and Student history without granting either management path. Staff leave reads follow the selected academic session; writes require that session to be active and the request to belong to it.

Support Staff management is not a grantable Support Staff module. Ignore legacy `non-teaching-staff` root and child grants, keep management writes Admin-only, and preserve the sanitized read path shared with ID Card Gen. For audit attribution, use the positive Staff ID with role `support_staff`; never put Staff IDs in Admin-only or ambiguous Teacher ID fields.

**Why:** Parent/child grants, leave-history visibility, session-bound actions, and shared numeric ID spaces can otherwise authorize sibling operations or misattribute Staff actions.

**How to apply:** Keep the UI permission tree, direct-route guards, API guards, response filtering, and audit attribution aligned. Preserve existing parent-only module semantics and the shared ID Card Gen read path.
