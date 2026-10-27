# Hướng dẫn thu thập corpus và review benchmark BA

Ngày chuẩn bị: 25/10/2026. Trạng thái: chờ dữ liệu thực và đánh giá của con người.
Hướng dẫn này áp dụng cho Harness² research runner; xem hợp đồng tại
[HARNESS2_BENCHMARK.md](HARNESS2_BENCHMARK.md) và [LIVE_ACCEPTANCE.md](LIVE_ACCEPTANCE.md).

## 1. Phân công và nơi lưu

| Vai trò | Việc cần làm | Bằng chứng cần giữ |
| --- | --- | --- |
| Chủ dữ liệu | Chọn nguồn được phép dùng, duyệt ẩn danh và phạm vi sử dụng | Văn bản/quyết định thật, mã tham chiếu và ngày |
| Người quản lý corpus | Gán ID, kiểm tra nguồn, chia train/test, quản lý phiên bản | Danh mục nguồn và bảng ánh xạ ẩn danh riêng tư |
| BA A và BA B | Độc lập lập gold trước chạy; độc lập đánh giá predictions sau chạy | Hai bộ nhận xét gốc với danh tính và thời gian |
| Người phân xử | Giải quyết bất đồng, chốt gold và verdict cuối | Lý do quyết định, tham chiếu hai nhận xét gốc |
| Operator | Preflight, lưu hash, vận hành lượt đã được cho phép, chấm | Manifest, ledger, report và log |

Dùng ba người khác nhau cho BA A, BA B và phân xử. Runner hiện dùng một bộ ba
review sheet cho toàn lượt: chọn cùng hai BA và cùng người phân xử cho mọi case test,
ghi các ID đó trong annotation của corpus. Danh tính trong file là tự khai;
cần giữ bằng chứng review thực tế để đối chiếu.

Tài liệu khách hàng gốc và review thuộc dự án phải ở `DATA_DIR/projects/<uuid>/`.
Xác định UUID qua `/api/projects` trước khi làm việc với tài liệu dự án.
Chỉ bản đã được phép ẩn danh/tổng hợp cho nghiên cứu mới đưa vào thư mục benchmark
riêng trong `data/benchmarks/harness2/`. Giữ bảng ánh xạ danh tính ngoài context model.
Không commit dữ liệu, phiếu review hay giấy phép vào Git.

## 2. Thu thập 20–50 case thực

Mẫu hiện có: `data/benchmarks/harness2/corpora-20261020/real-corpus.UNAPPROVED.json`.
Sao chép sang thư mục nghiên cứu mới trước khi điền; giữ mẫu gốc chưa duyệt.
Mẫu có 20 dòng trống, 10 train/10 test chỉ là chỗ điền ban đầu, chưa phải thiết kế
lấy mẫu được phê duyệt. Có thể dùng 20–50 case theo phạm vi nghiệp vụ cần nghiên cứu.

Mỗi case cần một brief thực đủ ngữ cảnh để đánh giá. Giữ nguyên chỗ mơ hồ hoặc thiếu
thông tin; không thêm SLA, stack, vai trò hay quy tắc nghiệp vụ cho brief có vẻ đầy đủ.
Loại bỏ tên thật, liên hệ, tài khoản, bí mật và định danh không cần thiết. Giữ ý nghĩa
nghiệp vụ của số liệu/quan hệ; ghi riêng những phép biến đổi đã thực hiện.

| Trường case | Cách điền |
| --- | --- |
| `id` | Mã duy nhất, ổn định, chữ/số/gạch ngang/gạch dưới, tối đa 80 ký tự |
| `title`, `brief` | Tiêu đề 2–250 ký tự; brief 20–100000 ký tự, nguồn thực đã ẩn danh |
| `domain` | Mã miền nghiệp vụ, cùng bộ ký tự như ID; không dùng nhãn này để suy đoán ERP |
| `groupId` | Mã nhóm khách hàng/dự án; các brief liên quan hoặc gần trùng phải cùng nhóm |
| `split` | `train` hoặc `test`, chốt trước khi chạy |
| `sourceId` | ID nguồn đúng của bản đã chuẩn hóa, dạng `SRC-` và ba chữ số; giữ ánh xạ về nguồn gốc |
| `respondent` | Mã người cung cấp có thật sau ẩn danh, có ánh xạ riêng tư |
| `sourceReference` | Tham chiếu thực tới tài liệu/biên bản được phép sử dụng |
| `expectedFunctional`, `expectedNfr` | Gold do hai BA và người phân xử xác lập, như mục 3 |
| `annotation` | Trạng thái, danh tính, ngày và bằng chứng review thật |

