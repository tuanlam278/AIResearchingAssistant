# System Library Import Guide

Tài liệu hệ thống là tài liệu do admin import qua trang `/admin`. Người dùng thường chỉ xem/tìm/lọc/tải xuống/ghim và đưa tài liệu sang Không gian Nghiên cứu; không upload trực tiếp vào Thư viện Hệ thống.

## Luồng import admin

1. Admin đăng nhập (dev local có thể dùng `admin` / `admin` nếu chưa seed admin thật).
2. Frontend gọi `POST /api/admin/system-library/import` bằng bearer token của admin.
3. Backend kiểm tra `user.role === 'admin'`.
4. Backend parse PDF/DOCX/TXT/MD, chunk nội dung, tạo embedding, gọi LLM sinh metadata:
   - `category`
   - `tags`
   - `summary` 1–2 câu
5. Metadata lưu vào `system_documents`, chunks/vector lưu vào `system_document_chunks`.

Nếu LLM metadata lỗi nhưng parse/chunk thành công, import vẫn tiếp tục với fallback `category = "Khác"`, `tags = []`, `summary = ""`.

## Schema chính

Xem `docs/sql/complete_schema.sql` để tạo/cập nhật:

- `users.role` (`user` hoặc `admin`) nếu dự án dùng bảng `users`.
- `system_documents`.
- `system_document_chunks`.
- `system_document_bookmarks`.
- `documents.source_type/source_id` để link tài liệu hệ thống vào notebook.

Các field plan cũ như `access_level`, `is_vip`, `is_pro`, `required_plan` nếu đã tồn tại chỉ là deprecated compatibility và không còn được API/UI sử dụng.

## API chính

- `POST /api/admin/system-library/import` — admin import tài liệu hệ thống.
- `GET /api/admin/system-library/documents` — admin xem danh sách import.
- `DELETE /api/admin/system-library/documents/{document_id}` — admin xoá tài liệu và chunks liên quan.
- `GET /api/system-library/documents` / `POST /api/system-library/search` — user xem/tìm/lọc.
- `POST /api/system-library/documents/{document_id}/bookmark` — user ghim.
- `POST /api/notebooks/{notebook_id}/system-documents` — link tài liệu hệ thống vào Không gian Nghiên cứu để RAG/chat/so sánh tại notebook.
