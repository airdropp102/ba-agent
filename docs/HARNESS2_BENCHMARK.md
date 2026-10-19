# Harness² cho BA Studio — cài đặt và đề xuất benchmark

Ngày kiểm tra: 2026-10-20 (Asia/Ho_Chi_Minh).

Trạng thái: thiết kế được người dùng duyệt ngày 2026-10-19. Đã triển khai adapter
và runner offline qua core Harness² cùng các hàm validation/normalization/evidence/
canonical của BA Studio. Ngày 2026-10-20 bổ sung **Codex-backed solver/improver**,
durable call cap, transfer A/B/C và bộ chấm dựa trên human review. Người dùng đã
cho phép pilot giả lập tối đa 24 lần gọi Codex. Có model thật không đồng nghĩa có
corpus thực hoặc semantic acceptance. Mọi đầu ra BA vẫn DRAFT, không tự có BA
Review hoặc customer approval; chất lượng/hiệu quả học chờ đánh giá độc lập.

## 1. Môi trường đã cài

- Source: `https://github.com/google-research/harness2`.
- Revision: `1cfe254e8d25b15f37048c3730134686abe60335`.
- Checkout riêng: `/Users/thuannv/.local/share/ba-benchmarks/harness2`.
- Virtualenv: `.venv` trong checkout; Python 3.12.15, harness2 0.1.0 và extras `render`.
- Host: macOS Intel. Upstream hướng dẫn benchmark trên Linux/Python 3.12;
  demo chạy được trên macOS không xác nhận hỗ trợ đầy đủ các benchmark.
- Không thay `.env`, provider, database dự án BA hoặc mã runtime BA Studio.
- Không gọi external model hoặc Figma trong lần kiểm tra này.

Chạy lại demo bằng namespace mới để không chỉ resume kết quả đã hoàn tất:

```bash
cd /Users/thuannv/.local/share/ba-benchmarks/harness2
source .venv/bin/activate
harness2-demo --output runs/demo-new-experiment --k 2
```

Kết quả lần cài đặt nằm trong `runs/ba-studio-offline-demo/demo.json`:
2 tác vụ, 0 lỗi, 28 Python executions, 32 deterministic editor calls.
Cả parallel và sequential có 0 library entries trước tác vụ đầu và 1 entry
trước tác vụ thứ hai. Đây là synthetic demo với editor xác định, không phải
điểm semantic, kết quả model thật hay bằng chứng BA Studio đã biết học.

## 2. Harness² phù hợp ở đâu?

Harness² tối ưu hệ thống bao quanh model khi giữ nguyên trọng số: prompt,
memory, hướng dẫn tool, skills và các thành phần thực thi. Nó kết hợp
Propose–Probe–Compose trên tác vụ hiện tại với thư viện kinh nghiệm cho tác vụ sau.

CLI upstream chỉ chọn JobBench (`jb`), LAB (`lab`) và WorkBuddy (`wb`).
Chạy những benchmark đó với OpenCode/Codex không tự động đánh giá BA Studio.
Không có lệnh upstream `--bench ba-studio` trong revision đã kiểm tra.

Điểm nối phù hợp là protocol `BenchmarkAdapter` trong
`harness2/core/spec.py`, tham khảo adapter offline `harness2/demo.py`.
Cần adapter BA và cơ chế áp dụng candidate policy thực sự vào mỗi rollout;
chỉ lưu bài học ra file hoặc thêm prompt không được runtime đọc sẽ không đủ.
Runner offline đã có vòng lưu/đọc kinh nghiệm xuyên tác vụ bằng thư viện upstream.
Runtime BA Studio đang vận hành chưa được bổ sung cơ chế học hoặc thay policy.

## 3. Ba hướng triển khai

1. Chỉ dùng benchmark upstream: nhanh để nghiên cứu Harness², nhưng đo executor
   upstream thay vì ứng dụng BA Studio.
2. **Đề xuất:** adapter BA riêng, dùng core Harness² và runtime BA thật trong
   môi trường cô lập; giữ upstream ở revision cố định, tránh fork lớn.
3. Tự viết harness học/đánh giá hoàn toàn bằng Node: khớp runtime nhưng mất
   khả năng kiểm chứng trực tiếp thuật toán Harness² và tốn công tái triển khai.

## 4. Thiết kế đã duyệt (offline đã làm, live còn điều kiện)

### Phạm vi và dữ liệu

