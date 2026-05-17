import { useEffect, useRef } from "react";

export default function ChatBox({
  messages,
  value,
  onChange,
  onSubmit,
  loading,
  error,
  loadingMessage,
  placeholder = "Đặt câu hỏi về tài liệu...",
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div>
      <div
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
