import json
import logging
from typing import Any, List

from groq import AsyncGroq

from app.config import settings

logger = logging.getLogger(__name__)


def _client() -> AsyncGroq:
    api_key = (settings.GROQ_API_KEY or "").strip()
    if not api_key or api_key.startswith("your_"):
        raise RuntimeError("Thiếu GROQ_API_KEY hoặc không thể tạo nội dung học tập.")
    return AsyncGroq(api_key=api_key)


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def _normalize_flashcards(value: Any) -> list[dict[str, str]]:
    cards = value.get("flashcards") if isinstance(value, dict) else value
    if not isinstance(cards, list):
        raise ValueError("Groq response does not contain a flashcards array")
    normalized: list[dict[str, str]] = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        front = str(card.get("front") or "").strip()
        back = str(card.get("back") or "").strip()
        if front and back:
            normalized.append({"front": front, "back": back})
    if not normalized:
        raise ValueError("Groq response did not include usable flashcards")
    return normalized


async def generate_flashcards_from_context(context: str, count: int = 5) -> list[dict[str, str]]:
    if not context.strip():
        raise ValueError("Không có nội dung tài liệu để tạo flashcards.")

    safe_count = max(1, min(int(count or 5), 20))
    prompt = (
        "Tạo flashcards học tập từ ngữ cảnh tài liệu nghiên cứu bên dưới. "
        "Mỗi flashcard phải có front là câu hỏi/khái niệm và back là câu trả lời/giải thích ngắn gọn. "
        "Chỉ trả về JSON hợp lệ, không Markdown, không giải thích ngoài JSON. "
        f"Schema: {{\"flashcards\":[{{\"front\":\"...\",\"back\":\"...\"}}]}}. Số lượng: {safe_count}.\n\n"
        f"Ngữ cảnh:\n{context[:14000]}"
    )
    try:
        response = await _client().chat.completions.create(
            model=settings.GROQ_FLASHCARD_MODEL,
            messages=[
                {"role": "system", "content": "Bạn là trợ lý tạo flashcards. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or ""
        return _normalize_flashcards(_extract_json(raw))[:safe_count]
    except RuntimeError:
        raise
    except Exception as exc:
        logger.exception("Groq flashcard generation failed")
        raise RuntimeError("Thiếu GROQ_API_KEY hoặc không thể tạo flashcards.") from exc


VALID_QUESTION_TYPES = {"multiple_choice", "true_false", "fill_blank", "essay"}


def _as_str(value: Any) -> str:
    return str(value or "").strip()


def _normalize_choice(choice: Any, fallback_key: str) -> dict[str, str] | None:
    if isinstance(choice, dict):
        key = _as_str(choice.get("key") or fallback_key)
        text = _as_str(choice.get("text") or choice.get("label") or choice.get("value"))
    else:
        key = fallback_key
        text = _as_str(choice)
    if not key or not text:
        return None
    return {"key": key, "text": text}


def _normalize_question(value: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    q_type = _as_str(value.get("type") or "multiple_choice")
    if q_type == "short_answer":
        q_type = "essay"
    if q_type not in VALID_QUESTION_TYPES:
        return None

    question = _as_str(value.get("question"))
    explanation = _as_str(value.get("explanation"))
    if not question or not explanation:
        return None

    normalized: dict[str, Any] = {
        "id": _as_str(value.get("id")) or f"q-{index + 1}",
        "type": q_type,
        "question": question,
        "explanation": explanation,
        "citations": value.get("citations") if isinstance(value.get("citations"), list) else [],
    }

    if q_type == "multiple_choice":
        raw_choices = value.get("choices") if isinstance(value.get("choices"), list) else []
        choices = [_normalize_choice(choice, chr(65 + idx)) for idx, choice in enumerate(raw_choices[:4])]
        choices = [choice for choice in choices if choice]
        if len(choices) != 4:
            return None
        valid_keys = {choice["key"] for choice in choices}
        answer = _as_str(value.get("answer")).strip()
        if answer:
            answer = answer.strip().upper()
            if answer not in valid_keys:
                first = answer[0]
                second = answer[1:2]
                if first in valid_keys and (len(answer) == 1 or second in {".", ":", ")", "]", "-", " "}):
                    answer = first
        if answer not in valid_keys:
            return None
        normalized.update({
            "choices": choices,
            "answer": answer,
            "choice_explanations": value.get("choice_explanations") if isinstance(value.get("choice_explanations"), dict) else {},
        })
    elif q_type == "true_false":
        normalized.update({
            "choices": [{"key": "True", "text": "Đúng"}, {"key": "False", "text": "Sai"}],
            "answer": "True" if str(value.get("answer")).lower() in {"true", "đúng", "dung"} else "False",
            "choice_explanations": value.get("choice_explanations") if isinstance(value.get("choice_explanations"), dict) else {},
        })
    elif q_type == "fill_blank":
        blank_answer = _as_str(value.get("blank_answer") or value.get("answer"))
        acceptable = value.get("acceptable_answers") if isinstance(value.get("acceptable_answers"), list) else []
        acceptable = [_as_str(item) for item in acceptable if _as_str(item)]
        if blank_answer and blank_answer not in acceptable:
            acceptable.insert(0, blank_answer)
        if not blank_answer or not acceptable:
            return None
        normalized.update({"blank_answer": blank_answer, "acceptable_answers": acceptable})
    else:
        sample_answer = _as_str(value.get("sample_answer") or value.get("answer"))
        rubric = value.get("rubric") if isinstance(value.get("rubric"), list) else []
        rubric = [_as_str(item) for item in rubric if _as_str(item)]
        if not sample_answer or not rubric:
            return None
        normalized.update({"sample_answer": sample_answer, "rubric": rubric})
    return normalized


def _normalize_quiz_questions(value: Any, expected_count: int | None = None) -> list[dict[str, Any]]:
    questions = value.get("questions") if isinstance(value, dict) else value
    if not isinstance(questions, list):
        raise ValueError("Groq response does not contain a questions array")
    normalized = []
    for idx, item in enumerate(questions):
        question = _normalize_question(item, idx)
        if question:
            normalized.append(question)
    if not normalized:
        raise ValueError("Groq response did not include any usable questions")
    return normalized[:expected_count] if expected_count else normalized


def _build_quiz_prompt(context: str, safe_count: int, allowed: str) -> str:
    return (
        "Tạo bộ câu hỏi quiz từ ngữ cảnh tài liệu bên dưới. Không bịa ngoài tài liệu/RAG. "
        f"Số lượng câu hỏi cần tạo: {safe_count}. Loại câu hỏi: {allowed}. "
        "Output phải là JSON object hợp lệ. Root key bắt buộc là \"questions\" và questions phải là array. "
        "Mỗi question phải có type, question, choices, answer, explanation. "
        "Với multiple_choice, choices phải có đúng 4 lựa chọn key A/B/C/D và answer chỉ là \"A\", \"B\", \"C\" hoặc \"D\"; không trả dạng \"A. Nội dung đáp án\". "
        "Với true_false, choices là True/False và answer là True hoặc False. "
        "Không trả Markdown, không bọc code fence, không thêm bất kỳ text nào ngoài JSON.\n\n"
        "CHÚ Ý ĐỊNH DẠNG: Bạn CHỈ ĐƯỢC PHÉP trả về JSON hợp lệ theo đúng cấu trúc mẫu sau (không dùng Markdown):\n"
        "{\n"
        "  \"questions\": [\n"
        "    {\n"
        "      \"type\": \"multiple_choice\",\n"
        "      \"question\": \"Nội dung câu hỏi?\",\n"
        "      \"choices\": [{\"key\": \"A\", \"text\": \"Lựa chọn 1\"}, {\"key\": \"B\", \"text\": \"Lựa chọn 2\"}, {\"key\": \"C\", \"text\": \"Lựa chọn 3\"}, {\"key\": \"D\", \"text\": \"Lựa chọn 4\"}],\n"
        "      \"answer\": \"A\",\n"
        "      \"explanation\": \"Giải thích vì sao đúng...\",\n"
        "      \"choice_explanations\": {\"A\": \"Giải thích A...\", \"B\": \"Giải thích B...\"}\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        f"Ngữ cảnh:\n{context[:14000]}"
    )


async def generate_quiz_from_context(context: str, count: int = 3, question_type: str = "mixed") -> list[dict[str, Any]]:
    if not context.strip():
        raise ValueError("Không có nội dung tài liệu để tạo quiz.")
    safe_count = max(1, min(int(count or 1), 5))
    allowed = "multiple_choice và true_false" if question_type == "mixed" else question_type
    prompt = _build_quiz_prompt(context, safe_count, allowed)
    try:
        response = await _client().chat.completions.create(
            model=settings.GROQ_FLASHCARD_MODEL,
            messages=[
                {"role": "system", "content": "Bạn là trợ lý tạo quiz dựa trên RAG. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or ""
        return _normalize_quiz_questions(_extract_json(raw), safe_count)
    except RuntimeError:
        raise
    except Exception as exc:
        logger.exception("Groq quiz generation failed")
        raise RuntimeError("Thiếu GROQ_API_KEY hoặc không thể tạo quiz/test.") from exc


async def generate_test_from_context(context: str, count: int = 10) -> dict[str, Any]:
    if not context.strip():
        raise ValueError("Không có nội dung tài liệu để tạo bài kiểm tra.")
    if int(count or 10) != 10:
        raise ValueError("Bài kiểm tra phải có đúng 10 câu hỏi.")
    prompt = (
        "Tạo bài kiểm tra đúng 10 câu từ ngữ cảnh tài liệu bên dưới. Không bịa ngoài tài liệu. "
        "Phân bổ bắt buộc: 4 multiple_choice, 2 true_false, 2 fill_blank, 2 essay. "
        "Mỗi câu phải có id, type, question, explanation, citations array. "
        "multiple_choice có 4 choices A/B/C/D, answer, choice_explanations. "
        "true_false có answer True/False và choice_explanations. "
        "fill_blank có blank_answer và acceptable_answers. "
        "essay có sample_answer và rubric. "
        "Chỉ trả về JSON hợp lệ theo schema {\"test\":{\"title\":\"Bài kiểm tra từ tài liệu đã chọn\",\"questions\":[...]}}; không Markdown.\n\n"
        f"Ngữ cảnh:\n{context[:16000]}"
    )
    try:
        response = await _client().chat.completions.create(
            model=settings.GROQ_FLASHCARD_MODEL,
            messages=[
                {"role": "system", "content": "Bạn là trợ lý tạo bài kiểm tra dựa trên RAG. Output JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or ""
        data = _extract_json(raw)
        test = data.get("test") if isinstance(data, dict) and isinstance(data.get("test"), dict) else data
        questions = _normalize_quiz_questions(test.get("questions") if isinstance(test, dict) else data, 10)
        types = {question["type"] for question in questions}
        if not {"multiple_choice", "true_false", "fill_blank", "essay"}.issubset(types):
            raise ValueError("Bài kiểm tra chưa đủ các dạng câu hỏi")
        return {"id": _as_str(test.get("id") if isinstance(test, dict) else "") or "rag-test-10", "title": _as_str(test.get("title") if isinstance(test, dict) else "") or "Bài kiểm tra từ tài liệu đã chọn", "questions": questions}
    except RuntimeError:
        raise
    except Exception as exc:
        logger.exception("Groq test generation failed")
        raise RuntimeError("Thiếu GROQ_API_KEY hoặc không thể tạo quiz/test.") from exc
