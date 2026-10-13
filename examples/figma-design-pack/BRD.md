# BRD — Business Requirements Document: Cổng tiếp nhận và xử lý bảo hành

> Trạng thái: BẢN THẢO — yêu cầu BA xác nhận trước khi nghiệm thu.
> Phiên bản dự án: 2 • Tạo ngày 2026-10-13
> Nguồn: Cổng tiếp nhận và xử lý bảo hành / yêu cầu nhập trực tiếp và ghi chú review.
> Chế độ: DEMO (không phân tích AI)

## 1. Tổng quan và bối cảnh
Xây dựng cổng đăng ký, xử lý và thống kê yêu cầu bảo hành máy lọc nước.

## 2. Vấn đề kinh doanh
Chưa được nêu rõ trong brief — cần xác nhận pain point và KPI.

## 3. Mục tiêu kinh doanh
- Tiếp nhận yêu cầu bảo hành
- Quản lý quá trình xử lý bảo hành
- Theo dõi số phiếu theo trạng thái

## 4. Stakeholder
| Vai trò | Nhu cầu |
| --- | --- |
| Khách hàng | Đăng ký bảo hành |
| Nhân viên trạm | Xử lý yêu cầu |
| Quản trị viên | Xem thống kê |

## 5. Phạm vi
### Trong phạm vi
- Đăng ký bảo hành
- Theo dõi và cập nhật trạng thái yêu cầu
- Báo cáo số phiếu theo trạng thái
- Phân quyền theo vai trò

### Ngoài phạm vi (chỉ khi đã nêu rõ)
- Chưa được thống nhất

## 6. Business Rules
| ID | Quy tắc | Mức xác thực | Bằng chứng |
| --- | --- | --- | --- |
| BR-001 | Phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên. | Có bằng chứng trong brief | Hệ thống phải phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên. |

## 7. Danh mục nhu cầu/chức năng
| ID | Tên | Vai trò | Ưu tiên | Mục tiêu | Mức xác thực |
| --- | --- | --- | --- | --- | --- |
| FR-001 | Đăng ký bảo hành | Khách hàng | Must | Tiếp nhận yêu cầu bảo hành | Có bằng chứng trong brief |
| FR-002 | Xử lý yêu cầu | Nhân viên trạm | Must | Quản lý quá trình xử lý bảo hành | Có bằng chứng trong brief |
| FR-003 | Thống kê trạng thái | Quản trị viên | Must | Theo dõi số phiếu theo trạng thái | Có bằng chứng trong brief |

## 8. Giả định
- Luồng gửi biểu mẫu, kiểm tra dữ liệu và thông báo kết quả chưa được khách hàng mô tả.

## 9. Rủi ro
- Chưa có quy tắc trạng thái, kiểm tra số seri và cơ chế xác thực.

## 10. Open Questions
| ID | Ưu tiên | Câu hỏi | Tác động |
| --- | --- | --- | --- |
| Q-001 | High | Xác thực người dùng và kiểm tra phân quyền bằng cơ chế nào? | Ảnh hưởng bảo mật và luồng đăng nhập |
| Q-002 | High | Số seri trùng lặp, không hợp lệ hoặc hết hạn bảo hành thì xử lý thế nào? | Ảnh hưởng business rules và validation |
| Q-003 | High | Các trạng thái có được quay lui và ai được chuyển trạng thái? | Ảnh hưởng transition/permission |
| Q-004 | Medium | Báo cáo cần bộ lọc thời gian, trạm và xuất file không? | Ảnh hưởng phạm vi báo cáo |

## 11. Ghi chú BA Review
BA review only

## 12. Trạng thái phê duyệt
Đã được BA đánh dấu rà soát vào 2026-10-13T04:00:00.000Z; không đồng nghĩa khách hàng ký duyệt.


## Quality Gate
Chưa chạy bộ kiểm tra chất lượng.
