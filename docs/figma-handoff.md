# Tích hợp Figma: vẽ, duyệt và chỉnh sửa prototype

Luồng hiện hành bắt đầu trong tab **Prototype**, sau BA Review và khi requirements không chờ refresh. Codex dùng **UI UX Pro Max** để định hướng thiết kế, **TalkToFigma MCP** để tạo frame chỉnh sửa được. Workflow BA kết thúc ở DELIVERABLES; gallery chỉ hiển thị bản đã duyệt.

## BA Studio local relay setup

The Prototype setup flow starts and stops the bundled TalkToFigma-compatible relay from BA Studio. Install Bun and configure `BUN_BIN` (default `bun`) if it is not on PATH. The relay binds only to `127.0.0.1:3055`; it does not print WebSocket payloads. BA Studio and the Figma desktop app/plugin must run on the same computer.

After starting the relay in Prototype, open the TalkToFigma plugin manually in the target Figma file and connect it to the local socket. Copy the channel ID shown by the plugin into BA Studio together with the Figma file link. `npm run doctor -- --figma` checks the Bun runtime and the vendored local-safe relay source; it cannot verify that the plugin is open or joined to a channel.

The relay protocol is pinned to `grab/cursor-talk-to-figma-mcp` revision `ddd90f3a6d454ea0b2fc29f1b084f50fd062b880`; see `vendor/talk-to-figma-relay/NOTICE.md`. Revalidate join, message, and progress_update compatibility before changing that revision.

## Prototype tab review workflow

The Prototype tab exposes the managed local relay and version-bound design review. Click **Start socket cursor-talk-to-figma-mcp** to run the bundled relay at `127.0.0.1:3055`. This route is disabled when BA Studio binds to a non-loopback host. Bun must be installed; set `BUN_BIN` if it is not available on PATH.

The user opens the target Figma file, starts TalkToFigma and connects it to the relay manually. BA Studio does not open the Figma plugin or infer its channel. The user enters the HTTPS Figma file link and the channel ID shown by the connected plugin. On Continue, BA Studio queues a single-attempt Figma design job. The worker runs a read-only channel/file preflight, builds editable frames with Codex + UI UX Pro Max, verifies frame reports, exports bounded PNG/JPEG previews and stores them under `DATA_DIR/projects/<uuid>/04-figma/exports/v<version>-<platform>/previews/<run UUID>/`.

The Prototype tab displays the generated draft by screen with the FR IDs, preview and Figma frame link. The reviewer can approve the exact manifest digest and project version, or request changes and send a revision back to the same connected channel. Only the approved screen set appears in the approved Figma gallery. These design decisions remain separate from BA Review and customer sign-off. The HTML click-through prototype stays available alongside the Figma gallery.

A failed job is not automatically retried because Figma may already contain partial frames. Inspect the Figma file before submitting another attempt. The UI reports failed state and keeps the input available for an explicit retry. Relay status and offline tests do not prove that the Figma plugin is connected or that a human has inspected the result.

### Scoped Codex tool authorization

After explicit operator approval, set `CODEX_FIGMA_TOOL_APPROVAL=true` to apply the fixed 27-tool TalkToFigma allowlist in `src/figma-codex-policy.js` only to Figma subprocesses. BA analysis calls receive no approval overrides; the user-level Codex configuration is not edited. Each subprocess receives per-tool approval settings and the shell sandbox remains read-only. Delete tools are excluded. The connection preflight exposes only join/document/selection tools; preview export exposes only join/document/node/export tools. Each subprocess rejoins its channel because MCP connections are not shared between CLI calls.

Approval denial returns `MCP_APPROVAL_REQUIRED`; missing plugin connectivity or file-key evidence returns its own failure code. A file key supplied by the operator must never be reported as if it were read from the plugin. If the installed plugin cannot expose the actual file key, stop unless the operator explicitly confirmed the exact file and channel for this run. This confirmation is bound to project UUID/version/run ID/file key/channel digest, recorded in the audit, and labeled OPERATOR_FILE_CONFIRMATION_NOT_INDEPENDENT_ATTESTATION. It resolves only a connected plugin with FILE_KEY_UNAVAILABLE and an empty reported key; it never overrides a mismatched file, disconnected plugin, approval denial or missing MCP. Each new run requires a fresh explicit confirmation. Native navigation and customer approval remain separate human gates.