Chia theo nhóm, không chia ngẫu nhiên từng brief có cùng nguồn sang hai tập.
Hai tập phải có dữ liệu; không nhóm nào xuất hiện ở cả train và test. Mọi domain ở
test phải có case train tương ứng. Kiểm tra gần trùng bằng người: validator chỉ bắt
brief trùng sau chuẩn hóa khoảng trắng/Unicode, không phát hiện mọi bản diễn đạt lại.
Nên có nhiều nhóm test để xem biến động; một nhóm không tạo được khoảng bất định.

## 3. Lập gold trước khi chạy model

1. BA A và BA B đọc brief độc lập, ghi từng FR/NFR có căn cứ và các câu hỏi còn mở.
   Mỗi nhận xét giữ case ID, trích dẫn, giải thích và thời gian; chưa xem predictions.
2. Người phân xử đối chiếu hai bộ nhận xét, giải thích quyết định ở từng bất đồng.
3. Điền `expectedFunctional` và `expectedNfr`: mỗi phần tử là một mảng cách diễn đạt
   tương đương của **một** khái niệm. Không gom nhiều yêu cầu khác nhau thành aliases.
4. Chỉ sau review thực mới đặt `annotation.status="approved"`, điền `reviewerIds`,
   `adjudicatedBy`, `adjudicatedAt` (ISO timestamp) và `reference` tới hồ sơ phân xử.

Không tạo NFR chỉ để có mẫu số. Một case có thể không có NFR; ít nhất một khái niệm
FR hoặc NFR phải có trong case. Thiếu mẫu số được báo UNKNOWN/null.
Thứ tự gold tạo ID: phần tử đầu FR là `FR-G1`, tiếp theo `FR-G2`; NFR tương tự.
Chốt thứ tự trước lượt chạy; sửa gold sau đó làm đổi corpus hash và cần nghiên cứu mới.

Chỉ sau khi chủ dữ liệu duyệt mới ghi root `provenance.kind="real-anonymized"`,
`dataUseApproved=true` và `approvalReference` thật. Quyền dùng dữ liệu không tự
thay thế quyền truyền nội dung đến provider trong một lượt benchmark cụ thể.

Admission hiện tái sử dụng validator live acceptance nên bắt buộc `figmaTarget`
với fileKey/nodeId/nodeName/designSpecReference thật, đúng scope đã được cho phép.
Nếu chưa có target, ghi nhận còn thiếu; không điền dummy để qua preflight.
Harness² không tự gọi Figma và metadata target không chứng minh visual QA.

## 4. Preflight và ngân sách

Lệnh kiểm tra local (thay đường dẫn bằng corpus đã chuẩn bị):

```bash
npm run benchmark:harness2:live -- preflight --corpus /secure/ba-corpus-reviewed.json
```

Preflight không gọi model. Mẫu UNAPPROVED và synthetic phải bị từ chối trong chế độ
reviewed. Preflight PASS kiểm tra cấu trúc/hợp đồng, không xác minh danh tính hay
tính đại diện của corpus và không cho phép tự gửi dữ liệu.

Runner hiện dùng `k=1`, sequential, train C rồi test A/B/C với memory C đóng băng.
Số CLI invocations dự kiến = **8 × số case train + 15 × số case test**.
Ví dụ 10 train + 10 test cần 230 invocations. Đây là dự toán số lần gọi, chưa phải
ngân sách được duyệt; tokens/giá chưa biết vẫn UNKNOWN. Cần ghi rõ model, corpus hash,
phạm vi truyền dữ liệu, trần invocation cho lượt mới. Quyền pilot cũ 24 calls không
bao phủ corpus thực. Sau khi được cho phép, dùng lệnh run ở tài liệu benchmark.

