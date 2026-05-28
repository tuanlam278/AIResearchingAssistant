import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ─── SourceCard ───────────────────────────────────────────────────────────────
function SourceCard({ source, index }) {
  const title = source.title || source.source_name || `Đoạn ${source.chunk_id || index + 1}`;
  const url = source.url || source.link;
  const snippet = source.snippet || source.summary || source.content;
  const page = source.page;
  const score = source.score || source.relevance;
  const scoreText = typeof score === "number" ? `${Math.round(score <= 1 ? score * 100 : score)}%` : null;

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12, padding: "14px 16px", marginBottom: 10,
      transition: "border-color 0.2s, background 0.2s", cursor: "default",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(196,164,100,0.4)"; e.currentTarget.style.background = "rgba(196,164,100,0.04)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        {url
          ? <a href={url} target="_blank" rel="noreferrer" style={{ fontFamily: "'Lora', Georgia, serif", fontWeight: 600, fontSize: 13, color: "#c4a464", textDecoration: "none" }}>{title}</a>
          : <span style={{ fontFamily: "'Lora', Georgia, serif", fontWeight: 600, fontSize: 13, color: "#c4a464" }}>{title}</span>
        }
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {typeof page === "number" && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(255,255,255,0.06)", color: "#9a9080", border: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" }}>
              tr. {page}
            </span>
          )}
          {scoreText && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(196,164,100,0.12)", color: "#c4a464", border: "1px solid rgba(196,164,100,0.2)", whiteSpace: "nowrap" }}>
              {scoreText}
            </span>
          )}
        </div>
      </div>
      {snippet && (
        <p style={{ fontSize: 12, lineHeight: 1.65, color: "#8a8070", margin: 0, whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {snippet}
        </p>
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, index }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 16,
      animation: `fadeSlideIn 0.3s ease ${index * 0.05}s both`,
    }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #c4a464, #8a6a30)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, marginRight: 10, marginTop: 2, boxShadow: "0 2px 8px rgba(196,164,100,0.3)",
        }}>✦</div>
      )}
      <div style={{
        maxWidth: "75%", padding: "12px 16px",
        borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        background: isUser ? "linear-gradient(135deg, #c4a464, #a08040)" : "rgba(255,255,255,0.05)",
        border: isUser ? "none" : "1px solid rgba(255,255,255,0.08)",
        color: isUser ? "#1a1510" : "#d4cfc8",
        fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap",
        fontFamily: isUser ? "'DM Sans', sans-serif" : "'Lora', Georgia, serif",
        fontWeight: isUser ? 500 : 400,
        boxShadow: isUser ? "0 4px 16px rgba(196,164,100,0.2)" : "none",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ─── ResearchPage ─────────────────────────────────────────────────────────────
export default function ResearchPage() {
  const { notebookId } = useParams();   // ← đổi từ docId → notebookId
  const { token } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const chatHistory = useMemo(
    () => messages.map(({ role, content }) => ({ role, content })),
    [messages]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setError("");
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const response = await api.sendResearchQuery({ notebookId, question, chatHistory }, token);
      const answer = response?.answer || response?.message || response?.content || "Không có nội dung trả lời.";
      setMessages(prev => [...prev, { role: "assistant", content: answer }]);
      const nextSources = response?.sources || response?.citations || response?.documents || [];
      setSources(Array.isArray(nextSources) ? nextSources : []);
      if (nextSources.length > 0) setSources(nextSources);
    } catch (err) {
      setError(err.message || "Không thể nhận phản hồi từ hệ thống.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

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

        .rp-body {
          flex: 1; display: flex; overflow: hidden;
          border-top: 1px solid rgba(255,255,255,0.04);
        }

        /* Chat column */
        .rp-chat-col {
          flex: 1; display: flex; flex-direction: column; overflow: hidden;
          border-right: 1px solid rgba(255,255,255,0.06);
        }
        .rp-messages {
          flex: 1; overflow-y: auto; padding: 28px 24px;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent;
        }
        .rp-messages::-webkit-scrollbar { width: 3px; }
        .rp-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }

        .rp-empty-state {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          height: 100%; gap: 12px; text-align: center; padding: 40px;
        }
        .rp-empty-icon {
          width: 56px; height: 56px; border-radius: 16px;
          background: linear-gradient(135deg, rgba(196,164,100,0.15), rgba(138,106,48,0.15));
          border: 1px solid rgba(196,164,100,0.2);
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; color: #c4a464;
          margin-bottom: 4px;
        }
        .rp-empty-state h3 {
          font-family: 'Lora', Georgia, serif;
          font-size: 17px; font-weight: 600; color: #e8e0d0;
        }
        .rp-empty-state p { font-size: 13px; color: #5a5040; line-height: 1.6; max-width: 280px; }

        .rp-typing {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; width: fit-content;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px 18px 18px 4px;
          margin-bottom: 16px;
          font-size: 13px; color: #6a6050;
          font-family: 'Lora', Georgia, serif; font-style: italic;
        }
        .rp-typing-dots { display: flex; gap: 4px; }
        .rp-typing-dots span {
          width: 6px; height: 6px; border-radius: 50%;
          background: #c4a464; opacity: 0.7;
          animation: typingBounce 1.2s ease infinite;
        }
        .rp-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .rp-typing-dots span:nth-child(3) { animation-delay: 0.4s; }

        .rp-input-area {
          padding: 16px 20px 20px;
          border-top: 1px solid rgba(255,255,255,0.06);
          background: rgba(15,13,10,0.5);
        }
        .rp-error {
          display: flex; align-items: center; gap: 8px;
          background: rgba(200,80,80,0.08); border: 1px solid rgba(200,80,80,0.18);
          border-radius: 10px; padding: 9px 14px;
          font-size: 13px; color: #e07878; margin-bottom: 12px;
        }
        .rp-textarea-wrap {
          display: flex; align-items: flex-end; gap: 10px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 14px; padding: 10px 12px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .rp-textarea-wrap:focus-within {
          border-color: rgba(196,164,100,0.35);
          box-shadow: 0 0 0 3px rgba(196,164,100,0.06);
        }
        .rp-textarea {
          flex: 1; background: transparent; border: none; outline: none;
          resize: none; color: #d4cfc8;
          font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6;
          max-height: 120px; overflow-y: auto; scrollbar-width: none;
        }
        .rp-textarea::placeholder { color: #4a4030; }
        .rp-textarea::-webkit-scrollbar { display: none; }
        .rp-send-btn {
          width: 36px; height: 36px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #c4a464, #8a6a30);
          color: #1a1510; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; font-size: 16px;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 2px 10px rgba(196,164,100,0.25);
        }
        .rp-send-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.05); }
        .rp-send-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; }
        .rp-hint { text-align: center; font-size: 11px; color: #3a3020; margin-top: 8px; }

        /* Sources panel */
        .rp-sources-col {
          width: 320px; flex-shrink: 0;
          display: flex; flex-direction: column; overflow: hidden;
        }
        .rp-sources-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .rp-sources-title {
          font-family: 'Lora', Georgia, serif; font-size: 13px; font-weight: 600;
          color: #8a8070; text-transform: uppercase; letter-spacing: 0.08em;
          display: flex; align-items: center; gap: 8px;
        }
        .rp-sources-count {
          background: rgba(196,164,100,0.15); color: #c4a464;
          font-size: 11px; padding: 2px 7px; border-radius: 99px;
          font-family: 'DM Sans', sans-serif; font-style: normal; letter-spacing: 0;
        }
        .rp-sources-body {
          flex: 1; overflow-y: auto; padding: 16px;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.06) transparent;
        }
        .rp-sources-body::-webkit-scrollbar { width: 3px; }
        .rp-sources-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
        .rp-sources-empty {
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          height: 100%; gap: 8px; color: #3a3020;
          text-align: center; padding: 32px 20px;
          font-size: 13px; font-family: 'Lora', Georgia, serif; font-style: italic;
        }

        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>

      <div className="research-page">
        {/* Header */}
        <header className="rp-header">
          <Link to={`/notebooks/${notebookId}`} className="rp-back">
            ← Notebook
          </Link>
          <div className="rp-divider" />
          <h1 className="rp-title">Nghiên cứu tài liệu</h1>
        </header>

        {/* Body */}
        <div className="rp-body">

          {/* Chat column */}
          <div className="rp-chat-col">
            <div className="rp-messages">
              {messages.length === 0 && !loading ? (
                <div className="rp-empty-state">
                  <div className="rp-empty-icon">✦</div>
                  <h3>Bắt đầu nghiên cứu</h3>
                  <p>Đặt câu hỏi về toàn bộ tài liệu trong notebook để nhận phân tích từ AI.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <MessageBubble key={`${msg.role}-${i}`} msg={msg} index={i} />
                ))
              )}

              {loading && (
                <div className="rp-typing">
                  <div className="rp-typing-dots">
                    <span /><span /><span />
                  </div>
                  Đang phân tích tài liệu...
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="rp-input-area">
              {error && <div className="rp-error">⚠ {error}</div>}
              <div className="rp-textarea-wrap">
                <textarea
                  ref={textareaRef}
                  className="rp-textarea"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Đặt câu hỏi về tài liệu..."
                  disabled={loading}
                  rows={2}
                  maxLength={1000}
                />
                <button
                  className="rp-send-btn"
                  onClick={handleSubmit}
                  disabled={loading || !input.trim()}
                  title="Gửi (Enter)"
                >
                  ↑
                </button>
              </div>
              <p className="rp-hint">Enter để gửi · Shift+Enter xuống dòng</p>
            </div>
          </div>

          {/* Sources panel */}
          <div className="rp-sources-col">
            <div className="rp-sources-header">
              <div className="rp-sources-title">
                Nguồn trích dẫn
                {sources.length > 0 && (
                  <span className="rp-sources-count">{sources.length}</span>
                )}
              </div>
            </div>
            <div className="rp-sources-body">
              {sources.length === 0 ? (
                <div className="rp-sources-empty">
                  Các đoạn văn bản liên quan sẽ hiển thị tại đây sau khi bạn đặt câu hỏi.
                </div>
              ) : (
                sources.map((src, i) => (
                  <SourceCard key={src.chunk_id || src.url || i} source={src} index={i} />
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}