## Native preview export and failed-preview recovery

BA Studio exports preview bytes through the pinned local relay protocol with a read-only join/export client. PNG/JPEG bytes are bounded, signature-checked, checksummed and stored with their native MIME type; they are not copied through model output. The review set includes only current prototype screen IDs, so supplemental DRAFT screen suggestions cannot become approved screens through this flow.

For an explicitly authorized failed preview run with a valid file/channel confirmation and matching registered frames, run `node scripts/figma-recover-previews.mjs --project UUID --version CURRENT_FAILED_VERSION --confirm`. Recovery reads the immutable source revision, rejects changed requirements/file/channel/current version, requires every review screen to be a registry skip action, re-exports previews, and commits a new WAITING_FOR_REVIEW revision with audit and recovery report. It never draws, rewrites the failed job record, approves a design, or changes customer signoff. Source-version snapshots remain read-only.

## Editing an approved design

The approved gallery includes an explicit edit request with required feedback. REQUEST_CHANGES can reopen the exact currently approved project version and manifest; stale approvals or blank feedback are rejected. The previous approval and frame references remain historical evidence. A new revision requires the connected channel and explicit file confirmation, creates new frames in a versioned section, and returns to WAITING_FOR_REVIEW. A prior approval never automatically approves the new revision or supplies customer signoff.

## Prototype replaces the manual workflow panels

The BA workflow now ends at `DELIVERABLES` with state `COMPLETED`. It no longer schedules a separate Figma Design Pack or manual Figma publish stage. The Workflow UI links to Prototype, which owns setup, drawing, revision and version-bound design review. Drawing still prepares its internal grounded handoff on demand.

Existing manual-run checkpoints, files, approvals and registry history remain stored. Historical manual API routes remain compatible for existing integrations, but no longer appear as actions in the application. Viewing an old project does not migrate or replay its workflow.

## Runner, registry và giới hạn giao dịch

`src/figma-publisher.js` chuẩn bị grounded handoff nội bộ rồi chạy Codex với `CODEX_BIN`, optional `CODEX_MODEL` và timeout riêng `CODEX_FIGMA_TIMEOUT_MS` (tối đa 600000 ms). Shell sandbox read-only; quyền MCP được cấp riêng theo allowlist. Progress log chỉ ghi metadata và heartbeat, không ghi prompt/MCP payload. Timeout kết thúc process group.

Report phải qua schema, đối chiếu plan, project version và registry hiện hành. Registry scoped theo file key trong `04-figma/registry/FILE_KEY.json`. Screen không đổi được skip; thay đổi tạo frame mới, giữ frame cũ. Version fence và lease bảo vệ commit của các writer hợp tác, nhưng filesystem rename và Figma side effects không atomic với SQLite. Crash sau tạo node trước lưu registry có thể để lại frame trùng khi thử lại.

Node ID và `verified=true` trong operator report không tự chứng minh độc lập rằng frame tồn tại/đúng. Cần kiểm tra trực tiếp và human visual QA; acceptance độc lập dùng read-back riêng theo [LIVE_ACCEPTANCE](LIVE_ACCEPTANCE.md). Native prototype navigation và customer signoff không được suy ra từ approval gallery.

## Tương thích tích hợp cũ

Các API manual và `scripts/figma-design.mjs` vẫn tồn tại cho integration cũ; không còn là bước bắt buộc hoặc panel thao tác trong UI. Script có thể tạo handoff với `--project UUID --platform web`; publish cần thêm `--publish --channel CHANNEL --figma-file FILE_KEY` và mọi approval/preflight liên quan. Không chạy script để replay checkpoint đã hoàn tất. Lịch sử cũ giữ nguyên để audit, không được xem là approval của revision mới.

Xem thêm [workflow](WORKFLOWS.md), [API](API.md) và [vận hành](OPERATIONS.md).

### Missing section tool and empty reports

When TalkToFigma does not expose `create_section`, the publisher uses a new named top-level container frame and nests new screen frames with `parentId`. This is a FRAME, not a native SECTION; existing nodes remain untouched. Names and parents are supplied at creation time, so `rename_node` and `set_parent` are not required.

