import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

const LOADING_LABELS = {
  reading: "Đang đọc tài liệu...",
  retrieving: "Đang tìm đoạn liên quan...",
  generating: "Đang tạo câu trả lời...",
};

const isAbortError = (err) => err?.name === "AbortError" || err?.code === "ABORT_ERR";

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

function citationTooltip(citation) {
  const title = citation.document_title || "Tài liệu";
  const page = citation.page_start ? `Trang ${citation.page_start}` : "Không rõ trang";
  const score = typeof citation.score === "number"
    ? `Độ tin cậy ${Math.round((citation.score <= 1 ? citation.score : citation.score / 100) * 100)}%`
    : "";
  return [title, page, score].filter(Boolean).join(" · ");
}

function CitationButton({ citation, onClick }) {
  return (
    <button
      type="button"
      className="rp-citation-badge"
      title={citationTooltip(citation)}
      aria-label={`Mở nguồn ${citation.citation_index}`}
      onClick={() => onClick?.(citation.citation_index)}
    >
      [{citation.citation_index}]
    </button>
  );
}

function AnswerWithCitations({ content, citations = [], onCitationClick }) {
  const citationMap = useMemo(
    () => new Map(citations.map((citation) => [String(citation.citation_index), citation])),
    [citations]
  );
  const parts = content.split(/(\[(?:\d+)\])/g);
  const hasInlineCitation = /\[(\d+)\]/.test(content);

  return (
    <>
      {parts.map((part, index) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (!match) return <span key={`${part}-${index}`}>{part}</span>;

        const citation = citationMap.get(match[1]);
        if (!citation) return <span key={`${part}-${index}`}>{part}</span>;

        return (
          <CitationButton
            key={`${part}-${index}`}
            citation={citation}
            onClick={onCitationClick}
          />
        );
      })}

      {!hasInlineCitation && citations.length > 0 && (
        <span className="rp-citation-footer">
          Nguồn:{" "}
          {citations.map((citation) => (
            <CitationButton
              key={citation.citation_index}
              citation={citation}
              onClick={onCitationClick}
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

      <div className="rp-notes-body">
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
              <div key={note.id} className="rp-note-card">
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
    </div>
  );
}

function MessageBubble({
  msg,
  index,
  onCopy,
  onRegenerate,
  onCitationClick,
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
              onCitationClick={onCitationClick}
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
  const [regeneratingIndex, setRegeneratingIndex] = useState(null);
  const [activeCitationIndex, setActiveCitationIndex] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editDraft, setEditDraft] = useState({ title: "", content: "" });
  const [savingNoteMessageId, setSavingNoteMessageId] = useState(null);
  const [savedMessageIds, setSavedMessageIds] = useState(() => new Set());
  const [suggestedQuestions, setSuggestedQuestions] = useState(() => location.state?.suggestedQuestions || []);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const activeRequestRef = useRef(null);
  const loadingTimerRef = useRef(null);

  const chatHistory = useMemo(
    () => messages.map(({ role, content }) => ({ role, content })),
    [messages]
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
    let cancelled = false;
    setLoadingNotes(true);
    api.getWorkspaceNotes(notebookId, token)
      .then((result) => {
        if (cancelled) return;
        const fetchedNotes = result?.notes ?? [];
        setNotes(fetchedNotes);
        setSavedMessageIds(new Set(fetchedNotes.map((note) => note.source_message_id).filter(Boolean)));
      })
      .catch((err) => {
        if (!cancelled) showToast("error", err.message || "Không thể tải ghi chú.");
      })
      .finally(() => {
        if (!cancelled) setLoadingNotes(false);
      });
    return () => { cancelled = true; };
  }, [notebookId, token]);

  useEffect(() => {
    const prefillQuestion = location.state?.prefillQuestion;
    const incomingSuggestions = location.state?.suggestedQuestions || [];
    if (incomingSuggestions.length > 0) setSuggestedQuestions(incomingSuggestions);
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

  const handleCitationClick = (citationIndex) => {
    setActiveCitationIndex(citationIndex);
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
    let streamFailed = false;

    const isActive = () => activeRequestRef.current?.id === requestId && !activeRequestRef.current?.cancelled;

    try {
      await api.streamResearchQuery(
        { notebookId, question, chatHistory: history },
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
          onToken: (chunk) => {
            if (!isActive()) return;
            fullAnswer += chunk;
            setLoadingStage("generating");
            if (mode === "regenerate") {
              setMessages((prev) => prev.map((msg, i) => (
                i === targetIndex ? { ...msg, content: fullAnswer, citations: latestCitations } : msg
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
            };

            if (mode === "regenerate") {
              setMessages((prev) => prev.map((msg, i) => (i === targetIndex ? assistantMessage : msg)));
            } else {
              setMessages((prev) => [...prev, assistantMessage]);
            }
            setStreamingAnswer("");
            setStreamingCitations([]);
            setLoading(false);
            setRegeneratingIndex(null);
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
      setRegeneratingIndex(null);
      clearLoadingTimer();
      activeRequestRef.current = null;
    }
  };

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    const userMessage = {
      id: crypto.randomUUID?.() || `${Date.now()}-user`,
      role: "user",
      content: question,
    };
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, userMessage]);

    await startChatRequest({ question, history, mode: "new" });
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
      showToast("success", "Đã xoá ghi chú.");
    } catch (err) {
      showToast("error", err.message || "Không thể xoá ghi chú.");
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

        .rp-body { flex: 1; display: flex; overflow: hidden; border-top: 1px solid rgba(255,255,255,0.04); }
        .rp-chat-col { flex: 1; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid rgba(255,255,255,0.06); }
        .rp-messages { flex: 1; overflow-y: auto; padding: 28px 24px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent; }
        .rp-messages::-webkit-scrollbar { width: 3px; }
        .rp-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }

        .rp-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; text-align: center; padding: 40px; }
        .rp-empty-icon { width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, rgba(196,164,100,0.15), rgba(138,106,48,0.15)); border: 1px solid rgba(196,164,100,0.2); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #c4a464; margin-bottom: 4px; }
        .rp-empty-state h3 { font-family: 'Lora', Georgia, serif; font-size: 17px; font-weight: 600; color: #e8e0d0; }
        .rp-empty-state p { font-size: 13px; color: #5a5040; line-height: 1.6; max-width: 280px; }
        .rp-empty-suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 680px; margin-top: 10px; }
        .rp-empty-suggestion { border: 1px solid rgba(196,164,100,0.18); background: rgba(196,164,100,0.08); color: #c4a464; border-radius: 999px; padding: 8px 11px; cursor: pointer; font-size: 12px; }
        .rp-empty-suggestion:hover { background: rgba(196,164,100,0.14); border-color: rgba(196,164,100,0.35); }

        .rp-message-row { display: flex; margin-bottom: 16px; }
        .rp-message-row.user { justify-content: flex-end; }
        .rp-message-row.assistant { justify-content: flex-start; }
        .rp-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, #c4a464, #8a6a30); display: flex; align-items: center; justify-content: center; font-size: 14px; margin-right: 10px; margin-top: 2px; box-shadow: 0 2px 8px rgba(196,164,100,0.3); }
        .rp-bubble { max-width: 75%; padding: 12px 16px; font-size: 14px; line-height: 1.7; white-space: pre-wrap; position: relative; }
        .rp-bubble.user { border-radius: 18px 18px 4px 18px; background: linear-gradient(135deg, #c4a464, #a08040); color: #1a1510; font-family: 'DM Sans', sans-serif; font-weight: 500; box-shadow: 0 4px 16px rgba(196,164,100,0.2); }
        .rp-bubble.assistant { border-radius: 18px 18px 18px 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #d4cfc8; font-family: 'Lora', Georgia, serif; font-weight: 400; padding-bottom: 34px; }
        .rp-bubble-content { white-space: pre-wrap; }
        .rp-bubble-loading { color: #8a8070; font-style: italic; }
        .rp-bubble-actions { position: absolute; right: 10px; bottom: 7px; display: flex; gap: 6px; opacity: 0.35; transition: opacity 0.2s; }
        .rp-bubble.assistant:hover .rp-bubble-actions { opacity: 1; }
        .rp-icon-btn { width: 22px; height: 22px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: #9a9080; cursor: pointer; font-size: 12px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
        .rp-icon-btn:hover:not(:disabled) { color: #c4a464; border-color: rgba(196,164,100,0.25); background: rgba(196,164,100,0.08); }
        .rp-icon-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        .rp-citation-badge { display: inline-flex; align-items: center; justify-content: center; margin: 0 2px; padding: 0 4px; border: none; background: rgba(196,164,100,0.12); color: #c4a464; border-radius: 5px; cursor: pointer; font: inherit; font-family: 'DM Sans', sans-serif; font-size: 12px; }
        .rp-citation-badge:hover { background: rgba(196,164,100,0.22); }
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
        .rp-textarea-wrap { display: flex; align-items: flex-end; gap: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 10px 12px; transition: border-color 0.2s, box-shadow 0.2s; }
        .rp-textarea-wrap:focus-within { border-color: rgba(196,164,100,0.35); box-shadow: 0 0 0 3px rgba(196,164,100,0.06); }
        .rp-textarea { flex: 1; background: transparent; border: none; outline: none; resize: none; color: #d4cfc8; font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; max-height: 120px; overflow-y: auto; scrollbar-width: none; }
        .rp-textarea::placeholder { color: #4a4030; }
        .rp-textarea::-webkit-scrollbar { display: none; }
        .rp-send-btn, .rp-stop-btn { height: 36px; border-radius: 10px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s; }
        .rp-send-btn { width: 36px; background: linear-gradient(135deg, #c4a464, #8a6a30); color: #1a1510; font-size: 16px; box-shadow: 0 2px 10px rgba(196,164,100,0.25); }
        .rp-stop-btn { padding: 0 12px; gap: 7px; background: rgba(224,120,120,0.12); color: #e07878; border: 1px solid rgba(224,120,120,0.22); font-size: 12px; font-weight: 600; }
        .rp-send-btn:hover:not(:disabled), .rp-stop-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.04); }
        .rp-send-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
        .rp-hint { text-align: center; font-size: 11px; color: #3a3020; margin-top: 8px; }

        .rp-toast { position: fixed; right: 22px; bottom: 22px; z-index: 30; padding: 10px 14px; border-radius: 10px; font-size: 13px; box-shadow: 0 8px 28px rgba(0,0,0,0.28); }
        .rp-toast.success { background: rgba(80,160,110,0.16); color: #8fe0a8; border: 1px solid rgba(80,160,110,0.3); }
        .rp-toast.error { background: rgba(200,80,80,0.16); color: #e07878; border: 1px solid rgba(200,80,80,0.3); }

        .rp-notes-col { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; }
        .rp-notes-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
        .rp-notes-title { font-family: 'Lora', Georgia, serif; font-size: 14px; font-weight: 700; color: #e8e0d0; text-transform: uppercase; letter-spacing: 0.08em; }
        .rp-notes-subtitle { font-size: 11px; color: #5a5040; margin-top: 5px; line-height: 1.45; }
        .rp-notes-count { background: rgba(196,164,100,0.15); color: #c4a464; font-size: 11px; padding: 2px 7px; border-radius: 99px; flex-shrink: 0; }
        .rp-notes-body { flex: 1; overflow-y: auto; padding: 16px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent; }
        .rp-notes-body::-webkit-scrollbar { width: 3px; }
        .rp-notes-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
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
        .rp-note-edit textarea { resize: vertical; line-height: 1.55; }
        .rp-note-edit input:focus, .rp-note-edit textarea:focus { border-color: rgba(196,164,100,0.35); box-shadow: 0 0 0 3px rgba(196,164,100,0.06); }
        .rp-note-edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .rp-note-cancel, .rp-note-save { border: none; border-radius: 8px; padding: 7px 11px; font-size: 12px; cursor: pointer; }
        .rp-note-cancel { background: rgba(255,255,255,0.06); color: #8a8070; }
        .rp-note-save { background: linear-gradient(135deg, #c4a464, #8a6a30); color: #1a1510; font-weight: 700; }
        .rp-citation-detail { margin-bottom: 14px; border: 1px solid rgba(196,164,100,0.2); background: rgba(196,164,100,0.06); border-radius: 12px; padding: 12px; }
        .rp-citation-detail-head { display: flex; align-items: center; justify-content: space-between; color: #c4a464; font-size: 12px; font-weight: 700; margin-bottom: 7px; }
        .rp-citation-detail-head button { border: none; background: transparent; color: #8a8070; cursor: pointer; font-size: 18px; line-height: 1; }
        .rp-citation-detail-title { color: #e8e0d0; font-size: 13px; font-family: 'Lora', Georgia, serif; margin-bottom: 7px; }
        .rp-citation-detail-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 7px; }
        .rp-citation-detail-meta span { font-size: 11px; color: #c4a464; border: 1px solid rgba(196,164,100,0.18); border-radius: 99px; padding: 2px 7px; background: rgba(196,164,100,0.08); }
        .rp-citation-detail p { color: #8a8070; font-size: 12px; line-height: 1.6; margin: 0; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }

        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }
      `}</style>

      <div className="research-page">
        <header className="rp-header">
          <Link to={`/notebooks/${notebookId}`} className="rp-back">← Notebook</Link>
          <div className="rp-divider" />
          <h1 className="rp-title">Nghiên cứu tài liệu</h1>
        </header>

        <div className="rp-body">
          <div className="rp-chat-col">
            <div className="rp-messages">
              {messages.length === 0 && !loading ? (
                <div className="rp-empty-state">
                  <div className="rp-empty-icon">✦</div>
                  <h3>Bắt đầu nghiên cứu</h3>
                  <p>Đặt câu hỏi về toàn bộ tài liệu trong notebook để nhận phân tích từ AI.</p>
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
                    onCitationClick={handleCitationClick}
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
                        onCitationClick={handleCitationClick}
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
              <div className="rp-textarea-wrap">
                <textarea
                  ref={textareaRef}
                  className="rp-textarea"
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
          />
        </div>
      </div>

      {toast && <div className={`rp-toast ${toast.type}`}>{toast.message}</div>}
    </>
  );
}
