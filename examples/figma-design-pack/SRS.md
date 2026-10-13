# SRS — Software Requirements Specification: Cổng tiếp nhận và xử lý bảo hành

> Trạng thái: BẢN THẢO — yêu cầu BA xác nhận trước khi nghiệm thu.
> Phiên bản dự án: 2 • Tạo ngày 2026-10-13
> Nguồn: Cổng tiếp nhận và xử lý bảo hành / yêu cầu nhập trực tiếp và ghi chú review.
> Chế độ: DEMO (không phân tích AI)

## 1. Mục tiêu và ranh giới hệ thống
Xây dựng cổng đăng ký, xử lý và thống kê yêu cầu bảo hành máy lọc nước.

## 2. Đối tượng sử dụng
| Vai trò | Nhu cầu |
| --- | --- |
| Khách hàng | Đăng ký bảo hành |
| Nhân viên trạm | Xử lý yêu cầu |
| Quản trị viên | Xem thống kê |

## 3. Yêu cầu chức năng
### FR-001 — Đăng ký bảo hành
- **Mô tả:** Khách hàng nhập số seri và số điện thoại để đăng ký bảo hành.
- **Tác nhân:** Khách hàng
- **Ưu tiên:** Must
- **Mức xác thực:** Có bằng chứng trong brief
- **Bằng chứng:** Khách hàng có thể đăng ký bảo hành bằng số seri và số điện thoại.
- **Mục tiêu liên kết:** Tiếp nhận yêu cầu bảo hành
- **Prototype:** SCR-001 (Đăng ký bảo hành)

**Tiền điều kiện**
- TBD

**Luồng chính (mục chưa được khách hàng xác nhận vẫn chỉ là đề xuất)**
- Mở form đăng ký
- Nhập số seri và số điện thoại
- Gửi yêu cầu (cần xác nhận quy tắc kiểm tra và phản hồi)

**Luồng ngoại lệ**
- TBD

**Tiêu chí nghiệm thu đề xuất**
- Cho phép nhập số seri và số điện thoại
- Cần xác nhận kết quả xử lý khi gửi form

### FR-002 — Xử lý yêu cầu
- **Mô tả:** Nhân viên trạm xem danh sách và cập nhật trạng thái.
- **Tác nhân:** Nhân viên trạm
- **Ưu tiên:** Must
- **Mức xác thực:** Có bằng chứng trong brief
- **Bằng chứng:** Nhân viên trạm bảo hành xem danh sách yêu cầu, cập nhật trạng thái 'Tiếp nhận', 'Đang xử lý', 'Hoàn thành'.
- **Mục tiêu liên kết:** Quản lý quá trình xử lý bảo hành
- **Prototype:** SCR-002 (Danh sách bảo hành)

**Tiền điều kiện**
- TBD

**Luồng chính (mục chưa được khách hàng xác nhận vẫn chỉ là đề xuất)**
- Mở danh sách yêu cầu
- Chọn một yêu cầu
- Cập nhật trạng thái

**Luồng ngoại lệ**
- TBD

**Tiêu chí nghiệm thu đề xuất**
- Danh sách hiển thị yêu cầu
- Hỗ trợ ba trạng thái đã nêu

### FR-003 — Thống kê trạng thái
- **Mô tả:** Quản trị viên xem báo cáo số phiếu theo trạng thái.
- **Tác nhân:** Quản trị viên
- **Ưu tiên:** Must
- **Mức xác thực:** Có bằng chứng trong brief
- **Bằng chứng:** Quản trị viên xem báo cáo số phiếu theo trạng thái.
- **Mục tiêu liên kết:** Theo dõi số phiếu theo trạng thái
- **Prototype:** SCR-003 (Báo cáo)

**Tiền điều kiện**
- TBD

**Luồng chính (mục chưa được khách hàng xác nhận vẫn chỉ là đề xuất)**
- Mở trang báo cáo
- Xem số phiếu theo từng trạng thái

**Luồng ngoại lệ**
- TBD

**Tiêu chí nghiệm thu đề xuất**
- Báo cáo nhóm phiếu theo trạng thái


## 4. Yêu cầu phi chức năng
| ID | Nhóm | Mô tả | Chỉ tiêu đo | Mức xác thực |
| --- | --- | --- | --- | --- |

## 5. Quy tắc nghiệp vụ
| ID | Quy tắc | Nguồn |
| --- | --- | --- |
| BR-001 | Phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên. | Hệ thống phải phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên. |

## 6. Ma trận truy vết BRD → SRS → Prototype
| FR ID | Business goal | Trạng thái nguồn | Màn hình |
| --- | --- | --- | --- |
| FR-001 | Tiếp nhận yêu cầu bảo hành | Có bằng chứng trong brief | SCR-001 |
| FR-002 | Quản lý quá trình xử lý bảo hành | Có bằng chứng trong brief | SCR-002 |
| FR-003 | Theo dõi số phiếu theo trạng thái | Có bằng chứng trong brief | SCR-003 |

## 7. Giao diện tích hợp, dữ liệu, bảo mật
Chưa có đặc tả kỹ thuật được xác nhận. Cần làm rõ tích hợp, dữ liệu, phân quyền chi tiết, quyền riêng tư và NFR trước triển khai.

## 8. Vấn đề mở
| ID | Ưu tiên | Câu hỏi | Tác động |
| --- | --- | --- | --- |
| Q-001 | High | Xác thực người dùng và kiểm tra phân quyền bằng cơ chế nào? | Ảnh hưởng bảo mật và luồng đăng nhập |
| Q-002 | High | Số seri trùng lặp, không hợp lệ hoặc hết hạn bảo hành thì xử lý thế nào? | Ảnh hưởng business rules và validation |
| Q-003 | High | Các trạng thái có được quay lui và ai được chuyển trạng thái? | Ảnh hưởng transition/permission |
| Q-004 | Medium | Báo cáo cần bộ lọc thời gian, trạm và xuất file không? | Ảnh hưởng phạm vi báo cáo |

## 9. Ghi chú review
BA review only

## 10. Điều kiện bàn giao
Tài liệu mang tính draft. Cần phê duyệt nghiệp vụ và hoàn thành các điểm mở trước khi baseline SRS.


## Quality Gate
Chưa chạy bộ kiểm tra chất lượng.