## 5. Review predictions sau lượt chạy

Runner tạo `review-packet.json`, `reviewer-a.json`, `reviewer-b.json`,
`adjudicator.json` trong thư mục run. Packet chứa brief/gold/predictions: giữ riêng tư.
Sao chép mỗi phiếu sang nơi làm việc của đúng reviewer, giữ file PENDING gốc.
BA A/B hoàn tất độc lập trước khi xem phiếu của nhau; người phân xử xử lý sau đó.

Giữ nguyên `schemaVersion`, `runHash`, `caseId`, `arm`, `predictionId` và đủ mọi
prediction của cả A/B/C trên tất cả case test. Điền `reviewerId`, `reviewedAt` thật.
Không tái sử dụng judgments khi output hoặc corpus thay đổi.

| `verdict` | Khi dùng | Các trường đi kèm |
| --- | --- | --- |
| `supported` | Yêu cầu được brief hỗ trợ về nghĩa và khớp gold | `matchedGoldIds` hợp lệ, `supportQuote` lấy từ brief |
| `unsupported` | Yêu cầu không có căn cứ hoặc trái nguồn | `matchedGoldIds: []`, `note` giải thích cụ thể |
| `needs-clarification` | Chưa đủ thông tin để kết luận | `matchedGoldIds: []`, nên ghi câu hỏi còn thiếu trong `note` |

Một quote trùng văn bản chưa đủ để kết luận đúng nghĩa. Đọc cả điều kiện, phủ định,
actor và phạm vi. Một prediction có thể map nhiều gold ID nếu thực sự bao phủ từng
khái niệm; không map để làm tăng recall. Không biến câu hỏi/giả định thành yêu cầu đã duyệt.
Nếu phát hiện gold sai, dừng và lập phiên bản corpus mới; không sửa thầm gold của run.

Người phân xử điền phiếu riêng, ghi lý do cho bất đồng. Scorer từ chối PENDING,
thiếu prediction, sai hash, ID gold lạ, thiếu quote cho supported hoặc thiếu lý do
cho unsupported. `needs-clarification` là verdict được chấp nhận trong nghiên cứu,
không phải một yêu cầu supported; cần báo riêng các trường hợp này khi diễn giải kết quả.

## 6. Có thể review pilot cũ ngay

Run: `data/benchmarks/harness2/codex-pilot-20261020/`.
Corpus: `data/benchmarks/harness2/corpora-20261020/synthetic-pilot.json`.
Hai BA và người phân xử có thể dùng packet/phiếu tại đó để làm quen quy trình.
Đây là dữ liệu hư cấu; không đổi nhãn thành dữ liệu thực và không đưa vào 20–50 case.
Chưa có phiếu hoàn tất thì chưa có semantic score.

Sau khi có ba phiếu thực đã hoàn tất, chạy scorer theo mục 10 của tài liệu benchmark,
trỏ tới đúng run, đúng corpus và một output mới. Kết quả pilot chỉ có thể là
`SYNTHETIC_REVIEWED_NOT_ACCEPTANCE`; nghiên cứu thực chỉ là
`HUMAN_REVIEWED_RESEARCH_ONLY`. Không kết quả nào tự duyệt production/customer.

## 7. Gói bàn giao cần có

- Corpus 20–50 case đã chốt, nguồn và quyền sử dụng có thể đối chiếu.
- Hai bản gold review độc lập, hồ sơ phân xử, split theo nhóm và corpus hash.
- Figma target đúng scope để admission; bằng chứng cross-check/visual QA riêng nếu
  sau này thực hiện production acceptance.
- Model, quyền truyền dữ liệu và ngân sách dành riêng cho lượt benchmark mới.
- Sau chạy: report/manifest/ledger, ba review sheet hoàn tất đúng runHash và báo cáo
  research. Báo rõ mẫu nhỏ, case chưa chấm, lỗi, usage/giá UNKNOWN và câu hỏi còn mở.

Hiện chưa có corpus thực hoặc human review hoàn tất. Các bước thu thập và review
do người phụ trách thực hiện; agent hỗ trợ kiểm tra cấu trúc, preflight và chấm sau đó.
