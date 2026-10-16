# BA Studio — ERP Business Analysis & Build/Adopt/Hybrid

Current implementation guide. **Offline tests do not certify ERP domain expertise or vendor feature availability.**

## Key distinction

- `techStack`: technologies **already used** in a project (human supplied). Do not enter Odoo as an installed stack unless it is genuinely deployed.
- `solutionProfile`: business domain (`general` or `erp`), potential strategy (`undecided`, `custom`, `open-source`, `hybrid`, `commercial`), platform **candidates**, and business process scope.
- `erpFitGap`: append-only human attestations for a requirement + a shortlisted platform and exact version/edition. `UNASSESSED` by default; AI never autonomously records FIT.

## Catalog reference editions

- `odoo-community`: Odoo Community; LGPLv3; open source. https://www.odoo.com/documentation/19.0/legal/licenses.html
- `erpnext`: ERPNext; GPLv3; open source. https://docs.frappe.io/erpnext/open-source
- `odoo-enterprise`: Odoo Enterprise; **commercial** with subscription license, not open source. https://www.odoo.com/documentation/19.0/legal/licenses.html

These are **catalog attributes**, not assertions about installed modules, local regulatory fit, available features or exact enterprise support. Actual product features must be tested against selected version + edition. The default catalog is small and intentionally curated, not a live marketplace search.

## Single-agent workflow

```text
Customer brief + ERP profile (per project)
    → ERP discovery questions (As-Is/To-Be, roles/controls/migration/integration)
    → Source-grounded BA analysis (current canonical model)
    → Human Fit–Gap requirement x platform with version/edition and evidence
    → Draft 1–3 alternatives (standard/configure/build/hybrid)
    → BA/customer choice (operator-attested, NOT signed baseline)
    → Re-analyze → BA Review → PRD/BRD/SRS + Figma
```

**No silent platform choice:** an `open-source` strategy is a *review scope*, not deployment approval. All comparative TCO/localization/compliance are `UNKNOWN` until humans supply verified figures and evidence. When a shortlist/fit-gap record changes, recommendation digests become stale and downstream review is invalidated. Legacy v3.7 projects without an ERP profile retain the old tech-stack digest semantics.

## APIs

`GET /api/erp/catalog` — supported candidates and process groups.

`POST /api/projects/<uuid>/erp/profile` — apply a project-scoped profile (audited, versioned):

```json
{"solutionProfile":{"domain":"erp","strategy":"open-source","candidates":["odoo-community","erpnext"],"processAreas":["procure-to-pay","inventory-to-fulfillment","record-to-report","master-data"]}}
```

`GET /api/projects/<uuid>/erp` — scoped profile + matrix + comparison; Fit–Gap is *unassessed* until reviewed.

`POST /api/projects/<uuid>/erp/fit-gap` — human review of ONE requirement/candidate:

```json
{"requirementId":"FR-001","platformId":"odoo-community","classification":"CONFIGURE","verifiedVersion":"19.0","verifiedEdition":"Community - Purchase", "sourceReference":"ERP-DEMO-2026-10-13-001", "rationale":"BA verified the tested workflow in sandbox and recorded missing approval conditions."}
```

Status values: `FIT_STANDARD`, `CONFIGURE`, `EXTEND`, `INTEGRATE`, `GAP_BUILD`, `NOT_APPLICABLE`. BA attestation is not independently validated proof or customer sign-off. `If-Match` applies when server configured with `REQUIRE_IF_MATCH=true`. The existing `/tech-stack`, `/analyze`, `/recommendations/generate`, `/recommendations/approve` routes remain available.

## Per-project artifacts

```text
data/projects/<uuid>/
  00-admin/ERP_SOLUTION_PROFILE.json
  00-admin/TECH_STACK.json
  02-requirements/ERP_DISCOVERY.md
  02-requirements/ERP_FIT_GAP.json
  02-requirements/ERP_SOLUTION_COMPARISON.md
  02-requirements/PRD.md, BRD.md, SRS.md, canonical.json
  05-workflow/PROJECT_STATE.json
  08-sessions/... (v3.5 continuity)
  09-archive/... (historical snapshots)
```

SQLite is authoritative. Existing projects are untouched until a user chooses an ERP profile. All new files are projections scoped by UUID. Back up BOTH SQLite and the project tree when migrating.

## Working with the UI

