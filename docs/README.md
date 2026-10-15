# Tài liệu hệ thống BA Studio

Cập nhật theo source ngày 15/10/2026. Bắt đầu từ kiến trúc, sau đó đọc thành phần và workflow. Tài liệu hiện hành tổ chức theo chủ đề; không duy trì một bộ architecture/release-handoff cho từng version.

## Tài liệu chính

1. [ARCHITECTURE](ARCHITECTURE.md): hệ thống giải quyết gì, các process, luồng dữ liệu, SQLite/filesystem, quyền và giới hạn.
2. [COMPONENTS](COMPONENTS.md): bản đồ source, trách nhiệm từng module, cách các thành phần phối hợp.
3. [WORKFLOWS](WORKFLOWS.md): stage/gate, retry, reanalysis, Figma review/revision và session continuity.
4. [API](API.md): routes hiện có, payload chính và tương thích legacy.
5. [OPERATIONS](OPERATIONS.md): môi trường, chạy worker, backup, xử lý lỗi và kiểm thử.

## Hướng dẫn chuyên sâu

- [Project workspaces](PROJECT_WORKSPACES.md)
- [Clarification](CLARIFICATION.md)
- [ERP analysis](ERP.md)
- [Figma integration](figma-handoff.md)
- [Engineering session continuity](SESSION_CONTINUITY.md)
- [Live acceptance](LIVE_ACCEPTANCE.md)
- [Execution logs](CODEX_EXECUTION_LOGS.md)
- [BABOK mapping](babok-mapping.md)

`superpowers/plans/` và `superpowers/specs/` chứa thiết kế triển khai theo tác vụ, mang tính lịch sử; khi khác với source, bộ tài liệu chính và source hiện tại là tham chiếu vận hành. [Live acceptance implementation report](LIVE_ACCEPTANCE_IMPLEMENTATION_REPORT.md) là báo cáo kiểm thử lịch sử, không phải tuyên bố production acceptance hiện tại. Thiết kế giao diện ở [design-system](../design-system/ba-studio/MASTER.md).

## Quy tắc cập nhật

- Thay runtime/component: cập nhật ARCHITECTURE và COMPONENTS.
- Thay stage/state/approval: cập nhật WORKFLOWS, API và chuyên đề liên quan.
- Thay env/CLI/recovery: cập nhật OPERATIONS, SETUP và `.env.example` khi cần.
- Giữ nguyên phiên bản hợp đồng schema/database và dữ liệu khách hàng; việc bỏ tài liệu release không phải migration dữ liệu.
- Dùng Git để xem lại tài liệu đã xóa. Không ghi secrets, customer briefs hoặc private operator logs vào tài liệu repository.
