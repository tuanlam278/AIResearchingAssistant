import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("GOOGLE_API_KEY", "test-google-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.groq_service import (
    _build_quiz_prompt,
    _normalize_question,
    _normalize_quiz_questions,
)


CHOICES = [
    {"key": "A", "text": "Lựa chọn 1"},
    {"key": "B", "text": "Lựa chọn 2"},
    {"key": "C", "text": "Lựa chọn 3"},
    {"key": "D", "text": "Lựa chọn 4"},
]


def make_question(answer):
    return {
        "type": "multiple_choice",
        "question": "Nội dung câu hỏi?",
        "choices": CHOICES,
        "answer": answer,
        "explanation": "Giải thích vì sao đúng.",
        "choice_explanations": {"A": "A đúng"},
    }


@pytest.mark.parametrize(
    ("raw_answer", "expected"),
    [
        ("A", "A"),
        ("a", "A"),
        ("A. Nội dung đáp án", "A"),
        ("B: Nội dung đáp án", "B"),
        ("C) Nội dung đáp án", "C"),
        ("D Nội dung đáp án", "D"),
    ],
)
def test_normalize_multiple_choice_answer_variants(raw_answer, expected):
    question = _normalize_question(make_question(raw_answer), 0)

    assert question is not None
    assert question["answer"] == expected


def test_normalize_quiz_gracefully_returns_less_than_expected_count():
    payload = {
        "questions": [
            make_question("A"),
            make_question("B: Nội dung đáp án"),
            make_question("C) Nội dung đáp án"),
        ]
    }

    questions = _normalize_quiz_questions(payload, expected_count=5)

    assert len(questions) == 3
    assert [question["answer"] for question in questions] == ["A", "B", "C"]


def test_normalize_quiz_still_raises_when_no_questions_are_usable():
    with pytest.raises(ValueError, match="any usable questions"):
        _normalize_quiz_questions({"questions": [make_question("Option A")]}, expected_count=5)


def test_quiz_prompt_contains_required_json_schema():
    prompt = _build_quiz_prompt("Nội dung tài liệu", 5, "multiple_choice")

    assert "CHÚ Ý ĐỊNH DẠNG" in prompt
    assert '"questions": [' in prompt
    assert '"type": "multiple_choice"' in prompt
    assert '"choices": [{"key": "A", "text": "Lựa chọn 1"}' in prompt
    assert '"answer": "A"' in prompt
    assert "không dùng Markdown" in prompt
    assert "Nội dung tài liệu" in prompt
