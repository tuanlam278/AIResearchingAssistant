import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

const LOADING_LABELS = {
  reading: "Đang đọc tài liệu...",
  retrieving: "Đang tìm đoạn liên quan...",
  generating: "Đang tạo câu trả lời...",
};

const OUT_OF_SCOPE_WARNING = "Nội dung câu hỏi của bạn đi xa ra khỏi mức của tài liệu, nên nội dung sau có thể đúng hoặc sai.";

const FALLBACK_SUGGESTED_PROMPTS = [
  "Tóm tắt ý chính của tài liệu này",
  "Giải thích thuật ngữ quan trọng trong tài liệu",
  "Tạo câu hỏi ôn tập từ nội dung trên",
];

const QUICK_ACTIONS = [
  { id: "compare", icon: "⇄", label: "So sánh tài liệu", requiresTwo: true, prompt: "Hãy so sánh các tài liệu đã chọn. Trình bày điểm giống nhau, khác nhau, phương pháp nghiên cứu, kết quả chính, đóng góp và hạn chế của từng tài liệu." },
  { id: "main_points", icon: "☑", label: "Trình bày ý chính", prompt: "Hãy trình bày các ý chính của tài liệu đã chọn theo dạng bullet rõ ràng, dễ hiểu." },
  { id: "terms", icon: "?", label: "Giải thích thuật ngữ khó", prompt: "Hãy tìm và giải thích các thuật ngữ học thuật khó trong tài liệu đã chọn bằng ngôn ngữ dễ hiểu." },
  { id: "quiz_prompt", icon: "❔", label: "Tạo câu hỏi ôn tập", prompt: "Hãy tạo 1 -> 2 câu hỏi ôn tập từ tài liệu đã chọn, kèm đáp án ngắn." },
  { id: "claims", icon: "❞", label: "Trích xuất luận điểm chính", prompt: "Hãy trích xuất các luận điểm chính, bằng chứng hỗ trợ và kết luận từ tài liệu đã chọn." },
  { id: "outline", icon: "☷", label: "Tạo dàn ý nghiên cứu", prompt: "Hãy tạo một dàn ý nghiên cứu dựa trên tài liệu đã chọn, gồm các mục lớn, ý phụ và gợi ý triển khai." },
  { id: "next_questions", icon: "✦", label: "Gợi ý câu hỏi tiếp theo", prompt: "Dựa trên các tài liệu đã chọn và cuộc trò chuyện hiện tại, hãy gợi ý các câu hỏi tiếp theo mà người dùng nên hỏi để hiểu sâu hơn nội dung nghiên cứu." },
  { id: "quiz", icon: "☑", label: "Tạo trắc nghiệm", special: "quiz" },
  { id: "test", icon: "📝", label: "Tạo bài kiểm tra", special: "test" },
  { id: "flashcards", icon: "▣", label: "Flashcard", special: "flashcards" },
];

const isAbortError = (err) => err?.name === "AbortError" || err?.code === "ABORT_ERR";

function normalizeSuggestedPrompts(prompts = []) {
  const source = Array.isArray(prompts) && prompts.length ? prompts : FALLBACK_SUGGESTED_PROMPTS;
  return source
    .map((prompt) => String(prompt || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((prompt, index, arr) => arr.indexOf(prompt) === index)
    .slice(0, 3)
    .map((prompt) => (prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt));
}

function hasWarningInContent(content = "") {
  return String(content || "").trimStart().startsWith(OUT_OF_SCOPE_WARNING);
}

function parseDownloadFilename(contentDisposition = "") {
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {}
  }
  const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] || `research-chat-${new Date().toISOString().slice(0, 10)}.docx`;
}

function getCitationIndex(source, index) {
  return source?.citation_index || source?.index || index + 1;
}

function normalizeSources(rawSources = []) {
  return rawSources.map((source, index) => {
    const citationIndex = getCitationIndex(source, index);
    return {
      ...source,
      citation_index: citationIndex,
      id: source.id || source.chunk_id || source.citation_id || `${citationIndex}`,
      chunk_id: source.chunk_id || source.id || source.citation_id,
      document_id: source.document_id || source.doc_id,
      document_title:
        source.document_title ||
        source.title ||
        source.source_name ||
        source.filename ||
        `Tài liệu ${citationIndex}`,
      page_start: source.page_start ?? source.page ?? source.page_number,
      page_end: source.page_end ?? source.page ?? source.page_number,
      snippet: source.snippet || source.summary || source.content || "",
      score: source.score ?? source.relevance,
    };
  });
}

function formatCitationPage(citation = {}) {
  const page = citation.page_start ?? citation.page ?? citation.page_number;
  const pageEnd = citation.page_end;
  if (!page) return "Không rõ trang";
  return pageEnd && pageEnd !== page ? `Trang ${page}-${pageEnd}` : `Trang ${page}`;
}

function formatCitationConfidence(citation = {}) {
  const rawScore = citation.score ?? citation.confidence ?? citation.relevance;
  const numericScore = typeof rawScore === "number" ? rawScore : Number(rawScore);
  if (!Number.isFinite(numericScore)) return "Độ tin cậy chưa có";
  const percent = numericScore >= 0 && numericScore <= 1 ? numericScore * 100 : numericScore;
  return `Độ tin cậy ${Math.round(percent)}%`;
}

function citationTooltip(citation) {
  return [
    citation.document_title || "Tài liệu",
    formatCitationPage(citation),
    formatCitationConfidence(citation),
  ].join(" · ");
}

function CitationHoverCard({ citation }) {
  const snippet = citation.snippet || citation.summary || citation.content || "";

  return (
    <span className="rp-citation-wrap">
      <button
        type="button"
        className="rp-citation-badge"
        aria-label={`Nguồn ${citation.citation_index}: ${citationTooltip(citation)}`}
      >
        [{citation.citation_index}]
      </button>
      <span className="rp-citation-popover" role="tooltip">
        <strong>{citation.document_title || "Tài liệu"}</strong>
        <span className="rp-citation-popover-meta">
          <span>{formatCitationPage(citation)}</span>
          <span>{formatCitationConfidence(citation)}</span>
        </span>
        {snippet && <span className="rp-citation-snippet">{snippet}</span>}
      </span>
    </span>
  );
}


function MarkdownContent({ content = "", citations = [] }) {
  const citationMap = useMemo(
    () => new Map(citations.map((citation) => [String(citation.citation_index), citation])),
    [citations]
  );
  const markdown = useMemo(
    () => (content || "").replace(/\[(\d+)\]/g, (match, value) => (citationMap.has(String(value)) ? `[${match}](citation:${value})` : match)),
    [content, citationMap]
  );

  return (
    <ReactMarkdown
      className="rp-markdown"
      skipHtml
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith("citation:")) {
            const key = href.replace("citation:", "");
            const citation = citationMap.get(key);
            if (citation) return <CitationHoverCard citation={citation} />;
          }
          return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function AnswerWithCitations({ content, citations = [], warning = null }) {
  const hasInlineCitation = /\[(\d+)\]/.test(content || "");
  const shouldShowWarning = warning && !hasWarningInContent(content);

  return (
    <>
      {shouldShowWarning && <div className="rp-rag-warning" role="note">⚠ {warning}</div>}
      <MarkdownContent content={content || ""} citations={citations} />
      {!hasInlineCitation && citations.length > 0 && (
        <span className="rp-citation-footer">
          Nguồn:{" "}
          {citations.map((citation) => (
            <CitationHoverCard
              key={citation.citation_index}
              citation={citation}
            />
          ))}
        </span>
      )}
    </>
  );
}

function generateNoteTitle(content = "") {
  const words = content.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length < 3) return "Ghi chú mới";
  const title = words.slice(0, 10).join(" ");
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function formatNoteTime(value) {
  if (!value) return "Vừa cập nhật";
  try {
    return new Date(value).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Vừa cập nhật";
  }
}

function CitationDetail({ citation, onClose }) {
  if (!citation) return null;

  const page = citation.page_start || citation.page;
  const pageEnd = citation.page_end;
  const score = citation.score ?? citation.relevance;
  const scoreText = typeof score === "number" ? `${Math.round(score <= 1 ? score * 100 : score)}%` : null;
  const snippet = citation.snippet || citation.summary || citation.content;

  return (
    <div className="rp-citation-detail">
      <div className="rp-citation-detail-head">
        <span>Nguồn [{citation.citation_index}]</span>
        <button type="button" onClick={onClose} aria-label="Đóng nguồn trích dẫn">×</button>
      </div>
      <div className="rp-citation-detail-title">{citation.document_title || "Tài liệu"}</div>
      <div className="rp-citation-detail-meta">
        {page && <span>tr. {pageEnd && pageEnd !== page ? `${page}-${pageEnd}` : page}</span>}
        {scoreText && <span>{scoreText}</span>}
      </div>
      {snippet && <p>{snippet}</p>}
    </div>
  );
}

function getFlashcardsFromNote(note) {
  const fromMetadata = note?.metadata?.flashcards;
  if (Array.isArray(fromMetadata)) return fromMetadata;
  try {
    const parsed = JSON.parse(note?.content || "{}");
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.flashcards)) return parsed.flashcards;
  } catch {}
  return [];
}


function getQuizFromNote(note) {
  const quiz = note?.metadata?.quiz;
  if (quiz?.questions) return quiz;
  const questions = note?.metadata?.questions;
  if (Array.isArray(questions)) return { title: note?.title || "Bộ câu hỏi trắc nghiệm", questions };
  return null;
}

function getTestFromNote(note) {
  const test = note?.metadata?.test;
  if (test?.questions) return test;
  return null;
}

