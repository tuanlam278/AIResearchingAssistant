import { useEffect, useMemo, useRef } from "react";

const FALLBACK_PROMPTS = [
  "Tóm tắt ý chính của tài liệu này",
  "Giải thích thuật ngữ quan trọng trong tài liệu",
  "Tạo câu hỏi ôn tập từ nội dung trên",
];

function cleanPrompts(prompts = []) {
  const source = Array.isArray(prompts) && prompts.length ? prompts : FALLBACK_PROMPTS;
  return source
    .map((prompt) => String(prompt || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((prompt, index, arr) => arr.indexOf(prompt) === index)
    .slice(0, 3)
    .map((prompt) => (prompt.length > 96 ? `${prompt.slice(0, 93)}...` : prompt));
}

export default function ChatBox({
  messages,
  value,
  onChange,
  onSubmit,
  loading,
  error,
  loadingMessage,
  suggestedPrompts = FALLBACK_PROMPTS,
  onSuggestedPromptClick,
  placeholder = "Đặt câu hỏi về tài liệu...",
}) {
  const bottomRef = useRef(null);
  const visiblePrompts = useMemo(() => cleanPrompts(suggestedPrompts), [suggestedPrompts]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  const handlePromptClick = (prompt) => {
    if (onSuggestedPromptClick) onSuggestedPromptClick(prompt);
    else onChange?.(prompt);
  };

  return (
    <div>
      <div
        className="app-scrollbar"
        style={{
          minHeight: 320,
          maxHeight: 540,
          overflowY: "auto",
          marginBottom: 12,
        }}
      >
        {messages.length === 0 && (
          <p>Hãy nhập câu hỏi để bắt đầu nghiên cứu tài liệu.</p>
        )}

        {messages.map((msg, index) => (
          <div key={`${msg.role}-${index}`} style={{ marginBottom: 10 }}>
            <strong>{msg.role === "user" ? "Bạn" : "Trợ lý"}:</strong>
            {msg.warning && (
              <div style={{ marginTop: 6, color: "#92400e", background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "6px 8px" }}>
                ⚠ {msg.warning}
              </div>
            )}
            <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>
              {msg.content}
            </p>
          </div>
        ))}

        {loading && (
          <p style={{ marginTop: 8 }}>
            {loadingMessage || "Đang xử lý câu trả lời..."}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p style={{ color: "red", marginBottom: 8 }}>{error}</p>}

      <div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }} aria-label="Prompt gợi ý">
          {visiblePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handlePromptClick(prompt)}
              disabled={loading}
              style={{
                border: "1px solid #d6b36a",
                borderRadius: 999,
                background: "#fff8e6",
                color: "#5f4518",
                cursor: loading ? "not-allowed" : "pointer",
                padding: "6px 10px",
              }}
              onFocus={(event) => { event.currentTarget.style.boxShadow = "0 0 0 3px rgba(214,179,106,.35)"; }}
              onBlur={(event) => { event.currentTarget.style.boxShadow = "none"; }}
              onMouseEnter={(event) => { event.currentTarget.style.background = "#fdecc0"; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = "#fff8e6"; }}
            >
              {prompt}
            </button>
          ))}
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={loading}
          rows={3}
          maxLength={2000}
          style={{ width: "100%", resize: "vertical", marginBottom: 8 }}
        />
        <button onClick={onSubmit} disabled={loading || !value?.trim()}>
          {loading ? "Đang gửi..." : "Gửi"}
        </button>
      </div>
    </div>
  );
}
