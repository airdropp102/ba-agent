---
name: ba-verifying-requirements
description: Use when BRD, SRS, user stories, or a requirements baseline needs an independent quality review or stakeholder validation before approval.
---

# Verifying and Validating (BABOK 7.2–7.3)

**Verify:** Is each statement structurally sound — atomic, clear, consistent, complete enough, testable and traceable? The mechanical checks in `src/ba-quality.js` help but are intentionally non-exhaustive.

**Validate:** Does each statement address the stakeholder's real business problem and create the intended value? Ask stakeholders to judge; a model cannot grant approval.

Record findings separately:

- `verified`: passes documented BA quality review with no blocking gaps (not a business endorsement).
- `validated`: business owner confirms intended value and scope (must have a real recorded answer).
- `approved`: authorized stakeholder gives explicit, attributable sign-off.
- `baselined`: organization-controlled revision is frozen under change control, after sign-off.

The current BA Studio MVP exposes **BA reviewed draft** only. Do not label any export `approved` or `baselined` automatically.

If requirements cannot be independently tested or traced, return gap IDs + remediation; ask again before baseline. Treat source citations as unverified claims until confirmed with the appropriate stakeholder.