1. Create a project and open **Phân tích**. Set `Project domain = ERP`.
2. Choose strategy and candidate editions; select relevant end-to-end processes. Save profile.
3. Run (or rerun) analysis. Review `ERP_DISCOVERY.md` with finance, supply-chain, HR, IT stakeholders; record business evidence in the project.
4. Perform Fit–Gap by requirement and candidate, with product version, edition/module and evidence reference. Re-generate stale proposals.
5. Compare custom vs Odoo Community vs ERPNext in `ERP_SOLUTION_COMPARISON.md`. Do not input unverified TCO as fact.
6. Select an option only via the existing **human approval** flow, then regenerate/BA-review documents. A BA approval never implies that a customer approved the entire scope.

## Release quality / acceptance

Current deterministic tests verify catalog licensing, domain choice constraints, per-project isolation, proposal provenance and stale decision detection. They DO NOT prove semantic quality of ERP analysis or product feature coverage. A real acceptance requires BA-reviewed samples by module, expert Finance/Procurement/Manufacturing/Inventory reviewers, localized statutory checks, tested candidate instances, demo evidence and UAT.

Suggested acceptance metrics (targets, not measured results): 100% tested edition/version in Fit classifications; 100% candidate products labeled as NOT INSTALLED until confirmed; ≥90% human-reviewed end-to-end process coverage; 0 fabricated confirmed business rules; 0 automatic approvals; 100% project-isolation and stale-decision tests passing.

## Trade-off / risks

- Lightweight overlay keeps single-agent and existing v3.7 workflow, but has no Odoo/ERPNext environment or exhaustive module/edition catalog.
- Version/edition-specific Fit–Gap requires human demos and is more labor-intensive; this avoids the high risk of certifying unavailable ERP features or incorrect tax/accounting support.
- Comparative TCO and implementation time remain uncalculated without real inputs; there is no production-ready weighted vendor scoring yet.
- Current customer approval remains operator-attested rather than independently signed/verified. For cross-tool ERP/vendor repositories, expose a shared MCP server (usable by Codex/Claude) only when integration is actually needed.

The shortlist UI disables candidates whose distribution does not match `open-source` or `commercial`. Switching strategy deselects incompatible candidates and displays a notice; the project profile changes only on Save. Hybrid/Compare allow either class. General/custom profiles cannot select ERP candidates. Server-side license/strategy guards remain authoritative.

## Business process area help

The profile checklist provides Vietnamese descriptions for all eight process areas. Hover over an area or focus its information button to see scope and discovery questions; on touch devices tap the information button. Details do not toggle the checkbox or save a profile. Escape, Close and outside tap dismiss the popover. Descriptions are general discovery guidance, not confirmed customer requirements or a platform capability claim.

## Thiết kế giải pháp ERP sau BA Review

Trong **Tổng quan → Thiết kế giải pháp ERP**, chọn target từ shortlist (hoặc Custom Build cho strategy custom), nhập phiên bản, edition, deployment, phạm vi module và tham chiếu quyết định. Chọn checkbox xác nhận; không có nền tảng được tự chọn. Business process areas phải được chọn trước BA Review. Xác nhận target không cài sản phẩm và không xác nhận bản quyền/module.

Bấm tạo DRAFT để chạy stage qua queue. Adapter demo sinh khung khảo sát; OpenAI/Codex sinh structured output theo schema qua validation chung. Không chạy provider thật chỉ để mở panel. Mỗi FR có đúng một mục, gắn process area đã chọn, gồm module dự kiến, hướng standard/configure/extend/integrate/build, cấu hình, workflow, phân quyền, chuyển đổi dữ liệu, tích hợp, custom, UAT, rủi ro nâng cấp và câu hỏi mở. Các phần chưa có bằng chứng vẫn cần kiểm chứng trên môi trường mục tiêu; đây không phải bộ lệnh tự triển khai ERP.

BA nhập ghi chú để duyệt hoặc yêu cầu chỉnh sửa. Quyết định ràng buộc projectVersion, designId và contentDigest. Bản đã duyệt cho phép workflow tiếp tục DELIVERABLES. Đổi target/yêu cầu/profile/Fit–Gap/BA Review làm thiết kế cũ mất hiệu lực; phải xác nhận target và review lại. Lịch sử nằm trong snapshot SQLite và `erpSolutionDesignHistory` (20 bản gần nhất trong current state; snapshot vẫn giữ lịch sử cũ).

Artifacts: `00-admin/ERP_TARGET.json`, `02-requirements/ERP_SOLUTION_DESIGN.json`, `02-requirements/ERP_SOLUTION_DESIGN.md`. Markdown luôn ghi DRAFT, trạng thái và nền tảng. Không khẳng định cấu hình đã chạy thành công chỉ từ bản sinh AI. Xuất bản hiện hành qua API; bản stale không xuất được bằng route thiết kế hiện hành.
