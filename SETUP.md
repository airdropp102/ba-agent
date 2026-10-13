# BA Studio setup & continuity boot

1. Use Node.js >=22.13 and run `npm run setup` (idempotent environment setup and doctor).
2. Run `npm run session:bootstrap` **before changing any files**. Select Resume or New Task; verify worktree and latest committed evidence.
3. Read `docs/SESSION_CONTINUITY_V3_5.md` for checkpoint JSON and operator commands.
4. To start the BA Studio service run `npm run setup:start` (foreground). For separate background workflow jobs use `npm run worker` in another terminal.
5. Run `npm run eval:continuity` and `npm run test:serial` after harness changes. Before leaving, checkpoint progress and run `npm run session:handoff -- --task <uuid>`.

Canonical setup instructions for AI provider, Figma tools and configuration remain in [setup.md](setup.md). Project-specific Codex/Claude lifecycle hooks are supplied but may require trust/approval and compatible CLI versions. They export **committed** state only.

## Multi-project workspace setup (v3.6)

Run `npm run project:migrate` after upgrading from v3.5, then `npm run project:status`. For a BA project, run `npm run session:bootstrap -- --project <uuid>` and keep the handoff in `data/projects/<uuid>/08-sessions/`. Configure `BA_ACTIVE_PROJECT_ID` for hook isolation. Store customer-specific documents in each project folder; see `docs/MULTI_PROJECT_WORKSPACES_V3_6.md`. A SQLite backup alone does NOT include customer attachments/prototypes/design packs; back up the full `DATA_DIR`.

## Recommendation-assisted Gap Analysis (v3.7)

Open Analysis → Tech Stack, save actual technologies, then generate AI draft suggestions or run normal Workflow Gap Analysis. Human approvers must select an option, provide rationale and evidence reference; re-run Analysis and BA Review before exporting final draft documents. See `docs/RECOMMENDATION_ASSISTED_CLARIFICATION_V3_7.md`. Run `npm run eval:recommendations` to exercise the offline safety checks.


## v3.8 ERP option

After setup, create/open a project in the UI, go to **Phân tích → ERP Solution Strategy** and choose open-source candidates Odoo Community and/or ERPNext. These are **options**, not preinstalled systems; no Odoo server is required to run BA Studio. For ERP project assessment use `npm run eval:erp`. Customer documents, ERP discovery, Fit–Gap and comparison are exported under `DATA_DIR/projects/<uuid>/` and must be protected and backed up. See `docs/ERP_SOLUTION_INTELLIGENCE_V3_8.md`.

## Xóa toàn bộ project và dữ liệu liên quan

Dừng server (`Ctrl+C`) và mọi worker dùng cùng `DATA_DIR`, rồi chạy:

```bash
kill -TERM 18057
npm run project:purge                 # Chỉ xem trước, không xóa
npm run project:purge -- --confirm    # Xóa toàn bộ project
```

Lệnh xóa dữ liệu SQLite theo project (lịch sử, jobs, audit, telemetry, quality, Figma challenges, phiên gắn với project), thư mục `projects/<uuid>`, JSON mirror và các thư mục legacy liên quan. Giữ `.env`, cấu hình Codex, runtime và phiên kỹ thuật toàn cục. Dùng `DATA_DIR` hiện tại; yêu cầu `lsof` để kiểm tra server/worker đã dừng. Backup có sẵn hoặc dữ liệu đã gửi tới dịch vụ bên ngoài không nằm trong phạm vi xóa. Không tự tạo backup.

Nếu báo đã commit SQLite nhưng cleanup chưa hoàn tất, chạy lại cùng lệnh `--confirm` để dọn các thư mục tạm `.purge-<uuid>`.