The design prompt points to the installed `ui-ux-pro-max/SKILL.md` under `CODEX_HOME/skills` (default `~/.codex/skills`), independently of the isolated design-pack directory. `npm run doctor -- --figma` checks that the skill and search script exist. Install the skill before drawing if missing.

A schema-valid report with no screens now fails as `NO_VERIFIED_SCREENS`; other rejected screen reports fail as `FIGMA_REPORT_REJECTED`. Neither status implies that the remote file is unchanged. Inspect the file before an explicit retry; no automatic drawing retry or approval is introduced.

## Web/Mobile app và chỉnh sửa từng màn hình

Prototype có bộ chọn `Web` / `Mobile app` cho wireframe HTML, file tải xuống và lượt vẽ Figma tiếp theo. Lựa chọn được gửi bằng `platform:"web"|"mobile"` ở POST `figma-design`; không thay nền tảng đã khóa của workflow BA. Mobile dùng viewport 390×844 trong manifest. Mỗi lượt có một nền tảng hiện hành; chuyển nền tảng tạo bản cần duyệt mới, không kế thừa approval nền tảng trước. Các snapshot SQLite và frame cũ giữ nguyên. Registry Web giữ đường dẫn cũ, Mobile dùng `04-figma/registry/mobile/<file-key>.json` để tránh ghi đè registry Web.

Mỗi card màn hình trong draft/approved gallery có form **Chỉnh sửa màn hình này**. Form gửi `REQUEST_CHANGES` cùng `screenIds:["SCR-..."]`, ghi nhận đúng phạm vi và phản hồi. Người vận hành xác nhận file/channel rồi bấm **Vẽ lại màn hình đã chọn**. Server gắn phạm vi vào job; khi giữ nguyên nền tảng, không cho đổi file hoặc nới phạm vi màn hình của request này. Bộ chọn nền tảng vẫn hoạt động khi yêu cầu chỉnh sửa. Nếu đổi Web/Mobile app, UI thông báo rõ rằng toàn bộ màn hình sẽ được vẽ mới cho nền tảng mới; không tái sử dụng frame khác nền tảng và không kế thừa approval. API chuyển nền tảng không gửi `screenIds`; gửi scope màn hình cũ kèm nền tảng mới sẽ bị từ chối. Request không có `screenIds` tiếp tục là chỉnh sửa toàn bộ như API cũ.

Publisher chỉ tạo frame mới cho màn hình đã chọn. Màn hình không chọn phải có registry hash/node hợp lệ với yêu cầu hiện tại; nếu không, dừng trước khi vẽ để tránh giữ lại thiết kế stale. Preview đầy đủ được đọc lại và bản kết hợp vẫn cần duyệt toàn bộ; không tự approve các frame mới. Các node cũ được giữ nguyên. Lỗi/retry không tự chạy lại và giữ phạm vi màn hình đã chọn. `GET export/prototype.html?platform=mobile` tải wireframe Mobile; URL cũ không có query vẫn hoạt động.

### Design Brief, tư liệu và mẫu thiết kế

Trong Prototype, lưu **Định hướng thiết kế** trước khi vẽ: mục tiêu/cảm nhận, phong cách, người dùng, màu thương hiệu, font, mật độ và điều cần tránh. Chọn một SCR đại diện làm màn hình mẫu. Có thể tải tối đa 6 ảnh PNG/JPEG/WebP (5 MiB/ảnh, tổng 20 MiB), ghi rõ điểm muốn học từ mỗi ảnh. Không sao chép thêm nghiệp vụ từ ảnh tham khảo.

Thư viện component/asset ghi tên, loại, component node ID của file đang mở (nếu có), URL HTTPS, giấy phép và vị trí sử dụng. Nhập component/icon vào file Figma trước; publisher kiểm tra node có sẵn rồi dùng instance. URL không được tự tải, nhãn giấy phép cần người vận hành đối chiếu. Ảnh tải lên là visual reference gửi kèm Codex; không tự nhúng ảnh tham khảo vào Figma. Muốn chèn asset thật, chọn nguồn tự tải và dùng plugin extension bên dưới.

