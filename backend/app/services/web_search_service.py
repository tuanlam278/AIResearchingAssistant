from dataclasses import dataclass
from app.config import settings
import httpx # Dùng cho Tavily

@dataclass
class WebSearchResult:
    title: str
    url: str
    snippet: str = ""
    content: str = ""

def is_web_search_configured() -> bool:
    provider = settings.WEB_SEARCH_PROVIDER.lower().strip()
    if provider == "duckduckgo":
        return True # DuckDuckGo không cần API Key
    return bool(provider and settings.WEB_SEARCH_API_KEY)

async def search_web(query: str, max_results: int | None = None) -> list[WebSearchResult]:
    if not is_web_search_configured():
        raise RuntimeError("WEB_SEARCH_NOT_CONFIGURED")

    limit = max_results or settings.WEB_SEARCH_MAX_RESULTS
    provider = settings.WEB_SEARCH_PROVIDER.lower().strip()

    # Tích hợp DuckDuckGo (Miễn phí)
    if provider == "duckduckgo":
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            # Lấy kết quả text cơ bản
            ddgs_results = ddgs.text(query, max_results=limit)
            for r in ddgs_results:
                results.append(WebSearchResult(
                    title=r.get("title", ""),
                    url=r.get("href", ""),
                    snippet=r.get("body", "")
                ))
        return results

    # Tích hợp Tavily (Cần API Key)
    if provider == "tavily":
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": settings.WEB_SEARCH_API_KEY,
                    "query": query,
                    "max_results": limit,
                    "search_depth": "basic"
                }
            )
            response.raise_for_status()
            data = response.json()
            return [
                WebSearchResult(
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("content", "")
                ) for r in data.get("results", [])
            ]

    raise RuntimeError("UNSUPPORTED_WEB_SEARCH_PROVIDER")