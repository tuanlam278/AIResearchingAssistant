# Hướng dẫn cấu hình Global Web Chat API

Global Web Chat là tab **Web** trong Academic Lens. Frontend đã có hàm gọi `POST /api/academic-lens/web-chat`, nhưng backend hiện đang trả `501 WEB_SEARCH_NOT_CONFIGURED` để nhắc rằng bạn cần đấu nối một Web Search API thật trước khi dùng tính năng này.

## 1. Luồng hiện tại trong source code

1. Frontend lấy base URL backend từ `VITE_API_URL` và tạo một `axiosInstance` dùng chung cho toàn bộ API.
2. Khi người dùng chat ở tab Web, UI gọi `api.webAcademicLensChat({ message }, token)`.
3. Hàm này gửi request `POST /api/academic-lens/web-chat` kèm Bearer token.
4. Backend đã mount router Academic Lens tại prefix `/api/academic-lens`.
5. Endpoint `/web-chat` hiện là placeholder và trả lỗi `WEB_SEARCH_NOT_CONFIGURED`.

Vì vậy, cấu hình biến môi trường frontend/backend là chưa đủ; bạn cần bổ sung provider tìm kiếm web ở backend.

## 2. Cấu hình `.env` tối thiểu

### Frontend: `frontend/.env`

```env
VITE_API_URL=http://localhost:8000
VITE_MAX_UPLOAD_MB=50
VITE_GOOGLE_CLIENT_ID=<google-oauth-client-id-neu-dung-login-google>
```

Nếu deploy production, đổi `VITE_API_URL` thành URL public của FastAPI, ví dụ:

```env
VITE_API_URL=https://api.example.com
```

### Backend: `backend/.env`

Giữ các biến bắt buộc hiện có, đặc biệt là Supabase/auth/LLM:

```env
GOOGLE_API_KEY=<google-ai-studio-key>
VISION_MODEL=gemini-3.1-flash-lite
GROQ_API_KEY=<groq-key>
GROQ_FLASHCARD_MODEL=llama-3.1-8b-instant
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<anon-key>
JWT_SECRET_KEY=<random-secret-manh>
CORS_ORIGINS=["http://localhost:5173"]
```

Sau đó thêm nhóm biến riêng cho Web Search provider, ví dụ nếu dùng Tavily:

```env
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=<tavily-api-key>
WEB_SEARCH_MAX_RESULTS=5
```

Hoặc nếu dùng SerpAPI/Bing/Brave, vẫn nên giữ tên biến chung tương tự để dễ đổi provider:

```env
WEB_SEARCH_PROVIDER=serpapi
WEB_SEARCH_API_KEY=<provider-api-key>
WEB_SEARCH_MAX_RESULTS=5
```

> Không commit key thật. Chỉ commit `.env.example` hoặc tài liệu hướng dẫn.

## 3. Thêm biến vào `backend/app/config.py`

Thêm các field vào class `Settings`:

```python
WEB_SEARCH_PROVIDER: str = ""
WEB_SEARCH_API_KEY: str = ""
WEB_SEARCH_MAX_RESULTS: int = 5
```

Nếu muốn validate chặt hơn, có thể giới hạn provider trong service thay vì trong settings để tránh làm app fail khi chưa bật Global Web Chat.

## 4. Tạo service tìm kiếm web

Nên tạo file mới `backend/app/services/web_search_service.py` để tách logic provider khỏi router. Service nên trả về dữ liệu đã chuẩn hóa:

```python
from dataclasses import dataclass

from app.config import settings


@dataclass
class WebSearchResult:
    title: str
    url: str
    snippet: str = ""
    content: str = ""


def is_web_search_configured() -> bool:
    return bool(settings.WEB_SEARCH_PROVIDER and settings.WEB_SEARCH_API_KEY)


async def search_web(query: str, max_results: int | None = None) -> list[WebSearchResult]:
    if not is_web_search_configured():
        raise RuntimeError("WEB_SEARCH_NOT_CONFIGURED")

    limit = max_results or settings.WEB_SEARCH_MAX_RESULTS
    provider = settings.WEB_SEARCH_PROVIDER.lower().strip()

    if provider == "tavily":
        # Gọi Tavily/HTTP client tại đây và map response về WebSearchResult.
        raise NotImplementedError("Implement Tavily client")

    raise RuntimeError("UNSUPPORTED_WEB_SEARCH_PROVIDER")
```

Khi triển khai thật, thêm thư viện HTTP async như `httpx` vào `backend/requirements.txt`, rồi gọi API provider trong `search_web()`.

## 5. Thay placeholder `/web-chat` bằng logic thật

Trong `backend/app/routers/academic_lens.py`, thay endpoint hiện tại bằng flow:

1. Kiểm tra Web Search đã cấu hình.
2. Gọi `search_web(body.message)`.
3. Ghép title/snippet/content/url thành context.
4. Gọi LLM đang dùng trong project (`client.chat.completions.create`, `GROQ_MODEL`).
5. Trả `answer` và `citations` để frontend hiển thị nguồn.

Ví dụ khung xử lý:

```python
@router.post("/web-chat", response_model=dict)
async def web_chat(body: WebChatRequest, user: dict = Depends(get_current_user)):
    _ = user
    if not is_web_search_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "WEB_SEARCH_NOT_CONFIGURED", "message": "Global Web Chat cần cấu hình Web Search API."},
        )

    results = await search_web(body.message)
    context = "\n\n".join(
        f"[{idx}] {item.title}\nURL: {item.url}\nSnippet: {item.snippet}\nContent: {item.content}"
        for idx, item in enumerate(results, start=1)
    )

    response = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": "Bạn là Global Web Chat. Trả lời dựa trên kết quả web đã cung cấp và trích dẫn nguồn bằng [1], [2].",
            },
            {"role": "user", "content": f"Kết quả web:\n{context}\n\nCâu hỏi: {body.message}"},
        ],
        temperature=0.2,
    )

    return {
        "success": True,
        "data": {
            "answer": response.choices[0].message.content or "",
            "citations": [{"title": r.title, "url": r.url} for r in results],
        },
    }
```

## 6. Cấu hình CORS khi chạy từ trình duyệt

Backend chỉ cho phép các origin trong `CORS_ORIGINS`. Local mặc định là:

```env
CORS_ORIGINS=["http://localhost:5173"]
```

Production nên khai báo đúng domain frontend:

```env
CORS_ORIGINS=["https://app.example.com"]
```

Nếu có nhiều domain:

```env
CORS_ORIGINS=["http://localhost:5173", "https://app.example.com"]
```

## 7. Kiểm thử nhanh

Sau khi implement service/provider, chạy backend và frontend rồi kiểm thử:

```bash
# Backend
cd backend
uvicorn app.main:app --reload

# Frontend
cd frontend
npm run dev
```

Gọi API trực tiếp bằng curl, thay `<token>` bằng JWT thật sau khi login:

```bash
curl -X POST http://localhost:8000/api/academic-lens/web-chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Find recent papers about retrieval augmented generation evaluation"}'
```

Kết quả mong muốn:

```json
{
  "success": true,
  "data": {
    "answer": "...",
    "citations": [{ "title": "...", "url": "https://..." }]
  }
}
```

Nếu vẫn nhận `WEB_SEARCH_NOT_CONFIGURED`, hãy kiểm tra lại `WEB_SEARCH_PROVIDER`, `WEB_SEARCH_API_KEY`, restart backend và đảm bảo `backend/.env` nằm đúng thư mục chạy `uvicorn`.