Giai đoạn đầu chỉ đo bước phân tích yêu cầu: canonical FR/NFR/BR/Q, nguồn dẫn,
unsupported claims và cách xử lý thiếu thông tin. Không tự duyệt BA Review,
không sinh thiết kế Figma hoặc giả lập customer sign-off.

Corpus thật phải đáp ứng `docs/LIVE_ACCEPTANCE.md`: 20–50 case được ẩn danh,
có quyền sử dụng/truyền dữ liệu, hai BA review độc lập và adjudication.
Chia tập theo nhóm dự án/khách hàng trước khi học để tránh brief gần trùng
lọt sang tập kiểm tra. Quy mô này chỉ phù hợp pilot; báo bất định khi mẫu nhỏ.

Gold, reviewer annotations và rubric nằm ngoài filesystem/context/network mà
solver hoặc improver truy cập được. Human gates vẫn giữ nguyên.
Synthetic fixtures chỉ kiểm tra tích hợp offline, không được dùng làm production acceptance.

### Đối chứng để đo khả năng học

| Nhánh | Sửa harness trong tác vụ | Kinh nghiệm từ tác vụ trước |
| --- | --- | --- |
| A: baseline BA | Không | Không |
| B: task-only | Có, ngân sách cố định | Không; reset mỗi tác vụ |
| C: experience | Giống B | Có, chỉ từ tác vụ đã đi trước |

So sánh B−A đo tác dụng thích nghi trong bài. C−B trên các bài mới đo thêm
giá trị của kinh nghiệm; C−A không đủ để quy kết toàn bộ cải thiện cho học.
Giữ model, sampling config, policy nền, corpus và task order tương ứng cố định;
B/C có cùng số lần probe và trần tài nguyên, ghi nhận cả chi phí improver.
A được báo như baseline thực tế cùng tổng chi phí, không gọi là đối chứng cân bằng compute.

Pilot gồm hai phép đo riêng:

- Online learning curve: C chỉ đọc kinh nghiệm từ các bài trước trong stream;
  đổi seed/task order qua nhiều lần chạy, reset library giữa các lần.
- Transfer: học trên train rồi đóng băng library, chạy B/C trên cùng held-out
  test với ngân sách task-level bằng nhau và cấm ghi lại kinh nghiệm test.
  Cần adapter riêng cho chế độ library chỉ đọc; CLI upstream không tự bảo đảm phép đo này.

Không dùng điểm gold/judge hoặc review held-out để propose, select, reflect
hay chọn phiên bản memory. Prompt/guardrail nền là bất biến; candidate chỉ
sửa các guidance slots được cho phép, không sửa validator, schema, workflow,
review gates, source provenance hoặc tiêu chí chấm.

### Tích hợp và cô lập

Adapter nhận corpus đã qua admission và gọi runtime phân tích BA thật với
candidate policy đã validate. Mỗi rollout dùng DATA_DIR riêng và project UUID
riêng nếu đi qua API lưu project. Không dùng dữ liệu khách hàng đang vận hành.
Nếu mở rộng sang workflow, dùng `/workflow/advance`, giữ nguyên các trạng thái
WAITING_CLARIFICATION/WAITING_BA_REVIEW và operator approval cho Figma.

Policy kinh nghiệm là analyst guidance chưa xác minh, không phải customer
evidence. Không đưa quotes/IDs của khách hàng trước thành yêu cầu cho khách hàng sau.
Memory cross-project chỉ chứa bài học đã ẩn danh và được phép chia sẻ;
giữ namespace theo experiment/arm/model/policy digest/domain/seed.

Lưu manifest gồm app/upstream revision, corpus/split/task-order hash, policy
và library digest, provider/model, sampling và recursion budget. Tách run dir
khi cấu hình thay đổi; không resume bằng một cấu hình khác. Failed attempts,
timeouts và thiếu usage phải được báo riêng; usage/cost thiếu là UNKNOWN.
Không sao chép giá mặc định `0.0` trong upstream `RunView` thành chi phí BA đã đo.
Không lưu prompt/customer text trong `ai_invocations`.

### Chỉ số và tiêu chí đánh giá

- FR/NFR recall và unsupported requirement ratio qua hai BA review và adjudication.
- Quote grounding, giữ ID/source và không tự vượt human gates là guardrails riêng.
- Paired C−B trên held-out, learning curve, sai lầm lặp lại và regression theo domain.
- Tổng invocation, latency, measured tokens/cost của solver + improver + judge;
  báo tỷ lệ lỗi và số case chưa chấm, không bỏ lỗi khỏi báo cáo một cách im lặng.