function normalizeAnswerText(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function buildFlashcardMarkdown(cards = []) {
  return cards.map((card, index) => `### Flashcard ${index + 1}\n\n**Front:** ${card.front}\n\n**Back:** ${card.back}`).join("\n\n---\n\n");
}

function buildQuizMarkdown(quizOrQuestions, title = "Bộ câu hỏi trắc nghiệm") {
  const questions = Array.isArray(quizOrQuestions) ? quizOrQuestions : quizOrQuestions?.questions || [];
  return [`# ${title}`, ...questions.map((q, index) => {
    const answer = q.answer || q.blank_answer || q.sample_answer || "Xem rubric";
    return `## Câu ${index + 1}: ${q.question}\n\nLoại: ${q.type}\n\nĐáp án: ${answer}\n\nGiải thích: ${q.explanation || ""}`;
  })].join("\n\n");
}

function QuickActionsSidebar({
  actions,
  selectedDocumentIds,
  loading,
  onAction,
  flashcardCount,
  onFlashcardCountChange,
  quizCount,
  onQuizCountChange,
  quizType,
  onQuizTypeChange,
}) {
  const renderQuickCount = ({ value, onChange, label, helper }) => (
    <div className="rp-quick-config" onClick={(e) => e.stopPropagation()}>
      <div className="rp-quick-config-row">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <input
        type="range"
        min="0"
        max="5"
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <small>{value === 0 ? "Chọn ít nhất 1 mục để tạo." : helper}</small>
    </div>
  );

  return (
    <aside className="rp-actions-col">
      <div className="rp-notes-header">
        <div>
          <div className="rp-notes-title">Tính năng nhanh</div>
          <p className="rp-notes-subtitle">Chạy prompt nhanh trên tài liệu đã chọn.</p>
        </div>
      </div>
      {!selectedDocumentIds.length && (
        <div className="rp-action-helper">Chọn tài liệu để sử dụng tính năng nhanh.</div>
      )}
      <div className="rp-actions-list rp-app-scrollbar">
        {actions.map((action) => {
          const quickCount = action.special === "flashcards" ? flashcardCount : action.special === "quiz" ? quizCount : 1;
          const disabled = !selectedDocumentIds.length || (action.requiresTwo && selectedDocumentIds.length < 2) || loading || ((action.special === "flashcards" || action.special === "quiz") && quickCount === 0);
          return (
            <div key={action.id} className="rp-action-wrap">
              <button
                type="button"
                className="rp-action-card"
                disabled={disabled}
                title={action.requiresTwo && selectedDocumentIds.length < 2 ? "Cần chọn ít nhất 2 tài liệu để so sánh." : action.label}
                onClick={() => onAction(action)}
              >
                <span className="rp-action-icon">{action.icon}</span>
                <span>{action.label}</span>
              </button>
              {action.special === "flashcards" && renderQuickCount({ value: flashcardCount, onChange: onFlashcardCountChange, label: "Số flashcard", helper: "Tối đa 5 flashcards cho chế độ tạo nhanh." })}
              {action.special === "quiz" && (
                <div className="rp-quick-config" onClick={(e) => e.stopPropagation()}>
                  <label>
                    Dạng câu hỏi
                    <select value={quizType} onChange={(e) => onQuizTypeChange(e.target.value)}>
                      <option value="mixed">Mixed</option>
                      <option value="multiple_choice">A/B/C/D</option>
                      <option value="true_false">True/False</option>
                    </select>
                  </label>
                  {renderQuickCount({ value: quizCount, onChange: onQuizCountChange, label: "Số câu", helper: "Tối đa 5 câu cho quiz nhanh." })}
                </div>
              )}
              {action.special === "test" && <small className="rp-action-subnote">Tạo đúng 10 câu phối hợp nhiều dạng.</small>}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function FlashcardModal({ flashcards, title = "Flashcards", warning = null, onClose, onSave, saving = false, onGenerateMore, generatingMore = false }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = Array.isArray(flashcards) ? flashcards : [];
  const card = cards[index] || {};

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!cards.length) return null;
  const goTo = (next) => { setIndex(next); setFlipped(false); };

  return (
    <div className="rp-modal-overlay" onClick={onClose}>
      <div className="rp-flashcard-modal rp-app-scrollbar" onClick={(e) => e.stopPropagation()}>
        <div className="rp-note-modal-head">
          <div>
            <div className="rp-note-modal-kicker">Flashcard</div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="rp-note-modal-close" onClick={onClose} aria-label="Đóng flashcards">×</button>
        </div>
        {warning && <div className="rp-rag-warning flashcard" role="note">⚠ {warning}</div>}
        <div className={`rp-flashcard ${flipped ? "flipped" : ""}`}>
          <div className="rp-flashcard-side-label">{flipped ? "Back" : "Front"}</div>
          <p>{flipped ? card.back : card.front}</p>
        </div>
        <div className="rp-flashcard-controls">
          <button type="button" onClick={() => goTo(Math.max(0, index - 1))} disabled={index === 0}>← Trước</button>
          <button type="button" onClick={() => setFlipped((value) => !value)}>Lật thẻ</button>
          <button type="button" onClick={() => goTo(Math.min(cards.length - 1, index + 1))} disabled={index === cards.length - 1}>Tiếp →</button>
        </div>
        <div className="rp-flashcard-footer">
          <span>{index + 1}/{cards.length}</span>
          <div className="rp-flashcard-footer-actions">
            {onGenerateMore && <button type="button" className="rp-note-cancel" onClick={onGenerateMore} disabled={generatingMore || cards.length >= 5}>{cards.length >= 5 ? "Đã đạt tối đa 5 mục" : generatingMore ? "Đang tạo..." : "Tạo thêm flashcard"}</button>}
            {onSave && <button type="button" className="rp-note-save" onClick={onSave} disabled={saving}>{saving ? "Đang lưu..." : "Lưu vào ghi chú"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}


function QuizModal({ mode = "quiz", quiz, title, warning = null, onClose, onSave, saving = false, onGenerateMore, generatingMore = false }) {
  const questions = Array.isArray(quiz) ? quiz : quiz?.questions || [];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState({});
  const [showAll, setShowAll] = useState(false);
  const current = questions[index] || {};
  const currentAnswer = answers[current.id] ?? "";
  const isChecked = Boolean(checked[current.id]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!questions.length) return null;

  const setAnswer = (value) => setAnswers((prev) => ({ ...prev, [current.id]: value }));
  const checkCurrent = () => setChecked((prev) => ({ ...prev, [current.id]: true }));
  const isObjective = ["multiple_choice", "true_false"].includes(current.type);
  const isFillBlank = current.type === "fill_blank";
  const correct = isObjective
    ? currentAnswer === current.answer
    : isFillBlank
      ? (current.acceptable_answers || [current.blank_answer]).map(normalizeAnswerText).includes(normalizeAnswerText(currentAnswer))
      : null;

  const renderAnswerArea = () => {
    if (isObjective) {
      return (
        <div className="rp-quiz-choices">
          {(current.choices || []).map((choice) => {
            const isCorrectChoice = isChecked && choice.key === current.answer;
            const isWrongChoice = isChecked && currentAnswer === choice.key && choice.key !== current.answer;
            return (
              <button
                type="button"
                key={choice.key}
                className={`rp-quiz-choice ${currentAnswer === choice.key ? "selected" : ""} ${isCorrectChoice ? "correct" : ""} ${isWrongChoice ? "wrong" : ""}`}
                onClick={() => !isChecked && setAnswer(choice.key)}
              >
                <strong>{choice.key}</strong><span>{choice.text}</span>
              </button>
            );
          })}
        </div>
      );
    }
    if (isFillBlank) {
      return <input className="rp-quiz-input" value={currentAnswer} onChange={(e) => setAnswer(e.target.value)} disabled={isChecked} placeholder="Nhập đáp án của bạn..." />;
    }
    return <textarea className="rp-quiz-input textarea" value={currentAnswer} onChange={(e) => setAnswer(e.target.value)} placeholder="Nhập câu trả lời tự luận..." rows={5} />;
  };

  const renderFeedback = () => {
    if (!isChecked && !showAll) return null;
    return (
      <div className="rp-quiz-feedback">
        {current.type === "essay" ? (
          <>
            <strong>Câu trả lời tham khảo</strong>
            <p>{current.sample_answer}</p>
            {Array.isArray(current.rubric) && current.rubric.length > 0 && <ul>{current.rubric.map((item, i) => <li key={i}>{item}</li>)}</ul>}
          </>
        ) : (
          <>
            <strong className={correct ? "ok" : "bad"}>{correct ? "Đúng" : "Chưa đúng"}</strong>
            <p>Đáp án đúng: <b>{current.answer || current.blank_answer}</b></p>
          </>
        )}
        <small className="rp-quiz-explanation">{current.explanation}</small>
        {current.choice_explanations && Object.keys(current.choice_explanations).length > 0 && (
          <div className="rp-choice-explanations">
            {Object.entries(current.choice_explanations).map(([key, text]) => <small key={key}><b>{key}:</b> {text}</small>)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rp-modal-overlay" onClick={onClose}>
      <div className="rp-quiz-modal rp-app-scrollbar" onClick={(e) => e.stopPropagation()}>
        <div className="rp-note-modal-head">
          <div>
            <div className="rp-note-modal-kicker">{mode === "test" ? "Bài kiểm tra" : "Quiz"}</div>
            <h2>{title || quiz?.title || (mode === "test" ? "Bài kiểm tra từ tài liệu" : "Bộ câu hỏi trắc nghiệm")}</h2>
          </div>
          <button type="button" className="rp-note-modal-close" onClick={onClose} aria-label="Đóng quiz">×</button>
        </div>
        {warning && <div className="rp-rag-warning flashcard" role="note">⚠ {warning}</div>}
        <div className="rp-quiz-progress">Câu {index + 1}/{questions.length} · {current.type}</div>
        <div className="rp-quiz-question">{current.question}</div>
        {renderAnswerArea()}
        <div className="rp-quiz-actions">
          <button type="button" className="rp-note-save" onClick={checkCurrent} disabled={isChecked || (!currentAnswer && current.type !== "essay")}>{current.type === "essay" ? "Xem gợi ý đáp án" : "Kiểm tra"}</button>
          {mode === "test" && <button type="button" className="rp-note-cancel" onClick={() => setShowAll(true)}>Xem toàn bộ đáp án</button>}
        </div>
        {renderFeedback()}
        <div className="rp-flashcard-controls">
          <button type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>← Câu trước</button>
          <button type="button" onClick={() => setIndex(Math.min(questions.length - 1, index + 1))} disabled={index === questions.length - 1}>Câu tiếp theo →</button>
        </div>
        <div className="rp-flashcard-footer">
          <span>{index + 1}/{questions.length}</span>
          <div className="rp-flashcard-footer-actions">
            {onGenerateMore && <button type="button" className="rp-note-cancel" onClick={onGenerateMore} disabled={generatingMore || questions.length >= 5}>{questions.length >= 5 ? "Đã đạt tối đa 5 mục" : generatingMore ? "Đang tạo..." : "Tạo thêm câu hỏi"}</button>}
            {onSave && <button type="button" className="rp-note-save" onClick={onSave} disabled={saving}>{saving ? "Đang lưu..." : mode === "test" ? "Lưu bài kiểm tra vào ghi chú" : "Lưu vào ghi chú"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function NotesPanel({
  notes,
  loadingNotes,
  activeCitation,
  editingNoteId,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteNote,
  onCloseCitation,
  selectedNote,
  noteDetailMode,
  noteDetailDraft,
  onOpenNote,
  onCloseNote,
  onStartDetailEdit,
  onNoteDetailDraftChange,
  onSaveDetailEdit,
}) {
  return (
    <div className="rp-notes-col">
      <div className="rp-notes-header">
        <div>
          <div className="rp-notes-title">Ghi chú</div>
          <p className="rp-notes-subtitle">Lưu các câu trả lời quan trọng từ Chat.</p>
        </div>
        {notes.length > 0 && <span className="rp-notes-count">{notes.length}</span>}
      </div>

      <div className="rp-notes-body rp-app-scrollbar">
        <CitationDetail citation={activeCitation} onClose={onCloseCitation} />

        {loadingNotes ? (
          <div className="rp-notes-empty">Đang tải ghi chú...</div>
        ) : notes.length === 0 ? (
          <div className="rp-notes-empty">
            <strong>Chưa có ghi chú nào.</strong>
            <span>Bấm “Lưu vào ghi chú” ở một câu trả lời để lưu lại.</span>
          </div>
        ) : (
          notes.map((note) => {
            const citationCount = Array.isArray(note.citations) ? note.citations.length : 0;
            const isEditing = editingNoteId === note.id;

            return (
              <div key={note.id} className="rp-note-card" role="button" tabIndex={0} onClick={() => onOpenNote(note)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenNote(note); }}>
                <button
                  type="button"
                  className="rp-note-delete"
                  aria-label="Xoá ghi chú"
                  title="Xoá ghi chú"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteNote(note.id);
                  }}
                >
                  ×
                </button>

                {isEditing ? (
                  <div className="rp-note-edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={editDraft.title}
                      onChange={(e) => onEditDraftChange({ ...editDraft, title: e.target.value })}
                      placeholder="Tiêu đề ghi chú"
                    />
                    <textarea
                      value={editDraft.content}
                      onChange={(e) => onEditDraftChange({ ...editDraft, content: e.target.value })}
                      rows={7}
                      placeholder="Nội dung ghi chú"
                    />
                    <div className="rp-note-edit-actions">
                      <button type="button" className="rp-note-cancel" onClick={onCancelEdit}>Huỷ</button>
                      <button type="button" className="rp-note-save" onClick={() => onSaveEdit(note.id)}>Lưu</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rp-note-head">
                      <h3>{note.title || "Ghi chú mới"}</h3>
                      <button
                        type="button"
                        className="rp-note-edit-btn"
                        aria-label="Chỉnh sửa ghi chú"
                        title="Chỉnh sửa ghi chú"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartEdit(note);
                        }}
                      >
                        ✎
                      </button>
                    </div>
                    <p className="rp-note-preview">{note.content}</p>
                    <div className="rp-note-meta">
                      <span>{formatNoteTime(note.updated_at || note.created_at)}</span>
                      {citationCount > 0 && <span>{citationCount} nguồn</span>}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {selectedNote && (
        <div className="rp-modal-overlay rp-note-modal-overlay" onClick={onCloseNote}>
          <div className="rp-note-modal rp-app-scrollbar" onClick={(e) => e.stopPropagation()}>
            <div className="rp-note-modal-head">
              <div>
                <div className="rp-note-modal-kicker">Chi tiết ghi chú</div>
                {noteDetailMode === 'edit' ? (
                  <input
                    className="rp-note-modal-title-input"
                    value={noteDetailDraft.title}
                    onChange={(e) => onNoteDetailDraftChange({ ...noteDetailDraft, title: e.target.value })}
                    placeholder="Tiêu đề ghi chú"
                  />
                ) : (
                  <h2>{selectedNote.title || 'Ghi chú mới'}</h2>
                )}
              </div>
              <div className="rp-note-modal-actions">
                {noteDetailMode !== 'edit' && (
                  <>
                    <button type="button" className="rp-note-modal-icon" onClick={onStartDetailEdit} aria-label="Chỉnh sửa ghi chú" title="Chỉnh sửa ghi chú">✎</button>
                    <button type="button" className="rp-note-modal-icon danger" onClick={() => onDeleteNote(selectedNote.id)} aria-label="Xoá ghi chú" title="Xoá ghi chú">🗑</button>
                  </>
                )}
                <button type="button" className="rp-note-modal-close" onClick={onCloseNote} aria-label="Đóng ghi chú">×</button>
              </div>
            </div>

            {noteDetailMode === 'edit' ? (
              <div className="rp-note-modal-edit">
                <textarea
                  value={noteDetailDraft.content}
                  onChange={(e) => onNoteDetailDraftChange({ ...noteDetailDraft, content: e.target.value })}
                  rows={12}
                  placeholder="Nội dung ghi chú"
                />
                <div className="rp-note-modal-footer">
                  <button type="button" className="rp-note-cancel" onClick={() => onOpenNote(selectedNote)}>Huỷ</button>
                  <button type="button" className="rp-note-save" onClick={() => onSaveDetailEdit(selectedNote.id)}>Lưu</button>
                </div>
              </div>
            ) : (
              <>
                <div className="rp-note-modal-content rp-app-scrollbar"><MarkdownContent content={selectedNote.content} /></div>
                {Array.isArray(selectedNote.citations) && selectedNote.citations.length > 0 && (
                  <div className="rp-note-modal-sources">
                    <h3>Nguồn trích dẫn</h3>
                    {selectedNote.citations.map((citation, index) => (
                      <div key={`${citation.document_title || 'source'}-${index}`} className="rp-note-modal-source">
                        <strong>{citation.document_title || citation.filename || 'Tài liệu'}</strong>
                        {(citation.page_start || citation.page) && <span>tr. {citation.page_start || citation.page}</span>}
                        {(citation.snippet || citation.summary || citation.content) && <p>{citation.snippet || citation.summary || citation.content}</p>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="rp-note-modal-meta">
                  {selectedNote.created_at && <span>Tạo: {formatNoteTime(selectedNote.created_at)}</span>}
                  {selectedNote.updated_at && <span>Cập nhật: {formatNoteTime(selectedNote.updated_at)}</span>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  index,
  onCopy,
  onRegenerate,
  onSaveNote,
  saved,
  saving,
  regenerating,
}) {
  const isUser = msg.role === "user";
  const citations = Array.isArray(msg.citations) ? msg.citations : [];

  return (
    <div
      className={`rp-message-row ${isUser ? "user" : "assistant"}`}
      style={{ animation: `fadeSlideIn 0.3s ease ${index * 0.05}s both` }}
    >
      {!isUser && <div className="rp-avatar">✦</div>}
      <div className={`rp-bubble ${isUser ? "user" : "assistant"}`}>
        <div className="rp-bubble-content">
          {regenerating && !msg.content ? (
            <span className="rp-bubble-loading">Đang tạo lại câu trả lời...</span>
          ) : isUser ? (
            msg.content
          ) : (
            <AnswerWithCitations
              content={msg.content || ""}
              citations={citations}
              warning={msg.warning}
            />
          )}
          {regenerating && msg.content && <span style={{ opacity: 0.5 }}> ▌</span>}
        </div>

        {!isUser && !regenerating && (
          <div className="rp-bubble-actions" aria-label="Thao tác câu trả lời">
            <button
              type="button"
              className="rp-icon-btn"
              aria-label="Sao chép câu trả lời"
              title="Sao chép"
              onClick={() => onCopy?.(msg)}
            >
              ⧉
            </button>
            <button
              type="button"
              className="rp-icon-btn"
              aria-label={saved ? "Đã lưu vào ghi chú" : "Lưu vào ghi chú"}
              title={saved ? "Đã lưu" : "Lưu vào ghi chú"}
              disabled={saved || saving}
              onClick={() => onSaveNote?.(msg)}
            >
              {saved ? "✓" : "▣"}
            </button>
            <button
              type="button"
              className="rp-icon-btn"
              aria-label="Tạo lại câu trả lời"
              title="Tạo lại"
              onClick={() => onRegenerate?.(index)}
            >
              ↻
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ResearchPage() {
  const { notebookId } = useParams();
  const location = useLocation();
  const { token } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("reading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState(null);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingCitations, setStreamingCitations] = useState([]);
  const [streamingWarning, setStreamingWarning] = useState(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);
  const [activeCitationIndex, setActiveCitationIndex] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editDraft, setEditDraft] = useState({ title: "", content: "" });
  const [selectedNote, setSelectedNote] = useState(null);
  const [noteDetailMode, setNoteDetailMode] = useState('view');
  const [noteDetailDraft, setNoteDetailDraft] = useState({ title: "", content: "" });
  const [savingNoteMessageId, setSavingNoteMessageId] = useState(null);
  const [savedMessageIds, setSavedMessageIds] = useState(() => new Set());
  const [suggestedQuestions, setSuggestedQuestions] = useState(() => normalizeSuggestedPrompts(location.state?.suggestedQuestions));
  const [researchSession, setResearchSession] = useState(() => location.state?.researchSession || null);
  const [researchSessionId, setResearchSessionId] = useState(() => location.state?.researchSessionId || location.state?.researchSession?.id || null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState(() => location.state?.selectedDocumentIds || location.state?.researchSession?.selected_document_ids || []);
  const [selectedDocuments, setSelectedDocuments] = useState(() => location.state?.selectedDocuments || []);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [flashcardModal, setFlashcardModal] = useState(null);
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false);
  const [savingFlashcards, setSavingFlashcards] = useState(false);
  const [flashcardCount, setFlashcardCount] = useState(5);
  const [quizCount, setQuizCount] = useState(3);
  const [quizType, setQuizType] = useState("mixed");
  const [quizModal, setQuizModal] = useState(null);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [generatingTest, setGeneratingTest] = useState(false);
  const [savingQuiz, setSavingQuiz] = useState(false);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const activeRequestRef = useRef(null);
  const loadingTimerRef = useRef(null);
  const quickActionsRef = useRef(null);

  const chatHistory = useMemo(
    () => messages.filter((msg) => msg.role !== "system").map(({ role, content }) => ({ role, content })),
    [messages]
  );

  const visibleSuggestedPrompts = useMemo(
    () => normalizeSuggestedPrompts(suggestedQuestions),
    [suggestedQuestions]
  );

  const activeCitation = useMemo(() => {
    if (!activeCitationIndex) return null;
    const allCitations = [
      ...sources,
      ...streamingCitations,
      ...messages.flatMap((msg) => (Array.isArray(msg.citations) ? msg.citations : [])),
    ];
    return allCitations.find((citation, index) => String(getCitationIndex(citation, index)) === String(activeCitationIndex)) || null;
  }, [activeCitationIndex, messages, sources, streamingCitations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, streamingAnswer]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!token || !notebookId) return;
    if (!researchSessionId) {
      setNotes([]);
      setSavedMessageIds(new Set());
      setLoadingNotes(false);
      return undefined;
    }

    let cancelled = false;
    setLoadingNotes(true);
    api.getWorkspaceNotes(notebookId, token, { research_session_id: researchSessionId })
      .then((result) => {
        if (cancelled) return;
        const fetchedNotes = result?.notes ?? [];
        setNotes(fetchedNotes);
        setSavedMessageIds(new Set(fetchedNotes.map((note) => note.source_message_id).filter(Boolean)));
      })
      .catch((err) => {
        if (!cancelled) showToast("error", err.message || "Không thể tải ghi chú của phiên nghiên cứu.");
      })
      .finally(() => {
        if (!cancelled) setLoadingNotes(false);
      });
    return () => { cancelled = true; };
  }, [notebookId, token, researchSessionId]);

  useEffect(() => {
    if (!researchSessionId || !token) return;
    let cancelled = false;
    api.getResearchSessionMessages(researchSessionId, token)
      .then((result) => {
        if (cancelled) return;
        const session = result?.session || researchSession;
        const loadedMessages = result?.messages || [];
        const sessionNotes = result?.notes || null;
        setResearchSession(session);
        setSelectedDocumentIds(session?.selected_document_ids || selectedDocumentIds);
        setMessages(loadedMessages);
        if (sessionNotes) {
          setNotes(sessionNotes);
          setSavedMessageIds(new Set(sessionNotes.map((note) => note.source_message_id).filter(Boolean)));
        }
      })
      .catch((err) => {
        if (!cancelled) showToast("error", err.message || "Không thể tải lịch sử chat.");
      });
    return () => { cancelled = true; };
  }, [researchSessionId, token]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (quickActionsRef.current && !quickActionsRef.current.contains(event.target)) {
        setQuickActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const prefillQuestion = location.state?.prefillQuestion;
    const incomingSuggestions = location.state?.suggestedQuestions || [];
    if (incomingSuggestions.length > 0) setSuggestedQuestions(incomingSuggestions);
    if (location.state?.researchSession) setResearchSession(location.state.researchSession);
    if (location.state?.researchSessionId) setResearchSessionId(location.state.researchSessionId);
    if (location.state?.selectedDocumentIds) setSelectedDocumentIds(location.state.selectedDocumentIds);
    if (location.state?.selectedDocuments) setSelectedDocuments(location.state.selectedDocuments);
    if (prefillQuestion) setInput(prefillQuestion);
  }, [location.state]);

  useEffect(() => () => {
    activeRequestRef.current?.controller?.abort();
    if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
  }, []);

  const showToast = (type, message) => setToast({ type, message });

  const setProgressiveLoading = (initialStage = "reading") => {
    setLoadingStage(initialStage);
    if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = window.setTimeout(() => {
      setLoadingStage((stage) => (stage === "reading" ? "retrieving" : stage));
      loadingTimerRef.current = window.setTimeout(() => {
        setLoadingStage((stage) => (stage === "retrieving" ? "generating" : stage));
      }, 1100);
    }, 700);
  };

  const clearLoadingTimer = () => {
    if (loadingTimerRef.current) {
      window.clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  };


  const handleStop = () => {
    if (!activeRequestRef.current) return;
    activeRequestRef.current.cancelled = true;
    activeRequestRef.current.controller.abort();
    activeRequestRef.current = null;
    clearLoadingTimer();
    setLoading(false);
    setStreamingAnswer("");
    setStreamingCitations([]);
    setStreamingWarning(null);
    setRegeneratingIndex(null);
    setNotice("Đã dừng tạo câu trả lời.");
  };

  const startChatRequest = async ({ question, history, mode = "new", targetIndex = null, previousMessage = null }) => {
    const requestId = crypto.randomUUID?.() || `${Date.now()}`;
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller, cancelled: false, mode, targetIndex };

    setError("");
    setNotice("");
    setLoading(true);
    setProgressiveLoading("reading");
    setStreamingAnswer("");
    setStreamingCitations([]);
    if (mode === "new") setSources([]);
    if (mode === "regenerate") setRegeneratingIndex(targetIndex);

    let fullAnswer = "";
    let latestCitations = [];
    let latestWarning = null;
    let latestSuggestedPrompts = visibleSuggestedPrompts;
    let streamFailed = false;

    const isActive = () => activeRequestRef.current?.id === requestId && !activeRequestRef.current?.cancelled;

    try {
      await api.streamResearchQuery(
        { notebookId, question, chatHistory: history, selectedDocumentIds, researchSessionId },
        token,
        {
          onStatus: (status) => {
            if (!isActive()) return;
            if (["reading", "retrieving", "generating"].includes(status)) setLoadingStage(status);
          },
          onSources: (srcs, citations) => {
            if (!isActive()) return;
            latestCitations = normalizeSources(citations?.length ? citations : srcs);
            setSources(latestCitations);
            setStreamingCitations(latestCitations);
            setLoadingStage("generating");
          },
          onWarning: (warning) => {
            if (!isActive()) return;
            latestWarning = warning || null;
            setStreamingWarning(latestWarning);
          },
          onSuggestedPrompts: (prompts) => {
            if (!isActive()) return;
            latestSuggestedPrompts = normalizeSuggestedPrompts(prompts);
            setSuggestedQuestions(latestSuggestedPrompts);
          },
          onToken: (chunk) => {
            if (!isActive()) return;
            fullAnswer += chunk;
            setLoadingStage("generating");
            if (mode === "regenerate") {
              setMessages((prev) => prev.map((msg, i) => (
                i === targetIndex ? { ...msg, content: fullAnswer, citations: latestCitations, warning: latestWarning } : msg
              )));
            } else {
              setStreamingAnswer(fullAnswer);
            }
          },
          onDone: () => {
            if (!isActive()) return;
            const assistantMessage = {
              id: crypto.randomUUID?.() || `${Date.now()}-assistant`,
              role: "assistant",
              content: fullAnswer,
              citations: latestCitations,
              warning: hasWarningInContent(fullAnswer) ? null : latestWarning,
            };

            if (mode === "regenerate") {
              setMessages((prev) => prev.map((msg, i) => (i === targetIndex ? assistantMessage : msg)));
            } else {
              setMessages((prev) => [...prev, assistantMessage]);
            }
            setStreamingAnswer("");
            setStreamingCitations([]);
            setStreamingWarning(null);
            setLoading(false);
            setRegeneratingIndex(null);
            setSuggestedQuestions(normalizeSuggestedPrompts(latestSuggestedPrompts));
            clearLoadingTimer();
            activeRequestRef.current = null;
          },
          onError: (msg) => {
            if (!isActive()) return;
            streamFailed = true;
            if (mode === "regenerate" && previousMessage) {
              setMessages((prev) => prev.map((item, i) => (i === targetIndex ? previousMessage : item)));
            }
            setError(msg || "Lỗi khi nhận phản hồi.");
            setLoading(false);
            setRegeneratingIndex(null);
            clearLoadingTimer();
            activeRequestRef.current = null;
          },
        },
        { signal: controller.signal }
      );
    } catch (err) {
      if (activeRequestRef.current?.id !== requestId) return;

      if (isAbortError(err) || activeRequestRef.current?.cancelled) {
        if (mode === "regenerate" && previousMessage) {
          setMessages((prev) => prev.map((item, i) => (i === targetIndex ? previousMessage : item)));
        }
        setNotice("Đã dừng tạo câu trả lời.");
      } else if (!streamFailed) {
        if (mode === "regenerate" && previousMessage) {
          setMessages((prev) => prev.map((item, i) => (i === targetIndex ? previousMessage : item)));
        }
        setError(err.message || "Không thể kết nối server.");
      }
      setLoading(false);
      setStreamingAnswer("");
      setStreamingCitations([]);
      setStreamingWarning(null);
      setRegeneratingIndex(null);
      clearLoadingTimer();
      activeRequestRef.current = null;
    }
  };

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || loading) return;
    if (!selectedDocumentIds.length) {
      showToast("error", "Vui lòng chọn ít nhất một tài liệu để nghiên cứu.");
      return;
    }

    setInput("");
    const userMessage = {
      id: crypto.randomUUID?.() || `${Date.now()}-user`,
      role: "user",
      content: question,
    };
    const history = chatHistory;
    setMessages((prev) => [...prev, userMessage]);

    await startChatRequest({ question, history, mode: "new" });
  };

  const handleGenerateFlashcards = async () => {
    if (!researchSessionId) {
      showToast("error", "Không tìm thấy phiên nghiên cứu để tạo flashcards.");
      return;
    }
    if (!selectedDocumentIds.length) {
      showToast("error", "Chọn tài liệu để tạo flashcards.");
      return;
    }
    setGeneratingFlashcards(true);
    try {
      const result = await api.generateFlashcards(researchSessionId, { selected_document_ids: selectedDocumentIds, count: Math.max(1, Math.min(flashcardCount, 5)) }, token);
      const flashcards = result?.flashcards || [];
      if (!flashcards.length) throw new Error("Không tạo được flashcards.");
      setFlashcardModal({ title: "Flashcards từ tài liệu", flashcards: flashcards.slice(0, 5), warning: result?.warning || null, canSave: true });
      showToast("success", "Đã tạo flashcards.");
    } catch (err) {
      showToast("error", err.message || "Thiếu GROQ_API_KEY hoặc không thể tạo flashcards.");
    } finally {
      setGeneratingFlashcards(false);
    }
  };


  const handleGenerateMoreFlashcards = async () => {
    const existing = flashcardModal?.flashcards || [];
    const remaining = 5 - existing.length;
    if (remaining <= 0) return;
    setGeneratingFlashcards(true);
    try {
      const result = await api.generateFlashcards(researchSessionId, { selected_document_ids: selectedDocumentIds, count: remaining }, token);
      const more = result?.flashcards || [];
      setFlashcardModal((prev) => ({ ...prev, flashcards: [...(prev?.flashcards || []), ...more].slice(0, 5), warning: result?.warning || prev?.warning || null }));
    } catch (err) {
      showToast("error", err.message || "Không thể tạo thêm flashcards.");
    } finally {
      setGeneratingFlashcards(false);
    }
  };

  const handleGenerateQuiz = async (extraCount = null) => {
    if (!researchSessionId) {
      showToast("error", "Không tìm thấy phiên nghiên cứu để tạo quiz.");
      return;
    }
    if (!selectedDocumentIds.length) {
      showToast("error", "Vui lòng chọn tài liệu trước khi tạo trắc nghiệm.");
      return;
    }
    const existing = quizModal?.quiz?.questions || [];
    const requested = extraCount ?? quizCount;
    const count = Math.max(1, Math.min(requested, 5 - existing.length));
    if (count <= 0) {
      showToast("error", "Đã đạt tối đa 5 mục.");
      return;
    }
    setGeneratingQuiz(true);
    try {
      const result = await api.generateQuiz(researchSessionId, { selected_document_ids: selectedDocumentIds, count, question_type: quizType }, token);
      const questions = result?.quiz?.questions || result?.questions || [];
      if (!questions.length) throw new Error("Không tạo được quiz.");
      if (existing.length) {
        setQuizModal((prev) => ({ ...prev, quiz: { ...(prev?.quiz || {}), questions: [...existing, ...questions].slice(0, 5) }, warning: result?.warning || prev?.warning || null }));
      } else {
        setQuizModal({ mode: "quiz", title: "Bộ câu hỏi trắc nghiệm", quiz: { title: "Bộ câu hỏi trắc nghiệm", questions: questions.slice(0, 5) }, warning: result?.warning || null, canSave: true });
      }
      showToast("success", "Đã tạo trắc nghiệm.");
    } catch (err) {
      showToast("error", err.message || "Không thể tạo trắc nghiệm.");
    } finally {
      setGeneratingQuiz(false);
    }
  };

  const handleGenerateTest = async () => {
    if (!researchSessionId) {
      showToast("error", "Không tìm thấy phiên nghiên cứu để tạo bài kiểm tra.");
      return;
    }
    if (!selectedDocumentIds.length) {
      showToast("error", "Vui lòng chọn tài liệu trước khi tạo bài kiểm tra.");
      return;
    }
    setGeneratingTest(true);
    showToast("success", "Đang tạo bài kiểm tra từ tài liệu...");
    try {
      const result = await api.generateTest(researchSessionId, { selected_document_ids: selectedDocumentIds, count: 10 }, token);
      const test = result?.test;
      if (!test?.questions || test.questions.length !== 10) throw new Error("Bài kiểm tra chưa đủ 10 câu.");
      setQuizModal({ mode: "test", title: test.title || "Bài kiểm tra từ tài liệu đã chọn", quiz: test, warning: result?.warning || null, canSave: true });
      showToast("success", "Đã tạo bài kiểm tra 10 câu.");
    } catch (err) {
      showToast("error", err.message || "Không thể tạo bài kiểm tra.");
    } finally {
      setGeneratingTest(false);
    }
  };

  const runQuickAction = async (action) => {
    if (loading || generatingFlashcards || generatingQuiz || generatingTest) return;
    if (!selectedDocumentIds.length) {
      showToast("error", "Vui lòng chọn ít nhất một tài liệu để sử dụng tính năng này.");
      return;
    }
    if (action.requiresTwo && selectedDocumentIds.length < 2) {
      showToast("error", "Cần chọn ít nhất 2 tài liệu để so sánh.");
      return;
    }
    if (action.special === "flashcards") {
      await handleGenerateFlashcards();
      return;
    }
    if (action.special === "quiz") {
      await handleGenerateQuiz();
      return;
    }
    if (action.special === "test") {
      await handleGenerateTest();
      return;
    }
    const prompt = action.prompt;
    const userMessage = {
      id: crypto.randomUUID?.() || `${Date.now()}-quick-action`,
      role: "user",
      content: prompt,
      source: "quick_action",
    };
    const history = chatHistory;
    setMessages((prev) => [...prev, userMessage]);
    await startChatRequest({ question: prompt, history, mode: "new" });
  };

  const handleExportDocx = async () => {
    if (!researchSessionId || exportingDocx) return;
    setExportingDocx(true);
    showToast("success", "Đang tạo file chia sẻ...");
    try {
      const response = await api.exportResearchSessionDocx(researchSessionId, token);
      const blob = new Blob([response.data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const contentDisposition = response.headers?.["content-disposition"] || "";
      const filename = parseDownloadFilename(contentDisposition);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("success", "Đã tải file chia sẻ.");
    } catch (err) {
      showToast("error", err.message || "Không thể tạo file chia sẻ.");
    } finally {
      setExportingDocx(false);
    }
  };

  const handleSaveFlashcardsToNotes = async () => {
    const cards = flashcardModal?.flashcards || [];
    if (!cards.length || savingFlashcards) return;
    setSavingFlashcards(true);
    try {
      const fileNames = selectedDocuments.length ? selectedDocuments.map((doc) => doc.filename).join(", ") : "tài liệu đã chọn";
      const payload = {
        title: `Flashcards từ ${fileNames}`.slice(0, 180),
        content: buildFlashcardMarkdown(cards),
        note_type: "flashcards",
        metadata: { flashcards: cards },
        citations: [],
        research_session_id: researchSessionId,
      };
      const result = await api.createWorkspaceNote(notebookId, payload, token);
      const createdNote = result?.note;
      if (!createdNote) throw new Error("Không thể tạo ghi chú");
      setNotes((prev) => [createdNote, ...prev]);
      showToast("success", "Đã lưu flashcards vào ghi chú.");
    } catch (err) {
      showToast("error", err.message || "Không thể lưu flashcards.");
    } finally {
      setSavingFlashcards(false);
    }
  };


  const handleSaveQuizToNotes = async () => {
    const mode = quizModal?.mode || "quiz";
    const quiz = quizModal?.quiz;
    const questions = quiz?.questions || [];
    if (!questions.length || savingQuiz) return;
    setSavingQuiz(true);
    try {
      const payload = {
        title: mode === "test" ? (quiz.title || "Bài kiểm tra từ tài liệu đã chọn") : "Bộ câu hỏi trắc nghiệm",
        content: buildQuizMarkdown(quiz, mode === "test" ? (quiz.title || "Bài kiểm tra từ tài liệu đã chọn") : "Bộ câu hỏi trắc nghiệm"),
        note_type: mode === "test" ? "test" : "quiz",
        metadata: mode === "test" ? { test: quiz } : { quiz },
        citations: [],
        research_session_id: researchSessionId,
      };
      const result = await api.createWorkspaceNote(notebookId, payload, token);
      const createdNote = result?.note;
      if (!createdNote) throw new Error("Không thể tạo ghi chú");
      setNotes((prev) => [createdNote, ...prev]);
      showToast("success", mode === "test" ? "Đã lưu bài kiểm tra vào ghi chú." : "Đã lưu quiz vào ghi chú.");
    } catch (err) {
      showToast("error", err.message || "Không thể lưu quiz/test.");
    } finally {
      setSavingQuiz(false);
    }
  };

  const handleClearHistory = async () => {
    if (!researchSessionId || loading) return;
    if (!window.confirm("Xóa lịch sử cuộc trò chuyện của phiên này? Tài liệu và ghi chú sẽ được giữ nguyên.")) return;
    try {
      await api.clearResearchSessionMessages(researchSessionId, token);
      setMessages([]);
      setSources([]);
      setStreamingAnswer("");
      setStreamingCitations([]);
      setStreamingWarning(null);
      showToast("success", "Đã xóa lịch sử cuộc trò chuyện.");
    } catch (err) {
      showToast("error", err.message || "Không thể xóa lịch sử cuộc trò chuyện.");
    }
  };

  const handleRegenerate = async (assistantIndex) => {
    if (loading) return;

    const previousUserIndex = [...messages]
      .slice(0, assistantIndex)
      .map((msg, index) => ({ ...msg, index }))
      .reverse()
      .find((msg) => msg.role === "user")?.index;

    if (previousUserIndex == null) {
      showToast("error", "Không tìm thấy câu hỏi để tạo lại.");
      return;
    }

    const question = messages[previousUserIndex].content;
    const previousMessage = messages[assistantIndex];
    const history = messages
      .slice(0, assistantIndex)
      .filter((msg) => msg.role !== "system")
      .map(({ role, content }) => ({ role, content }));

    await startChatRequest({
      question,
      history,
      mode: "regenerate",
      targetIndex: assistantIndex,
      previousMessage,
    });
  };

  const handleCopy = async (msg) => {
    try {
      await navigator.clipboard.writeText(msg.content || "");
      showToast("success", "Đã sao chép câu trả lời.");
    } catch {
      showToast("error", "Không thể sao chép câu trả lời.");
    }
  };

  const handleSaveNote = async (msg) => {
    if (!token) {
      showToast("error", "Vui lòng đăng nhập để lưu ghi chú.");
      return;
    }
    if (!msg?.content?.trim()) return;

    const sourceMessageId = msg.id || `${msg.role}-${msg.content.slice(0, 24)}`;
    if (savedMessageIds.has(sourceMessageId)) return;

    setSavingNoteMessageId(sourceMessageId);
    try {
      const payload = {
        title: generateNoteTitle(msg.content),
        content: msg.content,
        citations: Array.isArray(msg.citations) ? msg.citations : [],
        source_message_id: sourceMessageId,
        research_session_id: researchSessionId,
      };
      const result = await api.createWorkspaceNote(notebookId, payload, token);
      const createdNote = result?.note;
      if (!createdNote) throw new Error("Không thể tạo ghi chú");
      setNotes((prev) => [createdNote, ...prev]);
      setSavedMessageIds((prev) => new Set([...prev, sourceMessageId]));
      showToast("success", "Đã lưu vào ghi chú.");
    } catch (err) {
      showToast("error", err.message || "Không thể lưu ghi chú.");
    } finally {
      setSavingNoteMessageId(null);
    }
  };

  const handleStartEditNote = (note) => {
    setEditingNoteId(note.id);
    setEditDraft({ title: note.title || "", content: note.content || "" });
  };

  const handleCancelEditNote = () => {
    setEditingNoteId(null);
    setEditDraft({ title: "", content: "" });
  };

  const handleSaveEditNote = async (noteId) => {
    const title = editDraft.title.trim() || "Ghi chú mới";
    const content = editDraft.content.trim();
    if (!content) {
      showToast("error", "Nội dung ghi chú không được để trống.");
      return;
    }

    try {
      const result = await api.updateNote(noteId, { title, content }, token);
      const updatedNote = result?.note;
      if (!updatedNote) throw new Error("Không thể cập nhật ghi chú");
      setNotes((prev) => prev.map((note) => (note.id === noteId ? updatedNote : note)));
      setSelectedNote((prev) => (prev?.id === noteId ? updatedNote : prev));
      setNoteDetailMode('view');
      handleCancelEditNote();
      showToast("success", "Đã cập nhật ghi chú.");
    } catch (err) {
      showToast("error", err.message || "Không thể cập nhật ghi chú.");
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await api.deleteNote(noteId, token);
      const deletedNote = notes.find((note) => note.id === noteId);
      setNotes((prev) => prev.filter((note) => note.id !== noteId));
      if (deletedNote?.source_message_id) {
        setSavedMessageIds((prev) => {
          const next = new Set(prev);
          next.delete(deletedNote.source_message_id);
          return next;
        });
      }
      if (editingNoteId === noteId) handleCancelEditNote();
      if (selectedNote?.id === noteId) setSelectedNote(null);
      showToast("success", "Đã xoá ghi chú.");
    } catch (err) {
      showToast("error", err.message || "Không thể xoá ghi chú.");
    }
  };

  const handleOpenNote = (note) => {
    const test = getTestFromNote(note);
    if (test?.questions?.length) {
      setQuizModal({ mode: "test", title: note.title || test.title || "Bài kiểm tra", quiz: test, canSave: false });
      return;
    }
    const quiz = getQuizFromNote(note);
    if (quiz?.questions?.length) {
      setQuizModal({ mode: "quiz", title: note.title || quiz.title || "Bộ câu hỏi trắc nghiệm", quiz, canSave: false });
      return;
    }
    const cards = getFlashcardsFromNote(note);
    if (cards.length) {
      setFlashcardModal({ title: note.title || "Flashcards", flashcards: cards, canSave: false });
      return;
    }
    setSelectedNote(note);
    setNoteDetailMode('view');
    setNoteDetailDraft({ title: note.title || '', content: note.content || '' });
  };

  const handleCloseNote = () => {
    setSelectedNote(null);
    setNoteDetailMode('view');
  };

  const handleStartDetailEdit = () => {
    if (!selectedNote) return;
    setNoteDetailDraft({ title: selectedNote.title || '', content: selectedNote.content || '' });
    setNoteDetailMode('edit');
  };

  const handleSaveDetailEditNote = async (noteId) => {
    const previous = notes.find((note) => note.id === noteId);
    const title = noteDetailDraft.title.trim() || 'Ghi chú mới';
    const content = noteDetailDraft.content.trim();
    if (!content) {
      showToast('error', 'Nội dung ghi chú không được để trống.');
      return;
    }
    try {
      const result = await api.updateNote(noteId, { title, content }, token);
      const updatedNote = result?.note;
      if (!updatedNote) throw new Error('Không thể cập nhật ghi chú');
      setNotes((prev) => prev.map((note) => (note.id === noteId ? updatedNote : note)));
      setSelectedNote(updatedNote);
      setNoteDetailMode('view');
      showToast('success', 'Đã cập nhật ghi chú.');
    } catch (err) {
      if (previous) setSelectedNote(previous);
      showToast('error', err.message || 'Không thể cập nhật ghi chú.');
    }
  };

  const handleSuggestedQuestion = (question) => {
    setInput(question);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const activeLoadingText = LOADING_LABELS[loadingStage] || LOADING_LABELS.reading;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0d0a; }
        .rp-app-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent; }
        .rp-app-scrollbar::-webkit-scrollbar { width: 3px; height: 3px; }
        .rp-app-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .rp-app-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 999px; }
        .rp-app-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }

        .research-page {
          min-height: 100vh;
          background: #0f0d0a;
          background-image:
            radial-gradient(ellipse 80% 50% at 20% 0%, rgba(196,164,100,0.06) 0%, transparent 60%),
            radial-gradient(ellipse 60% 40% at 80% 100%, rgba(100,80,40,0.08) 0%, transparent 60%);
          font-family: 'DM Sans', sans-serif;
          color: #d4cfc8;
          display: flex; flex-direction: column;
          height: 100vh; overflow: hidden;
        }

        .rp-header {
          display: flex; align-items: center; gap: 16px;
          padding: 14px 24px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(15,13,10,0.8);
          backdrop-filter: blur(12px);
          flex-shrink: 0; z-index: 10;
        }
        .rp-back {
          display: flex; align-items: center; gap: 6px;
          color: #8a8070; text-decoration: none;
          font-size: 13px; font-weight: 500;
          padding: 6px 10px; border-radius: 8px;
          transition: color 0.2s, background 0.2s; white-space: nowrap;
        }
        .rp-back:hover { color: #c4a464; background: rgba(196,164,100,0.08); }
        .rp-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.08); flex-shrink: 0; }
        .rp-title {
          font-family: 'Lora', Georgia, serif;
          font-size: 15px; font-weight: 600; color: #e8e0d0;
          flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .rp-share-btn { border: 1px solid rgba(196,164,100,0.28); background: rgba(196,164,100,0.1); color: #c4a464; border-radius: 9px; padding: 7px 11px; font-size: 12px; cursor: pointer; }
        .rp-share-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .rp-actions-col { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid rgba(255,255,255,0.06); }
        .rp-actions-list { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px; display: grid; gap: 10px; align-content: start; }
        .rp-action-helper { margin: 14px 16px 0; border: 1px dashed rgba(196,164,100,0.22); background: rgba(196,164,100,0.06); color: #c4a464; border-radius: 12px; padding: 11px; font-size: 12px; line-height: 1.45; }
        .rp-action-card { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 13px 14px; color: #d4cfc8; cursor: pointer; font-size: 12px; transition: border-color .2s, background .2s, color .2s, transform .15s; }
        .rp-action-card:hover:not(:disabled) { border-color: rgba(196,164,100,0.35); background: rgba(196,164,100,0.06); color: #c4a464; transform: translateY(-1px); }
        .rp-action-card:disabled { opacity: 0.38; cursor: not-allowed; transform: none; }
        .rp-action-icon { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 9px; background: rgba(196,164,100,0.1); color: #c4a464; border: 1px solid rgba(196,164,100,0.15); }
        .rp-markdown { white-space: normal; }
        .rp-markdown p { margin: 0 0 10px; }
        .rp-markdown p:last-child { margin-bottom: 0; }
        .rp-markdown ul, .rp-markdown ol { padding-left: 20px; margin: 8px 0 10px; }
        .rp-markdown li { margin: 4px 0; }
        .rp-markdown h1, .rp-markdown h2, .rp-markdown h3 { margin: 12px 0 8px; color: #e8e0d0; line-height: 1.35; }
        .rp-markdown code { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 1px 5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; }
        .rp-markdown pre { overflow-x: auto; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px; margin: 10px 0; }
        .rp-markdown pre code { background: transparent; border: none; padding: 0; }
        .rp-modal-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.62); display: flex; align-items: center; justify-content: center; padding: 22px; }
        .rp-flashcard-modal { width: min(560px, 96vw); max-height: 90vh; overflow-y: auto; border-radius: 20px; border: 1px solid rgba(255,255,255,.1); background: #17130f; box-shadow: 0 28px 80px rgba(0,0,0,.55); padding: 20px; }
        .rp-flashcard { min-height: 220px; margin: 18px 0; border-radius: 18px; border: 1px solid rgba(196,164,100,.22); background: linear-gradient(145deg, rgba(196,164,100,.12), rgba(255,255,255,.035)); display: flex; flex-direction: column; justify-content: center; padding: 26px; text-align: center; }
        .rp-flashcard.flipped { border-color: rgba(120,190,150,.28); background: linear-gradient(145deg, rgba(120,190,150,.12), rgba(255,255,255,.035)); }
        .rp-flashcard-side-label { color: #c4a464; text-transform: uppercase; letter-spacing: .12em; font-size: 11px; margin-bottom: 14px; }
        .rp-flashcard p { color: #e8e0d0; font-family: 'Lora', Georgia, serif; font-size: 18px; line-height: 1.7; }
        .rp-flashcard-controls, .rp-flashcard-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .rp-flashcard-controls button { flex: 1; border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.04); color: #d4cfc8; border-radius: 10px; padding: 9px 10px; cursor: pointer; }
        .rp-flashcard-controls button:disabled { opacity: .35; cursor: not-allowed; }
        .rp-flashcard-footer { margin-top: 14px; color: #8a8070; font-size: 12px; }
        @media (max-width: 1040px) { .rp-actions-col { width: 250px; } .rp-notes-col { width: 300px; } .rp-suggested-chip { max-width: calc(50% - 4px); } }
        @media (max-width: 720px) { .rp-suggested-prompts { flex-wrap: nowrap; overflow-x: auto; max-height: none; padding-bottom: 2px; } .rp-suggested-chip { max-width: 78vw; flex: 0 0 auto; } }
        .rp-clear-history { border: 1px solid rgba(224,120,120,0.25); background: rgba(224,120,120,0.08); color: #e07878; border-radius: 9px; padding: 7px 11px; font-size: 12px; cursor: pointer; }
        .rp-clear-history:disabled { opacity: 0.4; cursor: not-allowed; }

        .rp-body { flex: 1; display: flex; overflow: hidden; border-top: 1px solid rgba(255,255,255,0.04); }
        .rp-chat-col { flex: 1; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid rgba(255,255,255,0.06); }
        .rp-messages { flex: 1; overflow-y: auto; padding: 28px 24px; }

        .rp-context-banner { margin: 0 auto 18px; max-width: 720px; border: 1px solid rgba(196,164,100,0.18); background: rgba(196,164,100,0.08); color: #c4a464; border-radius: 12px; padding: 10px 14px; font-size: 13px; text-align: center; }
        .rp-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; text-align: center; padding: 40px; }
        .rp-empty-icon { width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, rgba(196,164,100,0.15), rgba(138,106,48,0.15)); border: 1px solid rgba(196,164,100,0.2); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #c4a464; margin-bottom: 4px; }
        .rp-empty-state h3 { font-family: 'Lora', Georgia, serif; font-size: 17px; font-weight: 600; color: #e8e0d0; }
        .rp-empty-state p { font-size: 13px; color: #5a5040; line-height: 1.6; max-width: 280px; }
        .rp-empty-suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 680px; margin-top: 10px; }
        .rp-empty-suggestion { border: 1px solid rgba(196,164,100,0.18); background: rgba(196,164,100,0.08); color: #c4a464; border-radius: 999px; padding: 8px 11px; cursor: pointer; font-size: 12px; }
        .rp-empty-suggestion:hover { background: rgba(196,164,100,0.14); border-color: rgba(196,164,100,0.35); }
        .rp-empty-suggestion:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(196,164,100,0.2); border-color: rgba(196,164,100,0.55); }

        .rp-message-row { display: flex; margin-bottom: 16px; }
        .rp-message-row.user { justify-content: flex-end; }
        .rp-message-row.assistant { justify-content: flex-start; }
        .rp-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, #c4a464, #8a6a30); display: flex; align-items: center; justify-content: center; font-size: 14px; margin-right: 10px; margin-top: 2px; box-shadow: 0 2px 8px rgba(196,164,100,0.3); }
        .rp-bubble { max-width: 75%; padding: 12px 16px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; position: relative; }
        .rp-bubble.user { border-radius: 18px 18px 4px 18px; background: linear-gradient(135deg, #c4a464, #a08040); color: #1a1510; font-family: 'DM Sans', sans-serif; font-weight: 500; box-shadow: 0 4px 16px rgba(196,164,100,0.2); }
        .rp-bubble.assistant { border-radius: 18px 18px 18px 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #d4cfc8; font-family: 'Lora', Georgia, serif; font-weight: 400; padding-bottom: 34px; }
        .rp-bubble-content { white-space: pre-wrap; }
        .rp-bubble-loading { color: #8a8070; font-style: italic; }
        .rp-rag-warning { margin: 0 0 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(245,158,11,0.32); background: rgba(245,158,11,0.12); color: #f7c76b; font-family: 'DM Sans', sans-serif; font-size: 12.5px; line-height: 1.45; white-space: normal; }
        .rp-rag-warning.flashcard { margin-top: 14px; margin-bottom: 0; }
        .rp-bubble-actions { position: absolute; right: 10px; bottom: 7px; display: flex; gap: 6px; opacity: 0.35; transition: opacity 0.2s; }
        .rp-bubble.assistant:hover .rp-bubble-actions { opacity: 1; }
        .rp-icon-btn { width: 22px; height: 22px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: #9a9080; cursor: pointer; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
        .rp-icon-btn:hover:not(:disabled) { color: #c4a464; border-color: rgba(196,164,100,0.25); background: rgba(196,164,100,0.08); }
        .rp-icon-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        .rp-citation-wrap { position: relative; display: inline-flex; align-items: center; white-space: normal; }
        .rp-citation-badge { display: inline-flex; align-items: center; justify-content: center; margin: 0 2px; padding: 0 4px; border: none; background: rgba(196,164,100,0.12); color: #c4a464; border-radius: 5px; cursor: help; font: inherit; font-family: 'DM Sans', sans-serif; font-size: 12px; }
        .rp-citation-badge:hover, .rp-citation-badge:focus-visible { background: rgba(196,164,100,0.22); outline: none; box-shadow: 0 0 0 2px rgba(196,164,100,0.22); }
        .rp-citation-popover { position: absolute; left: 50%; bottom: calc(100% + 10px); z-index: 25; width: min(280px, 72vw); transform: translate(-50%, 4px); opacity: 0; pointer-events: none; padding: 11px 12px; border: 1px solid rgba(196,164,100,0.24); border-radius: 12px; background: rgba(21,18,13,0.98); box-shadow: 0 14px 36px rgba(0,0,0,0.38); color: #d4cfc8; font-family: 'DM Sans', sans-serif; font-size: 12px; line-height: 1.45; white-space: normal; transition: opacity .16s ease, transform .16s ease; }
        .rp-citation-popover::after { content: ""; position: absolute; left: 50%; bottom: -6px; width: 10px; height: 10px; transform: translateX(-50%) rotate(45deg); background: rgba(21,18,13,0.98); border-right: 1px solid rgba(196,164,100,0.24); border-bottom: 1px solid rgba(196,164,100,0.24); }
        .rp-citation-wrap:hover .rp-citation-popover, .rp-citation-wrap:focus-within .rp-citation-popover { opacity: 1; transform: translate(-50%, 0); }
        .rp-citation-popover strong { display: block; color: #e8e0d0; font-family: 'Lora', Georgia, serif; font-size: 13px; line-height: 1.35; margin-bottom: 8px; }
        .rp-citation-popover-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        .rp-citation-popover-meta span { color: #c4a464; border: 1px solid rgba(196,164,100,0.18); border-radius: 999px; padding: 2px 7px; background: rgba(196,164,100,0.08); font-size: 11px; }
        .rp-citation-snippet { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; color: #8a8070; }
        .rp-citation-footer { display: block; margin-top: 10px; color: #8a8070; font-family: 'DM Sans', sans-serif; font-size: 12px; }

        .rp-typing { display: flex; align-items: center; gap: 10px; padding: 12px 16px; width: fit-content; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 18px 18px 18px 4px; margin-bottom: 16px; font-size: 13px; color: #8a8070; font-family: 'Lora', Georgia, serif; font-style: italic; }
        .rp-typing-dots { display: flex; gap: 4px; }
        .rp-typing-dots span { width: 6px; height: 6px; border-radius: 50%; background: #c4a464; opacity: 0.7; animation: typingBounce 1.2s ease infinite; }
        .rp-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .rp-typing-dots span:nth-child(3) { animation-delay: 0.4s; }

        .rp-input-area { padding: 16px 20px 20px; border-top: 1px solid rgba(255,255,255,0.06); background: rgba(15,13,10,0.5); }
        .rp-error, .rp-notice { display: flex; align-items: center; gap: 8px; border-radius: 10px; padding: 9px 14px; font-size: 13px; margin-bottom: 12px; }
        .rp-error { background: rgba(200,80,80,0.08); border: 1px solid rgba(200,80,80,0.18); color: #e07878; }
        .rp-notice { background: rgba(196,164,100,0.08); border: 1px solid rgba(196,164,100,0.16); color: #c4a464; }
        .rp-suggested-prompts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; max-height: 76px; overflow: hidden; }
        .rp-suggested-chip { max-width: min(32%, 280px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid rgba(196,164,100,0.22); background: rgba(196,164,100,0.07); color: #d6b36a; border-radius: 999px; padding: 7px 11px; font-size: 12px; cursor: pointer; transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease; }
        .rp-suggested-chip:hover:not(:disabled) { background: rgba(196,164,100,0.16); border-color: rgba(196,164,100,0.48); color: #f0d69c; transform: translateY(-1px); }
        .rp-suggested-chip:focus-visible { outline: none; border-color: rgba(196,164,100,0.72); box-shadow: 0 0 0 3px rgba(196,164,100,0.18); }
        .rp-suggested-chip:disabled { opacity: .55; cursor: not-allowed; transform: none; }
        .rp-textarea-wrap { display: flex; align-items: flex-end; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 10px 12px; transition: border-color 0.2s, box-shadow 0.2s; }
        .rp-textarea-wrap:focus-within { border-color: rgba(196,164,100,0.35); box-shadow: 0 0 0 3px rgba(196,164,100,0.06); }
        .rp-textarea { flex: 1; background: transparent; border: none; outline: none; resize: none; color: #d4cfc8; font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; max-height: 120px; overflow-y: auto; }
        .rp-textarea::placeholder { color: #4a4030; }
        .rp-send-btn, .rp-stop-btn { height: 36px; border-radius: 10px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s; }
        .rp-send-btn { width: 36px; background: linear-gradient(135deg, #c4a464, #8a6a30); color: #1a1510; font-size: 16px; box-shadow: 0 2px 10px rgba(196,164,100,0.25); }
        .rp-stop-btn { padding: 0 12px; gap: 7px; background: rgba(224,120,120,0.12); color: #e07878; border: 1px solid rgba(224,120,120,0.22); font-size: 12px; font-weight: 600; }
        .rp-send-btn:hover:not(:disabled), .rp-stop-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.04); }
        .rp-send-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
        .rp-quick-actions { position: relative; display: flex; align-items: center; gap: 8px; margin-top: 8px; min-height: 30px; }
        .rp-plus-btn { width: 28px; height: 28px; border-radius: 9px; border: 1px solid rgba(196,164,100,0.25); background: rgba(196,164,100,0.1); color: #c4a464; cursor: pointer; font-size: 18px; line-height: 1; }
        .rp-plus-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .rp-quick-label { color: #5a5040; font-size: 12px; }
        .rp-quick-menu { position: absolute; left: 0; bottom: 36px; z-index: 20; width: min(360px, calc(100vw - 40px)); display: grid; grid-template-columns: 1fr; gap: 6px; padding: 10px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.1); background: rgba(20,17,13,0.98); box-shadow: 0 18px 44px rgba(0,0,0,0.35); }
        .rp-quick-item { display: flex; align-items: center; gap: 9px; text-align: left; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.04); color: #d4cfc8; border-radius: 10px; padding: 9px 10px; cursor: pointer; font-size: 12px; }
        .rp-quick-item:hover:not(:disabled) { border-color: rgba(196,164,100,0.28); background: rgba(196,164,100,0.08); color: #c4a464; }
        .rp-quick-item:disabled { opacity: 0.38; cursor: not-allowed; }
        .rp-hint { text-align: center; font-size: 11px; color: #3a3020; margin-top: 8px; }

        .rp-toast { position: fixed; right: 22px; bottom: 22px; z-index: 30; padding: 10px 14px; border-radius: 10px; font-size: 13px; box-shadow: 0 8px 28px rgba(0,0,0,0.28); }
        .rp-toast.success { background: rgba(80,160,110,0.16); color: #8fe0a8; border: 1px solid rgba(80,160,110,0.3); }
        .rp-toast.error { background: rgba(200,80,80,0.16); color: #e07878; border: 1px solid rgba(200,80,80,0.3); }

        .rp-notes-col { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; }
        .rp-notes-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
        .rp-notes-title { font-family: 'Lora', Georgia, serif; font-size: 14px; font-weight: 700; color: #e8e0d0; text-transform: uppercase; letter-spacing: 0.08em; }
        .rp-notes-subtitle { font-size: 11px; color: #5a5040; margin-top: 5px; line-height: 1.45; }
        .rp-notes-count { background: rgba(196,164,100,0.15); color: #c4a464; font-size: 11px; padding: 2px 7px; border-radius: 99px; flex-shrink: 0; }
        .rp-notes-body { flex: 1; overflow-y: auto; padding: 16px; }
        .rp-notes-empty { min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #5a5040; text-align: center; padding: 28px 20px; font-size: 13px; font-family: 'Lora', Georgia, serif; font-style: italic; border: 1px dashed rgba(255,255,255,0.08); border-radius: 14px; background: rgba(255,255,255,0.02); }
        .rp-notes-empty strong { color: #8a8070; font-style: normal; }
        .rp-note-card { position: relative; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px 38px 14px 14px; margin-bottom: 10px; transition: border-color 0.2s, background 0.2s, box-shadow 0.2s; cursor: default; }
        .rp-note-card:hover { border-color: rgba(196,164,100,0.35); background: rgba(196,164,100,0.04); }
        .rp-note-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
        .rp-note-head h3 { font-family: 'Lora', Georgia, serif; font-size: 13px; color: #c4a464; line-height: 1.45; margin: 0; }
        .rp-note-preview { font-size: 12px; line-height: 1.6; color: #8a8070; margin: 0 0 10px; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
        .rp-note-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: #5a5040; font-size: 11px; }
        .rp-note-meta span { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 99px; padding: 2px 7px; }
        .rp-note-delete { position: absolute; top: 9px; right: 9px; width: 22px; height: 22px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: #6a6050; cursor: pointer; opacity: 0.25; transition: opacity 0.2s, color 0.2s, border-color 0.2s, background 0.2s; }
        .rp-note-card:hover .rp-note-delete { opacity: 1; }
        .rp-note-delete:hover { color: #e07878; border-color: rgba(224,120,120,0.35); background: rgba(224,120,120,0.1); }
        .rp-note-edit-btn { width: 23px; height: 23px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: #8a8070; cursor: pointer; flex-shrink: 0; }
        .rp-note-edit-btn:hover { color: #c4a464; border-color: rgba(196,164,100,0.28); background: rgba(196,164,100,0.08); }
        .rp-note-edit { display: flex; flex-direction: column; gap: 10px; }
        .rp-note-edit input, .rp-note-edit textarea { width: 100%; border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; background: rgba(15,13,10,0.45); color: #d4cfc8; padding: 9px 10px; font-family: 'DM Sans', sans-serif; font-size: 13px; outline: none; }
        .rp-note-edit textarea { resize: vertical; line-height: 1.55; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent; }
        .rp-note-edit input:focus, .rp-note-edit textarea:focus { border-color: rgba(196,164,100,0.35); box-shadow: 0 0 0 3px rgba(196,164,100,0.06); }
        .rp-note-edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .rp-note-cancel, .rp-note-save { border: none; border-radius: 8px; padding: 7px 11px; font-size: 12px; cursor: pointer; }
        .rp-note-cancel { background: rgba(255,255,255,0.06); color: #8a8070; }
        .rp-note-save { background: linear-gradient(135deg, #c4a464, #8a6a30); color: #1a1510; font-weight: 700; }
        .rp-note-modal-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,0.68); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .rp-note-modal { width: min(720px, 100%); max-height: 88vh; overflow-y: auto; background: #1a1710; border: 1px solid rgba(255,255,255,0.1); border-radius: 18px; padding: 22px; box-shadow: 0 24px 80px rgba(0,0,0,0.45); }
        .rp-note-modal-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid rgba(255,255,255,0.07); padding-bottom: 14px; margin-bottom: 16px; }
        .rp-note-modal-kicker { color: #c4a464; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
        .rp-note-modal h2 { font-family: 'Lora', Georgia, serif; color: #e8e0d0; font-size: 20px; line-height: 1.35; margin: 0; }
        .rp-note-modal-actions { display: flex; gap: 7px; flex-shrink: 0; }
        .rp-note-modal-icon, .rp-note-modal-close { width: 32px; height: 32px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.04); color: #8a8070; cursor: pointer; transition: color .2s, border-color .2s, background .2s; }
        .rp-note-modal-icon:hover { color: #c4a464; border-color: rgba(196,164,100,.35); background: rgba(196,164,100,.08); }
        .rp-note-modal-icon.danger:hover { color: #e07878; border-color: rgba(224,120,120,.35); background: rgba(224,120,120,.1); }
        .rp-note-modal-close:hover { color: #e8e0d0; background: rgba(255,255,255,.08); }
        .rp-note-modal-content { white-space: pre-wrap; color: #c7bdad; line-height: 1.75; font-size: 14px; margin: 0 0 18px; }
        .rp-note-modal-sources { display: grid; gap: 10px; margin-top: 16px; }
        .rp-note-modal-sources h3 { color: #e8e0d0; font-size: 13px; margin: 0; }
        .rp-note-modal-source { border: 1px solid rgba(255,255,255,.08); border-radius: 11px; padding: 10px; background: rgba(255,255,255,.03); color: #8a8070; font-size: 12px; }
        .rp-note-modal-source strong { color: #c4a464; margin-right: 8px; }
        .rp-note-modal-source p { margin: 6px 0 0; line-height: 1.55; }
        .rp-note-modal-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; color: #5a5040; font-size: 11px; }
        .rp-note-modal-meta span { border: 1px solid rgba(255,255,255,.07); border-radius: 99px; padding: 3px 8px; background: rgba(255,255,255,.035); }
        .rp-note-modal-title-input, .rp-note-modal-edit textarea { width: 100%; border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; background: rgba(15,13,10,0.45); color: #d4cfc8; padding: 10px 12px; font-family: 'DM Sans', sans-serif; outline: none; }
        .rp-note-modal-title-input { font-family: 'Lora', Georgia, serif; font-size: 18px; }
        .rp-note-modal-edit textarea { resize: vertical; line-height: 1.65; font-size: 13px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent; }
        .rp-note-modal-edit textarea::-webkit-scrollbar, .rp-note-edit textarea::-webkit-scrollbar, .rp-quiz-input.textarea::-webkit-scrollbar { width: 3px; height: 3px; }
        .rp-note-modal-edit textarea::-webkit-scrollbar-track, .rp-note-edit textarea::-webkit-scrollbar-track, .rp-quiz-input.textarea::-webkit-scrollbar-track { background: transparent; }
        .rp-note-modal-edit textarea::-webkit-scrollbar-thumb, .rp-note-edit textarea::-webkit-scrollbar-thumb, .rp-quiz-input.textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 999px; }
        .rp-note-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
        .rp-citation-detail { margin-bottom: 14px; border: 1px solid rgba(196,164,100,0.2); background: rgba(196,164,100,0.06); border-radius: 12px; padding: 12px; }
        .rp-citation-detail-head { display: flex; align-items: center; justify-content: space-between; color: #c4a464; font-size: 12px; font-weight: 700; margin-bottom: 7px; }
        .rp-citation-detail-head button { border: none; background: transparent; color: #8a8070; cursor: pointer; font-size: 18px; line-height: 1; }
        .rp-citation-detail-title { color: #e8e0d0; font-size: 13px; font-family: 'Lora', Georgia, serif; margin-bottom: 7px; }
        .rp-citation-detail-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 7px; }
        .rp-citation-detail-meta span { font-size: 11px; color: #c4a464; border: 1px solid rgba(196,164,100,0.18); border-radius: 99px; padding: 2px 7px; background: rgba(196,164,100,0.08); }
        .rp-citation-detail p { color: #8a8070; font-size: 12px; line-height: 1.6; margin: 0; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }


        .rp-action-wrap { display: grid; gap: 7px; min-width: 0; }
        .rp-action-subnote { color: #6a6050; font-size: 11px; line-height: 1.4; padding: 0 2px 4px; }
        .rp-quick-config { border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.025); border-radius: 10px; padding: 9px; display: grid; gap: 8px; min-width: 0; }
        .rp-quick-config label { display: grid; gap: 6px; color: #8a8070; font-size: 11px; }
        .rp-quick-config select { width: 100%; border: 1px solid rgba(255,255,255,0.09); border-radius: 8px; background: #15120d; color: #d4cfc8; padding: 7px 8px; font-family: 'DM Sans', sans-serif; }
        .rp-quick-config-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #8a8070; font-size: 12px; }
        .rp-quick-config-row strong { color: #c4a464; }
        .rp-quick-config input[type="range"] { width: 100%; accent-color: #c4a464; }
        .rp-quick-config small { color: #6a6050; font-size: 11px; line-height: 1.4; }

        .rp-quiz-modal { width: min(760px, 100%); max-height: 90vh; overflow-y: auto; background: #1a1710; border: 1px solid rgba(255,255,255,0.1); border-radius: 18px; padding: 22px; box-shadow: 0 24px 80px rgba(0,0,0,0.45); }
        .rp-quiz-progress { color: #c4a464; font-size: 12px; margin-bottom: 10px; }
        .rp-quiz-question { color: #e8e0d0; font-family: 'Lora', Georgia, serif; font-size: 18px; line-height: 1.55; margin-bottom: 14px; }
        .rp-quiz-choices { display: grid; gap: 10px; }
        .rp-quiz-choice { width: 100%; display: flex; gap: 10px; text-align: left; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.035); color: #d4cfc8; border-radius: 12px; padding: 11px 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .rp-quiz-choice strong { color: #c4a464; flex-shrink: 0; }
        .rp-quiz-choice.selected { border-color: rgba(196,164,100,0.42); background: rgba(196,164,100,0.10); }
        .rp-quiz-choice.correct { border-color: rgba(80,180,120,0.42); background: rgba(80,180,120,0.11); }
        .rp-quiz-choice.wrong { border-color: rgba(224,120,120,0.42); background: rgba(224,120,120,0.10); }
        .rp-quiz-input { width: 100%; border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; background: rgba(15,13,10,0.55); color: #d4cfc8; padding: 11px 12px; font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; }
        .rp-quiz-input.textarea { resize: vertical; line-height: 1.6; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent; }
        .rp-quiz-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
        .rp-quiz-feedback { margin-top: 14px; border: 1px solid rgba(196,164,100,0.16); background: rgba(196,164,100,0.06); border-radius: 13px; padding: 12px; color: #b8ad9c; font-size: 13px; line-height: 1.6; }
        .rp-quiz-feedback strong.ok { color: #78c878; }
        .rp-quiz-feedback strong.bad { color: #e07878; }
        .rp-quiz-feedback p { margin: 6px 0; }
        .rp-quiz-feedback ul { margin: 8px 0 0 18px; }
        .rp-quiz-explanation { display: block; color: #9a8160; font-size: 12px; line-height: 1.55; margin-top: 8px; }
        .rp-choice-explanations { display: grid; gap: 4px; margin-top: 10px; }
        .rp-choice-explanations small { color: #7f7668; font-size: 11.5px; line-height: 1.45; }
        .rp-flashcard-footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }

        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
      `}</style>

      <div className="research-page">
        <header className="rp-header">
          <Link to={`/notebooks/${notebookId}`} className="rp-back">← Notebook</Link>
          <div className="rp-divider" />
          <h1 className="rp-title">{researchSession?.title || "Nghiên cứu tài liệu"}</h1>
          <button className="rp-share-btn" onClick={handleExportDocx} disabled={!researchSessionId || exportingDocx}>{exportingDocx ? "Đang tạo..." : "Chia sẻ DOCX"}</button>
          <button className="rp-clear-history" onClick={handleClearHistory} disabled={!researchSessionId || loading}>Xóa lịch sử phiên này</button>
        </header>

        <div className="rp-body">
          <QuickActionsSidebar
            actions={QUICK_ACTIONS}
            selectedDocumentIds={selectedDocumentIds}
            loading={loading || generatingFlashcards || generatingQuiz || generatingTest}
            onAction={runQuickAction}
            flashcardCount={flashcardCount}
            onFlashcardCountChange={setFlashcardCount}
            quizCount={quizCount}
            onQuizCountChange={setQuizCount}
            quizType={quizType}
            onQuizTypeChange={setQuizType}
          />
          <div className="rp-chat-col">
            <div className="rp-messages rp-app-scrollbar">
              {selectedDocumentIds.length > 0 && (
                <div className="rp-context-banner">
                  Đây là nghiên cứu từ: {selectedDocuments.length > 0 ? selectedDocuments.map((doc) => doc.filename).join(', ') : `${selectedDocumentIds.length} tài liệu đã chọn`}
                </div>
              )}
              {messages.length === 0 && !loading ? (
                <div className="rp-empty-state">
                  <div className="rp-empty-icon">✦</div>
                  <h3>Bắt đầu nghiên cứu</h3>
                  <p>Đặt câu hỏi về các tài liệu đã chọn để nhận phân tích từ AI.</p>
                  {suggestedQuestions.length > 0 && (
                    <div className="rp-empty-suggestions">
                      {suggestedQuestions.map((question, index) => (
                        <button
                          key={index}
                          type="button"
                          className="rp-empty-suggestion"
                          onClick={() => handleSuggestedQuestion(question)}
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                messages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id || `${msg.role}-${i}`}
                    msg={msg}
                    index={i}
                    regenerating={regeneratingIndex === i}
                    onCopy={handleCopy}
                    onRegenerate={handleRegenerate}
                    onSaveNote={handleSaveNote}
                    saved={savedMessageIds.has(msg.id)}
                    saving={savingNoteMessageId === msg.id}
                  />
                ))
              )}

              {streamingAnswer && (
                <div className="rp-message-row assistant">
                  <div className="rp-avatar">✦</div>
                  <div className="rp-bubble assistant">
                    <div className="rp-bubble-content">
                      <AnswerWithCitations
                        content={streamingAnswer}
                        citations={streamingCitations}
                        warning={hasWarningInContent(streamingAnswer) ? null : streamingWarning}
                      />
                      <span style={{ opacity: 0.5 }}>▌</span>
                    </div>
                  </div>
                </div>
              )}

              {loading && !streamingAnswer && regeneratingIndex == null && (
                <div className="rp-typing">
                  <div className="rp-typing-dots"><span /><span /><span /></div>
                  {activeLoadingText}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="rp-input-area">
              {error && <div className="rp-error">⚠ {error}</div>}
              {notice && <div className="rp-notice">■ {notice}</div>}
              <div className="rp-suggested-prompts" aria-label="Prompt gợi ý">
                {visibleSuggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rp-suggested-chip"
                    onClick={() => handleSuggestedQuestion(prompt)}
                    disabled={loading}
                    title={prompt}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <div className="rp-textarea-wrap">
                <textarea
                  ref={textareaRef}
                  className="rp-textarea rp-app-scrollbar"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Đặt câu hỏi về tài liệu..."
                  disabled={loading}
                  rows={2}
                  maxLength={1000}
                />
                {loading ? (
                  <button className="rp-stop-btn" onClick={handleStop} title="Dừng tạo câu trả lời" aria-label="Dừng tạo câu trả lời">
                    ■ Dừng tạo
                  </button>
                ) : (
                  <button className="rp-send-btn" onClick={handleSubmit} disabled={!input.trim()} title="Gửi (Enter)">↑</button>
                )}
              </div>
              <p className="rp-hint">Enter để gửi · Shift+Enter xuống dòng</p>
            </div>
          </div>

          <NotesPanel
            notes={notes}
            loadingNotes={loadingNotes}
            activeCitation={activeCitation}
            editingNoteId={editingNoteId}
            editDraft={editDraft}
            onEditDraftChange={setEditDraft}
            onStartEdit={handleStartEditNote}
            onCancelEdit={handleCancelEditNote}
            onSaveEdit={handleSaveEditNote}
            onDeleteNote={handleDeleteNote}
            onCloseCitation={() => setActiveCitationIndex(null)}
            selectedNote={selectedNote}
            noteDetailMode={noteDetailMode}
            noteDetailDraft={noteDetailDraft}
            onOpenNote={handleOpenNote}
            onCloseNote={handleCloseNote}
            onStartDetailEdit={handleStartDetailEdit}
            onNoteDetailDraftChange={setNoteDetailDraft}
            onSaveDetailEdit={handleSaveDetailEditNote}
          />
        </div>
      </div>

      {flashcardModal && (
        <FlashcardModal
          title={flashcardModal.title}
          flashcards={flashcardModal.flashcards}
          warning={flashcardModal.warning}
          onClose={() => setFlashcardModal(null)}
          onSave={flashcardModal.canSave ? handleSaveFlashcardsToNotes : null}
          saving={savingFlashcards}
          onGenerateMore={flashcardModal.canSave ? handleGenerateMoreFlashcards : null}
          generatingMore={generatingFlashcards}
        />
      )}

      {quizModal && (
        <QuizModal
          mode={quizModal.mode}
          title={quizModal.title}
          quiz={quizModal.quiz}
          warning={quizModal.warning}
          onClose={() => setQuizModal(null)}
          onSave={quizModal.canSave ? handleSaveQuizToNotes : null}
          saving={savingQuiz}
          onGenerateMore={quizModal.canSave && quizModal.mode !== "test" ? () => handleGenerateQuiz(5 - (quizModal.quiz?.questions?.length || 0)) : null}
          generatingMore={generatingQuiz}
        />
      )}

      {toast && <div className={`rp-toast ${toast.type}`}>{toast.message}</div>}
    </>
  );
}
