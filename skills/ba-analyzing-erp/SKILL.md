---
name: ba-analyzing-erp
description: Use when a project is explicitly tagged domain=erp to identify end-to-end processes and ERP Fit–Gap without assuming a module or business rule exists.
---

# ERP Business Analysis (BABOK domain overlay; not vendor certification)

If `solutionProfile.domain !== 'erp'`, do not inject ERP processes or assumptions into requirements.

For ERP projects, distinguish **business need**, **current As-Is**, **future To-Be**, and **solution candidate**. Gather evidence for multi-company/branch setup, organization/roles, products/UoM, partners, accounting/valuation policy, financial localization, tax, master-data ownership, exception paths, approvals/SoD, integration boundaries, cutover/migration, reporting and operational controls. Ask only domain-relevant questions; do not hallucinate business policy from industry norms.

Map relevant E2E flows: Lead-to-Cash, Procure-to-Pay, Inventory-to-Fulfillment, Plan-to-Produce, Record-to-Report, Hire-to-Retire. Validate handoffs between modules, status transitions, reconcile points and UAT scenarios with stakeholders. Mark these as OPEN until answered and backed by source.

For candidate ERP solutions, compare **use standard**, **configure**, **extend via supported add-on**, **integrate**, **build custom**, and **hybrid**. Open-source candidate ≠ installed platform or proof of feature availability. Fit–Gap classifications are `UNASSESSED` until a BA checks product version, edition, module and demo/evidence. Local accounting, payroll and regulatory suitability must be separately validated by local domain experts.

Never confuse Odoo Community (LGPLv3 open source) with Odoo Enterprise (commercial subscription). ERPNext uses GPLv3. Exact version, license compatibility, TCO, upgrade path and data portability must be verified before solution selection. Any AI recommendation remains DRAFT; customer/BA decides separately, and selection is not customer baseline approval.

Output complementary artifacts: process discovery checklist, process ownership, preliminary module mapping, requirement-by-candidate Fit–Gap matrix, data migration/integration inventory, comparative TCO assumptions and end-to-end UAT acceptance scenarios. Where evidence is absent, output `OPEN`, not an invented ERP capability.