- Báo khoảng bất định theo đơn vị case/project và nhiều thứ tự chạy; chưa đặt
  ngưỡng hiệu quả học trước khi người dùng duyệt mục tiêu nghiên cứu.

Điểm deterministic quality không thay semantic review. Kết quả nghiên cứu học
không tự thỏa production acceptance; Figma read-back và human visual QA vẫn
phải làm riêng nếu tuyên bố nghiệm thu phạm vi đó.

## 5. Chạy benchmark upstream sau này

Trên Linux đã cài Python 3.12/uv, Node và dependencies theo upstream:

```bash
source .venv/bin/activate
harness2-setup jb --dry-run
```

Chỉ sau khi chọn provider/model, credentials và ngân sách, mới setup thật và
chạy model-backed commands. Không sao chép `.env` BA Studio sang checkout.
Đọc `docs/SETUP.md` và `docs/EXPERIMENTS.md` của upstream trước khi chạy.
Executor upstream có network unrestricted và Codex sandbox disabled;
benchmark cần host/container cô lập và egress policy chống lấy rubric/đáp án.

## 6. Chạy adapter BA offline

Tại thư mục BA Studio, với Node >=22.13 trên PATH:

```bash
npm run eval:harness2
npm run benchmark:harness2 -- \
  --output data/benchmarks/harness2/my-sequential-experiment \
  --mode sequential --k 2 --seed 42
npm run benchmark:harness2 -- \
  --output data/benchmarks/harness2/my-parallel-experiment \
  --mode parallel --k 2 --seed 42
```

Chọn output mới cho mỗi lượt. Runner từ chối thư mục đã tồn tại, không tự resume
hoặc ghi đè kết quả. Nếu ngắt giữa chừng, giữ namespace đó làm bằng chứng và dùng
namespace mới cho lượt tiếp theo. `report.json` chỉ có `completed=true` ở cuối;
snapshot dở dang có `status=RUNNING`. Lỗi case vẫn có row và làm lượt hoàn tất FAIL.
`--k` offline giới hạn 1–3; `--seed` điều khiển thứ tự fixture.

Launcher mặc định dùng virtualenv đã cài ở mục 1. Có thể chọn Python riêng:

```bash
HARNESS2_PYTHON=/absolute/path/to/harness2/.venv/bin/python npm run eval:harness2
```

Nếu chưa có môi trường:

```bash
git clone https://github.com/google-research/harness2 /absolute/path/to/harness2
cd /absolute/path/to/harness2
git checkout 1cfe254e8d25b15f37048c3730134686abe60335
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e '.[render]'
```

Giữ checkout offline này không có `.env`; adapter kiểm tra revision và từ chối
tracked source changes trong package `harness2`. Không sửa checkout benchmark
model-backed đang dùng để làm môi trường offline.

Mỗi lượt có 24 row: 4 synthetic cases × 3 arms × 2 protocols (online/transfer).
Transfer có 2 train và 2 test, tách group dự án; online shuffle cả 4 bài nên
không coi row test trong online là held-out. Chỉ test phase của transfer có
ý nghĩa kiểm tra cơ chế đóng băng memory. Protocol, arm và recursion mode có
namespace riêng; mỗi invocation của runner chỉ chọn một mode/k/seed.

Đọc các artifact sau:

- `manifest.json`: code/schema/policy/corpus/split/order hashes, revision, phiên
  bản runtime và cấu hình. Task order lưu công khai vì đây chỉ là synthetic IDs.
- `report.json`: trạng thái từng case/arm; solver/adaptation/selection/reflection
  counts; IDs thực sự đọc từ library; digest memory trước/sau; selected guidance
  và instruction hash; đường dẫn rollout đã chọn. `semanticScore`, `learningGain`,
  `tokens` và `costUsd` chưa đo đều là null/UNKNOWN. Không dùng cost `0.0` upstream.
- `<protocol>/<arm>/executions/<digest>/canonical.json`: canonical đầy đủ từ
  BA Studio; `result.json` kèm metadata và analysis. Improver chỉ nhận projection
  nội dung tác giả, không nhận `quality` hoặc semantic judgments.
- `<protocol>/C/library/<mode>/`: full adopted catalog trees + generic lessons
  được Harness² lưu; test phase của transfer dùng wrapper không ghi.

`OFFLINE_INTEGRATION_PASS` xác nhận các rollout và bất biến budget/memory của
runner; không phải điểm benchmark ngữ nghĩa hay production acceptance.
`npm run eval:harness2` có contract tests bổ sung cho invalid output, source trust,
policy invariants, stable IDs, history, frozen transfer, lỗi và interruption.