Sau khi lưu, bấm **Vẽ màn hình mẫu**, xác nhận đúng file và cho phép dùng brief/ảnh cho lượt này. Kiểm tra preview cùng frame thật rồi **Duyệt màn hình mẫu** hoặc yêu cầu chỉnh sửa. Mẫu được duyệt chỉ chốt hướng thị giác, không duyệt toàn bộ prototype. Lượt **Vẽ các màn hình còn lại** tái sử dụng mẫu trong registry phù hợp, sau đó vẫn cần duyệt đủ bộ màn hình. Đổi brief/tư liệu, yêu cầu nghiệp vụ, nền tảng hoặc file cần mẫu hợp lệ lại. API `POST /api/projects/:id/design-direction` lưu cấu hình với If-Match như các mutation khác; `POST .../figma-design` nhận `mode: sample|full` (mặc định tự chọn theo approval hiện hành), `visualInputsConfirmed:true` là bắt buộc cho project có brief. Không thể yêu cầu full để bỏ qua sample gate.

### Tự tải icon và asset từ link

1. Trong **Thư viện component / asset**, bấm **Thêm link thư viện / asset**.
2. Dán link bộ Iconify, ví dụ `https://icon-sets.iconify.design/lucide/`, hoặc link trực tiếp SVG/PNG/JPEG/WebP. Không cần node ID. Có thể chọn nguồn rõ ràng hoặc để **Tự nhận dạng link**. Link trang giới thiệu không phải link asset trực tiếp; mục **Link tham khảo** vẫn chỉ là ghi chú.
3. Ghi cách dùng nếu có, lưu brief. Lượt vẽ có xác nhận tải asset mới tự chọn icon từ danh sách thực của bộ icon. Chỉ asset được chọn cho màn hình đang vẽ được tải, cache và đưa vào các vị trí đã tạo. Đổi nền tảng vẫn cần mẫu hợp lệ riêng.
4. Mở **Cài plugin hỗ trợ tự chèn icon và ảnh**, tải ZIP và giải nén vào thư mục cố định. Trong Figma Desktop chọn **Plugins → Development → Import plugin from manifest…**, trỏ tới `manifest.json`. Nếu môi trường Figma yêu cầu ID do tài khoản cấp, tạo plugin development trong Figma và dùng ID được tạo cho manifest này.
5. Đóng plugin TalkToFigma cũ, mở **BA Studio TalkToFigma + Assets**, Connect với socket local và dùng Channel ID mới. Không cần sửa cấu hình MCP hiện có. Bản Community chưa có các lệnh asset mới; hệ thống sẽ dừng trước khi vẽ nếu thiếu chúng.
6. Vẽ, kiểm tra frame thật và **Duyệt màn hình mẫu**. Gallery asset đã tải hiển thị thumbnail và nguồn để đối chiếu. License lấy từ nguồn/operator chưa được hệ thống xác minh. Ảnh tải lên mục tham khảo vẫn là nguồn cảm hứng; muốn chèn ảnh thật hãy khai báo nó thành một nguồn asset trực tiếp.

Cấu hình API giữ `name/kind/componentId/sourceUrl/license/usage` cũ; nguồn mới thêm `sourceType`, Iconify lưu thêm `prefix`. `GET /api/projects/:id/design-assets` trả metadata cache theo direction hiện hành; `GET .../design-assets/:assetId` đọc bytes có kiểm tra checksum/project. `GET /api/figma/asset-plugin.zip` tải gói plugin công khai. Không có API tải link tuỳ ý ngoài lượt vẽ đã được xác nhận.

Source: [Iconify API](https://iconify.design/docs/api/), [Figma Plugin API](https://developers.figma.com/docs/plugins/api/figma/), [upstream TalkToFigma](https://github.com/grab/cursor-talk-to-figma-mcp) pinned at `ddd90f3a6d454ea0b2fc29f1b084f50fd062b880`.

Plugin development manifest chỉ khai báo `http://localhost:3055` và `ws://localhost:3055` trong `devAllowedDomains`, với `allowedDomains: ["none"]`. Figma đã từ chối IP literal `ws://127.0.0.1:3055` khi import gói cũ. Nếu gặp lỗi này, tải lại ZIP, thay file đã giải nén rồi import lại manifest; không cần đổi host của server relay đang bind loopback. Build/ZIP checks bảo vệ cấu hình local này; không thay thế kiểm tra import thực trong Figma.
