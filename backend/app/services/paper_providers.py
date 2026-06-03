"""Paper internet search providers with normalized results.

Google Scholar is intentionally not scraped. Providers should use APIs or permitted
metadata endpoints and return the common shape consumed by Library UI.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


PEER_REVIEWED_TYPES = {"article", "journal-article", "review", "book-chapter"}


def _inverted_abstract_to_text(value: dict[str, list[int]] | None) -> str:
    if not value:
        return ""
    positions: list[tuple[int, str]] = []
    for word, indexes in value.items():
        for index in indexes or []:
            positions.append((int(index), word))
    return " ".join(word for _, word in sorted(positions))


def _has_code(locations: list[dict[str, Any]], concepts: list[dict[str, Any]]) -> bool:
    haystack = " ".join(
        [str(item.get("landing_page_url") or "") for item in locations or []]
        + [str(item.get("display_name") or "") for item in concepts or []]
    ).lower()
    return any(token in haystack for token in ["github", "gitlab", "software", "code", "repository"])


def _has_data(locations: list[dict[str, Any]], concepts: list[dict[str, Any]]) -> bool:
    haystack = " ".join(
        [str(item.get("landing_page_url") or "") for item in locations or []]
        + [str(item.get("display_name") or "") for item in concepts or []]
    ).lower()
    return any(token in haystack for token in ["dataset", "data", "zenodo", "figshare", "dryad", "osf"])


def _summary_from_abstract(abstract: str, max_chars: int = 320) -> str:
    text = " ".join(str(abstract or "").split())
    if not text:
        return ""
    sentences = []
    for part in text.replace("? ", "?. ").replace("! ", "!. ").split(". "):
        cleaned = part.strip()
        if cleaned:
            sentences.append(cleaned if cleaned.endswith((".", "?", "!")) else f"{cleaned}.")
        if len(" ".join(sentences)) >= max_chars or len(sentences) >= 2:
            break
    summary = " ".join(sentences) or text
    return summary if len(summary) <= max_chars else f"{summary[:max_chars].rsplit(' ', 1)[0]}…"


def _display_names(items: list[dict[str, Any]], limit: int = 8) -> list[str]:
    names: list[str] = []
    for item in items or []:
        name = item.get("display_name") or item.get("name")
        if name and name not in names:
            names.append(str(name))
        if len(names) >= limit:
            break
    return names


class PaperProvider(ABC):
    source: str

    @abstractmethod
    def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        """Return normalized paper results."""


class OpenAlexProvider(PaperProvider):
    source = "OpenAlex"
    base_url = "https://api.openalex.org/works"

    def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        params = urlencode({"search": query, "per-page": max(1, min(limit, 50)), "sort": "relevance_score:desc"})
        request = Request(f"{self.base_url}?{params}", headers={"User-Agent": "AIResearchingAssistant/1.0 (mailto:research@example.com)"})
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            logger.exception("OpenAlex search failed")
            raise RuntimeError("Không thể tìm kiếm paper từ OpenAlex lúc này.") from exc
        return [self._normalize_work(work) for work in payload.get("results") or []]

    def _normalize_work(self, work: dict[str, Any]) -> dict[str, Any]:
        locations = work.get("locations") or []
        best_oa = work.get("best_oa_location") or {}
        primary = work.get("primary_location") or {}
        oa_pdf = best_oa.get("pdf_url") or primary.get("pdf_url")
        url = work.get("doi") or work.get("id") or primary.get("landing_page_url")
        work_type = str(work.get("type") or "").lower()
        is_oa = bool((work.get("open_access") or {}).get("is_oa") or oa_pdf)
        authorships = work.get("authorships") or []
        authors = [((a.get("author") or {}).get("display_name")) for a in authorships]
        authors = [name for name in authors if name]
        concepts = work.get("concepts") or []
        topics = work.get("topics") or []
        keywords = work.get("keywords") or []
        abstract = _inverted_abstract_to_text(work.get("abstract_inverted_index"))
        concept_names = _display_names(concepts, 10)
        topic_names = _display_names(topics, 10)
        keyword_names = _display_names(keywords, 10)
        tags = []
        for name in [*topic_names, *concept_names, *keyword_names]:
            if name and name not in tags:
                tags.append(name)
        venue = ((primary.get("source") or {}).get("display_name") or (work.get("host_venue") or {}).get("display_name") or "")
        openalex_url = work.get("id")
        landing_page_url = primary.get("landing_page_url") or best_oa.get("landing_page_url") or url
        doi = str(work.get("doi") or "").replace("https://doi.org/", "") or None
        normalized = {
            "id": str(work.get("id") or "").rsplit("/", 1)[-1],
            "source": self.source,
            "externalId": str(work.get("id") or "").rsplit("/", 1)[-1],
            "title": work.get("title") or work.get("display_name") or "Untitled paper",
            "authors": authors,
            "year": work.get("publication_year"),
            "publication_date": work.get("publication_date"),
            "venue": venue,
            "doi": doi,
            "openalex_url": openalex_url,
            "landing_page_url": landing_page_url,
            "pdf_url": oa_pdf,
            "abstract": abstract,
            "summary": _summary_from_abstract(abstract),
            "tags": tags[:8],
            "concepts": concept_names,
            "keywords": keyword_names,
            "citation_count": int(work.get("cited_by_count") or 0),
            "type": work.get("type") or "unknown",
            "is_open_access": is_oa,
            "peer_review_status": "PEER_REVIEWED" if work_type in PEER_REVIEWED_TYPES else ("PREPRINT" if work_type == "preprint" else "UNKNOWN"),
            "has_pdf": bool(oa_pdf),
            "has_code": _has_code(locations, concepts),
            "has_data": _has_data(locations, concepts),
            "access_type": "OPEN_ACCESS" if is_oa else "UNKNOWN",
            "review_type": "REVIEW" if "review" in work_type else ("RESEARCH_ARTICLE" if work_type in PEER_REVIEWED_TYPES else "UNKNOWN"),
        }
        # Backwards-compatible aliases for existing frontend/import code.
        normalized.update({
            "url": landing_page_url or openalex_url,
            "pdfUrl": oa_pdf,
            "citationCount": normalized["citation_count"],
            "isOpenAccess": is_oa,
            "peerReviewStatus": normalized["peer_review_status"],
            "hasPdf": normalized["has_pdf"],
            "hasCode": normalized["has_code"],
            "hasData": normalized["has_data"],
            "accessType": normalized["access_type"],
            "reviewType": normalized["review_type"],
        })
        return normalized


def get_paper_provider(source: str = "openalex") -> PaperProvider:
    normalized = str(source or "openalex").lower()
    if normalized != "openalex":
        raise ValueError("Provider chưa được hỗ trợ")
    return OpenAlexProvider()