### Ranh giới triển khai

- `scripts/harness2/adapter.py` thực thi `BenchmarkAdapter`; dùng restricted
  OpenCode-format surface vì prompt builder upstream chỉ biết `opencode/codex`.
  Không khởi chạy OpenCode: proposer và solver đều là scripted test doubles.
- `scripts/harness2/ba-runtime.mjs` gọi các hàm BA hiện có, không gọi HTTP workflow,
  production `ai-provider`, database, server hoặc Figma. Chỉ nhận synthetic task
  IDs đã đăng ký; không có tùy chọn corpus/customer brief/live/provider.
- Guidance chỉ có hai catalog IDs; fixture solver bổ sung câu hỏi theo hướng dẫn
  được đưa vào prompt. Fixture proposer có quy tắc xác định để thử đường đọc memory.
  Khác biệt fixture không chứng minh agent tự khám phá hoặc học được bài học.
- B/C có cùng số solver/adaptation calls; C có reflection để lưu kinh nghiệm,
  được báo riêng. Không gọi tổng chi phí B/C là bằng nhau.
- Node child dùng environment allowlist, HOME/DATA_DIR tạm riêng và lệnh dạng
  argv, không shell. Không đọc `.env` BA Studio; không ghi `ai_invocations`.
  Đây là cô lập logic cho code tin cậy offline, **không phải OS sandbox**.
  Không chạy model/tool không tin cậy trong môi trường này.
- NFR/BR chưa có fixture nghiệp vụ phong phú, chưa có đánh giá ERP, human review,
  recall, unsupported ratio, learning curve thống kê hoặc CI uncertainty.
  Module chưa thay thế production provider path hay customer workflow gates.

## 7. Điều kiện benchmark dữ liệu thực

Adapter Codex đã áp dụng candidate policy vào model call và đưa output qua các
BA guards (mục 9). Để nghiên cứu dữ liệu thực vẫn cần corpus được duyệt, quyền
truyền dữ liệu và ngân sách riêng. Chạy lặp lại với nhiều thứ tự/case, hai BA review
và adjudication rồi mới đánh giá hiệu quả học. Linux/egress isolation là yêu cầu
cho benchmark upstream hoặc executor có tools; adapter BA hiện chỉ gửi JSON với
tools bị tắt, đã dùng trên macOS. Chưa có corpus thực hay semantic acceptance.

## 8. Kết quả kiểm tra triển khai offline

- `npm run eval:harness2`: 5 Node tests + 7 Python tests PASS.
- Sequential k=2/seed=42 và parallel k=2/seed=43: mỗi lượt 24 row OK,
  0 lỗi, B/C cùng solver/adaptation counts; thư viện train giữ nguyên trong test.
- Bằng chứng local (không đưa vào Git):
  `data/benchmarks/harness2/verified-{sequential,parallel}-k2-20261019/report.json`
  và `data/setup-evidence/harness2-implementation-20261019/verification.json`.
- `TMPDIR=/private/tmp npm test` và `npm run test:serial`: 242/243 PASS,
  cùng lỗi đã có trước thay đổi tại `tests/v37-clarification-recommendations.test.js:148`
  (`Missing expected exception`). Chưa đạt regression toàn bộ.
- Doctor, offline guardrail eval, quality, Figma contract, production và workspaces PASS.

Phase offline ngày 2026-10-19 không có external model calls; semantic quality
và learning gain chưa đo. Các con số regression trên thuộc revision offline.

## 9. Codex-backed benchmark

Đã tạo dữ liệu riêng, không đưa vào Git:

- `data/benchmarks/harness2/corpora-20261020/synthetic-pilot.json`: hai tình huống
  do agent viết, nhãn synthetic; 1 train / 1 test, nhóm dự án tách biệt.
- `data/benchmarks/harness2/corpora-20261020/real-corpus.UNAPPROVED.json`: mẫu 20
  case trống, provenance UNVERIFIED, dataUseApproved=false và annotation=draft.
  Không tự điền phê duyệt, reviewer, nguồn khách hàng hay Figma target.

Lệnh chuẩn bị corpus mới và kiểm tra không gọi model:

```bash
npm run benchmark:harness2:live -- prepare --dir /secure/new-corpus-directory
npm run benchmark:harness2:live -- preflight \
  --corpus data/benchmarks/harness2/corpora-20261020/synthetic-pilot.json \
  --synthetic-smoke
npm run eval:harness2:live
node --test tests/harness2-review.test.js
```

