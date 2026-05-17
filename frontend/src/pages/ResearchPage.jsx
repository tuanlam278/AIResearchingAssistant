import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ChatBox from "../components/ChatBox";
import SourceCard from "../components/SourceCard";
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext'; // Bổ sung import Context

export default function ResearchPage() {
  const { docId } = useParams();
  const { token } = useAuth(); // Móc token từ hệ thống ra
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const chatHistory = useMemo(
    () => messages.map(({ role, content }) => ({ role, content })),
    [messages],
  );

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      // Đã nhét thêm token vào làm tham số thứ 2 để Server cho phép gọi
      const response = await api.sendResearchQuery({
        docId,
        question,
        chatHistory,
      }, token);

      const answer =
        response?.answer ||
        response?.message ||
        response?.content ||
        "Không có nội dung trả lời.";
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);

      const nextSources =
        response?.sources ||
        response?.citations ||
        response?.documents ||
        response?.links ||
        [];
      setSources(Array.isArray(nextSources) ? nextSources : []);
    } catch (err) {
      setError(err.message || "Không thể nhận phản hồi từ hệ thống.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Link to="/">← Quay lại</Link>
      <h2>Nghiên cứu tài liệu</h2>
      <p style={{ fontSize: 14, color: "#555" }}>Mã tài liệu: {docId}</p>

      <ChatBox
        messages={messages}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        loading={loading}
        error={error}
      />

      <div style={{ marginTop: 16 }}>
        <h3>Nguồn tham khảo</h3>
        {sources.length === 0 ? (
          <p>Chưa có nguồn tham khảo.</p>
        ) : (
          sources.map((source, index) => (
            <SourceCard
              key={source.chunk_id || source.url || index}
              source={source}
            />
          ))
        )}
      </div>
    </div>
  );
}