Reviewed mode không có `--synthetic-smoke`, tái sử dụng `validateCorpus` của live
acceptance (20–50 real-anonymized cases, data-use approval, hai BA/adjudication,
scoped Figma target). Cần thêm groupId/split train/test và sourceId/respondent/
sourceReference thật cho từng case. Adapter không gọi Figma; việc có target trong
admission không chứng minh read-back/visual QA. Synthetic và mẫu chưa duyệt đều
bị production preflight từ chối, không có tùy chọn hạ ngưỡng để qua gate.

Ví dụ chạy sau khi đã cho phép truyền dữ liệu và dành quota cho lượt mới:

```bash
npm run benchmark:harness2:live -- run \
  --corpus data/benchmarks/harness2/corpora-20261020/synthetic-pilot.json \
  --output /secure/new-codex-run \
  --synthetic-smoke --model gpt-6-sol --max-calls 24 \
  --confirm-external-processing
```

`--model` và `--max-calls` bắt buộc. Không đọc `.env` BA Studio hoặc dùng model mặc
định ngầm. Pilot chọn native Codex `gpt-6-sol` theo model trong wrapper BA hiện có;
reasoning effort=low được cố định và ghi trong manifest. Đây là cấu hình nghiên
cứu, không khẳng định giống mọi cấu hình production khác.

Live runner hiện giới hạn **k=1, sequential, train-C-then-test-ABC**:

| Công việc | Solver calls | Improver/reflection calls | Tổng |
| --- | ---: | ---: | ---: |
| C trên 1 case train | 4 | 3 + 1 | 8 |
| A trên 1 case test | 1 | 0 | 1 |
| B trên 1 case test | 4 | 3 | 7 |
| C trên 1 case test, library đóng băng | 4 | 3 | 7 |
| Pilot 1 train + 1 test | 13 | 10 | 23 |

Không train A/B vì mục tiêu là paired comparison trên held-out test. B/C có
cùng ngân sách test; chi phí học C được tính riêng. Reflection có thể trả [] nếu
không thấy bài học có căn cứ; không ép ghi memory để tạo kết quả tích cực.

`invocations.json` reserve trước khi gọi, lock/atomic write và cap bền vững.
Calls lỗi cũng chiếm ngân sách; failure dừng các calls tiếp theo. Interrupted
calls giữ IN_FLIGHT/UNKNOWN. Thư mục output phải mới; không tự replay hoặc resume.
Giới hạn là số lần gọi CLI Codex, không phải USD cap hay số HTTP retries nội bộ
của CLI. Giá thiếu là UNKNOWN; input/output tokens chỉ có khi CLI báo usage.

Mỗi model process dùng temp HOME/CODEX_HOME với bản sao auth.json 0600, không
có user config, skills cá nhân hoặc lịch sử từ case khác. Dùng `--ephemeral`,
read-only sandbox, tắt shell/apps/plugins/browser/computer/multi-agent/memory/
hooks/web và không cấu hình MCP. Unexpected tool events bị dừng. Auth tạm bị xóa;
không thay config/login của operator. Đây là cấu hình kiểm soát local CLI, không
phải chứng nhận độc lập về filesystem isolation hay provider data retention.

Solver chỉ nhận title/brief/solutionProfile đã admission; improver chỉ nhận
source, trajectory, authored outputs và catalog trees của context hiện hành.
Gold/rubric không đưa vào prompts. Guidance live có 8 procedural catalog IDs;
model đề xuất, so sánh rồi giữ subset. Library chỉ mang catalog IDs + generic
reflection, không giữ câu chữ khách hàng từ case trước. Đây là học cách chọn
guidance trong một không gian giới hạn, chưa phải tự tạo skill/script tùy ý.

Đầu ra đầy đủ chuyển sang `AWAITING_HUMAN_REVIEW`; không tự ghi semantic score.
`review-packet.json` chứa brief/gold/output nên phải giữ riêng tư. `reviewer-a.json`,
`reviewer-b.json`, `adjudicator.json` có reviewerId rỗng và verdict=PENDING.
Không dùng model tự điền các phiếu này thay cho review con người.

## 10. Chấm nghiên cứu sau human review

Sau khi hai BA review độc lập và người adjudicate hoàn tất các phiếu, chạy:

```bash
node scripts/harness2-review.mjs \
  --run-dir /secure/codex-run \
  --corpus /secure/reviewed-corpus.json \
  --review-a /secure/reviewer-a-completed.json \
  --review-b /secure/reviewer-b-completed.json \
  --adjudication /secure/adjudication-completed.json \
  --out /secure/new-research-report.json
```

Trong mỗi field functional/nonFunctional, dùng ID prediction từ phiếu; gold IDs
là FR-G1.. hoặc NFR-G1.. theo thứ tự expectedFunctional/expectedNfr của case.
`supported` cần matchedGoldIds và supportQuote thực sự trong brief; `unsupported`
cần note giải thích, không được map gold. Reviewer IDs/timestamp phải thật và
khớp quyền reviewer trong corpus thực. Ba danh tính phải khác nhau; các phiếu
phải khớp runHash của đúng file report.json, đủ mọi prediction ở cả ba arms.

Scorer tính human-adjudicated FR/NFR recall, unsupported ratio, hai BA agreement,
raw quote grounding và paired B−A / C−B. Deltas là trung bình chênh lệch recall
theo case; CI bootstrap theo project groups chỉ mang tính thăm dò, null khi có
dưới hai groups. Thiếu denominator trả null, không thay bằng 0.

Synthetic chỉ có thể ra `SYNTHETIC_REVIEWED_NOT_ACCEPTANCE`; corpus thực chỉ ra
`HUMAN_REVIEWED_RESEARCH_ONLY`. Luôn productionAccepted=false, customerApproved=false.
Không sửa production release thresholds hoặc thay thế Figma cross-check/visual QA.
Chưa có điểm semantic của pilot vì các phiếu human review vẫn chưa được điền.

## 11. Pilot Codex đã thực hiện ngày 2026-10-20

- `data/benchmarks/harness2/codex-pilot-20261020/report.json` ở trạng thái
  `AWAITING_HUMAN_REVIEW`: đủ 1 train/C và test/A/B/C, tất cả COMPLETED.
- Native Codex `gpt-6-sol`, effort=low: **23/24 CLI invocations**, 0 lỗi;
  13 solver, 9 propose/compose và 1 reflection. Không dùng lượt thứ 24.
- CLI báo tổng 368829 input tokens và 36483 output tokens. Đây là usage CLI
  báo, không phải giá quy đổi hoặc hóa đơn; costUsd vẫn null/UNKNOWN.
- C train giữ `trace-goals`; test B chọn `trace-goals`, test C chọn
  `atomic-fr` + `trace-goals`. Những lựa chọn này là model hypotheses, không
  tự chứng minh guidance tốt hơn hoặc làm thay đổi yêu cầu đã duyệt.
- Library train có entry khi test C chạy và digest trước/sau test giống nhau.
- `PILOT_SUMMARY.md` là bản đọc nhanh; số FR/NFR là mô tả đầu ra, không phải
  điểm accuracy. Không tự điền reviewer IDs hay verdicts còn PENDING.
- Production preflight đã thực sự từ chối cả synthetic-pilot và mẫu UNAPPROVED;
  scorer đã thực sự từ chối các phiếu review chưa hoàn tất.

`execution-source.tar.gz` và `execution-source-snapshot.json` giữ đúng source/hash
đã dùng cho pilot. Sau pilot có hardening bổ sung: custom output validation (ID
trùng/không thuộc adopted tree) diễn ra trước khi ledger đánh dấu COMPLETED, để
block core retries sau output sai. Thay đổi này được test bằng fake subprocess/core,
không gọi thêm model. Hash runtime hiện hành khác hash pilot được giải thích bằng
snapshot này, không giả vờ chúng giống nhau.

Kiểm tra cuối: 6 Node + 1 Python live contracts, 2 research-review tests và 12
offline adapter contracts PASS. Full/serial Node suite mỗi lượt 250/251 PASS,
chỉ còn lỗi recommendation đã tồn tại tại
`tests/v37-clarification-recommendations.test.js:148`. Quality, Figma contract,
production, workspaces và offline guardrail eval PASS. Log trong
`data/setup-evidence/harness2-live-20261020/`; chưa đạt regression toàn bộ.

Pilot chỉ dùng dữ liệu hư cấu đã được cho phép. Cần case thực ẩn danh, provenance,
hai BA review độc lập và adjudication trước khi đo semantic learning trên hệ thống.

## Nguồn

- https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/README.md
- https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/SETUP.md
- https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/EXPERIMENTS.md
- https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/spec.py
- `docs/ARCHITECTURE.md`, `docs/LIVE_ACCEPTANCE.md`.
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/config-file/config-reference
